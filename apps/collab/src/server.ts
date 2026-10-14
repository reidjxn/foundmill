/**
 * The collab server (docs/ARCHITECTURE.md §1 apps/collab; BUILD §3.1, §11.5): Hocuspocus 4 over Yjs for spec blocks.
 *
 * - `onAuthenticate`: verifies the token (Supabase JWT, collab service token or dev token), parses the document
 *   name `spec:<businessId>:<specBlockId>`, loads the block through repos (404 → denied) and checks membership and
 *   the member's Product section permission (`effectivePermission`, as product.spec.* in apps/api): no access →
 *   denied, read → read-only, write (owners/admins/members only) → read-write; an agent's service token must be bound to the
 *   business and the agent must exist there; agents are read-only on pinned (human-edited) blocks (AC-11.5.3).
 *   The same check runs again for every open connection every `reauthorizeMs` (security review S1): a member who was
 *   removed, walled from Product or made read-only meanwhile is closed or turned read-only without reconnecting.
 * - `onLoadDocument`: fills the fresh Y.Doc from `spec_blocks.content` (ProseMirror JSON → y-prosemirror layout).
 * - `onStoreDocument`: debounced (`debounce` / `maxDebounce`) write back through `repos.product.editBlock`, which
 *   bumps `version` and records the last writer as `authored_by_kind` / `authored_by`. A store that carries any human
 *   update since the last one (tracked in `onChange`, so an agent's update landing last in the same debounce window
 *   does not hide it) pins the block, so agents are read-only on it from their next connection or HTTP edit.
 * - HTTP on the same port: `GET /health`; `GET|POST /v1/spec-blocks/:businessId/:specBlockId` for agents (Bearer
 *   service token) that have no WebSocket editor: POST reconciles a full ProseMirror document into the live CRDT
 *   through a direct connection, so concurrent human edits in untouched blocks survive.
 */
import { APP_NAME } from "@foundmill/config";
import { repos, type Db, type SpecBlock } from "@foundmill/db";
import { AppError, NotFoundError, hasSectionAccess, type Section } from "@foundmill/shared";
import { Server, type Hocuspocus, type onAuthenticatePayload, type onChangePayload, type onLoadDocumentPayload, type onRequestPayload, type onStoreDocumentPayload, type ServerConfiguration } from "@hocuspocus/server";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CollabAuthError, type CollabAuthenticator, type Principal } from "./auth";
import { InvalidDocumentNameError, parseDocumentName, specDocumentName, type SpecDocumentName } from "./document-name";
import { DEFAULT_FRAGMENT, fragmentToPmDoc, InvalidProseMirrorJsonError, parsePmDoc, reconcileFragment, type PmNode, type ReconcileResult } from "./prosemirror";
import { createSpecBlockStore, type Author, type SpecBlockStore } from "./store";

export const COLLAB_SERVICE = "collab" as const;
export const WRITE_ROLES = ["owner", "admin", "member"] as const;
/** The section whose permissions govern spec blocks (staff walled from Product neither read nor edit them). */
export const SPEC_SECTION: Section = "product";

export interface CollabLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const silentLogger: CollabLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Per-connection context set by `onAuthenticate` and carried into `onStoreDocument.lastContext`. */
export interface CollabContext {
  principal: Principal;
  businessId: string;
  specBlockId: string;
  readOnly: boolean;
}

export interface CollabServerDeps {
  db: Db;
  auth: CollabAuthenticator;
  log?: CollabLogger;
  store?: SpecBlockStore;
  /** For `/health`: whether the database answered at boot (see db-boot.ts). Defaults to true. */
  dbReady?: () => boolean;
  /**
   * Whether a signed-in person may use the app at all (`SIGNUP_ALLOWLIST`, the same list apps/api checks on every
   * request); one it refuses is denied like a non-member. Absent: everyone who signs in.
   */
  admit?: (user: { userId: string; email: string | null }) => boolean;
}

export interface CollabServerOptions {
  /** Hosts to try in order (Railway's private network is IPv6-only, §17). */
  hosts?: readonly string[];
  /** `onStoreDocument` debounce (ms). Hocuspocus default 2000. */
  debounceMs?: number;
  /** Upper bound before a store is forced (ms). Hocuspocus default 10000. */
  maxDebounceMs?: number;
  /** Idle-connection timeout (ms). */
  timeoutMs?: number;
  /** Yjs field used by the editor (Tiptap Collaboration default: "default"). */
  field?: string;
  /** Max JSON body for the HTTP edit endpoint (bytes). */
  maxBodyBytes?: number;
  /** How often every open connection is authorized again (default 15 000 ms; security review S1). */
  reauthorizeMs?: number;
  now?: () => Date;
}

export interface Authorization {
  block: SpecBlock;
  readOnly: boolean;
  /** Why the principal is read-only, when it is. */
  reason: "viewer" | "pinned" | null;
}

export interface HealthReport {
  ok: boolean;
  app: string;
  service: typeof COLLAB_SERVICE;
  uptimeMs: number;
  /** False when the database did not answer at boot (the server still runs; see db-boot.ts). */
  db: boolean;
  documents: number;
  connections: number;
  closing: boolean;
}

export interface EditResult extends ReconcileResult {
  businessId: string;
  specBlockId: string;
  version: number;
  /** Fingerprint of the content after the edit, to pass as `expectedRevision` on the next edit. */
  revision: string;
  content: PmNode;
}

export interface ReadResult {
  content: PmNode;
  version: number;
  /** Fingerprint of `content`; pass it back as `expectedRevision` to edit only if nobody changed the block meanwhile. */
  revision: string;
  pinned: boolean;
  live: boolean;
}

export interface EditOptions {
  /** Optimistic concurrency: when given and different from the current revision the edit is refused (409). */
  expectedRevision?: string | null;
}

export class StaleRevisionError extends AppError {
  constructor(public readonly currentRevision: string, expected: string) {
    super("stale_revision", `The block changed since revision ${expected} (now ${currentRevision}); read it again and re-apply`, 409, { currentRevision, expectedRevision: expected });
  }
}

export interface CollabServer {
  readonly hocuspocus: Hocuspocus<CollabContext>;
  readonly store: SpecBlockStore;
  /** Listens on the first host that accepts the port; port 0 picks an ephemeral port. */
  listen(port: number): Promise<{ port: number; host: string }>;
  /** `ws://host:port` once listening. */
  readonly url: string | null;
  readonly port: number | null;
  health(): HealthReport;
  /** Authorises a principal for one spec block (what `onAuthenticate` runs). */
  authorize(principal: Principal, name: SpecDocumentName): Promise<Authorization>;
  /** Applies a whole ProseMirror document as a minimal edit to the live CRDT and persists it. */
  edit(principal: Principal, name: SpecDocumentName, content: unknown, options?: EditOptions): Promise<EditResult>;
  /** Current content: the live document when loaded, otherwise the stored row. */
  read(principal: Principal, name: SpecDocumentName): Promise<ReadResult>;
  /**
   * Authorizes every open connection again (what the server runs every `reauthorizeMs`): a connection whose principal
   * lost access is closed, one that lost write access turns read-only (and back). Resolves to the number closed.
   */
  reauthorize(): Promise<number>;
  /** Flushes pending stores, closes every connection and the HTTP server. */
  close(): Promise<void>;
}

export class ReadOnlyError extends AppError {
  constructor(public readonly reason: "viewer" | "pinned") {
    super(reason === "pinned" ? "spec_block_pinned" : "read_only", reason === "pinned" ? "Pinned blocks are human-edited: agents may only propose changes (BUILD §11.5)" : "This membership may not edit spec blocks", reason === "pinned" ? 409 : 403);
  }
}

class CollabDenied extends Error {
  constructor(public readonly reason: string, message = reason) {
    super(message);
    this.name = "CollabDenied";
  }
}

const authorOf = (ctx: Partial<CollabContext> | undefined): Author => {
  const p = ctx?.principal;
  if (!p) return { kind: "system", id: null };
  return p.kind === "user" ? { kind: "user", id: p.userId } : { kind: "agent", id: p.agentId };
};

export function createCollabServer(deps: CollabServerDeps, options: CollabServerOptions = {}): CollabServer {
  const log = deps.log ?? silentLogger;
  const field = options.field ?? DEFAULT_FRAGMENT;
  const store = deps.store ?? createSpecBlockStore(deps.db, { field });
  const hosts = options.hosts ?? ["::", "0.0.0.0"];
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const startedAt = Date.now();
  let closing = false;
  let bound: { port: number; host: string } | null = null;
  /** Revision = fingerprint of the content a reader saw; an edit with `expectedRevision` only applies to that content. */
  const revisionOf = (content: PmNode) => createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  /** Documents a human changed since their last store: that store pins the block (AC-11.5.3). */
  const humanEdits = new Set<string>();
  const liveContent = (documentName: string): PmNode | null => {
    const live = hocuspocus.documents.get(documentName);
    return live && !live.isLoading ? fragmentToPmDoc(live.getXmlFragment(field)) : null;
  };

  async function authorize(principal: Principal, name: SpecDocumentName): Promise<Authorization> {
    const block = await store.getBlock(name.businessId, name.specBlockId);
    if (block.archivedAt) throw new NotFoundError("spec block", name.specBlockId);
    if (principal.kind === "user") {
      if (deps.admit && !deps.admit(principal)) throw new CollabDenied("not-invited", `user ${principal.userId} is not on the invite list`);
      const { membership, business } = await repos.memberships.access(deps.db, name.businessId, principal.userId);
      if (!membership) throw new CollabDenied("not-a-member", `user ${principal.userId} is not a member of business ${name.businessId}`);
      // An archived business is closed to its members everywhere else too (apps/api answers NOT_FOUND).
      if (!business) throw new CollabDenied("not-found", `business ${name.businessId} is archived`);
      // Spec blocks belong to the Product section: the same walls as product.spec.* in apps/api (BUILD §11.9).
      if (!hasSectionAccess(membership, SPEC_SECTION, "read")) throw new CollabDenied("section-denied", `user ${principal.userId} has no access to ${SPEC_SECTION} in business ${name.businessId}`);
      const canWrite = hasSectionAccess(membership, SPEC_SECTION, "write");
      return { block, readOnly: !canWrite, reason: canWrite ? null : "viewer" };
    }
    if (principal.businessId !== name.businessId) throw new CollabDenied("wrong-business", `service token is bound to business ${principal.businessId}`);
    await repos.agents.get(deps.db, name.businessId, principal.agentId); // NotFoundError when the agent is not in the club
    return { block, readOnly: block.pinned, reason: block.pinned ? "pinned" : null };
  }

  const onAuthenticate = async (data: onAuthenticatePayload<CollabContext>): Promise<Partial<CollabContext>> => {
    let name: SpecDocumentName;
    try {
      name = parseDocumentName(data.documentName);
    } catch (err) {
      throw new CollabDenied((err as InvalidDocumentNameError).reason ?? "invalid-document-name");
    }
    let principal: Principal;
    try {
      principal = await deps.auth.verify(data.token);
    } catch (err) {
      log.warn({ documentName: data.documentName, err: (err as Error).message }, "collab: token rejected");
      throw new CollabDenied(err instanceof CollabAuthError ? err.reason : "permission-denied");
    }
    try {
      const auth = await authorize(principal, name);
      data.connectionConfig.readOnly = auth.readOnly;
      log.debug({ documentName: data.documentName, principal, readOnly: auth.readOnly }, "collab: authenticated");
      return { principal, businessId: name.businessId, specBlockId: name.specBlockId, readOnly: auth.readOnly };
    } catch (err) {
      if (err instanceof CollabDenied) throw err;
      if (err instanceof NotFoundError) throw new CollabDenied("not-found", err.message);
      log.error({ documentName: data.documentName, err }, "collab: authorisation failed");
      throw new CollabDenied("permission-denied");
    }
  };

  const onLoadDocument = async (data: onLoadDocumentPayload<CollabContext>): Promise<void> => {
    const name = parseDocumentName(data.documentName);
    await store.load(name.businessId, name.specBlockId, data.document);
  };

  const onChange = async (data: onChangePayload<CollabContext>): Promise<void> => {
    // The load's own fill carries no principal; read-only connections never get an update this far.
    if ((data.context as Partial<CollabContext> | undefined)?.principal?.kind === "user") humanEdits.add(data.documentName);
  };

  const onStoreDocument = async (data: onStoreDocumentPayload<CollabContext>): Promise<void> => {
    const name = parseDocumentName(data.documentName);
    const author = authorOf(data.lastContext);
    const humanEdited = humanEdits.delete(data.documentName);
    try {
      const result = await store.save(name.businessId, name.specBlockId, data.document, author, { humanEdited });
      if (result.stored) log.info({ documentName: data.documentName, version: result.block?.version, author, pinned: result.block?.pinned }, "collab: stored spec block");
    } catch (err) {
      if (humanEdited) humanEdits.add(data.documentName);
      // Hocuspocus keeps the document in memory when the store hook rejects, so nothing is lost; retry on next change.
      log.error({ documentName: data.documentName, err }, "collab: store failed; document kept in memory");
      throw err;
    }
  };

  const onRequest = async (data: onRequestPayload): Promise<void> => {
    await handleHttp(data.request, data.response);
    // A falsy rejection tells Hocuspocus the response was handled (its request handler only rethrows truthy errors).
    throw null;
  };

  const configuration: Partial<ServerConfiguration<CollabContext>> = {
    name: `${APP_NAME} collab`,
    port: 0,
    address: hosts[0],
    quiet: true,
    stopOnSignals: false,
    unloadImmediately: false,
    debounce: options.debounceMs ?? 2000,
    maxDebounce: options.maxDebounceMs ?? 10_000,
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    onAuthenticate,
    onLoadDocument,
    onChange,
    onStoreDocument,
    onRequest,
    async afterUnloadDocument({ documentName }) {
      const name = parseDocumentName(documentName);
      humanEdits.delete(documentName);
      store.forget(name.businessId, name.specBlockId);
    },
  };
  const server = new Server<CollabContext>(configuration);
  const hocuspocus = server.hocuspocus;

  function health(): HealthReport {
    const db = deps.dbReady ? deps.dbReady() : true;
    return { ok: !closing && db, db, app: APP_NAME, service: COLLAB_SERVICE, uptimeMs: Date.now() - startedAt, documents: hocuspocus.getDocumentsCount(), connections: hocuspocus.getConnectionsCount(), closing };
  }

  async function edit(principal: Principal, name: SpecDocumentName, content: unknown, options: EditOptions = {}): Promise<EditResult> {
    const auth = await authorize(principal, name);
    if (auth.readOnly) throw new ReadOnlyError(auth.reason ?? "viewer");
    const pm = parsePmDoc(content);
    const documentName = specDocumentName(name.businessId, name.specBlockId);
    const context: CollabContext = { principal, businessId: name.businessId, specBlockId: name.specBlockId, readOnly: false };
    const connection = await hocuspocus.openDirectConnection(documentName, context);
    let result: ReconcileResult = { changed: 0, kept: 0 };
    let after: PmNode = pm;
    try {
      // The revision is checked inside the transaction callback, so no WebSocket update can slip in between the
      // check and the write (Yjs applies updates synchronously on this single thread).
      await connection.transact((document) => {
        const fragment = document.getXmlFragment(field);
        if (options.expectedRevision) {
          const current = revisionOf(fragmentToPmDoc(fragment));
          if (options.expectedRevision !== current) throw new StaleRevisionError(current, options.expectedRevision);
        }
        result = reconcileFragment(fragment, pm);
        after = fragmentToPmDoc(fragment);
      });
    } finally {
      await connection.disconnect(); // stores immediately; unloads only when nobody else holds the document
    }
    const block = await store.getBlock(name.businessId, name.specBlockId);
    return { ...result, businessId: name.businessId, specBlockId: name.specBlockId, version: block.version, revision: revisionOf(after), content: after };
  }

  async function read(principal: Principal, name: SpecDocumentName): Promise<ReadResult> {
    const auth = await authorize(principal, name);
    const live = liveContent(specDocumentName(name.businessId, name.specBlockId));
    const content = live ?? parsePmDocLenient(auth.block.content);
    return { content, version: auth.block.version, revision: revisionOf(content), pinned: auth.block.pinned, live: live !== null };
  }

  // --- re-authorization ---------------------------------------------------------------------------------------------

  /**
   * Access is checked when a connection authenticates and again here, for every open connection (security review S1):
   * a member removed from the business, walled from Product or turned into a viewer would otherwise keep a live editor
   * until they closed the tab. Denied: the connection turns read-only at once and is closed (the provider asks to
   * authenticate again and is refused). A failed check (the database did not answer) keeps the connection as it was.
   */
  async function reauthorize(): Promise<number> {
    let closed = 0;
    for (const document of [...hocuspocus.documents.values()]) {
      let name: SpecDocumentName;
      try {
        name = parseDocumentName(document.name);
      } catch {
        continue;
      }
      for (const connection of document.getConnections()) {
        const context = connection.context as Partial<CollabContext> | undefined;
        if (!context?.principal) continue;
        try {
          const auth = await authorize(context.principal, name);
          connection.readOnly = auth.readOnly;
          context.readOnly = auth.readOnly;
        } catch (err) {
          if (!(err instanceof CollabDenied) && !(err instanceof NotFoundError)) {
            log.warn({ documentName: document.name, err }, "collab: re-authorization failed; the connection keeps its access until the next check");
            continue;
          }
          connection.readOnly = true;
          connection.close({ code: 4403, reason: err instanceof CollabDenied ? err.reason : "not-found" });
          closed += 1;
          log.info({ documentName: document.name, principal: context.principal }, "collab: access withdrawn; connection closed");
        }
      }
    }
    return closed;
  }

  let reauthorizer: ReturnType<typeof setInterval> | null = null;
  let reauthorizing = false;
  function startReauthorizing(): void {
    if (reauthorizer) return;
    reauthorizer = setInterval(() => {
      if (reauthorizing) return;
      reauthorizing = true;
      reauthorize()
        .catch((err: unknown) => log.error({ err }, "collab: re-authorization sweep failed"))
        .finally(() => (reauthorizing = false));
    }, Math.max(10, options.reauthorizeMs ?? 15_000));
    reauthorizer.unref?.();
  }

  // --- HTTP ---------------------------------------------------------------------------------------------------------

  const SPEC_ROUTE = /^\/v1\/spec-blocks\/([^/]+)\/([^/]+)\/?$/;

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();
    try {
      if (url.pathname === "/health") {
        if (method !== "GET" && method !== "HEAD") return sendJson(res, 405, { error: "method_not_allowed" });
        const h = health();
        return sendJson(res, h.ok ? 200 : 503, h);
      }
      const match = SPEC_ROUTE.exec(url.pathname);
      if (match) {
        const name = parseDocumentName(`spec:${match[1]}:${match[2]}`);
        const principal = await deps.auth.verify(bearerToken(req));
        if (method === "GET") return sendJson(res, 200, await read(principal, name));
        if (method === "POST" || method === "PUT") {
          const body = await readJsonBody(req, maxBodyBytes);
          const envelope = body && typeof body === "object" && "content" in body ? (body as { content: unknown; expectedRevision?: unknown }) : null;
          const content = envelope ? envelope.content : body;
          const expectedRevision = envelope && typeof envelope.expectedRevision === "string" ? envelope.expectedRevision : null;
          return sendJson(res, 200, await edit(principal, name, content, { expectedRevision }));
        }
        return sendJson(res, 405, { error: "method_not_allowed" });
      }
      return sendJson(res, 404, { error: "not_found", message: `No route ${method} ${url.pathname}` });
    } catch (err) {
      const { status, body } = httpError(err);
      if (status >= 500) log.error({ method, path: url.pathname, err }, "collab: request failed");
      return sendJson(res, status, body);
    }
  }

  // --- lifecycle ----------------------------------------------------------------------------------------------------

  function listenOn(host: string, port: number): Promise<{ port: number; host: string }> {
    return new Promise((resolve, reject) => {
      const http = server.httpServer;
      const onError = (err: NodeJS.ErrnoException) => {
        http.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        http.off("error", onError);
        const address = http.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        resolve({ port: actualPort, host });
      };
      http.once("error", onError);
      http.once("listening", onListening);
      server.configuration.address = host;
      server.configuration.port = port;
      void server.listen().catch(reject);
    });
  }

  async function listen(port: number) {
    let lastErr: unknown = null;
    for (const host of hosts) {
      try {
        bound = await listenOn(host, port);
        log.info({ port: bound.port, host }, "collab listening");
        startReauthorizing();
        return bound;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        lastErr = err;
        if (code === "EAFNOSUPPORT" || code === "EADDRNOTAVAIL") {
          log.warn({ host, code }, "collab: address family unavailable; trying the next host");
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("collab: no address family available to listen on");
  }

  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    if (reauthorizer) clearInterval(reauthorizer);
    reauthorizer = null;
    hocuspocus.flushPendingStores();
    await server.destroy();
    bound = null;
  }

  return {
    hocuspocus,
    store,
    listen,
    get url() {
      return bound ? `ws://${bound.host.includes(":") ? `[${bound.host}]` : bound.host}:${bound.port}` : null;
    },
    get port() {
      return bound?.port ?? null;
    },
    health,
    authorize,
    edit,
    read,
    reauthorize,
    close,
  };
}

// --- helpers ----------------------------------------------------------------------------------------------------------

function parsePmDocLenient(content: unknown): PmNode {
  try {
    return parsePmDoc(content);
  } catch {
    return { type: "doc", content: [] };
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new AppError("payload_too_large", `Body exceeds ${maxBytes} bytes`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new AppError("invalid_json", "Body is not valid JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
  res.end(text);
}

export function httpError(err: unknown): { status: number; body: { error: string; message: string; details?: unknown } } {
  if (err instanceof CollabAuthError) return { status: 401, body: { error: "unauthorized", message: err.message } };
  if (err instanceof CollabDenied) return { status: err.reason === "not-found" ? 404 : 403, body: { error: err.reason, message: err.message } };
  if (err instanceof InvalidDocumentNameError) return { status: 404, body: { error: "not_found", message: err.message } };
  if (err instanceof InvalidProseMirrorJsonError) return { status: 400, body: { error: "invalid_content", message: err.message } };
  if (err instanceof AppError) return { status: err.status, body: { error: err.code, message: err.message, details: err.details } };
  return { status: 500, body: { error: "internal", message: "Unexpected error" } };
}
