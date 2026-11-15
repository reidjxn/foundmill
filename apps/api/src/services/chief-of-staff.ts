/**
 * The Chief of Staff on every page (founder, Phase 3): `chiefOfStaff.answer` answers "What's happening?", "What's
 * blocking us?" and "Why am I seeing this?" in plain words, from the same facts as Today and with no model call.
 *
 * The facts are Today's own reads, gathered once: `needsYouFor` (the Needs you notes, with the same section walls),
 * `weekFactsFor` (the week's work, rounds and Autopilot), `goalView` (the goal and its pace line), plus the cycle status,
 * the running work with who does it, the work waiting on other work and the stop and vacation states. The sentences are
 * the pure builders of packages/shared chief-answers.ts, which reuse Today's (today-words.ts, goals.ts). Each part
 * follows the reader's section access, as `today.get` does: Needs you needs Inbox read, the work needs Development read,
 * and a revenue goal is masked for a reader walled off Finance (`goalView`).
 */
import { repos, type DbTx } from "@foundmill/db";
import { AGENT_STOP_REASON_WORDS, chiefAnswer, dayKeyIn, goalDateWords, hasSectionAccess, vacationUntilLabel, type ChiefAnswer, type ChiefFacts, type ChiefPage, type ChiefQuestion } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { cycleStatus } from "./cycle";
import { goalView } from "./goals";
import { maskFinance } from "./inbox-redaction";
import { autopilotNextDay, needsYouFor, titleOf, weekFactsFor } from "./today";

export interface ChiefAnswerView extends ChiefAnswer {
  /** The business's Chief of Staff by its stored name; null when it has none (the page then hides the control). */
  chiefOfStaff: { id: string; name: string } | null;
  /** The business's day the answer was built on ("2026-11-09"). */
  today: string;
}

const WAITING_MAX = 20;
const RUNNING_MAX = 20;

/** Work waiting on other work: each blocked piece with the titles of the unfinished work ahead of it. */
async function blockedWork(tx: DbTx, ctx: BusinessContext): Promise<NonNullable<ChiefFacts["work"]>["blocked"]> {
  const blocked = await repos.tasks.list(tx, ctx.businessId, { status: "blocked", limit: WAITING_MAX });
  if (!blocked.items.length) return [];
  const ids = blocked.items.map((t) => t.id);
  const edges = (await repos.tasks.listEdges(tx, ctx.businessId, ids)).filter((e) => ids.includes(e.toTask));
  const ahead = await repos.tasks.byIds(tx, ctx.businessId, [...new Set(edges.map((e) => e.fromTask))]);
  const open = new Map(ahead.filter((t) => t.status !== "done").map((t) => [t.id, titleOf(t)]));
  return blocked.items.map((t) => ({ title: titleOf(t), waitingOn: edges.filter((e) => e.toTask === t.id && open.has(e.fromTask)).map((e) => open.get(e.fromTask)!) }));
}

/** The facts behind the three answers, as this reader may see them. Exported for tests. */
export async function chiefFactsFor(ctx: BusinessContext, now: Date = new Date()): Promise<{ facts: ChiefFacts; chiefOfStaff: ChiefAnswerView["chiefOfStaff"] }> {
  const m = ctx.membership;
  const zone = ctx.business.timeZone;
  const today = dayKeyIn(now, zone);
  const work = hasSectionAccess(m, "development", "read");
  const autopilotNextOn = work ? await autopilotNextDay(ctx) : null;
  return ctx.rls(async (tx) => {
    const cycle = await cycleStatus({ db: tx, businessId: ctx.businessId });
    const [needsYou, blocking, week, goals, holiday, chief] = await Promise.all([
      hasSectionAccess(m, "inbox", "read") ? needsYouFor(tx, ctx) : Promise.resolve(null),
      hasSectionAccess(m, "inbox", "read") ? repos.inbox.countBlocking(tx, ctx.businessId) : Promise.resolve(0),
      work ? weekFactsFor(tx, ctx, { now, autopilotNextOn, cycle }) : Promise.resolve(null),
      goalView(tx, ctx),
      repos.holidays.current(tx, ctx.businessId, now),
      repos.agents.chiefOfStaff(tx, ctx.businessId),
    ]);
    const running = work ? await repos.tasks.list(tx, ctx.businessId, { status: "running", limit: RUNNING_MAX }) : null;
    const agentIds = [...new Set((running?.items ?? []).map((t) => t.assigneeAgentId).filter((id): id is string => Boolean(id)))];
    const [agents, blocked] = await Promise.all([repos.agents.byIds(tx, ctx.businessId, agentIds), work ? blockedWork(tx, ctx) : Promise.resolve([])]);
    const byId = new Map(agents.map((a) => [a.id, a]));
    const first = needsYou?.items[0];
    const active = goals.active;
    const condition = holiday?.untilCondition as { text?: string } | null | undefined;
    const stopped = ctx.business.agentsStoppedAt ? AGENT_STOP_REASON_WORDS[ctx.business.agentsStoppedReason ?? "kill_switch"] : null;
    const facts: ChiefFacts = {
      today,
      work: week
        ? {
            week,
            running: (running?.items ?? []).map((t) => {
              const a = t.assigneeAgentId ? byId.get(t.assigneeAgentId) : undefined;
              return { title: titleOf(t), agent: a ? { id: a.id, name: a.name } : null };
            }),
            blocked,
          }
        : null,
      goal: active ? { sentence: active.sentence, kind: active.kind, target: active.target, currency: active.currency, dueOn: active.dueOn, achievedAt: active.achievedAt, progress: active.progress } : null,
      needsYou: needsYou ? { total: needsYou.total, holding: blocking, top: first ? { subject: first.subject, from: first.fromAgent ? { id: first.fromAgent.id, name: first.fromAgent.name } : null } : null } : null,
      stopped: stopped ? { reason: stopped } : null,
      vacation: holiday ? { untilLabel: holiday.untilAt ? goalDateWords(dayKeyIn(holiday.untilAt, zone), today) : hasSectionAccess(m, "finance", "read") ? vacationUntilLabel(condition?.text) : maskFinance(vacationUntilLabel(condition?.text)) } : null,
      paused: cycle.paused,
      failure: !cycle.running && cycle.lastFailure ? cycle.lastFailure.message : null,
      agentsWorking: cycle.activeAgentIds.length,
    };
    return { facts, chiefOfStaff: chief ? { id: chief.id, name: chief.name } : null };
  });
}

/** One answer to one of the three questions, for the page the founder is on. */
export async function chiefOfStaffAnswer(ctx: BusinessContext, input: { question: ChiefQuestion; page: ChiefPage }, now: Date = new Date()): Promise<ChiefAnswerView> {
  const { facts, chiefOfStaff } = await chiefFactsFor(ctx, now);
  return { ...chiefAnswer(input.question, facts, input.page), chiefOfStaff, today: facts.today };
}
