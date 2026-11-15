/**
 * The signed-out read behind a person's public profile (app/u/[handle]): `publicPerson.byHandle` on the API with no
 * bearer, fresh on every request (a profile taken down answers not found at once), bounded like every server read
 * (`SERVER_LIMITS`). React `cache()`d per request, so the page, its metadata and its share image ask once each.
 */
import { cache } from "react";
import { createApiClient, SERVER_LIMITS, type RouterOutputs } from "./trpc";
import { retryDroppedRead } from "./trpc-server";

export type PublicPerson = NonNullable<RouterOutputs["publicPerson"]["byHandle"]>;

/** The public profile at `handle`, or null for an unknown handle or a profile that is not public. Rejects as the API does. */
export const publicPerson = cache(async (handle: string): Promise<PublicPerson | null> => {
  const api = createApiClient({ getToken: () => null, fetch: retryDroppedRead((input, init) => fetch(input, { ...init, cache: "no-store" })), limits: SERVER_LIMITS });
  return api.publicPerson.byHandle.query({ handle });
});
