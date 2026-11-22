/**
 * The signed-out reads behind a project's public page (app/p/[slug]), its story (app/p/[slug]/story) and its milestone
 * cards (app/m/[id]): `publicPage.bySlug`, `publicPage.storyBySlug` and `publicPage.cardById` on the API with no
 * bearer, fresh on every request (a page taken down, or a milestone hidden, answers not found at once), bounded like
 * every server read (`SERVER_LIMITS`). React `cache()`d per request, so a page, its metadata and its share image ask
 * once each.
 */
import { cache } from "react";
import { appErrorCode, createApiClient, SERVER_LIMITS, trpcErrorCode, type RouterOutputs } from "./trpc";
import { retryDroppedRead } from "./trpc-server";

export type PublicProjectPage = NonNullable<RouterOutputs["publicPage"]["bySlug"]>;
export type PublicProjectStory = NonNullable<RouterOutputs["publicPage"]["storyBySlug"]>;
export type PublicMilestoneCard = NonNullable<RouterOutputs["publicPage"]["cardById"]>;

const publicApi = () => createApiClient({ getToken: () => null, fetch: retryDroppedRead((input, init) => fetch(input, { ...init, cache: "no-store" })), limits: SERVER_LIMITS });

/** The published page at `slug`, or null for an unknown address or a page that is not public. Rejects as the API does. */
export const publicProjectPage = cache(async (slug: string): Promise<PublicProjectPage | null> => publicApi().publicPage.bySlug.query({ slug }));

/**
 * The story at `slug`: the project and the milestones its founders chose to show, oldest first. Null for an unknown
 * address, a page that is not public and a page that shows no milestone. Rejects as the API does.
 */
export const publicProjectStory = cache(async (slug: string): Promise<PublicProjectStory | null> => publicApi().publicPage.storyBySlug.query({ slug }));

/** The card of one shown milestone, or null when it is not shown (or its project's page is not public). Rejects as the API does. */
export const publicMilestoneCard = cache(async (id: string): Promise<PublicMilestoneCard | null> => publicApi().publicPage.cardById.query({ id }));

/** The gallery (`/explore`): the pages whose founders opted in, newest first. Rejects as the API does. */
export const publicExplore = cache(async () => publicApi().publicPage.explore.query());

/**
 * The IndexNow key file of a public page (app/p/[slug]/[keyFile]): the key when it is the one the project's founders
 * connected IndexNow with for this page, else null. Not cached: each request names its own key.
 */
export async function publicIndexNowKeyFile(slug: string, key: string): Promise<string | null> {
  return (await publicApi().publicPage.indexNowKeyFile.query({ slug, key }))?.key ?? null;
}

export type PublicPageQuiz = NonNullable<RouterOutputs["publicQuiz"]["bySlug"]>;

/**
 * The live quiz on the page at `slug` (0105), or null: none, turned off, or the read failed. Optional on the page, so a
 * failure leaves the quiz out rather than the page.
 */
export const publicPageQuiz = cache(async (slug: string): Promise<PublicPageQuiz | null> => publicApi().publicQuiz.bySlug.query({ slug }).catch(() => null));

export type PublicBookingSetup = RouterOutputs["publicBooking"]["get"];
export type PublicManagedBooking = RouterOutputs["publicBooking"]["manage"];

/**
 * The live booking setup of the page at `slug` (founder, Nov 22, 2026), or null when booking is not open there: not set
 * up, off, or the page not public. Any other failure rejects as the API does.
 */
export const publicBookingSetup = cache(async (slug: string): Promise<PublicBookingSetup | null> => {
  try {
    return await publicApi().publicBooking.get.query({ slug });
  } catch (err) {
    if (appErrorCode(err) === "booking_closed" || trpcErrorCode(err) === "NOT_FOUND") return null;
    throw err;
  }
});

/** What the customer's link shows, or null for a link that is not valid. Any other failure rejects as the API does. */
export async function publicManagedBooking(token: string): Promise<PublicManagedBooking | null> {
  try {
    return await publicApi().publicBooking.manage.query({ token });
  } catch (err) {
    if (appErrorCode(err) === "booking_not_found" || trpcErrorCode(err) === "NOT_FOUND") return null;
    throw err;
  }
}

/** Like the project page, but for the optional pieces on it: never fails the page. Null when booking is not live. */
export const publicBookingBlock = cache(async (slug: string): Promise<Pick<PublicBookingSetup, "services"> | null> =>
  publicApi()
    .publicBooking.block.query({ slug })
    .catch(() => null),
);
