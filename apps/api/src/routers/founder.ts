/** founder.profile.get/update (BUILD §11.1 founder profile; AC-11.1.1 gate lives in apps/web on `profile === null`). */
import { repos, FounderProfileInput, FounderProfilePatch } from "@foundmill/db";
import { protectedProcedure, router } from "../trpc";

export const founderRouter = router({
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const profile = await repos.founders.get(ctx.db, ctx.userId);
      const memberships = await repos.memberships.listForUser(ctx.db, ctx.userId);
      const businesses = await repos.businesses.listForUser(ctx.db, ctx.userId);
      return { profile, complete: profile !== null, email: ctx.email, memberships, businesses };
    }),
    update: protectedProcedure.input(FounderProfilePatch).mutation(async ({ ctx, input }) => {
      const existing = await repos.founders.get(ctx.db, ctx.userId);
      if (existing) return repos.founders.update(ctx.db, ctx.userId, input);
      const created = FounderProfileInput.parse({ displayName: input.displayName ?? ctx.email?.split("@")[0] ?? "Founder", ...input });
      return repos.founders.upsert(ctx.db, ctx.userId, created);
    }),
  }),
});
