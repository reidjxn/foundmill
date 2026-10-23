/**
 * The faces of anthropomorphic agents (docs/DECISIONS.md, Anthropomorphic agents). One AI-generated portrait per persona
 * catalog key, a platform asset in `persona_portraits` (at most 240 ever), made on first need and served by
 * `GET /personas/:key`.
 *
 * `ensurePortraits` is what `team.personas.ensure` calls with a business's persona keys: it answers at once with what is
 * ready, what is still coming and what will not come, and starts the missing ones in the background. The request never
 * waits for an image:
 *  - a key already being generated in this process is not started twice (in-flight dedupe);
 *  - at most `PORTRAIT_CONCURRENCY` images are made at the same time, the rest wait their turn in a queue;
 *  - a failure is logged (the key and the gateway's code, never a prompt or image) and the key backs off exponentially,
 *    one minute doubling to a day (`portraitBackoffMs`). The attempts and the next try are kept in Redis when the api has
 *    one, so every replica respects the same window, else in this process; a broken key or an unreachable gateway is
 *    retried by a later call, never in a tight loop and never by every replica at once;
 *  - a refusal that can never succeed for the key (the gateway answers a 4xx other than 401, 403, 408, 409, 412, 425 or
 *    429: the vendor refused the prompt, or the key is not in the gateway's catalog) is permanent: logged once as an error,
 *    never tried again in this process and reported in `failed`, so the web stops asking and shows the drawn portrait;
 *  - a queued key whose portrait another replica stored meanwhile is skipped.
 * In mock mode (`INTEGRATIONS_MODE=mock` and `openai_images` not in `LIVE_CONNECTORS`) the connector's deterministic
 * placeholder is drawn right here, with no gateway, like the domain checks; live, the gateway makes the image with the
 * platform key and its own prompt, built from the key (the api can never send one). Live, a stored placeholder (model
 * `MOCK_IMAGE_MODEL`, left by an earlier mock deployment) counts as missing, so it is regenerated and replaced.
 *
 * `storedPortrait` serves `GET /personas/:key` through a small in-memory LRU (`PORTRAIT_CACHE_MAX` entries, each kept
 * `PORTRAIT_CACHE_TTL_MS`) so a page of faces does not read the table for every <img>.
 */
import { createHash } from "node:crypto";
import { MOCK_IMAGE_MODEL, openaiImagesMock, OPENAI_IMAGES_KEY, mockIntegrationRecord } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { AppError, connectorMode, personaByKey, personaPortraitPrompt, type Env } from "@foundmill/shared";
import type { ApiGatewayClient, GatewayPortrait } from "./gateway";
import type { ApiLogger } from "./log";

/** Images made at the same time, whatever the number of businesses asking. */
export const PORTRAIT_CONCURRENCY = 3;
/** The first wait after a failure; each further failure doubles it. */
export const PORTRAIT_BACKOFF_BASE_MS = 60_000;
/** The longest wait between two tries of one key: a day. */
export const PORTRAIT_BACKOFF_MAX_MS = 24 * 60 * 60_000;
/** Redis keys of the shared backoff (`<prefix><personaKey>`). */
export const PORTRAIT_BACKOFF_REDIS_PREFIX = "persona-portrait:backoff:";

/** The wait after the `attempts`-th failure in a row: 1 min, 2, 4, … up to 24 h. */
export function portraitBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(PORTRAIT_BACKOFF_MAX_MS, PORTRAIT_BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 30));
}

/** The subset of ioredis the shared backoff uses (`deps.redis` is checked for it at run time). */
export interface PortraitRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", ms: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

export interface PortraitDeps {
  db: Db;
  env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">;
  gateway: ApiGatewayClient;
  log: Pick<ApiLogger, "info" | "warn" | "error">;
  /** The api's Redis (null without one): when it has GET/SET/DEL, the backoff is shared by every replica. */
  redis?: unknown;
  /** Clock for the backoff; tests move it. */
  now?: () => number;
}

export interface PortraitStatus {
  /** Keys with a stored portrait, in the order asked. */
  ready: string[];
  /** Catalog keys without one yet that will still be tried (generating, queued, or waiting out a failure). */
  pending: string[];
  /** Catalog keys whose portrait was refused for good (never tried again in this process): the drawn portrait stays. */
  failed: string[];
}

interface Backoff {
  attempts: number;
  nextTryAt: number;
}

interface PermanentFailure {
  code: string;
  status: number;
}

interface State {
  inFlight: Set<string>;
  queue: { key: string; deps: PortraitDeps; businessId?: string }[];
  /** The in-process backoff: used without Redis, and whenever Redis does not answer. */
  backoff: Map<string, Backoff>;
  permanent: Map<string, PermanentFailure>;
  active: number;
  idle: (() => void)[];
}

const state: State = { inFlight: new Set(), queue: [], backoff: new Map(), permanent: new Map(), active: 0, idle: [] };

/** Forgets every in-flight key, queued key, backoff, permanent failure and cached image (tests). */
export function resetPortraitState(): void {
  state.inFlight.clear();
  state.queue.length = 0;
  state.backoff.clear();
  state.permanent.clear();
  state.active = 0;
  state.idle.length = 0;
  portraitCache.clear();
}

/** Resolves when nothing is queued or being made (tests wait on it; the request path never does). */
export function portraitsIdle(): Promise<void> {
  return state.inFlight.size === 0 ? Promise.resolve() : new Promise((resolve) => state.idle.push(resolve));
}

/** True when portraits are made live (the gateway and OpenAI), where a stored mock placeholder is to be replaced. */
export function portraitsLive(env: PortraitDeps["env"]): boolean {
  return connectorMode(env, OPENAI_IMAGES_KEY) === "live";
}

/** The stored models that count as missing in this mode: the mock placeholder, when portraits are live. */
const excludedModels = (env: PortraitDeps["env"]): string[] => (portraitsLive(env) ? [MOCK_IMAGE_MODEL] : []);

/** One portrait: the local placeholder in mock mode, the gateway otherwise. */
export async function generatePortraitFor(deps: Pick<PortraitDeps, "env" | "gateway">, personaKey: string, businessId?: string): Promise<GatewayPortrait> {
  const persona = personaByKey(personaKey);
  if (!persona) throw new Error("not a persona catalog key");
  if (portraitsLive(deps.env)) return deps.gateway.generatePortrait(personaKey, businessId);
  const id = businessId ?? "00000000-0000-0000-0000-000000000000";
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const result = await openaiImagesMock.callTool("generate_image", { prompt: personaPortraitPrompt(persona), size: "1024x1024", quality: "medium" }, { businessId: id, agentId: id, sessionId: id, integration: mockIntegrationRecord(OPENAI_IMAGES_KEY, id), log, mode: "mock" });
  if (!result.ok) throw new Error(result.error?.message ?? "the placeholder portrait could not be drawn");
  const data = result.data as GatewayPortrait;
  return { mime: data.mime, base64: data.base64, model: data.model || MOCK_IMAGE_MODEL };
}

/** Gateway statuses that are about the request, not the key: a token, a timeout, a conflict, the api's own setup, a rate limit. */
const TRANSIENT_4XX = new Set([401, 403, 408, 409, 412, 425, 429]);

/** A failure that will never succeed for this key: a 4xx from the gateway other than the transient ones. */
export function isPermanentPortraitFailure(err: unknown): err is AppError {
  return err instanceof AppError && err.status >= 400 && err.status < 500 && !TRANSIENT_4XX.has(err.status);
}

// --- backoff store ----------------------------------------------------------------------------------------------------

interface BackoffStore {
  get(key: string): Promise<Backoff | null>;
  set(key: string, value: Backoff, now: number): Promise<void>;
  clear(key: string): Promise<void>;
}

function isPortraitRedis(redis: unknown): redis is PortraitRedis {
  const r = redis as Partial<PortraitRedis> | null | undefined;
  return !!r && typeof r.get === "function" && typeof r.set === "function" && typeof r.del === "function";
}

const memoryBackoff: BackoffStore = {
  get: async (key) => state.backoff.get(key) ?? null,
  set: async (key, value) => void state.backoff.set(key, value),
  clear: async (key) => void state.backoff.delete(key),
};

function parseBackoff(raw: string | null): Backoff | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Backoff>;
    return typeof v.attempts === "number" && typeof v.nextTryAt === "number" ? { attempts: v.attempts, nextTryAt: v.nextTryAt } : null;
  } catch {
    return null;
  }
}

/**
 * Redis when the api has one (every replica reads and writes the same window), with the in-process map kept beside it:
 * a Redis that does not answer falls back to this process's own record instead of retrying at once.
 */
function backoffStore(deps: Pick<PortraitDeps, "redis" | "log">): BackoffStore {
  const redis = deps.redis;
  if (!isPortraitRedis(redis)) return memoryBackoff;
  const unavailable = (err: unknown) => deps.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "persona portrait backoff: Redis did not answer; using this process's record");
  return {
    get: async (key) => {
      try {
        return parseBackoff(await redis.get(PORTRAIT_BACKOFF_REDIS_PREFIX + key));
      } catch (err) {
        unavailable(err);
        return memoryBackoff.get(key);
      }
    },
    set: async (key, value, now) => {
      await memoryBackoff.set(key, value, now);
      // Kept a day past the window, so failures in a row keep doubling while a key that recovered long ago starts over.
      const ttl = Math.max(1, value.nextTryAt - now) + PORTRAIT_BACKOFF_MAX_MS;
      await redis.set(PORTRAIT_BACKOFF_REDIS_PREFIX + key, JSON.stringify(value), "PX", ttl).catch(unavailable);
    },
    clear: async (key) => {
      await memoryBackoff.clear(key);
      await redis.del(PORTRAIT_BACKOFF_REDIS_PREFIX + key).catch(unavailable);
    },
  };
}

// --- the queue --------------------------------------------------------------------------------------------------------

function finish(): void {
  if (state.inFlight.size === 0) for (const resolve of state.idle.splice(0)) resolve();
}

async function run(job: State["queue"][number]): Promise<void> {
  const { key, deps } = job;
  const store = backoffStore(deps);
  const now = deps.now ?? Date.now;
  try {
    // Another replica may have stored it while this key waited in the queue.
    if ((await repos.personaPortraits.readyKeys(deps.db, [key], { excludeModels: excludedModels(deps.env) })).length > 0) return;
    const image = await generatePortraitFor(deps, key, job.businessId);
    // An upsert: a live face replaces a mock placeholder stored under the same key.
    await repos.personaPortraits.put(deps.db, { key, mime: image.mime, content: new Uint8Array(Buffer.from(image.base64, "base64")), model: image.model });
    invalidateStoredPortrait(key);
    await store.clear(key);
    deps.log.info({ personaKey: key, model: image.model }, "persona portrait stored");
  } catch (err) {
    const code = err instanceof AppError ? err.code : undefined;
    if (isPermanentPortraitFailure(err)) {
      state.permanent.set(key, { code: err.code, status: err.status });
      await store.clear(key);
      deps.log.error({ personaKey: key, code: err.code, status: err.status }, "persona portrait refused for good; the drawn portrait stays and the key is not tried again");
      return;
    }
    const attempts = ((await store.get(key))?.attempts ?? 0) + 1;
    const waitMs = portraitBackoffMs(attempts);
    await store.set(key, { attempts, nextTryAt: now() + waitMs }, now());
    deps.log.warn({ personaKey: key, code, err: err instanceof Error ? err.message : "unknown", attempts, retryInSeconds: waitMs / 1000 }, "persona portrait failed; a later call will try again");
  }
}

function pump(): void {
  while (state.active < PORTRAIT_CONCURRENCY && state.queue.length > 0) {
    const job = state.queue.shift()!;
    state.active += 1;
    void run(job).finally(() => {
      state.active -= 1;
      state.inFlight.delete(job.key);
      pump();
      finish();
    });
  }
}

/**
 * Says which of `keys` have a portrait, which are still coming and which were refused for good, and starts generating the
 * pending ones whose backoff has run out, in the background. Keys outside the catalog are dropped. Only the lookups (the
 * stored portraits and the backoff) are awaited; the images are never awaited by the caller.
 */
export async function ensurePortraits(deps: PortraitDeps, keys: readonly (string | null | undefined)[], options: { businessId?: string } = {}): Promise<PortraitStatus> {
  const wanted = [...new Set(keys.filter((k): k is string => typeof k === "string" && personaByKey(k) !== null))];
  if (wanted.length === 0) return { ready: [], pending: [], failed: [] };
  const ready = await repos.personaPortraits.readyKeys(deps.db, wanted, { excludeModels: excludedModels(deps.env) });
  const have = new Set(ready);
  const missing = wanted.filter((k) => !have.has(k));
  const failed = missing.filter((k) => state.permanent.has(k));
  const pending = missing.filter((k) => !state.permanent.has(k));
  const store = backoffStore(deps);
  const now = (deps.now ?? Date.now)();
  const candidates = pending.filter((k) => !state.inFlight.has(k));
  const waits = await Promise.all(candidates.map(async (k) => [k, await store.get(k)] as const));
  for (const [key, backoff] of waits) {
    // Checked again after the await: another call may have started the key meanwhile.
    if (state.inFlight.has(key) || state.permanent.has(key)) continue;
    if (backoff && now < backoff.nextTryAt) continue;
    state.inFlight.add(key);
    state.queue.push({ key, deps, ...(options.businessId ? { businessId: options.businessId } : {}) });
  }
  pump();
  return { ready, pending, failed };
}

// --- serving ----------------------------------------------------------------------------------------------------------

/** Stored portraits kept in memory for `GET /personas/:key` (the catalog holds 240 keys, so this is all of them). */
export const PORTRAIT_CACHE_MAX = 240;
/** How long one cached portrait is served before the table is read again (a face another replica replaced shows up). */
export const PORTRAIT_CACHE_TTL_MS = 10 * 60_000;

export interface ServedPortrait {
  mime: string;
  /** Exactly the image's bytes (its own ArrayBuffer, not a view into a larger one). */
  bytes: Uint8Array<ArrayBuffer>;
  /** The strong ETag, quoted: the sha256 hex of the bytes. */
  etag: string;
}

/** A least-recently-used map: a read moves the entry to the end; past `max`, the oldest goes. */
export class PortraitLru {
  private readonly entries = new Map<string, { value: ServedPortrait; expiresAt: number }>();
  constructor(private readonly max: number) {}
  get(key: string, now: number): ServedPortrait | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    this.entries.delete(key);
    if (hit.expiresAt <= now) return null;
    this.entries.set(key, hit);
    return hit.value;
  }
  set(key: string, value: ServedPortrait, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + PORTRAIT_CACHE_TTL_MS });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
  delete(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
  get size(): number {
    return this.entries.size;
  }
}

const portraitCache = new PortraitLru(PORTRAIT_CACHE_MAX);

/** The number of portraits held in memory (tests). */
export function cachedPortraitCount(): number {
  return portraitCache.size;
}

/** Drops one key from the serving cache (a new face was just stored). */
export function invalidateStoredPortrait(key: string): void {
  portraitCache.delete(key);
}

/** The strong ETag of some bytes: their sha256 hex, quoted. */
export function portraitEtag(bytes: Uint8Array): string {
  return `"${createHash("sha256").update(bytes).digest("hex")}"`;
}

/** Whether an `If-None-Match` header names `etag` (a list, a weak form of it, or `*`): the 304 case. */
export function etagMatches(ifNoneMatch: string | undefined | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((raw) => {
    const tag = raw.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

/**
 * The stored portrait of a catalog key for `GET /personas/:key`, or null (unknown key, not generated yet). Served from the
 * cache when it holds the key; a miss reads the table once and caches the answer (a null is not cached, so a face that is
 * made a moment later is found).
 */
export async function storedPortrait(db: Db, key: string, options: { now?: () => number } = {}): Promise<ServedPortrait | null> {
  if (personaByKey(key) === null) return null;
  const now = (options.now ?? Date.now)();
  const cached = portraitCache.get(key, now);
  if (cached) return cached;
  const row = await repos.personaPortraits.get(db, key);
  if (!row) return null;
  // A copy that owns its buffer: a Buffer from the driver can be a view into a pooled, larger ArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(row.content.byteLength));
  bytes.set(row.content);
  const served: ServedPortrait = { mime: row.mime, bytes, etag: portraitEtag(bytes) };
  portraitCache.set(key, served, now);
  return served;
}
