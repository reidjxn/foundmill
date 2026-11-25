/**
 * page.* — the project's public page in the console (Product › Public page; services/pages.ts) — and publicPage.* — the
 * signed-out read behind `/p/<slug>`.
 *
 * - `page.get`: any member with Product read; the starter draft when nothing was saved (no write, no model call).
 * - `page.saveDraft`, `page.setSlug`: Product write (the right that edits the vision); audited.
 * - `page.publish`, `page.unpublish`: an owner or an admin with Product write, by their own press (no agent tool calls
 *   these); audited, with `page.published` / `page.unpublished` through the outbox in the same transaction.
 * - `page.setExplore`: an owner or an admin; the opt-in to the public gallery, audited.
 * - `publicPage.explore`: anyone; the gallery of pages whose owners opted in (the view `public_explore_projects` only).
 * - `publicPage.indexNowKeyFile`: anyone; the IndexNow key file of a public page whose founders connected IndexNow for it
 *   (`/p/<slug>/<key>.txt`), or null.
 * - `publicPage.bySlug`: anyone, signed in or not; the view `public_project_pages` only; null for an unknown address
 *   or a page that is not public.
 * - `publicPage.storyBySlug`, `publicPage.cardById`: anyone; the milestones the founders chose to show (the view
 *   `public_project_milestones` only, services/milestones.ts): the project's story oldest first, and one card by its id;
 *   null for anything not public. Showing and hiding are `journey.showMilestone` / `journey.hideMilestone`.
 * - `publicPage.follow`: anyone; signs up to follow a published page whose "Follow" form is on (services/pages.ts
 *   `followPage`, double opt-in: a pending record and one confirmation email). The same `{ ok: true }` whether the
 *   address was new, already following, suppressed or the hidden field was filled. A Turnstile token is checked (through
 *   the gateway) before anything is recorded or sent; without a valid one the answer is `follow_unverified`. `post` is
 *   the last post code the visitor arrived with (item 8): the follow keeps that post's link only when it is the
 *   project's own, not simulated and visited, and the follow is credited to the post once the person confirms.
 * - `publicPage.visited`: anyone; the public page's beacon after it loaded, with the address's `via`. The first visit of
 *   a shared post's link stamps it (services/post-attribution.ts); a member's own visit and anything else change
 *   nothing. With the page's `slug` (a browser that is not automated) it also counts the visit by day and source
 *   (services/page-visits.ts, founder Nov 25, 2026). Always `{ ok: true }`.
 */
import { FOLLOW_EMAIL_MAX, PAGE_ABOUT_MAX, PAGE_CTA_LABEL_MAX, PAGE_CTA_URL_MAX, PAGE_FOR_WHOM_MAX, PAGE_OFFER_MAX, PAGE_PITCH_MAX, PAGE_PRICE_MAX, PAGE_SLUG_MAX, PAGE_STAGES } from "@foundmill/shared";
import { VIA_MAX_LENGTH } from "@foundmill/shared/via";
import { z } from "zod";
import { publicCardById, publicStoryBySlug } from "../services/milestones";
import { dismissPageProposal, usePageProposal, followPage, pageView, siteFollowConsent, publicExplore, publicIndexNowKeyFile, publicListedPages, publicPageBySlug, publishPage, savePageDraft, setPageExplore, setPageSlug, unpublishPage } from "../services/pages";
import { recordPageVisit } from "../services/page-visits";
import { recordPostVisit } from "../services/post-attribution";
import { publicProcedure, router, sectionAdmin, sectionRead, sectionWrite } from "../trpc";
import { publicUpdateCardById } from "../services/update-cards";

const read = sectionRead("product");
const write = sectionWrite("product");
const publish = sectionAdmin("product");

/** The page's fields as the client sends them; the shared schema tidies and checks them in the service. */
const ContentInput = z.object({
  pitch: z.string().max(PAGE_PITCH_MAX * 4),
  about: z.string().max(PAGE_ABOUT_MAX * 4),
  forWhom: z.string().max(PAGE_FOR_WHOM_MAX * 4).default(""),
  stage: z.enum(PAGE_STAGES).default("idea"),
  showFounders: z.boolean().default(false),
  followForm: z.boolean().default(true),
  offer: z.string().max(PAGE_OFFER_MAX * 4).optional(),
  price: z.string().max(PAGE_PRICE_MAX * 4).optional(),
  cta: z.object({ label: z.string().max(PAGE_CTA_LABEL_MAX * 4), url: z.string().max(PAGE_CTA_URL_MAX * 2) }).nullish(),
  askForm: z.boolean().optional(),
});

export const pageRouter = router({
  get: read.query(({ ctx }) => pageView(ctx)),
  saveDraft: write.input(z.object({ draft: ContentInput })).mutation(({ ctx, input }) => savePageDraft(ctx, { draft: input.draft })),
  setSlug: write.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2), draft: ContentInput.optional() })).mutation(({ ctx, input }) => setPageSlug(ctx, input)),
  publish: publish.input(z.object({ content: ContentInput })).mutation(({ ctx, input }) => publishPage(ctx, { content: input.content })),
  unpublish: publish.mutation(({ ctx }) => unpublishPage(ctx)),
  proposal: router({
    use: write.mutation(({ ctx }) => usePageProposal(ctx)),
    dismiss: write.mutation(({ ctx }) => dismissPageProposal(ctx)),
  }),
  setExplore: publish.input(z.object({ listed: z.boolean() })).mutation(({ ctx, input }) => setPageExplore(ctx, input)),
});

export const publicPageRouter = router({
  bySlug: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2) })).query(({ ctx, input }) => publicPageBySlug(ctx, input.slug)),
  storyBySlug: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2) })).query(({ ctx, input }) => publicStoryBySlug(ctx, input.slug)),
  /** Listed pages for the sitemap (WP-08 T7): address, last change, story; paged by address. */
  listed: publicProcedure.input(z.object({ cursor: z.string().max(PAGE_SLUG_MAX).nullish(), limit: z.number().int().min(1).max(5_000).default(5_000) })).query(({ ctx, input }) => publicListedPages(ctx, input)),
  /** The opt-in gallery (`/explore`, 0149): newest projects whose owners chose to be listed and whose pages are live. */
  explore: publicProcedure.query(({ ctx }) => publicExplore(ctx)),
  cardById: publicProcedure.input(z.object({ id: z.string().max(80) })).query(({ ctx, input }) => publicCardById(ctx, input.id)),
  indexNowKeyFile: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2), key: z.string().max(128) })).query(({ ctx, input }) => publicIndexNowKeyFile(ctx, input)),
  follow: publicProcedure
    .input(
      z.object({
        slug: z.string().max(PAGE_SLUG_MAX * 2),
        email: z.string().max(FOLLOW_EMAIL_MAX * 2),
        consent: z.boolean(),
        website: z.string().max(500).nullish(),
        turnstile: z.string().max(4096).nullish(),
        /** The last post code the visitor arrived with (the web's `fm_post` cookie), or nothing. A hint, never trusted. */
        post: z.string().max(40).nullish(),
        /** The project's site's form (apps/sites, WP-07 T6) instead of its public page. */
        via: z.enum(["page", "site"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => followPage(ctx, input)),
  /** The sentence a site's sign-up form shows beside its box (apps/sites, WP-07 T6): the same one the record keeps. */
  siteConsent: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2) })).query(({ ctx, input }) => siteFollowConsent(ctx, input.slug)),
  visited: publicProcedure
    .input(
      z.object({
        via: z.string().max(VIA_MAX_LENGTH * 2).default(""),
        /** The page that loaded, sent only by a browser that is not automated: its visit is counted (0175). */
        slug: z.string().max(PAGE_SLUG_MAX * 2).optional(),
        /** The address's query and the referrer: they choose the source bucket and are never stored. */
        search: z.string().max(2000).optional(),
        referrer: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.slug) await recordPageVisit(ctx, { slug: input.slug, via: input.via, search: input.search, referrer: input.referrer });
      return recordPostVisit(ctx, { via: input.via });
    }),
  /** One Customer Update a founder shared as a card (WP-14 T9; the view `public_customer_update_cards` only); null for anything not public. */
  updateCardById: publicProcedure.input(z.object({ id: z.string().max(80) })).query(({ ctx, input }) => publicUpdateCardById(ctx, input.id)),
});
