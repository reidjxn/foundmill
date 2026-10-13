/**
 * tRPC over @trpc/tanstack-react-query (docs/ARCHITECTURE.md §14 `lib/trpc.ts`): typed hooks from the API's
 * `AppRouter`, superjson on the link, Bearer from the Supabase session (or the dev token), NEXT_PUBLIC_API_URL.
 *
 * This module is server-safe (no React); the hooks live in lib/trpc-react.ts (`useTRPC`, `TRPCProvider`).
 *
 * `createApiClient` builds the vanilla client (also used on the server with a server-side token); the untyped
 * client powers the dotted-path `WidgetDataSource` for @foundmill/widgets and @foundmill/modules.
 *
 * Transport: a `splitLink`. Procedures that stream their answer (an async generator on the API, `STREAMING_PROCEDURES`)
 * go over `httpBatchStreamLink`, so each result reaches the browser the moment the API yields it; everything else stays
 * on `httpBatchLink` (one JSON answer per batch, gzip-compressed by the API, read by the server-rendered layouts).
 */
import { createTRPCClient, createTRPCUntypedClient, httpBatchLink, httpBatchStreamLink, splitLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@foundmill/api/router";
import { LIMITS } from "@foundmill/config";
import { DEV_BEARER_TOKEN } from "@/lib/auth/constants";
import { isDevLike, publicEnv } from "@/lib/env";

export type { AppRouter } from "@foundmill/api/router";
export type { RouterInputs, RouterOutputs } from "@foundmill/api/router";

export type TokenGetter = () => string | null | Promise<string | null>;

/** `${NEXT_PUBLIC_API_URL}/trpc` */
export function apiTrpcUrl(base = publicEnv().apiUrl): string {
  return `${base.replace(/\/+$/, "")}/trpc`;
}

/** Bearer for a request: the session token, else the dev token in development/test, else nothing. */
export async function resolveBearer(getToken: TokenGetter): Promise<string | null> {
  const token = await getToken();
  if (token) return token;
  return isDevLike() ? DEV_BEARER_TOKEN : null;
}

/**
 * Procedures whose answer is a stream (`AsyncIterable`): they must go over `httpBatchStreamLink` (the API refuses a
 * stream on a plain batch). Add a procedure here when it becomes an async generator on the API.
 */
export const STREAMING_PROCEDURES: ReadonlySet<string> = new Set(["idea.draft", "idea.logo.stream", "business.logo.stream"]);

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
/** What a timed-out request says (`errorMessage` shows it). */
export const REQUEST_TIMEOUT_MESSAGE = "The server took too long to answer. Check your connection, then try again.";

/**
 * `fetch` with an upper bound per request: the caller's own abort (an unmounted query, a stopped draft) still applies,
 * and after `QUERY_TIMEOUT_MS` (GET) or `MUTATION_TIMEOUT_MS` (anything else) the request is aborted with
 * `REQUEST_TIMEOUT_MESSAGE`. Streaming answers do not use it: they are long by design and the person stops them.
 */
export function fetchWithTimeout(base?: typeof fetch, limits: { query: number; mutation: number } = { query: QUERY_TIMEOUT_MS, mutation: MUTATION_TIMEOUT_MS }): typeof fetch {
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

export function createApiLinks(opts: { getToken: TokenGetter; url?: string; fetch?: typeof fetch }): TRPCLink<AppRouter>[] {
  const common = {
    url: opts.url ?? apiTrpcUrl(),
    transformer: superjson,
    fetch: opts.fetch,
    headers: async () => {
      const bearer = await resolveBearer(opts.getToken);
      return bearer ? { authorization: `Bearer ${bearer}` } : {};
    },
  };
  // One stream per request (`maxItems: 1`): a batched request is only aborted once every operation in it is, so Stop on
  // a draft that shared a request with another stream would leave the API drafting.
  return [splitLink({ condition: isStreamingOperation, true: httpBatchStreamLink({ ...common, maxItems: 1 }), false: httpBatchLink({ ...common, fetch: fetchWithTimeout(opts.fetch) }) })];
}

export function createApiClient(opts: { getToken: TokenGetter; url?: string; fetch?: typeof fetch }) {
  return createTRPCClient<AppRouter>({ links: createApiLinks(opts) });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Path-addressed client (`client.query("inbox.list", input)`) for the widget data source. */
export function createUntypedApiClient(opts: { getToken: TokenGetter; url?: string; fetch?: typeof fetch }) {
  return createTRPCUntypedClient<AppRouter>({ links: createApiLinks(opts) });
}

export type UntypedApiClient = ReturnType<typeof createUntypedApiClient>;

/** tRPC error code of an unknown error, or null. */
export function trpcErrorCode(err: unknown): string | null {
  if (err instanceof TRPCClientError) return (err.data as { code?: string } | undefined)?.code ?? null;
  return null;
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
