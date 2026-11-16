/**
 * The idea box after sign-in (docs/IDEA_BOX.md):
 *
 * - `ideaBox.claim({ token?, claim? })`: the visitor's card into their deck (the web's /start Server Action sends the
 *   `fm_idea` cookie it read, or the claim token the sign-in link carried). Null when there is nothing to claim.
 * - `waitlist.join({ token?, via? })`: a signed-in person who is not on the invite list yet. Their card is kept 90 days.
 *   `via` is the web's `fm_via` cookie: a waitlist link (`w.<code>`, WP-03 T10) records whose link brought them, once,
 *   when the entry is made; any other reference is ignored here.
 * - `waitlist.status`: whether they are on it, and their own link to share (`shareUrl`). Never a place or a count
 *   (DECISIONS 2026-11-12, "No public counts").
 *
 * The waitlist procedures take any signed-in person with a confirmed address, on the list or not (that is who they are
 * for); `ideaBox.claim` is for people who may use the product (`protectedProcedure`).
 */
import { TRPCError } from "@trpc/server";
import { repos, IDEA_DRAFT_HOLD_MS } from "@foundmill/db";
import { IdeaToken } from "@foundmill/shared";
import { VIA_MAX_LENGTH, parseVia, withVia } from "@foundmill/shared/via";
import { z } from "zod";
import { recordFirstIdeas, recordIdeaKept } from "../services/funnel-facts";
import { claimIdeaBoxDraft, ideaTokenHash, previewIdeaBoxDraft } from "../services/idea-box";
import { protectedProcedure, publicProcedure, router } from "../trpc";

/** How soon after signing in the email link's claim token still claims. */
export const CLAIM_FRESH_MS = 30 * 60_000;

const ClaimInput = z.strictObject({ token: IdeaToken.nullish(), claim: IdeaToken.nullish() });

/** Signed in with a confirmed address; the invite list is not checked (the waitlist is for people not on it). */
const confirmedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
  if (!ctx.emailConfirmed || !ctx.email) throw new TRPCError({ code: "FORBIDDEN", message: "Confirm your email address first" });
  return next({ ctx: { ...ctx, userId: ctx.userId, email: ctx.email } });
});

/** The link's claim token counts only right after a sign-in. */
const freshClaim = (ctx: { authenticatedAt: Date | null }, claim: string | null | undefined) => (!!ctx.authenticatedAt && Date.now() - ctx.authenticatedAt.getTime() <= CLAIM_FRESH_MS ? (claim ?? null) : null);

export const ideaBoxRouter = router({
  /**
   * The card waiting to be kept, without keeping it: the cookie's, the sign-in link's (right after a sign-in only), or
   * the one the person's waitlist entry holds. Null when there is none.
   */
  preview: protectedProcedure.input(ClaimInput).query(async ({ ctx, input }) => previewIdeaBoxDraft(ctx.db, ctx.userId, { token: input.token, claim: freshClaim(ctx, input.claim) })),
  /**
   * Keeps it ("Keep this card", a POST from /new/card/keep). The link's claim token counts only within `CLAIM_FRESH_MS`
   * of a sign-in, so a link someone else sends to a person who is already signed in cannot reach their deck, and the
   * press itself means nobody's card lands in a deck unseen.
   */
  claim: protectedProcedure.input(ClaimInput).mutation(async ({ ctx, input }) => {
    const claimed = await claimIdeaBoxDraft(ctx.db, ctx.userId, { token: input.token, claim: freshClaim(ctx, input.claim) });
    // The funnel's facts (WP-02 T9): a first keep only; a repeat (`again`) writes nothing.
    if (claimed && !claimed.again) {
      await recordIdeaKept(ctx, ctx.userId, claimed.ideaId);
      await recordFirstIdeas(ctx, ctx.userId, "idea_box", 1);
    }
    return claimed;
  }),
});

/** The person's own waitlist link: the home page with `?via=w.<code>`; null before the entry has a code. */
const waitlistShareUrl = (appUrl: string, code: string | null | undefined): string | null =>
  code ? withVia(`${appUrl.trim().replace(/\/+$/, "")}/`, { kind: "waitlist", ref: code }) : null;

export const waitlistRouter = router({
  join: confirmedProcedure
    .input(z.strictObject({ token: IdeaToken.nullish(), via: z.string().max(VIA_MAX_LENGTH).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const held = input.token ? await repos.ideaDrafts.hold(ctx.db, ideaTokenHash(input.token), new Date(now.getTime() + IDEA_DRAFT_HOLD_MS), now) : null;
      const ref = parseVia(input.via);
      const referrerCode = ref?.kind === "waitlist" ? ref.ref : null;
      const entry = await repos.waitlist.join(ctx.db, { userId: ctx.userId, email: ctx.email, ideaDraftId: held?.id ?? null, referrerCode, now });
      return { joined: true as const, cardKept: !!held, shareUrl: waitlistShareUrl(ctx.env.APP_URL, entry.code) };
    }),
  status: confirmedProcedure.query(async ({ ctx }) => {
    const entry = await repos.waitlist.get(ctx.db, ctx.userId);
    return { joined: !!entry, cardKept: !!entry?.ideaDraftId, shareUrl: waitlistShareUrl(ctx.env.APP_URL, entry?.code) };
  }),
});
