/**
 * holiday activities (BUILD §9.6 "Holiday (Automated)", §9.4): load the period, decide blocking inbox items within
 * the Chief of Staff's authority, check end conditions (until date, budget ceiling, wake events, founder return) and
 * build the "While you were away" report. Hard-gated items are never decided here; they queue for the founder.
 */
import { LIMITS } from "@foundmill/config";
import { repos, type Executor, type InboxItem } from "@foundmill/db";
import { DECISION_TYPES, type DecisionType, type EventType } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { MAX_HOLIDAY_CYCLES } from "../holiday-contract";
import type { HolidayCheck, HolidayDecisions, HolidayEnd, HolidayInput, LoadedHoliday } from "./types";

const GATED: ReadonlySet<DecisionType> = new Set<DecisionType>(["sign_contracts"]);

/** Classify an inbox decision by the kind of authority it needs (BUILD §19 keeps the list configurable). */
export function classifyDecision(item: Pick<InboxItem, "subject" | "bodyMd" | "decision">): DecisionType | null {
  const text = `${item.subject}\n${item.bodyMd}`.toLowerCase();
  const options = (item.decision as { options?: { cost_minor?: number; recommended?: boolean; reversible?: boolean }[] } | null)?.options ?? [];
  if (/\b(sign|signature|contract|agreement|terms)\b/.test(text)) return "sign_contracts";
  if (/\b(merge|pull request|\bpr\b|main branch)\b/.test(text)) return "merge_to_main";
  if (/\b(hire|recruit|new agent|add an agent)\b/.test(text)) return "hire_agents";
  if (/\b(model|opus|sonnet|haiku)\b/.test(text)) return "change_models";
  if (/\b(publish|post|campaign|newsletter|launch|ad|ads)\b/.test(text)) return "publish_content";
  if (/\b(email|message|reply|outreach|customers?)\b/.test(text)) return "message_customers";
  if (options.some((o) => (o.cost_minor ?? 0) > 0) || /\b(spend|budget|invoice|pay|€|\$|£)\b/.test(text)) return "spend_above_threshold";
  return null;
}

export interface AutoDecideOptions {
  chiefOfStaffId: string | null;
  /** Decision types the Chief of Staff may take (signing never is). */
  authority: readonly string[];
  auditAction: "holiday.decide" | "autopilot.decide";
  /** Words for the audit reason: "vacation" or "Automated mode". */
  scope: string;
  /** Business spend cap per action (minor units): an option that costs more waits for the founder. */
  spendCapMinor?: number | null;
}

/**
 * The Chief of Staff answers the Inbox items that block Continue with the recommended option, inside the authority it was
 * given: the vacation's, or Automated mode's (BUILD §9.6). Signing and anything outside the authority (or above the spend
 * cap) stays queued for the founder.
 */
export async function autoDecideBlocking(deps: OrchestratorDeps, businessId: string, options: AutoDecideOptions): Promise<HolidayDecisions> {
  const { db } = deps;
  const chiefId = options.chiefOfStaffId;
  const authority = new Set(options.authority);
  const items = await repos.inbox.list(db, businessId, { tab: "respond", limit: 100 });
  let decided = 0;
  let queuedGated = 0;
  const inboxItemIds: string[] = [];
  for (const item of items.items) {
    const decision = item.decision as { options?: { id: string; recommended?: boolean; reversible?: boolean; cost_minor?: number }[] } | null;
    const choices = decision?.options ?? [];
    const recommended = choices.find((o) => o.recommended) ?? choices[0];
    if (!recommended || !chiefId) {
      if (item.blocksContinue) queuedGated += 1;
      continue;
    }
    const kind = classifyDecision(item);
    const safeUnknown = kind === null && recommended.reversible === true && (recommended.cost_minor ?? 0) === 0;
    const withinCap = options.spendCapMinor == null || (recommended.cost_minor ?? 0) <= options.spendCapMinor;
    const allowed = withinCap && (kind === null ? safeUnknown : !GATED.has(kind) && authority.has(kind));
    if (!allowed) {
      queuedGated += 1;
      continue;
    }
    if (item.type === "customer_won") {
      await repos.inbox.markRead(db, businessId, item.id);
    }
    const { decision: made } = await repos.inbox.decide(db, businessId, item.id, { chosenOption: recommended.id, decidedByKind: "chief_of_staff", decidedBy: chiefId });
    await emitEvent(db, {
      businessId,
      type: "decision.made",
      actor: { kind: "agent", id: chiefId },
      payload: { decisionId: made.id, inboxItemId: item.id, chosenOption: recommended.id, freeText: null, decidedBy: "chief_of_staff", planId: null, planActionCount: 0, hardGateActions: 0 },
    });
    await repos.audit.append(db, businessId, { actorKind: "agent", actorId: chiefId, action: options.auditAction, target: { kind: "inbox_item", id: item.id }, details: { option: recommended.id, kind, reason: `within ${options.scope} authority (${kind ?? "safe reversible default"})` } });
    decided += 1;
    inboxItemIds.push(item.id);
  }
  return { decided, queuedGated, inboxItemIds };
}

export function createHolidayActivities(deps: OrchestratorDeps) {
  async function spentSince(businessId: string, from: Date): Promise<number> {
    const totals = await repos.usage.totals(deps.db, businessId, { from });
    return totals.costMinor;
  }

  return {
    async loadHoliday(input: HolidayInput): Promise<LoadedHoliday> {
      const { db } = deps;
      const [holiday, chief] = await Promise.all([repos.holidays.get(db, input.businessId, input.holidayId), repos.agents.chiefOfStaff(db, input.businessId)]);
      const authorityRaw = (holiday.authority as { decisionTypes?: unknown }).decisionTypes;
      const authority = (Array.isArray(authorityRaw) ? authorityRaw : [...DECISION_TYPES]).filter((d): d is DecisionType => (DECISION_TYPES as readonly string[]).includes(String(d)) && !GATED.has(d as DecisionType));
      const condition = holiday.untilCondition as { text?: unknown } | null;
      return {
        holidayId: holiday.id,
        untilAt: holiday.untilAt ? new Date(holiday.untilAt).toISOString() : null,
        untilCondition: condition && typeof condition.text === "string" ? condition.text : null,
        authority,
        budgetCeilingMinor: holiday.budgetCeilingMinor === null ? null : Number(holiday.budgetCeilingMinor),
        currency: holiday.currency ?? "EUR",
        wakeEvents: holiday.wakeEvents,
        startedAt: new Date(holiday.startedAt ?? holiday.createdAt).toISOString(),
        cadenceAgentHours: input.cadenceAgentHours ?? LIMITS.cycleTimeBoxAgentHours,
        chiefOfStaffId: chief?.id ?? null,
      };
    },

    async nextCycleNumber(input: { businessId: string }): Promise<{ cycleNumber: number }> {
      return { cycleNumber: await nextCycleNumberOf(deps.db, input.businessId) };
    },

    /** Should the holiday end? Checked after every cycle and on every wake-up. */
    async holidayCheck(input: { businessId: string; holiday: LoadedHoliday }): Promise<HolidayCheck> {
      const { db, clock } = deps;
      const now = clock.now();
      const h = input.holiday;
      const row = await repos.holidays.get(db, input.businessId, h.holidayId);
      const spentMinor = await spentSince(input.businessId, new Date(h.startedAt));
      const base = { spentMinor, now: now.toISOString(), wakeEventType: null, wakeEventId: null };
      // The date first: a vacation closed at its date (a new one started after it) ended because the date arrived.
      if (h.untilAt && new Date(h.untilAt).getTime() <= now.getTime()) return { ...base, shouldEnd: true, reason: "until_reached" };
      if (row.endedAt) return { ...base, shouldEnd: true, reason: "founder_returned" };
      // A stopped team ends the vacation: no cycle may start until an owner or admin resumes the agents.
      const stop = await repos.businesses.stopState(db, input.businessId);
      if (stop.stopped) return { ...base, shouldEnd: true, reason: stop.reason === "credits_exhausted" ? "budget_exhausted" : "kill_switch" };
      if (h.budgetCeilingMinor !== null && spentMinor >= h.budgetCeilingMinor) return { ...base, shouldEnd: true, reason: "budget_exhausted" };
      if (h.wakeEvents.length > 0) {
        const types = h.wakeEvents.filter((t): t is EventType => typeof t === "string");
        const page = await repos.events.list(db, input.businessId, { type: types, from: new Date(h.startedAt), limit: 1 });
        const hit = page.items[0];
        if (hit) return { ...base, shouldEnd: true, reason: "wake_event", wakeEventType: hit.type, wakeEventId: hit.id };
      }
      if (h.untilCondition && /customer|payment|paid/i.test(h.untilCondition)) {
        const page = await repos.events.list(db, input.businessId, { type: ["customer.converted", "payment.received"], from: new Date(h.startedAt), limit: 1 });
        if (page.items.length > 0) return { ...base, shouldEnd: true, reason: "condition_met" };
      }
      return { ...base, shouldEnd: false, reason: null };
    },

    /** The Chief of Staff decides blocking inbox items within authority; gated items stay queued. */
    async holidayAutoDecide(input: { businessId: string; holiday: LoadedHoliday }): Promise<HolidayDecisions> {
      return autoDecideBlocking(deps, input.businessId, { chiefOfStaffId: input.holiday.chiefOfStaffId, authority: input.holiday.authority, auditAction: "holiday.decide", scope: "vacation" });
    },

    /**
     * End the holiday: "While you were away" report, holiday row, `holiday.ended`. Idempotent, so a retry or an end the
     * api already wrote ("Come back" ends the row at once) never duplicates anything (audit O-15, DB-15, RA-22): the
     * report is written once, in the same transaction that ends the row and links it; a row that already has a report
     * keeps it; `holiday.ended` is written once per vacation (keyed by its id).
     */
    async endHoliday(input: { businessId: string; holiday: LoadedHoliday; reason: NonNullable<HolidayCheck["reason"]>; wakeEventType: string | null; cyclesRun: number }): Promise<HolidayEnd> {
      const { db, clock } = deps;
      const since = new Date(input.holiday.startedAt);
      const row = await repos.holidays.get(db, input.businessId, input.holiday.holidayId);
      // The founder's "Come back" (or a start after the date passed) may have ended the row already: that is the end.
      const now = row.endedAt ? new Date(row.endedAt) : clock.now();
      const [decisions, conversions, payments, pendingApprovals, usage, chief] = await Promise.all([
        repos.events.list(db, input.businessId, { type: "decision.made", from: since, limit: 200 }),
        repos.events.list(db, input.businessId, { type: "customer.converted", from: since, limit: 200 }),
        repos.events.list(db, input.businessId, { type: "payment.received", from: since, limit: 500 }),
        repos.approvals.countPending(db, input.businessId),
        repos.usage.totals(db, input.businessId, { from: since }),
        repos.agents.chiefOfStaff(db, input.businessId),
      ]);
      const founderTasks = (await repos.tasks.list(db, input.businessId, { status: "ready", limit: 200 })).items.filter((t) => t.assigneeAgentId === null && /^Founder action:/.test(t.title));
      const chiefDecisions = decisions.items.filter((e) => (e.payload as { decidedBy?: string }).decidedBy === "chief_of_staff");
      const moneyIn = payments.items.reduce((sum, e) => sum + Number((e.payload as { amount?: { amountMinor?: number } }).amount?.amountMinor ?? 0), 0);
      const currency = input.holiday.currency;
      const fmt = (minor: number) => `${(minor / 100).toFixed(2)} ${currency}`;
      const gatedItemsQueued = pendingApprovals + founderTasks.length;
      const awayMs = now.getTime() - since.getTime();
      const days = Math.round(awayMs / 86_400_000);
      const awayFor = days < 1 ? "less than a day" : `${days} day${days === 1 ? "" : "s"}`;
      const lines = [
        `You were away ${awayFor}; the team ran ${input.cyclesRun} cycle${input.cyclesRun === 1 ? "" : "s"} and the vacation ended because ${describeReason(input.reason, input.wakeEventType)}.`,
        ``,
        `**Decisions I took (${chiefDecisions.length})** — each one inside the authority you set; open any item to see the option and the reason.`,
        ...chiefDecisions.slice(0, 10).map((e) => `- ${new Date(e.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}: option "${(e.payload as { chosenOption?: string }).chosenOption ?? "free text"}" on inbox item ${(e.payload as { inboxItemId?: string }).inboxItemId ?? ""}`),
        ``,
        `**Customer Updates (${conversions.items.length})** — ${conversions.items.length ? "the replays are in the Customers tab, newest first." : "no customers won while you were away."}`,
        ``,
        `**Money** — in: ${fmt(moneyIn)} across ${payments.items.length} payment${payments.items.length === 1 ? "" : "s"}; team spend: ${fmt(usage.costMinor)} (Estimate).`,
        ``,
        `**Waiting for you (${gatedItemsQueued})** — ${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} and ${founderTasks.length} hard-gated action${founderTasks.length === 1 ? "" : "s"} only you can take.`,
      ];
      let reportInboxItemId: string | null = row.reportInboxItemId;
      if (!reportInboxItemId && chief) {
        reportInboxItemId = await db.transaction(async (tx) => {
          const item = await repos.inbox.createItem(tx, input.businessId, {
            type: "report",
            from_agent_id: chief.id,
            subject: "While you were away",
            body_md: lines.join("\n"),
            status_strip: [{ metric: "customers_week", source: "journeys.countConversions" }, { metric: "cash", source: "finance.cashPosition" }],
            exhibit: { kind: "none", spec_ref: null },
            decision: null,
            blocks_continue: false,
            source_event_ids: [],
            entity_ids: [],
          });
          await repos.holidays.end(tx, input.businessId, input.holiday.holidayId, { reportInboxItemId: item.id, endedAt: now });
          return item.id;
        });
      } else {
        await repos.holidays.end(db, input.businessId, input.holiday.holidayId, { endedAt: now });
      }
      const ev = await emitEvent(db, {
        businessId: input.businessId,
        type: "holiday.ended",
        actor: systemActor,
        payload: { holidayId: input.holiday.holidayId, startedAt: since.toISOString(), endedAt: now.toISOString(), reason: input.reason, wakeEventType: (input.wakeEventType as EventType | null) ?? null, cyclesRun: input.cyclesRun, decisionsMade: chiefDecisions.length, customersWon: conversions.items.length, spent: { amountMinor: Math.round(usage.costMinor), currency }, gatedItemsQueued, reportInboxItemId },
      }, { idempotencyKey: holidayEndedKey(input.holiday.holidayId) });
      return { reportInboxItemId, eventId: ev.id, cyclesRun: input.cyclesRun, decisionsMade: chiefDecisions.length, customersWon: conversions.items.length, spentMinor: usage.costMinor, gatedItemsQueued };
    },
  };
}

function describeReason(reason: NonNullable<HolidayCheck["reason"]>, wake: string | null): string {
  switch (reason) {
    case "until_reached":
      return "the date you set arrived";
    case "condition_met":
      return "the condition you set was met";
    case "founder_returned":
      return "you came back";
    case "wake_event":
      return `a wake event fired (${wake ?? "event"})`;
    case "budget_exhausted":
      return "the budget ceiling was reached";
    case "kill_switch":
      return "the kill switch was pressed";
    case "cycle_cap":
      return `it reached its safety limit of ${MAX_HOLIDAY_CYCLES} cycles without you coming back`;
  }
}

/** One `holiday.ended` per vacation, whoever writes it (this activity, or the api when no workflow runs). */
export const holidayEndedKey = (holidayId: string) => `holiday.ended:${holidayId}`;

export type HolidayActivities = ReturnType<typeof createHolidayActivities>;

/**
 * The number the next cycle takes: one past every cycle seen so far (started, completed, or queued by the api and not yet
 * started), the rule `cycleStatus` in apps/api uses, so a cycle the vacation starts never collides with the founder's press.
 */
export async function nextCycleNumberOf(db: Executor, businessId: string): Promise<number> {
  const [events, queued] = await Promise.all([repos.events.list(db, businessId, { type: ["cycle.started", "cycle.completed"], limit: 500 }), repos.audit.list(db, businessId, { action: ["business.continue", "cycle.queue"], limit: 8 })]);
  const numbers = [...events.items.map((e) => (e.payload as { cycleNumber?: unknown }).cycleNumber), ...queued.items.map((q) => (q.details as { cycleNumber?: unknown }).cycleNumber)];
  return numbers.reduce<number>((max, n) => (typeof n === "number" && Number.isFinite(n) ? Math.max(max, n) : max), 0) + 1;
}
