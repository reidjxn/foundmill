/**
 * tRPC over @trpc/tanstack-react-query (docs/ARCHITECTURE.md §14 `lib/trpc.ts`): typed hooks from the API's
 * `AppRouter`, superjson on the link, Bearer from the Supabase session (or the dev token), NEXT_PUBLIC_API_URL.
 *
 * This module is server-safe (no React); the hooks live in lib/trpc-react.ts (`useTRPC`, `TRPCProvider`).
 *
 * `createApiClient` builds the vanilla client (also used on the server with a server-side token, `SERVER_LIMITS`); the
 * untyped client over the same links (`untypedClientOf`) powers the dotted-path `WidgetDataSource` for
 * @foundmill/widgets and @foundmill/modules, so a widget's read and the shell's read made in the same tick share a batch.
 *
 * Transport: a `splitLink`. Procedures that stream their answer (an async generator on the API, `STREAMING_PROCEDURES`)
 * go over `httpBatchStreamLink`, so each result reaches the browser the moment the API yields it; everything else stays
 * on `httpBatchLink` (one JSON answer per batch, gzip-compressed by the API, read by the server-rendered layouts). In the
 * browser plain reads go to the web app's own origin (`queryUrl`, lib/same-origin-api.ts: no CORS preflight per read);
 * changes and streams go to the API directly, since they can run for minutes.
 */
import { createTRPCClient, createTRPCUntypedClient, getUntypedClient, httpBatchLink, httpBatchStreamLink, splitLink, TRPCClientError, type TRPCLink, type TRPCUntypedClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@foundmill/api/router";
import { LIMITS } from "@foundmill/config";
import { devBearerToken } from "@/lib/auth/dev-as";
import { publicEnv } from "@/lib/env";
import { SAME_ORIGIN_TRPC_PATH } from "@/lib/same-origin-api";

export type { AppRouter } from "@foundmill/api/router";
export type { RouterInputs, RouterOutputs } from "@foundmill/api/router";

export type TokenGetter = () => string | null | Promise<string | null>;

/** `${NEXT_PUBLIC_API_URL}/trpc` */
export function apiTrpcUrl(base = publicEnv().apiUrl): string {
  return `${base.replace(/\/+$/, "")}/trpc`;
}

/**
 * Where the browser sends plain reads: this origin's `/api/trpc` (rewritten to the API, lib/same-origin-api.ts). On the
 * server (a client component's server render) there is no page origin, so it stays the API itself.
 */
export function browserQueryUrl(): string {
  return typeof window === "undefined" ? apiTrpcUrl() : SAME_ORIGIN_TRPC_PATH;
}

/**
 * Upper bound of the wait for the bearer before a request (audit C5). In the browser the session token comes from
 * Supabase, which refreshes an expiring one first and retries a failing refresh for up to 30 s; past this bound the
 * request fails with `SIGN_IN_TIMEOUT_MESSAGE` and is retried like any failed read, and the refresh carries on.
 */
export const TOKEN_TIMEOUT_MS = 6_000;
/** What a request says when the bearer did not come in time. */
export const SIGN_IN_TIMEOUT_MESSAGE = "Your sign-in took too long to refresh. Check your connection, then try again.";

/**
 * Bearer for a request: the session token, else the dev token in development/test (`dev`, or `dev:<uuid>` after
 * `/auth/dev?as=<uuid>`: lib/auth/dev-as.ts), else nothing. A token that does not
 * come within `timeoutMs` rejects the request instead: nothing is sent, so an expired token never is.
 */
export async function resolveBearer(getToken: TokenGetter, timeoutMs = TOKEN_TIMEOUT_MS): Promise<string | null> {
  const pending = getToken();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const token =
    typeof pending === "string" || pending === null
      ? pending
      : await Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(SIGN_IN_TIMEOUT_MESSAGE), { name: "TimeoutError" })), timeoutMs);
          }),
        ]).finally(() => clearTimeout(timer));
  if (token) return token;
  return devBearerToken();
}

/**
 * Procedures whose answer is a stream (`AsyncIterable`): they must go over `httpBatchStreamLink` (the API refuses a
 * stream on a plain batch). Add a procedure here when it becomes an async generator on the API.
 */
export const STREAMING_PROCEDURES: ReadonlySet<string> = new Set(["idea.draft", "idea.logo.stream", "business.logo.stream", "agent.conversation.sendStream", "agent.conversation.inboxReplyStream", "idea.askStream"]);

/**
 * Procedures sent one per request, never batched with others: Team call's spoken turns (each is seconds of a vendor
 * call, and a batch answers only when its slowest call is done, so the first agent waited for the second's audio) and
 * the transcription of what the founder said.
 */
export const UNBATCHED_PROCEDURES: ReadonlySet<string> = new Set(["teamCall.speech", "teamCall.transcribe", "agent.speechAccent.preview"]);

/** True for an operation that goes on a request of its own. */
export function isUnbatchedOperation(op: { path: string }): boolean {
  return UNBATCHED_PROCEDURES.has(op.path);
}

/** True for an operation that must use the streaming link. */
export function isStreamingOperation(op: { path: string }): boolean {
  return STREAMING_PROCEDURES.has(op.path);
}

/**
 * Upper bound of a read (a query, sent as GET): long enough for a slow network, short enough that a request that never
 * answers (a dead connection after the laptop slept) never leaves a screen spinning (audit RES-13).
 */
export const QUERY_TIMEOUT_MS = 45_000;
/**
 * Upper bound of a change (a mutation, sent as POST): above the API's own wait for the composer, so a note still being
 * written is never cut off, and still finite, so no button spins and no dialog stays locked for good.
 */
export const MUTATION_TIMEOUT_MS = LIMITS.composerClientTimeoutMs + 30_000;
/**
 * Upper bound of a read made by a server render (audit F3): a page waits on it before sending anything, so a stalled
 * API shows the unreachable page (or hands the read to the browser, lib/hydrate.server.tsx) after this instead of
 * leaving a blank tab for the browser's full `QUERY_TIMEOUT_MS`.
 */
export const SERVER_QUERY_TIMEOUT_MS = 8_000;

/** Per-request upper bounds: a read (GET) and a change (anything else). */
export interface RequestLimits {
  query: number;
  mutation: number;
}
/** The browser's bounds. */
export const BROWSER_LIMITS: RequestLimits = { query: QUERY_TIMEOUT_MS, mutation: MUTATION_TIMEOUT_MS };
/** A server render's bounds (lib/trpc-server.ts). */
export const SERVER_LIMITS: RequestLimits = { query: SERVER_QUERY_TIMEOUT_MS, mutation: MUTATION_TIMEOUT_MS };
/**
 * Longest URL a batched read may have before the batch link splits it: the input travels in the URL, and the CDN in
 * front of the same-origin path refuses a URL over 14 KB (Node's own header limit is 16 KB).
 */
export const MAX_URL_LENGTH = 8_000;
/** What a timed-out request says (`errorMessage` shows it). */
export const REQUEST_TIMEOUT_MESSAGE = "The server took too long to answer. Check your connection, then try again.";

/**
 * `fetch` with an upper bound per request: the caller's own abort (an unmounted query, a stopped draft) still applies,
 * and after `QUERY_TIMEOUT_MS` (GET) or `MUTATION_TIMEOUT_MS` (anything else) the request is aborted with
 * `REQUEST_TIMEOUT_MESSAGE`. Streaming answers do not use it: they are long by design and the person stops them.
 */
export function fetchWithTimeout(base?: typeof fetch, limits: RequestLimits = BROWSER_LIMITS): typeof fetch {
  return (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const ms = method === "GET" ? limits.query : limits.mutation;
    const controller = new AbortController();
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    }
    // The timer is left to run out after an answer: aborting a settled request does nothing, and the response body is
    // read after `fetch` resolves, so it stays bounded too. On the server it never holds the process open.
    const timer = setTimeout(() => controller.abort(Object.assign(new Error(REQUEST_TIMEOUT_MESSAGE), { name: "TimeoutError" })), ms);
    (timer as { unref?: () => void }).unref?.();
    return (base ?? globalThis.fetch)(input, { ...init, signal: controller.signal });
  };
}

export interface ApiClientOptions {
  getToken: TokenGetter;
  /** The API's tRPC endpoint for changes and streams (and reads, unless `queryUrl` says otherwise). Default `apiTrpcUrl()`. */
  url?: string;
  /** Where plain reads go; default `url`. The browser passes `browserQueryUrl()`. */
  queryUrl?: string;
  fetch?: typeof fetch;
  /** Per-request upper bounds; default `BROWSER_LIMITS`. */
  limits?: RequestLimits;
}

export function createApiLinks(opts: ApiClientOptions): TRPCLink<AppRouter>[] {
  const url = opts.url ?? apiTrpcUrl();
  const queryUrl = opts.queryUrl ?? url;
  const headers = async () => {
    const bearer = await resolveBearer(opts.getToken);
    return bearer ? { authorization: `Bearer ${bearer}` } : {};
  };
  // A batch carries at most `LIMITS.trpcMaxBatchSize` calls: the api refuses a longer one (400).
  const batch = (to: string, fetch: typeof globalThis.fetch | undefined) =>
    httpBatchLink<AppRouter>({ url: to, transformer: superjson, headers, fetch: fetchWithTimeout(fetch, opts.limits), maxItems: LIMITS.trpcMaxBatchSize, maxURLLength: MAX_URL_LENGTH });
  // Reads to the page's own origin carry its cookies, as any same-origin request does: they ride the connection the page
  // already has open, and a preview deployment behind Vercel's protection lets them through. The API reads only the bearer.
  const batched = queryUrl === url ? batch(url, opts.fetch) : splitLink<AppRouter>({ condition: (op) => op.type === "query", true: batch(queryUrl, opts.fetch), false: batch(url, opts.fetch) });
  const single = httpBatchLink<AppRouter>({ url, transformer: superjson, headers, fetch: fetchWithTimeout(opts.fetch, opts.limits), maxItems: 1, maxURLLength: MAX_URL_LENGTH });
  const plain = splitLink<AppRouter>({ condition: isUnbatchedOperation, true: single, false: batched });
  // One stream per request (`maxItems: 1`): a batched request is only aborted once every operation in it is, so Stop on
  // a draft that shared a request with another stream would leave the API drafting.
  return [splitLink({ condition: isStreamingOperation, true: httpBatchStreamLink({ url, transformer: superjson, headers, fetch: opts.fetch, maxItems: 1 }), false: plain })];
}

export function createApiClient(opts: ApiClientOptions) {
  return createTRPCClient<AppRouter>({ links: createApiLinks(opts) });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Path-addressed client (`client.query("inbox.list", input)`) for the widget data source. */
export type UntypedApiClient = TRPCUntypedClient<AppRouter>;

/**
 * The path-addressed view of a typed client: the same links, so its calls and the typed client's calls made in the same
 * tick travel in one batch (one request, one answer) instead of two.
 */
export function untypedClientOf(client: ApiClient): UntypedApiClient {
  return getUntypedClient(client);
}

/** A path-addressed client with links of its own (tests, stories). The app uses `untypedClientOf`. */
export function createUntypedApiClient(opts: ApiClientOptions): UntypedApiClient {
  return createTRPCUntypedClient<AppRouter>({ links: createApiLinks(opts) });
}

/** tRPC error code of an unknown error, or null. */
export function trpcErrorCode(err: unknown): string | null {
  if (err instanceof TRPCClientError) return (err.data as { code?: string } | undefined)?.code ?? null;
  return null;
}

/** The validation issues an API error carries (`data.details`, Zod's own list: a `path` and a `message` each), or null. */
export function validationIssues(err: unknown): { path: (string | number)[]; message: string }[] | null {
  if (!(err instanceof TRPCClientError)) return null;
  const details = (err.data as { details?: unknown } | undefined)?.details;
  if (!Array.isArray(details)) return null;
  const issues = details.filter((d): d is { path: (string | number)[]; message: string } => Boolean(d) && typeof d === "object" && Array.isArray((d as { path?: unknown }).path) && typeof (d as { message?: unknown }).message === "string");
  return issues.length ? issues : null;
}

/** The API's own error code (`appCode`: `not_invited`, `rate_limited`, ...) of an unknown error, or null. */
export function appErrorCode(err: unknown): string | null {
  if (err instanceof TRPCClientError) return (err.data as { appCode?: string } | undefined)?.appCode ?? null;
  return null;
}

/** Signed in, but this deployment admits only the addresses on its invite list (the API's SIGNUP_ALLOWLIST). */
export function isNotInvited(err: unknown): boolean {
  return appErrorCode(err) === "not_invited";
}

/**
 * Why an invite-only refusal happened: the address is not on the list, or it is but the sign-in did not show it is
 * confirmed yet (the API's `details.reason`, SEC2 S11).
 */
export function notInvitedReason(err: unknown): "not_listed" | "email_unconfirmed" {
  const details = err instanceof TRPCClientError ? (err.data as { details?: { reason?: unknown } } | undefined)?.details : undefined;
  return details?.reason === "email_unconfirmed" ? "email_unconfirmed" : "not_listed";
}

/** What a refused TOO_MANY_REQUESTS says when the API sent no sentence of its own. */
export const RATE_LIMITED_MESSAGE = "That's a lot of requests in a short time. Wait a minute, then try again.";

/** The words a person reads for a permission section ("crm" is "CRM"). */
export function sectionWord(section: string): string {
  if (section === "crm") return "CRM";
  const words = section.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a refusal starts with when the person has no access to a section: the screens show a "no access" state for it. */
export const NO_ACCESS_PREFIX = "No access to ";

/**
 * A refusal (FORBIDDEN) in product words, never the API's keys and role names (audit RUI-05): "You do not have read
 * access to finance" reads "No access to Finance. …", "Your role (viewer) cannot perform changes" reads "As a viewer you
 * can follow this business, but not change it." Anything else keeps the API's own sentence.
 */
export function forbiddenMessage(message: string): string {
  const read = /^You do not have read access to (\w+)/.exec(message);
  if (read) return `${NO_ACCESS_PREFIX}${sectionWord(read[1]!)}. Ask an owner or admin if you need it.`;
  const write = /^You do not have write access to (\w+)\b/.exec(message);
  if (write && !/, and this plan would/.test(message)) return `You can read ${sectionWord(write[1]!)} but not change it. Ask an owner or admin for write access.`;
  const role = /^Your role \((\w+)\) cannot perform (.+)$/.exec(message);
  if (role) {
    if (role[2] === "administration") return "Only an owner or admin can do this.";
    if (role[2] === "owner actions") return "Only the owner can do this.";
    if (role[1] === "viewer" || role[1] === "advisor") return `As ${role[1] === "advisor" ? "an advisor" : "a viewer"} you can follow this business, but not change it.`;
  }
  return message;
}

/**
 * Human-readable message for an API error (never the stack). A rate limit reads as the API's own sentence ("Refresh
 * limit reached. Try again in 2 minutes."), or a friendly line when it sent none.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof TRPCClientError) {
    if (trpcErrorCode(err) === "TOO_MANY_REQUESTS") return /Try again/i.test(err.message) ? err.message : RATE_LIMITED_MESSAGE;
    if (trpcErrorCode(err) === "FORBIDDEN") return forbiddenMessage(err.message) || fallback;
    return err.message || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * A plan tier limit refusal (`tier_limit`, BUILD §10.5: businesses, seats or concurrent agents) with the business whose
 * Settings › Billing changes the plan; null for any other error. Screens turn it into an upgrade prompt.
 */
export function tierLimitOf(err: unknown): { limit: string; planBusinessId: string | null } | null {
  if (!(err instanceof TRPCClientError)) return null;
  const data = err.data as { appCode?: string; details?: { limit?: string; planBusinessId?: string | null } } | undefined;
  if (data?.appCode !== "tier_limit") return null;
  return { limit: data.details?.limit ?? "businesses", planBusinessId: data.details?.planBusinessId ?? null };
}

/**
 * The API's refusal of a value someone else already holds (`conflict` with the form field it is about, such as a
 * business slug that is taken), for showing under that field; null for any other error.
 */
export function fieldConflictOf(err: unknown): { field: string; message: string } | null {
  if (!(err instanceof TRPCClientError)) return null;
  const data = err.data as { appCode?: string; details?: { field?: unknown } } | undefined;
  if (data?.appCode !== "conflict" || typeof data.details?.field !== "string") return null;
  return { field: data.details.field, message: err.message };
}

/** The query key @trpc/tanstack-react-query uses for a procedure path, so path-string queries and typed hooks share a cache. */
export function trpcQueryKey(path: string, input?: unknown, type: "query" | "infinite" | "any" = "query"): readonly unknown[] {
  const parts = path.split(".");
  const meta: Record<string, unknown> = {};
  if (input !== undefined) meta.input = input;
  if (type !== "any") meta.type = type;
  return Object.keys(meta).length ? [parts, meta] : [parts];
}

/** Key prefix for invalidating every query under a router (`["inbox"]` → every inbox.* query). */
export function trpcPathPrefix(path: string): readonly unknown[] {
  return [path.split(".")];
}
