/**
 * tRPC for Server Components and Route Handlers: a vanilla client carrying the signed-in user's bearer. Layouts use
 * it to load the business, departments and the founder profile before rendering the shell (ARCHITECTURE §14).
 *
 * `serverApi`, `serverBusiness` and `serverDepartments` are wrapped in React `cache()`: within one server request (the
 * layout, the `generateMetadata`s and the page) the session is read once and `business.get` and `department.list` are
 * asked once each. The cache is per request,
 * so nothing is shared between requests or users.
 */
import { cache } from "react";
import { createApiClient, type ApiClient, type RouterOutputs } from "./trpc";
import { getServerAuth, type ServerAuth } from "./auth/server";
import { shellQueryInputs } from "./shell-queries";

export interface ServerApi {
  api: ApiClient;
  auth: ServerAuth;
}

/**
 * A new API client with the signed-in user's bearer. Calls made in the same tick on one client travel in one batch and
 * answer together, so queries handed over unawaited (lib/hydrate.server.tsx) use their own client and never hold up
 * what a layout awaits.
 */
export function createServerClient(auth: ServerAuth): ApiClient {
  return createApiClient({ getToken: () => auth.token, fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) });
}

/** The API client for the current request, or null when nobody is signed in. */
export const serverApi = cache(async (): Promise<ServerApi | null> => {
  const auth = await getServerAuth();
  if (!auth) return null;
  return { api: createServerClient(auth), auth };
});

/** `business.get` for this request (layout and metadata share one call); null when nobody is signed in. Rejects as the API does. */
export const serverBusiness = cache(async (businessId: string): Promise<RouterOutputs["business"]["get"] | null> => {
  const server = await serverApi();
  if (!server) return null;
  return server.api.business.get.query({ businessId });
});

/**
 * The sidebar's `department.list` for this request: the layout and the department and agent pages' `generateMetadata`
 * (their browser titles) share one call. Null when nobody is signed in; rejects as the API does.
 */
export const serverDepartments = cache(async (businessId: string): Promise<RouterOutputs["department"]["list"] | null> => {
  const server = await serverApi();
  if (!server) return null;
  return server.api.department.list.query(shellQueryInputs(businessId).departments);
});

/**
 * `crm.entity.get` for this request: the entity page's browser title and the profile the page hands to the browser
 * share one call. Null when nobody is signed in; rejects as the API does.
 */
export const serverEntity = cache(async (businessId: string, entityId: string): Promise<RouterOutputs["crm"]["entity"]["get"] | null> => {
  const server = await serverApi();
  if (!server) return null;
  return server.api.crm.entity.get.query({ businessId, entityId });
});
