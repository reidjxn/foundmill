/**
 * Logo procedures (BUILD §11.1 Commit screen, §11.15 Settings › Business):
 *
 * - `business.logo.get`      the current logo as a data URL (members; null = the initials mark)
 * - `business.logo.prepare`  check an upload without storing it, for the preview (owner/admin)
 * - `business.logo.upload`   check and store a logo, replacing the current one; audited (owner/admin)
 * - `business.logo.generate` four marks from the logo designer (Opus), sanitised; rate-limited, metered, audited
 * - `business.logo.stream`   the same set, streamed: each mark the moment it passes the check (async generator over
 *   `httpBatchStreamLink`), then the whole set; one allowance per set, as `generate`
 * - `business.logo.remove`   back to the initials mark; audited (owner/admin)
 * - `idea.logo.prepare` / `idea.logo.generate` / `idea.logo.stream`  the same before commit, for the founder's own idea
 *   (rate-limited per user); the chosen logo then travels with `idea.commit`.
 *
 * A set is four parallel single-mark calls, one per direction (services/logo.ts). The allowance is given back when a
 * set fails before any tokens were spent; a streamed set that delivered a mark keeps it spent, even if stopped.
 *
 * Upload checks (prepare, upload) are limited per user (`LIMITS.logoChecksPerUserPerHour`): the SVG check is CPU work.
 * `business_logos` is read-only to app roles, so writes go through the service role after the role check and the logo
 * check (services/logo.ts), with the audit row in the same transaction.
 */
import { repos } from "@foundmill/db";
import { AppError, Archetype } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { eventStream } from "../services/event-stream";
import { BrandColours, checkLogoChoice, emptyLogoSpend, generateLogoOptions, logoLimiter, LogoChoice, LogoDataUrl, logoSlots, preparedView, sanitisedSummary, takeLogoAllowance, takeLogoCheck, type LogoBrief, type LogoEvent, type LogoSet, type LogoSpend } from "../services/logo";
import { adminProcedure, audit, businessProcedure, Id, internalErrorMessage, protectedProcedure, router, toTRPCError, type BusinessContext } from "../trpc";

const Round = z.number().int().min(0).max(10_000).default(0);

/** Gives the allowance back when the call failed before any tokens were spent (model unavailable, rate limited). */
function refundUnlessSpent(keys: string[], err: unknown): never {
  if (!(err instanceof AppError && err.code === "logo_generation_failed")) logoLimiter.refund(keys);
  throw err;
}

/** Hooks a set run reports through: `generate` ignores them, `stream` turns them into `LogoEvent`s. */
type SetHooks = { emit?: (event: LogoEvent) => void; signal?: AbortSignal };

/**
 * One set for `brief`, spending one allowance: the slots are announced, each mark is handed over as it passes, then the
 * whole set. `after` runs once the set is done (Settings audits there). The allowance is refunded only when
 * nothing was delivered and no tokens were spent.
 */
async function runLogoSet(
  ctx: Pick<Context, "models">,
  allowance: { keys: string[]; remaining: number },
  brief: LogoBrief,
  opts: { scope: string; attribution: { businessId?: string; kind: string }; after?: (set: Omit<LogoSet, "remaining"> | null, spend: LogoSpend) => Promise<void> },
  hooks: SetHooks = {},
): Promise<LogoSet> {
  let delivered = 0;
  const spend = emptyLogoSpend();
  const slots = logoSlots(brief.count);
  hooks.emit?.({ type: "started", total: slots.length, slots, mode: ctx.models.mode });
  let set: Omit<LogoSet, "remaining">;
  try {
    ({ set } = await generateLogoOptions(ctx.models, brief, {
      scope: opts.scope,
      attribution: opts.attribution,
      signal: hooks.signal,
      spend,
      onOption: (option, slot) => {
        delivered++;
        hooks.emit?.({ type: "option", index: slot.index, option });
      },
      onFailed: (slot, message) => hooks.emit?.({ type: "failed", index: slot.index, message }),
    }));
  } catch (err) {
    // A set that failed or was stopped part way is still audited with what its finished calls cost (each call was booked
    // to the ledger by the model client as it ended; a call stopped in flight is booked as an Estimate).
    if (spend.calls > 0) await opts.after?.(null, spend).catch(() => undefined);
    // A delivered mark, or a set the founder stopped, keeps the allowance spent.
    if (delivered > 0 || hooks.signal?.aborted) throw err;
    return refundUnlessSpent(allowance.keys, err);
  }
  await opts.after?.(set, spend);
  const done: LogoSet = { ...set, remaining: allowance.remaining };
  hooks.emit?.({ type: "done", set: done });
  return done;
}

/** Errors thrown mid-stream skip the error-mapping middleware: map them the same way here (as `idea.draft` does). */
function streamError(ctx: Pick<Context, "env" | "log" | "requestId">, path: string, err: unknown): TRPCError {
  const mapped = toTRPCError(err);
  if (mapped.code !== "INTERNAL_SERVER_ERROR") return mapped;
  ctx.log.error({ path, err: mapped.cause ?? mapped, requestId: ctx.requestId }, "procedure failed");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: internalErrorMessage(mapped.message, ctx.env.APP_ENV, ctx.requestId), cause: mapped.cause });
}

const BusinessGenerateInput = z.object({ colours: BrandColours.optional(), round: Round });

/**
 * Settings › Business: a set for the business, audited once it is done. Each of its model calls is booked to the
 * business's usage ledger by the API's model client (attribution `businessId`, services/models.ts), so nothing is
 * booked here.
 */
async function businessLogoSet(ctx: BusinessContext, input: z.infer<typeof BusinessGenerateInput>, hooks?: SetHooks): Promise<LogoSet> {
  const allowance = takeLogoAllowance({ userId: ctx.userId, businessId: ctx.businessId });
  let brief: LogoBrief;
  try {
    const committed = await repos.ideas.forBusiness(ctx.db, ctx.businessId);
    const colours = input.colours ?? { primary: ctx.business.kitPrimary, secondary: ctx.business.kitSecondary };
    brief = { businessName: ctx.business.name, pitch: committed?.idea.pitch ?? "", archetype: ctx.business.archetype, colours, round: input.round };
  } catch (err) {
    return refundUnlessSpent(allowance.keys, err);
  }
  return runLogoSet(
    ctx,
    allowance,
    brief,
    {
      scope: `logo:${ctx.businessId}`,
      attribution: { businessId: ctx.businessId, kind: "logo" },
      after: (set, spend) => {
        const costMinor = set?.cost.amountMinor ?? Math.round(spend.costMicroMinor / 1_000_000);
        const mode = set?.mode ?? ctx.models.mode;
        return ctx.db.transaction(async (tx) => {
          await audit(tx, ctx, { action: "business.logo.generate", target: { kind: "business", id: ctx.businessId }, details: { options: set?.options.length ?? 0, dropped: set?.dropped ?? 0, failed: set?.failed ?? 0, stopped: set === null, round: input.round, costMinor, currency: spend.currency, costLabel: "Estimate", mode, calls: spend.calls } });
        });
      },
    },
    hooks,
  );
}

const IdeaGenerateInput = z.object({ ideaId: Id, name: z.string().trim().min(1).max(120), colours: BrandColours, archetype: Archetype.optional(), round: Round });

/** Commit screen: a set for one of the founder's own ideas (no business yet, so no ledger row; DECISIONS 2026-10-09). */
async function ideaLogoSet(ctx: Context & { userId: string }, input: z.infer<typeof IdeaGenerateInput>, hooks?: SetHooks): Promise<LogoSet> {
  const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
  const allowance = takeLogoAllowance({ userId: ctx.userId });
  return runLogoSet(
    ctx,
    allowance,
    { businessName: input.name, pitch: idea.current?.pitch ?? idea.pitch, archetype: input.archetype ?? idea.archetype, colours: input.colours, round: input.round },
    { scope: `logo:user:${ctx.userId}`, attribution: { kind: "logo" } },
    hooks,
  );
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

  generate: adminProcedure.input(BusinessGenerateInput).mutation(({ ctx, input }) => businessLogoSet(ctx, input)),

  /** The same set as `generate`, streamed: `started` (the slots), each `option` as it passes the check, then `done`. */
  stream: adminProcedure.input(BusinessGenerateInput).mutation(async function* ({ ctx, input, signal }): AsyncGenerator<LogoEvent, void, undefined> {
    try {
      yield* eventStream<LogoEvent>((emit, abort) => businessLogoSet(ctx, input, { emit, signal: abort }), signal);
    } catch (err) {
      throw streamError(ctx, "business.logo.stream", err);
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
  generate: protectedProcedure.input(IdeaGenerateInput).mutation(({ ctx, input }) => ideaLogoSet(ctx, input)),

  /** The same set as `generate`, streamed mark by mark (the Commit screen's picker). */
  stream: protectedProcedure.input(IdeaGenerateInput).mutation(async function* ({ ctx, input, signal }): AsyncGenerator<LogoEvent, void, undefined> {
    try {
      yield* eventStream<LogoEvent>((emit, abort) => ideaLogoSet(ctx, input, { emit, signal: abort }), signal);
    } catch (err) {
      throw streamError(ctx, "idea.logo.stream", err);
    }
  }),
});

export { LogoChoice };
