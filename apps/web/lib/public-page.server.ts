/**
 * The signed-out reads behind a project's public page (app/p/[slug]), its story (app/p/[slug]/story) and its milestone
 * cards (app/m/[id]): `publicPage.bySlug`, `publicPage.storyBySlug` and `publicPage.cardById` on the API with no
 * bearer, fresh on every request (a page taken down, or a milestone hidden, answers not found at once), bounded like
 * every server read (`SERVER_LIMITS`). React `cache()`d per request, so a page, its metadata and its share image ask
 * once each.
 */
import { cache } from "react";
import { createApiClient, SERVER_LIMITS, type RouterOutputs } from "./trpc";
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
