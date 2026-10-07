/**
 * tRPC for Server Components and Route Handlers: a vanilla client carrying the signed-in user's bearer. Layouts use
 * it to load the business, departments and the founder profile before rendering the shell (ARCHITECTURE §14).
 */
import { createApiClient, type ApiClient } from "./trpc";
import { getServerAuth, type ServerAuth } from "./auth/server";

export interface ServerApi {
  api: ApiClient;
  auth: ServerAuth;
}

/** The API client for the current request, or null when nobody is signed in. */
export async function serverApi(): Promise<ServerApi | null> {
  const auth = await getServerAuth();
  if (!auth) return null;
  const api = createApiClient({ getToken: () => auth.token, fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) });
  return { api, auth };
}
