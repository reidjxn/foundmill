/**
 * Logo procedures (BUILD §11.1 Commit screen, §11.15 Settings › Business):
 *
 * - `business.logo.get`      the current logo as a data URL (members; null = the initials mark)
 * - `business.logo.prepare`  check an upload without storing it, for the preview (owner/admin)
 * - `business.logo.upload`   check and store a logo, replacing the current one; audited (owner/admin)
 * - `business.logo.generate` four marks from the logo designer (Opus), sanitised; rate-limited, metered, audited
 * - `business.logo.remove`   back to the initials mark; audited (owner/admin)
 * - `idea.logo.prepare` / `idea.logo.generate`  the same before commit, for the founder's own idea (rate-limited per
 *   user); the chosen logo then travels with `idea.commit`.
 *
 * Upload checks (prepare, upload) are limited per user (`LIMITS.logoChecksPerUserPerHour`): the SVG check is CPU work.
 * `business_logos` is read-only to app roles, so writes go through the service role after the role check and the logo
 * check (services/logo.ts), with the audit row in the same transaction.
 */
import { repos } from "@foundmill/db";
import { AppError, Archetype } from "@foundmill/shared";
import { z } from "zod";
import { BrandColours, checkLogoChoice, generateLogoOptions, logoLimiter, LogoChoice, LogoDataUrl, preparedView, sanitisedSummary, takeLogoAllowance, takeLogoCheck } from "../services/logo";
import { adminProcedure, audit, businessProcedure, Id, protectedProcedure, router } from "../trpc";

const Round = z.number().int().min(0).max(10_000).default(0);

/** Gives the allowance back when the call failed before any tokens were spent (model unavailable, rate limited). */
function refundUnlessSpent(keys: string[], err: unknown): never {
  if (!(err instanceof AppError && err.code === "logo_generation_failed")) logoLimiter.refund(keys);
  throw err;
}

export const businessLogoRouter = router({
  /** `version` is the caller's cache key (`business.get` → `logo.sha256`); the newest logo is always returned. */
  get: businessProcedure.input(z.object({ version: z.string().max(64).optional() })).query(({ ctx }) => ctx.rls((tx) => repos.logos.get(tx, ctx.businessId))),

  prepare: adminProcedure.input(z.object({ dataUrl: LogoDataUrl })).mutation(({ ctx, input }) => {
    takeLogoCheck(ctx.userId);
    return preparedView(checkLogoChoice({ source: "upload", dataUrl: input.dataUrl }));
  }),

  upload: adminProcedure.input(LogoChoice).mutation(async ({ ctx, input }) => {
    takeLogoCheck(ctx.userId);
    // Checked once here; storage recognises the result and does not run the sanitiser again.
    const checked = checkLogoChoice(input);
    return ctx.db.transaction(async (tx) => {
      const { meta, previous } = await repos.logos.set(tx, ctx.businessId, { source: input.source, logo: checked, createdBy: ctx.userId });
      await audit(tx, ctx, {
        action: "business.logo.set",
        target: { kind: "business", id: ctx.businessId },
        details: { source: meta.source, mime: meta.mime, width: meta.width, height: meta.height, bytes: meta.bytes, sha256: meta.sha256, previousSha256: previous?.sha256 ?? null, sanitised: sanitisedSummary(checked) },
      });
      return { logo: meta, dataUrl: checked.dataUrl };
    });
  }),

  generate: adminProcedure.input(z.object({ colours: BrandColours.optional(), round: Round })).mutation(async ({ ctx, input }) => {
    const allowance = takeLogoAllowance({ userId: ctx.userId, businessId: ctx.businessId });
    try {
      const committed = await repos.ideas.forBusiness(ctx.db, ctx.businessId);
      const colours = input.colours ?? { primary: ctx.business.kitPrimary, secondary: ctx.business.kitSecondary };
      const { set, usage } = await generateLogoOptions(
        ctx.models,
        { businessName: ctx.business.name, pitch: committed?.idea.pitch ?? "", archetype: ctx.business.archetype, colours, round: input.round },
        { scope: `logo:${ctx.businessId}`, attribution: { businessId: ctx.businessId, kind: "logo" } },
      );
      await ctx.db.transaction(async (tx) => {
        await repos.usage.record(tx, ctx.businessId, { kind: "tokens", modelKey: usage.modelKey, quantity: usage.tokens, unit: "tokens", costMinor: Math.max(0, set.cost.amountMinor), currency: set.cost.currency, billedTo: "credits", details: { service: "api", route: "logoDesigner", purpose: "logo", model: usage.model, mode: set.mode, label: "Estimate" } });
        await audit(tx, ctx, { action: "business.logo.generate", target: { kind: "business", id: ctx.businessId }, details: { options: set.options.length, dropped: set.dropped, round: input.round, costMinor: set.cost.amountMinor, currency: set.cost.currency, costLabel: "Estimate", mode: set.mode } });
      });
      return { ...set, remaining: allowance.remaining };
    } catch (err) {
      refundUnlessSpent(allowance.keys, err);
    }
  }),

  remove: adminProcedure.mutation(({ ctx }) =>
    ctx.db.transaction(async (tx) => {
      const removed = await repos.logos.remove(tx, ctx.businessId);
      if (removed) await audit(tx, ctx, { action: "business.logo.remove", target: { kind: "business", id: ctx.businessId }, details: { sha256: removed.sha256, mime: removed.mime, source: removed.source } });
      return { removed: removed !== null };
    }),
  ),
});

export const ideaLogoRouter = router({
  /** Check an upload before commit and return what would be stored (the preview shows exactly that). */
  prepare: protectedProcedure.input(z.object({ dataUrl: LogoDataUrl })).mutation(({ ctx, input }) => {
    takeLogoCheck(ctx.userId);
    return preparedView(checkLogoChoice({ source: "upload", dataUrl: input.dataUrl }));
  }),

  /** Four marks for one of the founder's ideas, from the name on the Commit screen, the idea's pitch and archetype. */
  generate: protectedProcedure
    .input(z.object({ ideaId: Id, name: z.string().trim().min(1).max(120), colours: BrandColours, archetype: Archetype.optional(), round: Round }))
    .mutation(async ({ ctx, input }) => {
      const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
      const allowance = takeLogoAllowance({ userId: ctx.userId });
      try {
        const { set } = await generateLogoOptions(
          ctx.models,
          { businessName: input.name, pitch: idea.current?.pitch ?? idea.pitch, archetype: input.archetype ?? idea.archetype, colours: input.colours, round: input.round },
          { scope: `logo:user:${ctx.userId}`, attribution: { kind: "logo" } },
        );
        return { ...set, remaining: allowance.remaining };
      } catch (err) {
        refundUnlessSpent(allowance.keys, err);
      }
    }),
});

export { LogoChoice };
