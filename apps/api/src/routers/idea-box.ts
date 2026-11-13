/**
 * The idea box after sign-in (docs/IDEA_BOX.md):
 *
 * - `ideaBox.claim({ token?, claim? })`: the visitor's card into their deck (the web's /start Server Action sends the
 *   `fm_idea` cookie it read, or the claim token the sign-in link carried). Null when there is nothing to claim.
 * - `waitlist.join({ token? })`: a signed-in person who is not on the invite list yet. Their card is kept 90 days.
 * - `waitlist.status`: whether they are on it.
 *
 * The waitlist procedures take any signed-in person with a confirmed address, on the list or not (that is who they are
 * for); `ideaBox.claim` is for people who may use the product (`protectedProcedure`).
 */
import { TRPCError } from "@trpc/server";
import { repos, IDEA_DRAFT_HOLD_MS } from "@foundmill/db";
import { IdeaToken } from "@foundmill/shared";
import { z } from "zod";
import { claimIdeaBoxDraft, ideaTokenHash } from "../services/idea-box";
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

export const ideaBoxRouter = router({
  /**
   * The cookie's token claims at any time. The sign-in link's claim token claims only right after a sign-in
   * (`CLAIM_FRESH_MS`): a link someone else sends to a person who is already signed in cannot drop a card into their deck.
   */
  claim: protectedProcedure.input(ClaimInput).mutation(async ({ ctx, input }) => {
    const fresh = !!ctx.authenticatedAt && Date.now() - ctx.authenticatedAt.getTime() <= CLAIM_FRESH_MS;
    return claimIdeaBoxDraft(ctx.db, ctx.userId, { token: input.token, claim: fresh ? input.claim : null });
  }),
});

export const waitlistRouter = router({
  join: confirmedProcedure.input(z.strictObject({ token: IdeaToken.nullish() })).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const held = input.token ? await repos.ideaDrafts.hold(ctx.db, ideaTokenHash(input.token), new Date(now.getTime() + IDEA_DRAFT_HOLD_MS), now) : null;
    await repos.waitlist.join(ctx.db, { userId: ctx.userId, email: ctx.email, ideaDraftId: held?.id ?? null, now });
    return { joined: true as const, cardKept: !!held };
  }),
  status: confirmedProcedure.query(async ({ ctx }) => {
    const entry = await repos.waitlist.get(ctx.db, ctx.userId);
    return { joined: !!entry, cardKept: !!entry?.ideaDraftId };
  }),
});
