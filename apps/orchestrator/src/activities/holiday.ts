/**
 * holiday activities (BUILD §9.6 "Holiday (Automated)", §9.4): load the period, decide blocking inbox items within
 * the Chief of Staff's authority, check end conditions (until date, budget ceiling, wake events, founder return) and
 * build the "While you were away" report.
 *
 * A decision taken on vacation goes down the founder's own plan path (apps/api `inbox.decide`): the recommended option
 * compiles to typed actions (`compileOptionPlan`, the same rules), each action is checked against the policies, the
 * plan is written with origin `holiday` beside the item's decision, and the holiday workflow runs it through
 * `planExecution` (sessions, channel engines and the stop flag as for any plan). The Chief of Staff never gives a
 * go-ahead the founder would have had to give: an item whose plan is hard-gated, moves money, sits outside the policy
 * or changes a section the person who handed over cannot change stays open in the Inbox, and the report lists it as
 * waiting for the founder with the reason. A stopped team decides nothing.
 */
import { LIMITS } from "@foundmill/config";
import { repos, type Agent, type Business, type Executor, type InboxItem } from "@foundmill/db";
import { PRICING_CURRENCY, compileOptionPlan, type PlanAction } from "@foundmill/models";
import { DECISION_TYPES, formatMoney, planSectionWalls, type DecisionType, type EventType, type SectionMembership } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { MAX_HOLIDAY_CYCLES } from "../holiday-contract";
import { emitEvent, systemActor } from "../events";
import { ACTION_TOOLS, amountOf, evaluateAction, type PolicyVerdict } from "./plan";
import type { HolidayCheck, HolidayDecisions, HolidayEnd, HolidayInput, LoadedHoliday } from "./types";

const GATED: ReadonlySet<DecisionType> = new Set<DecisionType>(["sign_contracts", "merge_to_main"]);

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

interface HolidayOption {
  id: string;
  label?: string;
  consequence?: string;
  recommended?: boolean;
  reversible?: boolean;
  cost_minor?: number;
  /** What choosing it runs, written with the option (typed actions); when present nothing is read from its words. */
  actions?: unknown;
}

/** What the Chief of Staff does with one blocking item: run the recommended option's plan, or leave it to the founder. */
export type VacationVerdict =
  | { kind: "decide"; option: HolidayOption; decisionType: DecisionType | null; summary: string; actions: { action: PlanAction; verdict: PolicyVerdict }[] }
  | { kind: "wait"; reason: string };

/** Everything a vacation decision is checked against, loaded once per pass over the Inbox. */
export interface VacationContext {
  business: Pick<Business, "id" | "businessMode">;
  agents: readonly Agent[];
  chiefOfStaffId: string | null;
  authority: ReadonlySet<DecisionType>;
  /** The membership of the person who handed over (the vacation's starter; the owner's walls, none, when unknown). */
  actsFor: SectionMembership;
  currency: string;
  /** What an option may cost before it needs the spend authority (`holidayThresholdMinor`); the policy default when absent. */
  thresholdMinor?: number;
}

/**
 * Option ids of an approval's decision item (an agent's gated call the policy asked the founder about; the Inbox answers
 * it through `inbox.decide`, which resolves the approval, never through an option plan). The policy already said "ask",
 * so it is the founder's like any `ask` below. Kept in step with packages/db's `APPROVAL_OPTIONS` (B-approvals).
 */
const APPROVAL_OPTION_IDS: ReadonlySet<string> = new Set(["approve_request", "reject_request"]);

/** The item is an approval's (its Approve and Reject options): the founder answers it, and it counts as an approval. */
export function isApprovalItem(item: Pick<InboxItem, "decision">): boolean {
  return ((item.decision as { options?: { id?: unknown }[] } | null)?.options ?? []).some((o) => typeof o?.id === "string" && APPROVAL_OPTION_IDS.has(o.id));
}

const MONEY_WORDS: Partial<Record<PlanAction["type"], string>> = { set_budget: "a budget", approve_spend: "approving spend", train_agent: "a paid training run", create_task: "a task with a budget" };

const SECTION_WORDS: Partial<Record<string, string>> = { distribution: "Distribution", finance: "Finance", development: "Development", product: "Product", crm: "the CRM", team: "the Team" };

/**
 * The founder's plan path for one item, as the Chief of Staff may walk it (pure, so the report can say why an item
 * waits): the authority the founder gave, then the recommended option compiled by the same rules as an option click,
 * then each action's policy verdict, then what only the founder may do. A hard gate, money, a policy `ask` or `deny`,
 * or a section the person who handed over cannot change leaves the item to the founder.
 */
export function vacationVerdict(item: Pick<InboxItem, "subject" | "bodyMd" | "decision" | "fromAgentId">, ctx: VacationContext): VacationVerdict {
  const options = ((item.decision as { options?: HolidayOption[] } | null)?.options ?? []).filter((o) => typeof o?.id === "string");
  const recommended = options.find((o) => o.recommended) ?? options[0];
  if (!recommended) return { kind: "wait", reason: "it has no option to choose" };
  if (isApprovalItem(item)) return { kind: "wait", reason: "an agent's call waits for your approval" };
  if (!ctx.chiefOfStaffId) return { kind: "wait", reason: "there is no Chief of Staff to decide it" };
  // Every authority the recommended option needs must be granted: a costed customer decision needs the spend authority as
  // well as the messaging one (audit VO-E1).
  const needs = { optionId: recommended.id, thresholdMinor: ctx.thresholdMinor };
  const kinds = decisionAuthorities(item, needs);
  const decisionType = classifyDecision(item, needs);
  const safeUnknown = kinds.length === 0 && recommended.reversible === true && (recommended.cost_minor ?? 0) === 0;
  const allowed = kinds.length === 0 ? safeUnknown : kinds.every((k) => !GATED.has(k) && ctx.authority.has(k));
  if (!allowed) return { kind: "wait", reason: kinds.includes("sign_contracts") ? "signing is always yours" : kinds.length > 0 ? "it is outside the authority you gave" : "the recommended option is not free and reversible" };
  // Money is the founder's (CLAUDE.md "Never"): an option that costs anything waits, whatever authority was given.
  if ((recommended.cost_minor ?? 0) > 0) return { kind: "wait", reason: `it costs money (${formatMoney({ amountMinor: recommended.cost_minor ?? 0, currency: ctx.currency })})` };

  const compiled = compileOptionPlan({ id: recommended.id, label: recommended.label ?? recommended.id, consequence: recommended.consequence, cost_minor: recommended.cost_minor, reversible: recommended.reversible, actions: recommended.actions }, { fromAgentId: item.fromAgentId, subject: item.subject }, {
    agents: ctx.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, department_id: a.departmentIds[0] ?? undefined })),
    defaultCurrency: ctx.currency,
  });
  const actions = compiled.actions.map((action) => ({ action, verdict: evaluateAction({ type: action.type, params: action.params, agentId: action.agent_id }, { business: ctx.business, agents: ctx.agents, holidayActive: true }) }));
  if (actions.some((a) => a.verdict.hardGate)) return { kind: "wait", reason: "only you can do what it needs (a hard gate)" };
  const money = actions.find((a) => ACTION_TOOLS[a.action.type].spendsMoney === true || amountOf(a.action.params) > 0);
  if (money) return { kind: "wait", reason: `it moves money (${MONEY_WORDS[money.action.type] ?? "a budget"})` };
  const denied = actions.find((a) => a.verdict.outcome === "deny");
  if (denied) return { kind: "wait", reason: `the policy refuses part of it${denied.verdict.reasons[0] ? ` (${denied.verdict.reasons[0]})` : ""}` };
  const asked = actions.find((a) => a.verdict.outcome === "ask");
  if (asked) return { kind: "wait", reason: `it needs your go-ahead${asked.verdict.reasons[0] ? ` (${asked.verdict.reasons[0]})` : ""}` };
  const walls = planSectionWalls(ctx.actsFor, compiled.actions);
  if (walls.length > 0) return { kind: "wait", reason: `it changes ${walls.map((w) => SECTION_WORDS[w.section] ?? w.section).join(" and ")}, which the person who started the vacation cannot change` };
  return { kind: "decide", option: recommended, decisionType, summary: compiled.summary, actions };
}

/** The owner's walls (none): the Chief of Staff's limit when the vacation's starter is unknown or no longer a member. */
const OWNER: SectionMembership = { role: "owner", sectionPermissions: {} };

/** Why an answered item still waits: its plan is outside policy and only the founder gives the go-ahead (`plan.confirm`). */
export const AWAITING_GO_AHEAD = "its plan waits for your go-ahead";
/** A sign-off of the product (the specification, the roadmap, Ready to start selling) is never taken for the founder (founder, 2026-10-18). */
export const SIGNOFF_IS_YOURS = "signing off the product is yours";

/** The item asks the founder to choose (options), or to confirm the plan they chose: the report lists it as waiting. */
function asksFounder(item: Pick<InboxItem, "state" | "decision">): boolean {
  return item.state === "answered" || ((item.decision as { options?: unknown[] } | null)?.options?.length ?? 0) > 0;
}

/** Why an item the founder must answer is still open when the vacation ends (the report's "Waiting for you"). */
export function waitingReason(item: Pick<InboxItem, "state" | "subject" | "bodyMd" | "decision" | "fromAgentId">, ctx: VacationContext, stopped: boolean): string {
  if (item.state === "answered") return AWAITING_GO_AHEAD;
  const verdict = vacationVerdict(item, ctx);
  if (verdict.kind === "wait") return verdict.reason;
  return stopped ? "the agents were stopped before I could take it" : "it came in after my last pass";
}

/*
 * W01's simple helper (decides inside the given authority without compiling a plan) that Automated mode's activity
 * (./automatedMode) calls; the vacation itself takes the plan path above.
 */
export interface AutoDecideOptions {
  chiefOfStaffId: string | null;
  /** Decision types the Chief of Staff may take (signing never is). */
  authority: readonly string[];
  auditAction: "holiday.decide" | "automated_mode.decide";
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
    // The product's sign-offs and the start of distribution are the founder's, whatever the authority (founder, 2026-10-18).
    const signoff = await repos.productSignoffs.forInboxItem(db, businessId, item.id);
    if (!recommended || !chiefId || signoff) {
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
  return { decided, queuedGated, inboxItemIds, planIds: [], waiting: [] };
}

/** The plan's workflow id, as apps/api's `workflowIds.plan` and Stop all agents know it. */
export const planWorkflowId = (planId: string): string => `plan:${planId}`;

export function createHolidayActivities(deps: OrchestratorDeps) {
  async function spentSince(businessId: string, from: Date): Promise<number> {
    const totals = await repos.usage.totals(deps.db, businessId, { from });
    return totals.costMinor;
  }

  /** What vacation decisions are checked against: the business, its agents, the authority and the hand-over's walls. */
  async function vacationContext(businessId: string, holiday: LoadedHoliday): Promise<VacationContext> {
    const { db } = deps;
    const [business, agents, row] = await Promise.all([repos.businesses.get(db, businessId), repos.agents.list(db, businessId, { limit: 200 }), repos.holidays.get(db, businessId, holiday.holidayId)]);
    const starter = row.startedBy ? await repos.memberships.get(db, businessId, row.startedBy) : null;
    const chief = agents.items.find((a) => a.id === holiday.chiefOfStaffId);
    return {
      business,
      agents: agents.items,
      thresholdMinor: holidayThresholdMinor(chief?.autonomy["approvalThresholdMinor"], business.spendCapMinor ?? null),
      chiefOfStaffId: holiday.chiefOfStaffId,
      authority: new Set(holiday.authority.filter((d): d is DecisionType => (DECISION_TYPES as readonly string[]).includes(d))),
      actsFor: starter ? { role: starter.role, sectionPermissions: starter.sectionPermissions } : OWNER,
      currency: business.glossary.currency ?? holiday.currency,
    };
  }

  /**
   * This vacation's decision plans still executing (origin `holiday`, written since it started). A pass hands them all
   * to the workflow, which starts each as `plan:<id>`: one already running is left alone, and one whose start an
   * activity retry lost (the decision committed, the result never reached the workflow) starts on the next pass.
   * planExecution skips actions that already ran, so a second start does nothing twice.
   */
  async function plansToRun(businessId: string, holiday: LoadedHoliday): Promise<string[]> {
    const since = new Date(holiday.startedAt).getTime();
    const page = await repos.plans.list(deps.db, businessId, { status: "executing", origin: "holiday", limit: 100 });
    return page.items.filter((p) => p.createdAt.getTime() >= since).map((p) => p.id);
  }

  /** One "Decisions I took" line: the note, the option and how far its plan got (never a decision that ran nothing). */
  async function decisionLine(businessId: string, e: { occurredAt: Date | string; payload: unknown }): Promise<string> {
    const p = e.payload as { inboxItemId?: string; chosenOption?: string | null; planId?: string | null };
    const [item, status] = await Promise.all([
      p.inboxItemId ? repos.inbox.get(deps.db, businessId, p.inboxItemId).catch(() => null) : null,
      p.planId ? repos.plans.status(deps.db, businessId, p.planId).catch(() => null) : null,
    ]);
    const options = ((item?.decision as { options?: { id: string; label?: string }[] } | null)?.options ?? []);
    const label = options.find((o) => o.id === p.chosenOption)?.label ?? p.chosenOption ?? "an option";
    const day = new Date(e.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const done = status ? status.counts.done : 0;
    const progress = !status ? "no plan was recorded" : status.plan.status === "done" ? `done (${done} of ${status.total} action${status.total === 1 ? "" : "s"})` : status.plan.status === "failed" ? `the plan failed (${done} of ${status.total} done)` : `running (${done} of ${status.total} done)`;
    return `- ${day}: "${item?.subject ?? "a note"}", I chose "${label}"; ${progress}.`;
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

    /**
     * The Chief of Staff decides blocking inbox items within authority, down the founder's plan path: each decision
     * writes its plan (origin `holiday`, its `plan:<id>` recorded before it starts) beside the decision in one
     * transaction, and the holiday workflow runs the returned `planIds` through `planExecution`. Items only the founder
     * may decide stay open and come back in `waiting` with the reason; so does an item the founder answered whose plan
     * waits for their go-ahead (the Chief of Staff never confirms a plan for them). A stopped team decides nothing.
     */
    async holidayAutoDecide(input: { businessId: string; holiday: LoadedHoliday }): Promise<HolidayDecisions> {
      const { db } = deps;
      const businessId = input.businessId;
      const none: HolidayDecisions = { decided: 0, queuedGated: 0, inboxItemIds: [], planIds: [], waiting: [] };
      // The stop flag wins: a stopped team decides and starts nothing (the vacation ends at its next check).
      if (await repos.businesses.agentsStopped(db, businessId)) return none;
      const [items, ctx] = await Promise.all([repos.inbox.list(db, businessId, { tab: "respond", limit: 100 }), vacationContext(businessId, input.holiday)]);
      const chiefId = ctx.chiefOfStaffId;
      let decided = 0;
      let queuedGated = 0;
      const inboxItemIds: string[] = [];
      const waiting: HolidayDecisions["waiting"] = [];
      for (const item of items.items) {
        // Answered by the founder, its plan outside policy: only they confirm it ("Here is what will happen"). A sign-off
        // of the product (its round is on the item) is never taken for them.
        const signoff = item.state === "answered" ? null : await repos.productSignoffs.forInboxItem(db, businessId, item.id);
        const verdict: VacationVerdict = item.state === "answered" ? { kind: "wait", reason: AWAITING_GO_AHEAD } : signoff ? { kind: "wait", reason: SIGNOFF_IS_YOURS } : vacationVerdict(item, ctx);
        if (verdict.kind === "wait" || !chiefId) {
          // Only a decision the founder has to take counts as queued; a note with nothing to choose is just unread.
          if (item.blocksContinue || asksFounder(item)) queuedGated += 1;
          if (asksFounder(item) && verdict.kind === "wait") waiting.push({ inboxItemId: item.id, reason: verdict.reason });
          continue;
        }
        const option = verdict.option;
        await db.transaction(async (tx) => {
          const plan = await repos.plans.create(tx, businessId, {
            origin: "holiday",
            summaryMd: verdict.summary,
            inboxItemId: item.id,
            status: "executing",
            actions: verdict.actions.map((a) => ({ type: a.action.type, params: a.action.params, agentId: a.action.agent_id, policyOutcome: a.verdict.outcome })),
          });
          // Stop all agents reaches an executing plan through its recorded workflow id, so it is set before it starts.
          await repos.plans.setWorkflowId(tx, businessId, plan.id, planWorkflowId(plan.id));
          if (item.type === "customer_won") await repos.inbox.markRead(tx, businessId, item.id);
          const { decision: made } = await repos.inbox.decide(tx, businessId, item.id, { chosenOption: option.id, decidedByKind: "chief_of_staff", decidedBy: chiefId, planId: plan.id });
          await emitEvent(tx, {
            businessId,
            type: "decision.made",
            actor: { kind: "agent", id: chiefId },
            payload: { decisionId: made.id, inboxItemId: item.id, chosenOption: option.id, freeText: null, decidedBy: "chief_of_staff", planId: plan.id, planActionCount: plan.actions.length, hardGateActions: 0 },
          });
          await repos.audit.append(tx, businessId, {
            actorKind: "agent",
            actorId: chiefId,
            action: "holiday.decide",
            target: { kind: "inbox_item", id: item.id },
            details: { option: option.id, kind: verdict.decisionType, planId: plan.id, actionTypes: plan.actions.map((a) => a.type), reason: `within vacation authority (${verdict.decisionType ?? "safe reversible default"})` },
          });
        });
        decided += 1;
        inboxItemIds.push(item.id);
      }
      return { decided, queuedGated, inboxItemIds, planIds: await plansToRun(businessId, input.holiday), waiting };
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
      const [decisions, conversions, payments, pendingApprovals, usage, chief, open, ctx, stopped] = await Promise.all([
        repos.events.list(db, input.businessId, { type: "decision.made", from: since, limit: 200 }),
        repos.events.list(db, input.businessId, { type: "customer.converted", from: since, limit: 200 }),
        repos.events.list(db, input.businessId, { type: "payment.received", from: since, limit: 500 }),
        repos.approvals.countPending(db, input.businessId),
        repos.usage.totals(db, input.businessId, { from: since }),
        repos.agents.chiefOfStaff(db, input.businessId),
        repos.inbox.list(db, input.businessId, { tab: "respond", limit: 100 }),
        vacationContext(input.businessId, input.holiday),
        repos.businesses.agentsStopped(db, input.businessId),
      ]);
      const founderTasks = (await repos.tasks.list(db, input.businessId, { status: "ready", limit: 200 })).items.filter((t) => t.assigneeAgentId === null && /^Founder action:/.test(t.title));
      const chiefDecisions = decisions.items.filter((e) => (e.payload as { decidedBy?: string }).decidedBy === "chief_of_staff");
      const taken = await Promise.all(chiefDecisions.slice(0, 10).map((e) => decisionLine(input.businessId, e)));
      // Every decision still open, and every plan of the founder's still waiting for their go-ahead, with the reason.
      const waiting = open.items.filter(asksFounder).map((item) => ({ item, reason: waitingReason(item, ctx, stopped) }));
      // An approval's note is listed with the rest but counted once, as the approval it answers.
      const decisionsWaiting = waiting.filter((w) => !isApprovalItem(w.item)).length;
      const moneyIn = payments.items.reduce((sum, e) => sum + Number((e.payload as { amount?: { amountMinor?: number } }).amount?.amountMinor ?? 0), 0);
      // Money in is the business's (the vacation's currency, the business's own unless the founder priced the ceiling
      // otherwise); team spend is model cost, metered in the pricing currency. Narrow symbols, US grouping ("£1,240.00").
      const currency = input.holiday.currency;
      const fmt = (minor: number, inCurrency = currency) => formatMoney({ amountMinor: Math.round(minor), currency: inCurrency });
      const gatedItemsQueued = pendingApprovals + founderTasks.length + decisionsWaiting;
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const awayFor = describeAway(now.getTime() - since.getTime());

      const lines = [
        `You were away ${awayFor}; the team ran ${input.cyclesRun} cycle${input.cyclesRun === 1 ? "" : "s"} and the vacation ended because ${describeReason(input.reason, input.wakeEventType)}.`,
        ``,
        `**Decisions I took (${chiefDecisions.length})** — each one inside the authority you set, run as a plan like your own decisions; open any item to see the plan and how far it got.`,
        ...taken,
        ``,
        `**Customer Updates (${conversions.items.length})** — ${conversions.items.length ? "the replays are in the Customers tab, newest first." : "no customers won while you were away."}`,
        ``,
        `**Money** — in: ${fmt(moneyIn)} across ${payments.items.length} payment${payments.items.length === 1 ? "" : "s"}; team spend: ${fmt(usage.costMinor, PRICING_CURRENCY)} (Estimate).`,
        ``,
        `**Waiting for you (${gatedItemsQueued})** — ${plural(decisionsWaiting, "decision")} to take or confirm, ${plural(pendingApprovals, "approval")} and ${plural(founderTasks.length, "hard-gated action")} only you can take.`,
        ...waiting.slice(0, 10).map((w) => `- "${w.item.subject}": ${w.reason}.`),
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
        payload: { holidayId: input.holiday.holidayId, startedAt: since.toISOString(), endedAt: now.toISOString(), reason: input.reason, wakeEventType: (input.wakeEventType as EventType | null) ?? null, cyclesRun: input.cyclesRun, decisionsMade: chiefDecisions.length, customersWon: conversions.items.length, spent: { amountMinor: Math.round(usage.costMinor), currency: PRICING_CURRENCY }, gatedItemsQueued, reportInboxItemId },
      }, { idempotencyKey: holidayEndedKey(input.holiday.holidayId) });
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
