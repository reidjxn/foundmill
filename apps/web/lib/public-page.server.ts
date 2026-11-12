/**
 * The signed-out read behind a project's public page (app/p/[slug]): `publicPage.bySlug` on the API with no bearer,
 * fresh on every request (a page taken down answers not found at once), bounded like every server read
 * (`SERVER_LIMITS`). React `cache()`d per request, so the page, its metadata and its share image ask once each.
 */
import { cache } from "react";
import { createApiClient, SERVER_LIMITS, type RouterOutputs } from "./trpc";
import { retryDroppedRead } from "./trpc-server";

export type PublicProjectPage = NonNullable<RouterOutputs["publicPage"]["bySlug"]>;

/** The published page at `slug`, or null for an unknown address or a page that is not public. Rejects as the API does. */
export const publicProjectPage = cache(async (slug: string): Promise<PublicProjectPage | null> => {
  const api = createApiClient({ getToken: () => null, fetch: retryDroppedRead((input, init) => fetch(input, { ...init, cache: "no-store" })), limits: SERVER_LIMITS });
  return api.publicPage.bySlug.query({ slug });
});
