/**
 * holiday activities (BUILD §9.6 "Holiday (Automated)", §9.4): load the period, decide blocking inbox items within
 * the Chief of Staff's authority, check end conditions (until date, budget ceiling, wake events, founder return) and
 * build the "While you were away" report. Hard-gated items are never decided here; they queue for the founder.
 */
import { LIMITS } from "@foundmill/config";
import { repos, type InboxItem } from "@foundmill/db";
import { PRICING_CURRENCY } from "@foundmill/models";
import { DECISION_TYPES, formatMoney, type DecisionType, type EventType } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
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
        currency: holiday.currency,
        wakeEvents: holiday.wakeEvents,
        startedAt: new Date(holiday.startedAt ?? holiday.createdAt).toISOString(),
        cadenceAgentHours: input.cadenceAgentHours ?? LIMITS.cycleTimeBoxAgentHours,
        chiefOfStaffId: chief?.id ?? null,
      };
    },

    async nextCycleNumber(input: { businessId: string }): Promise<{ cycleNumber: number }> {
      const counts = await repos.events.countByType(deps.db, input.businessId);
      return { cycleNumber: (counts["cycle.started"] ?? 0) + 1 };
    },

    /** Should the holiday end? Checked after every cycle and on every wake-up. */
    async holidayCheck(input: { businessId: string; holiday: LoadedHoliday }): Promise<HolidayCheck> {
      const { db, clock } = deps;
      const now = clock.now();
      const h = input.holiday;
      const row = await repos.holidays.get(db, input.businessId, h.holidayId);
      const spentMinor = await spentSince(input.businessId, new Date(h.startedAt));
      const base = { spentMinor, now: now.toISOString(), wakeEventType: null, wakeEventId: null };
      if (row.endedAt) return { ...base, shouldEnd: true, reason: "founder_returned" };
      if (h.untilAt && new Date(h.untilAt).getTime() <= now.getTime()) return { ...base, shouldEnd: true, reason: "until_reached" };
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
      const { db } = deps;
      const chiefId = input.holiday.chiefOfStaffId;
      const authority = new Set(input.holiday.authority);
      const items = await repos.inbox.list(db, input.businessId, { tab: "respond", limit: 100 });
      let decided = 0;
      let queuedGated = 0;
      const inboxItemIds: string[] = [];
      for (const item of items.items) {
        const decision = item.decision as { options?: { id: string; recommended?: boolean; reversible?: boolean; cost_minor?: number }[] } | null;
        const options = decision?.options ?? [];
        const recommended = options.find((o) => o.recommended) ?? options[0];
        if (!recommended || !chiefId) {
          if (item.blocksContinue) queuedGated += 1;
          continue;
        }
        const kind = classifyDecision(item);
        const safeUnknown = kind === null && recommended.reversible === true && (recommended.cost_minor ?? 0) === 0;
        const allowed = kind === null ? safeUnknown : !GATED.has(kind) && authority.has(kind);
        if (!allowed) {
          queuedGated += 1;
          continue;
        }
        if (item.type === "customer_won") {
          await repos.inbox.markRead(db, input.businessId, item.id);
        }
        const { decision: made } = await repos.inbox.decide(db, input.businessId, item.id, { chosenOption: recommended.id, decidedByKind: "chief_of_staff", decidedBy: chiefId });
        await emitEvent(db, {
          businessId: input.businessId,
          type: "decision.made",
          actor: { kind: "agent", id: chiefId },
          payload: { decisionId: made.id, inboxItemId: item.id, chosenOption: recommended.id, freeText: null, decidedBy: "chief_of_staff", planId: null, planActionCount: 0, hardGateActions: 0 },
        });
        await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: chiefId, action: "holiday.decide", target: { kind: "inbox_item", id: item.id }, details: { option: recommended.id, kind, reason: `within vacation authority (${kind ?? "safe reversible default"})` } });
        decided += 1;
        inboxItemIds.push(item.id);
      }
      return { decided, queuedGated, inboxItemIds };
    },

    /** End the holiday: "While you were away" report, holiday row, `holiday.ended`. */
    async endHoliday(input: { businessId: string; holiday: LoadedHoliday; reason: NonNullable<HolidayCheck["reason"]>; wakeEventType: string | null; cyclesRun: number }): Promise<HolidayEnd> {
      const { db, clock } = deps;
      const since = new Date(input.holiday.startedAt);
      const now = clock.now();
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
      // Money in is the business's (the vacation's currency, the business's own unless the founder priced the ceiling
      // otherwise); team spend is model cost, metered in the pricing currency. Narrow symbols, US grouping ("£1,240.00").
      const currency = input.holiday.currency;
      const fmt = (minor: number, inCurrency = currency) => formatMoney({ amountMinor: Math.round(minor), currency: inCurrency });
      const gatedItemsQueued = pendingApprovals + founderTasks.length;
      const days = Math.max(1, Math.round((now.getTime() - since.getTime()) / 86_400_000));
      const lines = [
        `You were away ${days} day${days === 1 ? "" : "s"}; the team ran ${input.cyclesRun} cycle${input.cyclesRun === 1 ? "" : "s"} and the vacation ended because ${describeReason(input.reason, input.wakeEventType)}.`,
        ``,
        `**Decisions I took (${chiefDecisions.length})** — each one inside the authority you set; open any item to see the option and the reason.`,
        ...chiefDecisions.slice(0, 10).map((e) => `- ${new Date(e.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}: option "${(e.payload as { chosenOption?: string }).chosenOption ?? "free text"}" on inbox item ${(e.payload as { inboxItemId?: string }).inboxItemId ?? ""}`),
        ``,
        `**Customer Updates (${conversions.items.length})** — ${conversions.items.length ? "the replays are in the Customers tab, newest first." : "no customers won while you were away."}`,
        ``,
        `**Money** — in: ${fmt(moneyIn)} across ${payments.items.length} payment${payments.items.length === 1 ? "" : "s"}; team spend: ${fmt(usage.costMinor, PRICING_CURRENCY)} (Estimate).`,
        ``,
        `**Waiting for you (${gatedItemsQueued})** — ${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} and ${founderTasks.length} hard-gated action${founderTasks.length === 1 ? "" : "s"} only you can take.`,
      ];
      let reportInboxItemId: string | null = null;
      if (chief) {
        const item = await repos.inbox.createItem(db, input.businessId, {
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
        reportInboxItemId = item.id;
      }
      await repos.holidays.end(db, input.businessId, input.holiday.holidayId, { reportInboxItemId, endedAt: now });
      const ev = await emitEvent(db, {
        businessId: input.businessId,
        type: "holiday.ended",
        actor: systemActor,
        payload: { holidayId: input.holiday.holidayId, startedAt: since.toISOString(), endedAt: now.toISOString(), reason: input.reason, wakeEventType: (input.wakeEventType as EventType | null) ?? null, cyclesRun: input.cyclesRun, decisionsMade: chiefDecisions.length, customersWon: conversions.items.length, spent: { amountMinor: Math.round(usage.costMinor), currency: PRICING_CURRENCY }, gatedItemsQueued, reportInboxItemId },
      });
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
  }
}

export type HolidayActivities = ReturnType<typeof createHolidayActivities>;
