/**
 * holiday activities (BUILD §9.6 "Holiday (Automated)", §9.4): load the period, decide blocking inbox items within
 * the Chief of Staff's authority, check end conditions (until date, budget ceiling, wake events, founder return) and
 * build the "While you were away" report. Hard-gated items are never decided here; they queue for the founder.
 */
import { LIMITS } from "@foundmill/config";
import { repos, type InboxItem } from "@foundmill/db";
import { DECISION_TYPES, type DecisionType, type EventType } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { HolidayCheck, HolidayDecisions, HolidayEnd, HolidayInput, LoadedHoliday } from "./types";

const GATED: ReadonlySet<DecisionType> = new Set<DecisionType>(["sign_contracts"]);

type HolidayItem = Pick<InboxItem, "subject" | "bodyMd" | "decision">;
interface HolidayOption {
  id: string;
  recommended?: boolean;
  reversible?: boolean;
  cost_minor?: number;
}

const TOPICS: readonly [RegExp, DecisionType][] = [
  [/\b(sign|signature|contract|agreement|terms)\b/, "sign_contracts"],
  [/\b(merge|pull request|pr|main branch)\b/, "merge_to_main"],
  [/\b(hire|recruit|new agent|add an agent)\b/, "hire_agents"],
  [/\b(model|opus|sonnet|haiku)\b/, "change_models"],
  [/\b(publish|post|campaign|newsletter|launch|ad|ads)\b/, "publish_content"],
  [/\b(email|message|reply|outreach|customers?)\b/, "message_customers"],
];
const SPEND_WORDS = /\b(spend\w*|budget\w*|invoic\w*|pay|paying|payment|paid|purchase|buy|cost\w*|price\w*)\b|[€$£]\s?\d/;

const optionsOf = (item: Pick<InboxItem, "decision">): HolidayOption[] => (item.decision as { options?: HolidayOption[] } | null)?.options ?? [];
const costOf = (option: HolidayOption | undefined): number => Math.max(0, Math.round(Number(option?.cost_minor ?? 0)) || 0);

/**
 * Every kind of authority deciding an inbox item with one option needs (BUILD §19 keeps the list configurable): each
 * topic its wording touches, and "Spend above the approval threshold" when that option costs more than the threshold,
 * or when it talks about spending without saying what it costs. Every one must be granted, so a costed customer
 * decision needs the spend authority as well as the messaging one (audit VO-E1).
 */
export function decisionAuthorities(item: HolidayItem, opts: { optionId?: string; thresholdMinor?: number } = {}): DecisionType[] {
  const text = `${item.subject}\n${item.bodyMd}`.toLowerCase();
  const options = optionsOf(item);
  const option = options.find((o) => o.id === opts.optionId) ?? options.find((o) => o.recommended) ?? options[0];
  const kinds = TOPICS.filter(([re]) => re.test(text)).map(([, kind]) => kind);
  const cost = costOf(option);
  const unpriced = !options.some((o) => costOf(o) > 0) && SPEND_WORDS.test(text);
  if (cost > (opts.thresholdMinor ?? LIMITS.approvalThresholdMinorDefault) || unpriced) kinds.push("spend_above_threshold");
  return kinds;
}

/** The one authority an audit line names for a decision: a hard gate first, then spending, then the first topic. */
export function classifyDecision(item: HolidayItem, opts: { optionId?: string; thresholdMinor?: number } = {}): DecisionType | null {
  const kinds = decisionAuthorities(item, opts);
  return kinds.find((k) => GATED.has(k)) ?? (kinds.includes("spend_above_threshold") ? "spend_above_threshold" : (kinds[0] ?? null));
}

/** What an option may cost before it needs the spend authority: the Chief of Staff's own approval threshold (the policy default when it has none), lowered to the business's spend cap per action, as the gateway does. */
function holidayThresholdMinor(chiefThresholdMinor: unknown, businessCapMinor: number | null): number {
  const own = typeof chiefThresholdMinor === "number" && Number.isInteger(chiefThresholdMinor) && chiefThresholdMinor >= 0 ? chiefThresholdMinor : LIMITS.approvalThresholdMinorDefault;
  return businessCapMinor === null ? own : Math.min(own, businessCapMinor);
}

export function createHolidayActivities(deps: OrchestratorDeps) {
  async function spentSince(businessId: string, from: Date): Promise<number> {
    const totals = await repos.usage.totals(deps.db, businessId, { from });
    return totals.costMinor;
  }

  /** What the options the Chief of Staff chose since `from` cost (the vacation's commitments so far). */
  async function chosenByChiefSince(businessId: string, from: Date): Promise<number> {
    const made = await repos.events.list(deps.db, businessId, { type: "decision.made", from, limit: 200 });
    const chosen = made.items.map((e) => e.payload as { decidedBy?: string; inboxItemId?: string; chosenOption?: string | null }).filter((p) => p.decidedBy === "chief_of_staff" && p.inboxItemId && p.chosenOption);
    const items = await Promise.all(chosen.map((p) => repos.inbox.get(deps.db, businessId, p.inboxItemId!).catch(() => null)));
    return chosen.reduce((sum, p, i) => sum + (items[i] ? costOf(optionsOf(items[i]).find((o) => o.id === p.chosenOption)) : 0), 0);
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
      // A stopped team ends the vacation: no cycle may start until an owner or admin resumes the agents.
      const stop = await repos.businesses.stopState(db, input.businessId);
      if (stop.stopped) return { ...base, shouldEnd: true, reason: stop.reason === "credits_exhausted" ? "budget_exhausted" : "kill_switch" };
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

    /**
     * The Chief of Staff decides blocking inbox items within authority; gated items stay queued. An item is decided only
     * when every authority its recommended option needs was granted (`decisionAuthorities`), and a costed option never
     * past the Chief's spend cap or what the vacation's budget ceiling has left (the spend so far and the options the
     * Chief already chose this vacation count against it).
     */
    async holidayAutoDecide(input: { businessId: string; holiday: LoadedHoliday }): Promise<HolidayDecisions> {
      const { db } = deps;
      const h = input.holiday;
      const chiefId = h.chiefOfStaffId;
      const authority = new Set(h.authority);
      const [items, business, chief] = await Promise.all([
        repos.inbox.list(db, input.businessId, { tab: "respond", limit: 100 }),
        repos.businesses.get(db, input.businessId),
        chiefId ? repos.agents.get(db, input.businessId, chiefId) : Promise.resolve(null),
      ]);
      const thresholdMinor = holidayThresholdMinor(chief?.autonomy["approvalThresholdMinor"], business.spendCapMinor ?? null);
      const capRaw = chief?.autonomy["spendCapMinor"];
      const spendCapMinor = typeof capRaw === "number" && Number.isInteger(capRaw) && capRaw >= 0 ? capRaw : null;
      let budgetLeftMinor = h.budgetCeilingMinor === null ? null : h.budgetCeilingMinor - (await spentSince(input.businessId, new Date(h.startedAt))) - (await chosenByChiefSince(input.businessId, new Date(h.startedAt)));
      let decided = 0;
      let queuedGated = 0;
      const inboxItemIds: string[] = [];
      for (const item of items.items) {
        const recommended = optionsOf(item).find((o) => o.recommended) ?? optionsOf(item)[0];
        if (!recommended || !chiefId) {
          if (item.blocksContinue) queuedGated += 1;
          continue;
        }
        const kinds = decisionAuthorities(item, { optionId: recommended.id, thresholdMinor });
        const kind = classifyDecision(item, { optionId: recommended.id, thresholdMinor });
        const cost = costOf(recommended);
        const safeUnknown = kinds.length === 0 && recommended.reversible === true && cost === 0;
        const withinAuthority = kinds.length === 0 ? safeUnknown : kinds.every((k) => !GATED.has(k) && authority.has(k));
        const withinCaps = cost === 0 || ((spendCapMinor === null || cost <= spendCapMinor) && (budgetLeftMinor === null || cost <= budgetLeftMinor));
        if (!withinAuthority || !withinCaps) {
          queuedGated += 1;
          continue;
        }
        if (budgetLeftMinor !== null) budgetLeftMinor -= cost;
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
        await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: chiefId, action: "holiday.decide", target: { kind: "inbox_item", id: item.id }, details: { option: recommended.id, kind, kinds, costMinor: cost, reason: `within vacation authority (${kinds.length ? kinds.join(", ") : "safe reversible default"})` } });
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
      const currency = input.holiday.currency;
      const fmt = (minor: number) => `${(minor / 100).toFixed(2)} ${currency}`;
      const gatedItemsQueued = pendingApprovals + founderTasks.length;
      const lines = [
        `You were away ${describeAway(now.getTime() - since.getTime())}; the team ran ${input.cyclesRun} cycle${input.cyclesRun === 1 ? "" : "s"} and the vacation ended because ${describeReason(input.reason, input.wakeEventType)}.`,
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
        payload: { holidayId: input.holiday.holidayId, startedAt: since.toISOString(), endedAt: now.toISOString(), reason: input.reason, wakeEventType: (input.wakeEventType as EventType | null) ?? null, cyclesRun: input.cyclesRun, decisionsMade: chiefDecisions.length, customersWon: conversions.items.length, spent: { amountMinor: Math.round(usage.costMinor), currency }, gatedItemsQueued, reportInboxItemId },
      });
      return { reportInboxItemId, eventId: ev.id, cyclesRun: input.cyclesRun, decisionsMade: chiefDecisions.length, customersWon: conversions.items.length, spentMinor: usage.costMinor, gatedItemsQueued };
    },
  };
}

/** How long the founder was away, in the largest whole unit that fits: minutes under an hour, hours under a day, then days. */
export function describeAway(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (ms < 3_600_000) return plural(Math.min(59, Math.max(1, Math.round(ms / 60_000))), "minute");
  if (ms < 86_400_000) return plural(Math.min(23, Math.max(1, Math.round(ms / 3_600_000))), "hour");
  return plural(Math.max(1, Math.round(ms / 86_400_000)), "day");
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
