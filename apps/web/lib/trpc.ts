/**
 * tRPC over @trpc/tanstack-react-query (docs/ARCHITECTURE.md §14 `lib/trpc.ts`): typed hooks from the API's
 * `AppRouter`, superjson on the link, Bearer from the Supabase session (or the dev token), NEXT_PUBLIC_API_URL.
 *
 * This module is server-safe (no React); the hooks live in lib/trpc-react.ts (`useTRPC`, `TRPCProvider`).
 *
 * `createApiClient` builds the vanilla client (also used on the server with a server-side token); the untyped
 * client powers the dotted-path `WidgetDataSource` for @foundmill/widgets and @foundmill/modules.
 */
import { createTRPCClient, createTRPCUntypedClient, httpBatchLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@foundmill/api/router";
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

export function createApiLinks(opts: { getToken: TokenGetter; url?: string; fetch?: typeof fetch }): TRPCLink<AppRouter>[] {
  return [
    httpBatchLink({
      url: opts.url ?? apiTrpcUrl(),
      transformer: superjson,
      fetch: opts.fetch,
      headers: async () => {
        const bearer = await resolveBearer(opts.getToken);
        return bearer ? { authorization: `Bearer ${bearer}` } : {};
      },
    }),
  ];
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

/** Human-readable message for an API error (never the stack). */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof TRPCClientError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
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
