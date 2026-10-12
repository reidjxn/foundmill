/**
 * business.get/update/setGameMode/setBusinessMode/setSpendCap/continue/pauseCycle/resumeCycle/startHoliday/endHoliday/
 * stopAllAgents/resumeAgents/export/archive/requestDeletion/cancelDeletion (BUILD §9.4, §9.6, §11.15, §14).
 */
import { LIMITS } from "@foundmill/config";
import { repos, UpdateBusinessInput } from "@foundmill/db";
import { BUSINESS_MODES, DECISION_TYPES, EVENT_TYPES, GAME_MODES } from "@foundmill/shared";
import { z } from "zod";
import { pauseCycle, resumeCycle, startCycle } from "../services/cycle";
import { assertAgentsRunning, resumeAgents, stopAllAgents } from "../services/killswitch";
import { archiveBusiness, cancelDeletion, deletionState, exportBusiness, requestDeletion } from "../services/lifecycle";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { noteAsSeenBy } from "../services/inbox-redaction";
import { adminProcedure, audit, businessProcedure, emit, ownerProcedure, router, writeProcedure } from "../trpc";
import { businessLogoRouter } from "./logo";

/** What an admin may change on the business record (Settings › Business and Glossary send these). */
const BusinessSettingsInput = UpdateBusinessInput.pick({ name: true, slug: true, archetype: true, kitPrimary: true, kitSecondary: true, glossary: true });

const HolidayUntil = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date: z.coerce.date() }),
  z.object({ kind: z.literal("condition"), condition: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal("return") }),
]);

export const businessRouter = router({
  logo: businessLogoRouter,

  get: businessProcedure.query(async ({ ctx }) => {
    const [holiday, blocking, departments, agents, deletion, logo, foundations] = await ctx.rls(async (tx) =>
      Promise.all([repos.holidays.current(tx, ctx.businessId), repos.inbox.countBlocking(tx, ctx.businessId), repos.departments.list(tx, ctx.businessId), repos.agents.countByStatus(tx, ctx.businessId), deletionState({ db: tx, businessId: ctx.businessId }), repos.logos.getMeta(tx, ctx.businessId), repos.foundations.get(tx, ctx.businessId)]),
    );
    return {
      business: ctx.business,
      /**
       * The logo's metadata only (a few hundred bytes); the image itself comes from `business.logo.get`, keyed by
       * `sha256`, so this payload stays small. Null: draw the initials mark.
       */
      logo,
      role: ctx.role,
      membership: ctx.membership,
      holiday,
      blockingItems: blocking,
      departments,
      agentsByStatus: agents,
      /** Brand colours (the `kit` key is the wave-1 identifier; display label is "Brand colours"). */
      kit: { primary: ctx.business.kitPrimary, secondary: ctx.business.kitSecondary },
      brandColours: { primary: ctx.business.kitPrimary, secondary: ctx.business.kitSecondary },
      deletion: deletion.status === "scheduled" ? deletion : null,
      /**
       * Where the first-open drafting of the vision, specification and roadmap stands (`none`: this business has none).
       * The shell calls `product.foundations.ensure` only while it is pending or drafting, not on every open.
       */
      foundationsStatus: foundations?.status ?? ("none" as const),
    };
  }),

  /**
   * One press of Continue (BUILD §9.4): starts the next businessCycle on Temporal when reachable, resumes a paused one,
   * or runs one in-process cycle step (one new Inbox item through the composer) and returns the new Continue state.
   * Refuses (CONFLICT) while red items block Continue or a holiday is running. The note an in-process step wrote comes
   * back as this person may read it (the walls of inbox.get; audit RUI-02).
   */
  continue: writeProcedure.use(modelLimited("continue")).mutation(async ({ ctx }) => {
    const result = await startCycle(ctx);
    const item = result.item;
    return item ? { ...result, item: await ctx.rls((tx) => noteAsSeenBy(tx, ctx.businessId, ctx.membership, item)) } : result;
  }),
  pauseCycle: writeProcedure.mutation(({ ctx }) => pauseCycle(ctx)),
  resumeCycle: writeProcedure.mutation(({ ctx }) => resumeCycle(ctx)),

  // Settings › Business and Glossary fields only. The plan and model billing change through the owner-only
  // `billing.changeTier` (audited there); the data region is not changed from here; the logo goes through
  // `business.logo.*` (crest_url is retired, 0017). Other keys are stripped by the schema.
  update: adminProcedure.input(BusinessSettingsInput).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const business = await repos.businesses.update(tx, ctx.businessId, input);
      await audit(tx, ctx, { action: "business.update", target: { kind: "business", id: ctx.businessId }, details: { fields: Object.keys(input) } });
      return business;
    }),
  ),

  setGameMode: adminProcedure.input(z.object({ gameMode: z.enum(GAME_MODES), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const business = await ctx.rls(async (tx) => {
      const from = ctx.business.gameMode;
      const changed = await repos.businesses.setGameMode(tx, ctx.businessId, input.gameMode);
      if (from !== input.gameMode) {
        await emit(tx, ctx, { type: "mode.changed", payload: { scope: "game", from, to: input.gameMode, reason: input.reason ?? null } });
        await audit(tx, ctx, { action: "business.set_game_mode", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.gameMode } });
      }
      return changed;
    });
    // LIVE → Personal (BUILD §7.3, AC-11.14.2): the business leaves every leaderboard now. The rows live behind
    // service_role-only grants, so this runs on the service connection once the mode change has committed; reads also
    // hide any business that is not LIVE, so a failure here never shows a Personal business.
    if (input.gameMode !== "live") await repos.social.removeBusinessFromLeaderboards(ctx.db, ctx.businessId);
    return business;
  }),

  setBusinessMode: adminProcedure.input(z.object({ businessMode: z.enum(BUSINESS_MODES), reason: z.string().max(500).optional() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = ctx.business.businessMode;
      const business = await repos.businesses.setBusinessMode(tx, ctx.businessId, input.businessMode);
      if (from !== input.businessMode) {
        await emit(tx, ctx, { type: "mode.changed", payload: { scope: "business", from, to: input.businessMode, reason: input.reason ?? null } });
        await audit(tx, ctx, { action: "business.set_business_mode", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.businessMode } });
      }
      return business;
    }),
  ),

  /**
   * The "Spend cap per action" (Settings › Mode; first set on Commit), in minor units of the business currency: above it
   * every spend asks the founder first, whatever the mode (the gateway lowers each agent's approval threshold to it).
   * Null removes the business cap; each agent's own threshold then applies.
   */
  setSpendCap: adminProcedure.input(z.object({ spendCapMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = ctx.business.spendCapMinor;
      const business = await repos.businesses.setSpendCap(tx, ctx.businessId, input.spendCapMinor);
      if (from !== input.spendCapMinor) await audit(tx, ctx, { action: "business.set_spend_cap", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.spendCapMinor } });
      return business;
    }),
  ),

  /** Holiday = Automated mode with the Chief of Staff in charge (BUILD §9.6). */
  startHoliday: adminProcedure
    .input(
      z.object({
        until: HolidayUntil,
        authority: z.array(z.enum(DECISION_TYPES)).default(DECISION_TYPES.filter((d) => d !== "sign_contracts")),
        budgetCeilingMinor: z.number().int().nonnegative().nullable().default(null),
        currency: z.string().length(3).default("EUR"),
        wakeEvents: z.array(z.enum(EVENT_TYPES)).default(["credential.expiring", "filing.due", "runway.threshold_crossed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Signing is a hard gate: never part of the Chief of Staff's authority, whatever the dialog sent.
      const authority = input.authority.filter((d) => d !== "sign_contracts");
      const existing = await repos.holidays.current(ctx.db, ctx.businessId);
      if (existing) return { holiday: existing, workflow: { queued: false, workflowId: workflowIds.holiday(existing.id), reason: "a vacation is already running" } };
      // A vacation runs cycles: none starts while the team is stopped.
      await assertAgentsRunning(ctx, "a vacation");
      const holiday = await ctx.rls(async (tx) => {
        const h = await repos.holidays.start(tx, ctx.businessId, {
          untilAt: input.until.kind === "date" ? input.until.date : null,
          untilCondition: input.until.kind === "condition" ? { text: input.until.condition } : input.until.kind === "return" ? { text: "until I return" } : null,
          authority: { decisionTypes: authority },
          budgetCeilingMinor: input.budgetCeilingMinor,
          currency: input.currency,
          wakeEvents: input.wakeEvents,
          startedBy: ctx.userId,
        });
        const workflowId = workflowIds.holiday(h.id);
        await emit(tx, ctx, {
          type: "holiday.started",
          payload: {
            holidayId: h.id,
            workflowId,
            untilAt: input.until.kind === "date" ? input.until.date.toISOString() : null,
            untilCondition: input.until.kind === "condition" ? input.until.condition : input.until.kind === "return" ? "until I return" : null,
            budgetCeiling: input.budgetCeilingMinor === null ? null : { amountMinor: input.budgetCeilingMinor, currency: input.currency },
            authority,
            wakeEvents: input.wakeEvents,
            cadenceAgentHours: LIMITS.cycleTimeBoxAgentHours,
          },
        });
        await audit(tx, ctx, { action: "business.start_holiday", target: { kind: "holiday", id: h.id }, details: { until: input.until, authority, budgetCeilingMinor: input.budgetCeilingMinor } });
        return h;
      });
      const workflow = await ctx.temporal.start(WORKFLOWS.holiday, { workflowId: workflowIds.holiday(holiday.id), args: [{ businessId: ctx.businessId, holidayId: holiday.id }] });
      return { holiday, workflow };
    }),

  endHoliday: adminProcedure.input(z.object({ reason: z.enum(["founder_returned", "kill_switch"]).default("founder_returned") })).mutation(async ({ ctx, input }) => {
    const current = await repos.holidays.current(ctx.db, ctx.businessId);
    if (!current) return { holiday: null, workflow: { queued: false, workflowId: "", reason: "no vacation is running" } };
    const workflow = await ctx.temporal.signal(workflowIds.holiday(current.id), "stop", { reason: input.reason, by: ctx.userId });
    const holiday = await ctx.rls(async (tx) => {
      const endedAt = new Date();
      const h = await repos.holidays.end(tx, ctx.businessId, current.id, { endedAt });
      const range = { from: current.startedAt ?? current.createdAt, to: endedAt };
      const [counts, usage] = await Promise.all([repos.events.countByType(tx, ctx.businessId, range), repos.usage.totals(tx, ctx.businessId, range)]);
      await emit(tx, ctx, {
        type: "holiday.ended",
        payload: {
          holidayId: h.id,
          startedAt: (current.startedAt ?? current.createdAt).toISOString(),
          endedAt: endedAt.toISOString(),
          reason: input.reason,
          wakeEventType: null,
          cyclesRun: counts["cycle.completed"] ?? 0,
          decisionsMade: counts["decision.made"] ?? 0,
          customersWon: counts["customer.converted"] ?? 0,
          spent: { amountMinor: usage.costMinor, currency: current.currency ?? "EUR" },
          gatedItemsQueued: await repos.approvals.countPending(tx, ctx.businessId),
          reportInboxItemId: null,
        },
      });
      await audit(tx, ctx, { action: "business.end_holiday", target: { kind: "holiday", id: h.id }, details: { reason: input.reason, workflowQueued: workflow.queued } });
      return h;
    });
    return { holiday, workflow };
  }),

  /** Kill switch (BUILD §14): ≤ 30 s, pauses workflows, engines and campaigns; works without Temporal. */
  stopAllAgents: adminProcedure.input(z.object({ reason: z.string().max(200).default("kill_switch") })).mutation(({ ctx, input }) => stopAllAgents(ctx, input.reason)),
  /**
   * The way back from the kill switch, a revoked key or used-up credits (owner or admin, audited): lifts the stop, sets
   * the agents it paused back to idle and restarts the channel engines it ended. CONFLICT while the team could not run
   * (its own key missing, credits used up).
   */
  resumeAgents: adminProcedure.mutation(({ ctx }) => resumeAgents(ctx)),

  /** Audit trail (read-only, hash-chained). */
  audit: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.audit.list(tx, ctx.businessId, input))),

  // --- Danger zone (BUILD §11.15) -------------------------------------------------------------------------------------
  /** Export everything as a portable JSON archive (credentials never included); an Inbox note carries the counts. */
  export: adminProcedure.mutation(({ ctx }) => exportBusiness(ctx)),
  /** Stop every agent and hide the business. Data stays. */
  archive: adminProcedure.input(z.object({ reason: z.string().max(200).default("archived") })).mutation(async ({ ctx, input }) => {
    const archived = await archiveBusiness(ctx, input.reason);
    await repos.social.removeBusinessFromLeaderboards(ctx.db, ctx.businessId);
    return archived;
  }),
  /** Owner-only, fresh authentication required (PRECONDITION_FAILED `reauth_required` otherwise); deletion runs 7 days later unless cancelled. */
  requestDeletion: ownerProcedure.input(z.object({ confirmName: z.string().max(200).optional() })).mutation(({ ctx, input }) => requestDeletion(ctx, { confirmName: input.confirmName })),
  cancelDeletion: ownerProcedure.mutation(({ ctx }) => cancelDeletion(ctx)),
  deletionStatus: businessProcedure.query(({ ctx }) => ctx.rls((tx) => deletionState({ db: tx, businessId: ctx.businessId }))),
});
