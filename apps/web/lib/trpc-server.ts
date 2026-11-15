/**
 * tRPC for Server Components and Route Handlers: a vanilla client carrying the signed-in user's bearer. Layouts use
 * it to load the business, departments and the founder profile before rendering the shell (ARCHITECTURE §14).
 *
 * `serverApi`, `serverBusiness`, `serverDepartments` and `serverEntity` are wrapped in React `cache()`: within one server
 * request the session is read once and each of those reads is asked once, whichever components ask for it. The cache is
 * per request, so nothing is shared between requests or users (each client navigation is a request of its own).
 *
 * Every read here is bounded by `SERVER_LIMITS` (8 s): a page waits on its reads before sending anything, so a stalled
 * API renders the unreachable page (or hands the read to the browser) instead of a blank tab (audit F3).
 */
import { cache } from "react";
import { createApiClient, SERVER_LIMITS, type ApiClient, type RouterOutputs } from "./trpc";
import { getServerAuth, type ServerAuth } from "./auth/server";
import { shellQueryInputs } from "./shell-queries";

export interface ServerApi {
  api: ApiClient;
  auth: ServerAuth;
}

/**
 * A new API client with the signed-in user's bearer and the server's limits. Calls made in the same tick on one client
 * travel in one batch and answer together, so queries handed over unawaited (lib/hydrate.server.tsx) use their own
 * client and never hold up what a layout awaits.
 */
export function createServerClient(auth: ServerAuth): ApiClient {
  return createApiClient({ getToken: () => auth.token, fetch: retryDroppedRead((input, init) => fetch(input, { ...init, cache: "no-store" })), limits: SERVER_LIMITS });
}

/**
 * A read (GET) whose connection dropped before any answer (`fetch` rejects with a TypeError, e.g. "fetch failed" on a
 * kept-alive socket the API closed while it was busy) is asked once more on a fresh connection, inside the same
 * `SERVER_LIMITS` deadline (the caller's signal is reused). Writes are never repeated; an HTTP error answer, a timeout
 * or an abort is returned as it came. Without this, one stale socket showed a founder "Can't reach the server" on
 * /new/ideate right after Today's first load (CI, 2026-11-09).
 */
export function retryDroppedRead(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    try {
      return await base(input, init);
    } catch (err) {
      if (method !== "GET" || !(err instanceof TypeError) || init?.signal?.aborted) throw err;
      return base(input, init);
    }
  };
}

/** The API client for the current request, or null when nobody is signed in. */
export const serverApi = cache(async (): Promise<ServerApi | null> => {
  const auth = await getServerAuth();
  if (!auth) return null;
  return { api: createServerClient(auth), auth };
});

/** `business.get` for this request (asked once, however many components need it); null when nobody is signed in. Rejects as the API does. */
export const serverBusiness = cache(async (businessId: string): Promise<RouterOutputs["business"]["get"] | null> => {
  const server = await serverApi();
  if (!server) return null;
  return server.api.business.get.query({ businessId });
});

/**
 * The sidebar's `department.list` for this request (asked once, however many components need it). Null when nobody is
 * signed in; rejects as the API does.
 */
export const serverDepartments = cache(async (businessId: string): Promise<RouterOutputs["department"]["list"] | null> => {
  const server = await serverApi();
  if (!server) return null;
  return server.api.department.list.query(shellQueryInputs(businessId).departments);
});

/**
 * `crm.entity.get` for this request (asked once, however many components need it). Null when nobody is signed in;
 * rejects as the API does.
 */
export const serverEntity = cache(async (businessId: string, entityId: string): Promise<RouterOutputs["crm"]["entity"]["get"] | null> => {
  const server = await serverApi();
  if (!server) return null;
  return server.api.crm.entity.get.query({ businessId, entityId });
});
