/**
 * page.* — the project's public page in the console (Product › Public page; services/pages.ts) — and publicPage.* — the
 * signed-out read behind `/p/<slug>`.
 *
 * - `page.get`: any member with Product read; the starter draft when nothing was saved (no write, no model call).
 * - `page.saveDraft`, `page.setSlug`: Product write (the right that edits the vision); audited.
 * - `page.publish`, `page.unpublish`: an owner or an admin with Product write, by their own press (no agent tool calls
 *   these); audited, with `page.published` / `page.unpublished` through the outbox in the same transaction.
 * - `publicPage.indexNowKeyFile`: anyone; the IndexNow key file of a public page whose founders connected IndexNow for it
 *   (`/p/<slug>/<key>.txt`), or null.
 * - `publicPage.bySlug`: anyone, signed in or not; the view `public_project_pages` only; null for an unknown address
 *   or a page that is not public.
 * - `publicPage.follow`: anyone; signs up to follow a published page whose "Follow" form is on (services/pages.ts
 *   `followPage`, double opt-in: a pending record and one confirmation email). The same `{ ok: true }` whether the
 *   address was new, already following, suppressed or the hidden field was filled.
 */
import { FOLLOW_EMAIL_MAX, PAGE_ABOUT_MAX, PAGE_FOR_WHOM_MAX, PAGE_PITCH_MAX, PAGE_SLUG_MAX, PAGE_STAGES } from "@foundmill/shared";
import { z } from "zod";
import { followPage, pageView, publicIndexNowKeyFile, publicPageBySlug, publishPage, savePageDraft, setPageSlug, unpublishPage } from "../services/pages";
import { publicProcedure, router, sectionAdmin, sectionRead, sectionWrite } from "../trpc";

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
});

export const pageRouter = router({
  get: read.query(({ ctx }) => pageView(ctx)),
  saveDraft: write.input(z.object({ draft: ContentInput })).mutation(({ ctx, input }) => savePageDraft(ctx, { draft: input.draft })),
  setSlug: write.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2), draft: ContentInput.optional() })).mutation(({ ctx, input }) => setPageSlug(ctx, input)),
  publish: publish.input(z.object({ content: ContentInput })).mutation(({ ctx, input }) => publishPage(ctx, { content: input.content })),
  unpublish: publish.mutation(({ ctx }) => unpublishPage(ctx)),
});

export const publicPageRouter = router({
  bySlug: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2) })).query(({ ctx, input }) => publicPageBySlug(ctx, input.slug)),
  indexNowKeyFile: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2), key: z.string().max(128) })).query(({ ctx, input }) => publicIndexNowKeyFile(ctx, input)),
  follow: publicProcedure
    .input(
      z.object({
        slug: z.string().max(PAGE_SLUG_MAX * 2),
        email: z.string().max(FOLLOW_EMAIL_MAX * 2),
        consent: z.boolean(),
        website: z.string().max(500).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => followPage(ctx, input)),
});
