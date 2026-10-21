/**
 * business.get/update/setGameMode/setBusinessMode/setSpendCap/continue/pauseCycle/resumeCycle/startHoliday/endHoliday/
 * stopAllAgents/resumeAgents/export/archive/restore/listArchived/requestDeletion/cancelDeletion (BUILD §9.4, §9.6, §11.15, §14).
 */
import { LIMITS, liveModeOpen } from "@foundmill/config";
import { HolidayRunningError, repos, SLUG_TAKEN, UpdateBusinessInput, type Db, type DbTx } from "@foundmill/db";
import { demoBusinessIdForSlug, EXAMPLE_BUSINESS_ID } from "@foundmill/db/seed/constants";
import { BUSINESS_SETTINGS_FIELDS, businessStreamKey } from "@foundmill/events";
import { PRICING_CURRENCY } from "@foundmill/models";
import { AppError, AUTOPILOT_CADENCES, AUTOPILOT_LIMITS, BUSINESS_MODES, ConflictError, CurrencyCode, DECISION_TYPES, EVENT_TYPES, GAME_MODES, isValidTimeZone } from "@foundmill/shared";
import { z } from "zod";
import { autopilotStatus, ensureAutopilot, setAutopilot } from "../services/autopilot";
import { pauseCycle, resumeCycle, startCycle } from "../services/cycle";
import { assertAgentsRunning, resumeAgents, stopAllAgents } from "../services/killswitch";
import { requireAdultToGoLive } from "../services/live";
import { archiveBusiness, cancelDeletion, deletionState, exportBusiness, requestDeletion, restoreBusiness } from "../services/lifecycle";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { noteAsSeenBy } from "../services/inbox-redaction";
import { signoffViews, startDistribution } from "../services/signoff";
import type { Context } from "../context";
import { adminArchivedProcedure, adminProcedure, archivedBusinessProcedure, assertLiveOpen, audit, businessProcedure, emit, Id, ownerArchivedProcedure, ownerProcedure, protectedProcedure, router, writeProcedure } from "../trpc";
import { businessLogoRouter } from "./logo";

/** How the signed-in person stands to the example business (`business.example.get`). */
export type ExampleMembership = "none" | "example" | "member";

/** What New business needs for the "Explore an example" door, or null when the deployment has no example business. */
export interface ExampleBusinessView {
  id: string;
  name: string;
  slug: string;
  kitPrimary: string;
  kitSecondary: string;
  /** `example`: an example membership already exists (the door reopens it); `member`: a real seat (the door hides). */
  membership: ExampleMembership;
}

/** The example business (the seed's Northwind Skincare first, else the oldest committed demo), or null. */
export function findExampleBusiness(db: Db | DbTx) {
  return repos.businesses.example(db, { prefer: EXAMPLE_BUSINESS_ID });
}

/** "member" for any real seat, "example" for an example membership, "none" without one. */
export function exampleMembershipOf(membership: { source: string } | null): ExampleMembership {
  if (!membership) return "none";
  return membership.source === "example" ? "example" : "member";
}

export const NO_EXAMPLE_BUSINESS = "There is no example business on this deployment";

/**
 * What an admin may change on the business record (Settings › Business and Glossary send these). The currency (0025) is
 * the one new business amounts are written in and every screen formats the business's money with; amounts already
 * stored keep their own currency (nothing is converted).
 */
const BusinessSettingsInput = UpdateBusinessInput.pick({ name: true, slug: true, archetype: true, kitPrimary: true, kitSecondary: true, glossary: true, currency: true });

/**
 * What the saving form last saw for each field it changes (audit RES-07, RUI-08). When another tab or a co-founder
 * changed one of those fields since, the save is refused (CONFLICT) instead of silently writing the old value back;
 * fields the form does not change are never sent, so unrelated changes never conflict.
 */
const ExpectedBusinessFields = z.object({ name: z.string().nullable(), slug: z.string().nullable(), archetype: z.string().nullable(), kitPrimary: z.string().nullable(), kitSecondary: z.string().nullable(), currency: z.string().nullable() }).partial();
type ExpectedBusinessFields = z.infer<typeof ExpectedBusinessFields>;

const FIELD_WORDS: Record<keyof ExpectedBusinessFields, string> = { name: "the name", slug: "the address", archetype: "the archetype", kitPrimary: "the primary brand color", kitSecondary: "the secondary brand color", currency: "the currency" };

/** The expected fields whose stored value is no longer what the form saw. */
export function staleBusinessFields(current: Partial<Record<keyof ExpectedBusinessFields, string | null>>, expected: ExpectedBusinessFields): (keyof ExpectedBusinessFields)[] {
  return (Object.keys(expected) as (keyof ExpectedBusinessFields)[]).filter((k) => (current[k] ?? null) !== (expected[k] ?? null));
}

const HolidayUntil = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date: z.coerce.date() }),
  z.object({ kind: z.literal("condition"), condition: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal("return") }),
]);

/** Autopilot's switch and settings (Settings > Mode, Commit); each field is optional so a change sends only what it changes. */
const AutopilotSettingsInput = z.object({
  enabled: z.boolean().optional(),
  cadence: z.enum(AUTOPILOT_CADENCES).optional(),
  dailyHour: z.number().int().min(AUTOPILOT_LIMITS.dailyHour.min).max(AUTOPILOT_LIMITS.dailyHour.max).optional(),
  maxCyclesPerDay: z.number().int().min(AUTOPILOT_LIMITS.maxCyclesPerDay.min).max(AUTOPILOT_LIMITS.maxCyclesPerDay.max).optional(),
  /** USD cents of model spend per UTC day (an Estimate); null: the credits left. */
  spendCeilingMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  maxIdleCycles: z.number().int().min(AUTOPILOT_LIMITS.maxIdleCycles.min).max(AUTOPILOT_LIMITS.maxIdleCycles.max).optional(),
});

/** The first-week checklist's flags (docs/UX_AUDIT_AND_PLAN.md §6.2 FirstWeekChecklist), one per item, all read-only. */
export interface FirstWeekFlags {
  specificationSignedOff: boolean;
  roadmapSignedOff: boolean;
  cycleCompleted: boolean;
  noteRead: boolean;
  conversationReplySent: boolean;
  distributionStarted: boolean;
  bankOrStripeConnected: boolean;
}

/**
 * What the business has done in its first week, from what it already records: the latest sign-off round of each kind
 * approved, a `cycle.completed` event, a note from an agent that someone opened (a read receipt, 0048) or answered, a
 * message the founder wrote to an agent, distribution started, a bank account or a connected Stripe. Every read runs
 * under the caller's RLS (a member of another business is refused by `businessProcedure` before any of this runs);
 * each existence check loads one id at most. The sign-offs are read as their latest round of each kind only (not the
 * Product screens' views, which also read the stage and every specification version with its snapshot), and
 * distribution comes from the business the access lookup already holds: one transaction, every read in parallel.
 */
export async function firstWeekFlags(tx: DbTx, business: { id: string; distributionStartedAt: Date | null }): Promise<FirstWeekFlags> {
  const businessId = business.id;
  const [signoffs, completed, noteRead, conversationReplySent, accounts, stripe] = await Promise.all([
    repos.productSignoffs.latest(tx, businessId),
    repos.events.list(tx, businessId, { type: "cycle.completed", limit: 1 }),
    repos.inbox.anyAgentNoteOpened(tx, businessId),
    repos.conversations.anyFounderMessage(tx, businessId),
    repos.finance.listAccounts(tx, businessId),
    repos.integrations.getByKey(tx, businessId, "stripe"),
  ]);
  return {
    specificationSignedOff: signoffs.spec?.status === "approved",
    roadmapSignedOff: signoffs.roadmap?.status === "approved",
    cycleCompleted: completed.items.length > 0,
    noteRead,
    conversationReplySent,
    distributionStarted: business.distributionStartedAt !== null,
    bankOrStripeConnected: accounts.length > 0 || stripe?.status === "connected" || stripe?.status === "mock",
  };
}

const journeyRefreshes = new WeakMap<Db, { running: Promise<void> | null; again: boolean }>();

/**
 * Rebuilds the Journey's daily rows in the background (`refresh_journey_daily()`, over every business: 450-850 ms in
 * production, which `business.setTimeZone` used to wait for; audit api-db F6). A request while one runs folds into one
 * more right after it; a failure is logged and left to the orchestrator's refresh every 15 minutes. Resolves when the
 * rebuild it joined has finished (tests wait on it; the router does not).
 */
export function refreshJourneyDailySoon(ctx: Pick<Context, "db" | "log">): Promise<void> {
  let state = journeyRefreshes.get(ctx.db);
  if (!state) journeyRefreshes.set(ctx.db, (state = { running: null, again: false }));
  const s = state;
  if (s.running) {
    s.again = true;
    return s.running;
  }
  const run = async () => {
    do {
      s.again = false;
      await repos.journeys.refreshDaily(ctx.db).catch((err: unknown) => ctx.log.warn({ err: (err as Error)?.message }, "journey_daily refresh after a time zone change failed; the scheduled refresh retries"));
    } while (s.again);
    s.running = null;
  };
  s.running = run();
  return s.running;
}

export const businessRouter = router({
  logo: businessLogoRouter,

  /**
   * Autopilot (0055): the business starts its own cycles. `get` is the chip and the settings (any member reads it);
   * `set` is the switch and settings (owner or admin, audited, refused while the team is stopped); `ensure` starts the
   * workflow of an Autopilot that is on and not paused when the orchestrator was down when it was saved.
   */
  autopilot: router({
    get: businessProcedure.query(({ ctx }) => autopilotStatus(ctx)),
    set: adminProcedure.input(AutopilotSettingsInput).mutation(({ ctx, input }) => setAutopilot(ctx, input)),
    ensure: writeProcedure.mutation(({ ctx }) => ensureAutopilot(ctx)),
  }),

  /**
   * The first-week checklist (UX plan §6.2, §7.8): one done flag per item, read-only, for any member of the business
   * (RLS-scoped like every other read here). Home's "Your first week" panel ticks its rows off from this.
   */
  firstWeek: router({
    get: businessProcedure.query(({ ctx }) => ctx.rls((tx) => firstWeekFlags(tx, { id: ctx.businessId, distributionStartedAt: ctx.business.distributionStartedAt }))),
  }),

  /**
   * The example business (docs/UX_AUDIT_AND_PLAN.md §10 Phase 3, §12 item 5; 0065): a signed-in founder walks around a
   * seeded demo business as a read-only viewer before starting their own. Account-level like founder.businesses.*:
   * no businessId on `get` and `open` (the server picks the example). All three run on the service connection: the
   * memberships insert policy lets nobody give themselves a membership, and the delete is pinned to the caller's own
   * example row. Nothing an example viewer does is kept (a viewer writes nothing; leaving deletes the row).
   */
  example: router({
    /**
     * Which demo business is the example (the seed's Northwind Skincare when present, else the oldest committed demo),
     * and how the caller stands to it. Null when the deployment has no demo business (production without seeds), so
     * New business shows no example door.
     */
    get: protectedProcedure.query(async ({ ctx }): Promise<ExampleBusinessView | null> => {
      const example = await findExampleBusiness(ctx.db);
      if (!example) return null;
      const membership = await repos.memberships.get(ctx.db, example.id, ctx.userId);
      return { id: example.id, name: example.name, slug: example.slug, kitPrimary: example.kitPrimary, kitSecondary: example.kitSecondary, membership: exampleMembershipOf(membership) };
    }),
    /**
     * Opens the example for the caller: a viewer membership with `source: "example"`, written once (idempotent: a
     * second open answers the same row, `created: false`) and audited on the example business when written. Refused
     * (CONFLICT) when the caller already belongs to that business for real: a seat is never rewritten into an example.
     */
    open: protectedProcedure.mutation(async ({ ctx }) => {
      const example = await findExampleBusiness(ctx.db);
      if (!example) throw new AppError("not_found", NO_EXAMPLE_BUSINESS, 404);
      return ctx.db.transaction(async (tx) => {
        const { membership, created } = await repos.memberships.openExample(tx, example.id, ctx.userId);
        if (created) await audit(tx, { businessId: example.id, userId: ctx.userId }, { action: "business.example.open", target: { kind: "membership", id: membership.id }, details: { businessId: example.id } });
        return { businessId: example.id, membershipId: membership.id, created };
      });
    }),
    /**
     * Leaves the example: deletes the caller's own example membership of `businessId` and nothing else (a real seat on
     * the same business is never touched; `left: false` when there was none). Audited on the business when a row went.
     */
    leave: protectedProcedure.input(z.object({ businessId: Id })).mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const gone = await repos.memberships.leaveExample(tx, input.businessId, ctx.userId);
        if (gone) await audit(tx, { businessId: input.businessId, userId: ctx.userId }, { action: "business.example.leave", target: { kind: "membership", id: gone.id }, details: { businessId: input.businessId } });
        return { businessId: input.businessId, left: gone !== null };
      }),
    ),
  }),

  get: businessProcedure.query(async ({ ctx }) => {
    const [holiday, blocking, departments, agents, deletion, logo, foundations, signoffs] = await ctx.rls(async (tx) =>
      Promise.all([repos.holidays.current(tx, ctx.businessId), repos.inbox.countBlocking(tx, ctx.businessId), repos.departments.list(tx, ctx.businessId), repos.agents.countByStatus(tx, ctx.businessId), deletionState({ db: tx, businessId: ctx.businessId }), repos.logos.getMeta(tx, ctx.businessId), repos.foundations.get(tx, ctx.businessId), signoffViews(tx, ctx.businessId)]),
    );
    // While LIVE is closed on this deployment a stored "live" reads as Personal everywhere (sidebar, widgets, Settings),
    // and `liveOpen` tells Settings not to offer Go live.
    const liveOpen = liveModeOpen(ctx.env);
    return {
      business: liveOpen ? ctx.business : { ...ctx.business, gameMode: "personal" as const },
      liveOpen,
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
      /**
       * The first days (founder, 2026-10-18): where the business stands (drafting, awaiting the founder's sign-off,
       * building, selling), the latest sign-off round of the specification and the roadmap, and when distribution started.
       */
      productStage: signoffs.stage,
      signoffs: { spec: signoffs.spec, roadmap: signoffs.roadmap },
      distributionStartedAt: ctx.business.distributionStartedAt,
    };
  }),

  /**
   * Start distribution (founder, 2026-10-18; owner or admin, audited, refused while the team is stopped): the channel
   * engines start, the channel-scoring task is created and the Board asks which route to the first customer comes first.
   * Idempotent: a second start changes nothing (`started: false`).
   */
  startDistribution: adminProcedure.mutation(async ({ ctx }) => {
    const result = await startDistribution(ctx, { via: "board" });
    return { started: result.started, boardItemId: result.boardItemId, scoringTaskId: result.scoringTaskId, engines: result.engines, followUpId: result.followUp?.id ?? null };
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
  update: adminProcedure.input(BusinessSettingsInput.extend({ expected: ExpectedBusinessFields.optional() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const { expected, ...changes } = input;
      // The demo businesses' slugs are reserved for them (boot-time seeding finds them by id, and nobody else holds those addresses).
      const reservedFor = changes.slug ? demoBusinessIdForSlug(changes.slug) : null;
      if (reservedFor && reservedFor !== ctx.businessId) throw new ConflictError(SLUG_TAKEN, { field: "slug" });
      if (expected) {
        const current = await repos.businesses.get(tx, ctx.businessId);
        const stale = staleBusinessFields(current, expected);
        if (stale.length) throw new ConflictError(`Someone changed ${stale.map((k) => FIELD_WORDS[k]).join(" and ")} since you opened these settings. The latest values are shown now; make your change again if you still want it.`, { fields: stale });
      }
      const business = await repos.businesses.update(tx, ctx.businessId, changes);
      const currencyChange = business.currency !== ctx.business.currency ? { from: ctx.business.currency, to: business.currency } : null;
      // The input also carries `businessId`; only the settings fields count as changed.
      const fields = BUSINESS_SETTINGS_FIELDS.filter((k) => changes[k] !== undefined);
      await audit(tx, ctx, { action: "business.update", target: { kind: "business", id: ctx.businessId }, details: { fields, ...(currencyChange ? { currency: currencyChange } : {}) } });
      // Every open tab refetches the business (the top bar, the settings form), so none keeps the old name.
      if (fields.length) await emit(tx, ctx, { type: "business.updated", payload: { fields } });
      return business;
    }),
  ),

  setGameMode: adminProcedure.input(z.object({ gameMode: z.enum(GAME_MODES), reason: z.string().max(500).optional(), confirmAdult: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    // Going LIVE puts the business on the network, which is for adults (BUILD §11.14): the founder confirms once that
    // they are 18 or older (0027; the Go live dialog asks), or has already.
    // Going live is refused while LIVE is closed; switching back to Personal always works.
    if (input.gameMode === "live") assertLiveOpen(ctx.env);
    if (input.gameMode === "live" && ctx.business.gameMode !== "live") await requireAdultToGoLive(ctx.db, ctx.userId, input.confirmAdult);
    const business = await ctx.rls(async (tx) => {
      const from = ctx.business.gameMode;
      const changed = await repos.businesses.setGameMode(tx, ctx.businessId, input.gameMode);
      if (from !== input.gameMode) {
        await emit(tx, ctx, { type: "mode.changed", payload: { scope: "game", from, to: input.gameMode, reason: input.reason ?? null } });
        await audit(tx, ctx, { action: "business.set_game_mode", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.gameMode, ...(input.gameMode === "live" ? { confirmedAdult: true } : {}) } });
      }
      return changed;
    });
    // LIVE → Personal (BUILD §7.3, AC-11.14.2): the business leaves every leaderboard now. The rows live behind
    // service_role-only grants, so this runs on the service connection once the mode change has committed; reads also
    // hide any business that is not LIVE, so a failure here never shows a Personal business.
    if (input.gameMode !== "live") await repos.social.removeBusinessFromLeaderboards(ctx.db, ctx.businessId);
    return business;
  }),

  /**
   * Automated runs the business by itself (BUILD §11.3): the mode change starts the business's Automated mode loop (`automatedMode`), which
   * keeps pressing Continue and lets the Chief of Staff answer what blocks it, within Automated mode's authority; any
   * other mode stops it. Without a reachable orchestrator the mode is still saved and the workflow reconciler starts the
   * loop once one is up (audit SOAK-01).
   */
  setBusinessMode: adminProcedure.input(z.object({ businessMode: z.enum(BUSINESS_MODES), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const from = ctx.business.businessMode;
    const business = await ctx.rls(async (tx) => {
      const changed = await repos.businesses.setBusinessMode(tx, ctx.businessId, input.businessMode);
      if (from !== input.businessMode) {
        await emit(tx, ctx, { type: "mode.changed", payload: { scope: "business", from, to: input.businessMode, reason: input.reason ?? null } });
        await audit(tx, ctx, { action: "business.set_business_mode", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.businessMode } });
      }
      return changed;
    });
    if (input.businessMode === "automated" && ctx.business.committedAt) await ctx.temporal.start(WORKFLOWS.automatedMode, { workflowId: workflowIds.automatedMode(ctx.businessId), args: [{ businessId: ctx.businessId }] });
    else if (from === "automated" && input.businessMode !== "automated") await ctx.temporal.signal(workflowIds.automatedMode(ctx.businessId), "stop", { reason: "mode_changed", by: ctx.userId });
    return business;
  }),

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

  /**
   * The monthly model budget (0059, BUILD §10.4), in US cents like wages and credits: what the team's metered work may cost
   * in a calendar month, whoever pays the model (credits or the business's own key). Once the month's cost reaches it no new
   * session starts and a running one is held to what was left when it began. Null removes the budget.
   */
  setModelBudget: adminProcedure.input(z.object({ modelBudgetMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = ctx.business.modelBudgetMinor;
      const business = await repos.businesses.setModelBudget(tx, ctx.businessId, input.modelBudgetMinor);
      if (from !== input.modelBudgetMinor) await audit(tx, ctx, { action: "business.set_model_budget", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.modelBudgetMinor } });
      return business;
    }),
  ),

  /**
   * The business time zone (0041): Home's "today", week and month, the Journey's days and the top bar's date follow it.
   * The app sets it from an owner's or admin's browser the first time they open the business; Settings › Business
   * changes it. The Journey's daily rows are rebuilt in the new zone right after, in the background.
   */
  setTimeZone: adminProcedure.input(z.object({ timeZone: z.string().min(1).max(64).refine(isValidTimeZone, "Pick a time zone such as America/New_York") })).mutation(async ({ ctx, input }) => {
    const business = await ctx.rls(async (tx) => {
      const from = ctx.business.timeZone;
      const updated = await repos.businesses.setTimeZone(tx, ctx.businessId, input.timeZone);
      if (from !== input.timeZone) await audit(tx, ctx, { action: "business.set_time_zone", target: { kind: "business", id: ctx.businessId }, details: { from, to: input.timeZone } });
      return updated;
    });
    // Not awaited: the rebuild covers every business and the answer does not depend on it. The nightly refresh (and
    // every later one) buckets in the new zone anyway.
    if (ctx.business.timeZone !== input.timeZone) void refreshJourneyDailySoon(ctx);
    return business;
  }),

  /** Holiday = Automated mode with the Chief of Staff in charge (BUILD §9.6). */
  startHoliday: adminProcedure
    .input(
      z.object({
        until: HolidayUntil,
        authority: z.array(z.enum(DECISION_TYPES)).default(DECISION_TYPES.filter((d) => d !== "sign_contracts")),
        budgetCeilingMinor: z.number().int().nonnegative().nullable().default(null),
        /** The ceiling's currency; absent: the business's own (0025). */
        currency: CurrencyCode.optional(),
        wakeEvents: z.array(z.enum(EVENT_TYPES)).default(["credential.expiring", "filing.due", "runway.threshold_crossed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Signing is a hard gate: never part of the Chief of Staff's authority, whatever the dialog sent.
      const authority = input.authority.filter((d) => d !== "sign_contracts");
      const currency = (input.currency ?? ctx.business.currency).toUpperCase();
      const alreadyRunning = <T extends { id: string }>(existing: T) => ({ holiday: existing, workflow: { queued: false, workflowId: workflowIds.holiday(existing.id), reason: "a vacation is already running" } });
      const existing = await repos.holidays.current(ctx.db, ctx.businessId);
      if (existing) return alreadyRunning(existing);
      // A vacation runs cycles: none starts while the team is stopped.
      await assertAgentsRunning(ctx, "a vacation");
      // Two starts at once (a double submit, two tabs) meet the one-running-vacation index (0036): the second answers
      // with the vacation the first started, and nothing of its own (event, audit) is kept.
      const started = await ctx
        .rls(async (tx) => {
          const h = await repos.holidays.start(tx, ctx.businessId, {
            untilAt: input.until.kind === "date" ? input.until.date : null,
            untilCondition: input.until.kind === "condition" ? { text: input.until.condition } : input.until.kind === "return" ? { text: "you return" } : null,
            authority: { decisionTypes: authority },
            budgetCeilingMinor: input.budgetCeilingMinor,
            currency,
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
              budgetCeiling: input.budgetCeilingMinor === null ? null : { amountMinor: input.budgetCeilingMinor, currency },
              authority,
              wakeEvents: input.wakeEvents,
              cadenceAgentHours: LIMITS.cycleTimeBoxAgentHours,
            },
          });
          await audit(tx, ctx, { action: "business.start_holiday", target: { kind: "holiday", id: h.id }, details: { until: input.until, authority, budgetCeilingMinor: input.budgetCeilingMinor } });
          return h;
        })
        .catch(async (err: unknown) => {
          if (!(err instanceof HolidayRunningError)) throw err;
          const running = await repos.holidays.current(ctx.db, ctx.businessId);
          if (!running) throw err;
          return { running };
        });
      if ("running" in started) return alreadyRunning(started.running);
      const holiday = started;
      // Not queued (no orchestrator reachable): the row stays running and the orchestrator's reconciler starts its
      // workflow once it is up; a dated vacation also ends by itself on its date.
      const workflow = await ctx.temporal.start(WORKFLOWS.holiday, { workflowId: workflowIds.holiday(holiday.id), args: [{ businessId: ctx.businessId, holidayId: holiday.id }] });
      return { holiday, workflow };
    }),

  /**
   * "Come back": the row ends at once (the top bar follows) and the vacation workflow is told why. A workflow that got
   * the signal writes the "While you were away" report and `holiday.ended` (linked to the report) once; ending an
   * already-ended row is a no-op for it (audit O-15). With no workflow behind the vacation the api records the end.
   */
  endHoliday: adminProcedure.input(z.object({ reason: z.enum(["founder_returned", "kill_switch"]).default("founder_returned") })).mutation(async ({ ctx, input }) => {
    const current = await repos.holidays.current(ctx.db, ctx.businessId);
    if (!current) return { holiday: null, workflow: { queued: false, workflowId: "", reason: "no vacation is running" } };
    const workflow = await ctx.temporal.signal(workflowIds.holiday(current.id), "stop", { reason: input.reason, by: ctx.userId });
    const holiday = await ctx.rls(async (tx) => {
      const endedAt = new Date();
      const h = await repos.holidays.end(tx, ctx.businessId, current.id, { endedAt });
      await audit(tx, ctx, { action: "business.end_holiday", target: { kind: "holiday", id: h.id }, details: { reason: input.reason, workflowQueued: workflow.queued } });
      if (workflow.queued) return h;
      const range = { from: current.startedAt ?? current.createdAt, to: endedAt };
      const [counts, usage] = await Promise.all([repos.events.countByType(tx, ctx.businessId, range), repos.usage.totals(tx, ctx.businessId, range)]);
      await emit(tx, ctx, {
        idempotencyKey: `holiday.ended:${h.id}`,
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
          // Team spend is model cost, metered in the pricing currency (USD), not the business's.
          spent: { amountMinor: usage.costMinor, currency: PRICING_CURRENCY },
          gatedItemsQueued: await repos.approvals.countPending(tx, ctx.businessId),
          reportInboxItemId: null,
        },
      });
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
  // Export, restore and deletion also reach an archived business (`*ArchivedProcedure`); everything else 404s on one.
  /**
   * Export everything as a portable JSON archive (credentials never included): every business-scoped table to its last
   * row, returned for the browser to save as `fileName`; an Inbox note carries the counts.
   */
  export: adminArchivedProcedure.mutation(({ ctx }) => exportBusiness(ctx)),
  /** Stop every agent and hide the business. Data stays; an owner restores it with `restore`. */
  archive: adminProcedure.input(z.object({ reason: z.string().max(200).default("archived") })).mutation(async ({ ctx, input }) => {
    const archived = await archiveBusiness(ctx, input.reason);
    await repos.social.removeBusinessFromLeaderboards(ctx.db, ctx.businessId);
    // Its events stay in Postgres; the live stream goes now instead of when its 30-day TTL runs out (#233).
    await ctx.redis?.del(businessStreamKey(ctx.businessId)).catch((err: unknown) => ctx.log.warn({ err: (err as Error).message }, "business stream not removed on archive; it expires on its TTL"));
    return archived;
  }),
  /** Owner-only: bring an archived business back (idempotent). Its agents stay stopped until resumed. */
  restore: ownerArchivedProcedure.mutation(({ ctx }) => restoreBusiness(ctx)),
  /** The archived businesses the signed-in account owns, with any scheduled deletion (Your businesses › Archived businesses). */
  listArchived: protectedProcedure.query(async ({ ctx }) => {
    const archived = await repos.businesses.listArchivedForUser(ctx.db, ctx.userId);
    return Promise.all(
      archived.map(async (business) => {
        const deletion = await deletionState({ db: ctx.db, businessId: business.id });
        return { business: { id: business.id, name: business.name, slug: business.slug, kitPrimary: business.kitPrimary, kitSecondary: business.kitSecondary, archivedAt: business.archivedAt }, deletion: deletion.status === "scheduled" ? deletion : null };
      }),
    );
  }),
  /** Owner-only, fresh authentication required (PRECONDITION_FAILED `reauth_required` otherwise); deletion runs 7 days later unless cancelled. */
  requestDeletion: ownerArchivedProcedure.input(z.object({ confirmName: z.string().max(200).optional() })).mutation(({ ctx, input }) => requestDeletion(ctx, { confirmName: input.confirmName })),
  cancelDeletion: ownerArchivedProcedure.mutation(({ ctx }) => cancelDeletion(ctx)),
  deletionStatus: archivedBusinessProcedure.query(({ ctx }) => ctx.rls((tx) => deletionState({ db: tx, businessId: ctx.businessId }))),
});
