/**
 * `loadBrief`: the ~4,000-token business brief rebuilt each cycle (BUILD §9.7) and prompt-cached for every agent call.
 * Facts come from the repositories; nothing is invented and every non-real number carries its label.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { concurrencyAllowance, creditsState, modelBudgetState, periodOf, repos } from "@foundmill/db";
import type { TaskStatus } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { failureStreak, taskRetry } from "../retry";
import { enforceWageCaps, recoverAgents } from "./dispatch";
import type { BriefAgent, BriefDepartment, BriefTask, BusinessBrief } from "./types";

/**
 * Tasks a cycle may plan (`PLANNABLE_STATUSES` in packages/db, the cycle's DISPATCHABLE). `failed` and `blocked` are
 * here so such a task is retried (with a backoff and a limit, `retry.ts`) instead of leaving the loop for good;
 * `stopped` is not: that is the founder's "Stop and discard", which only Start undoes. Every one of them is loaded, most
 * important and then oldest first (audit SOAK-04: a recency page of 200 dropped a long-running business's oldest work).
 */
const PLANNING_CANDIDATE_LIMIT = 500;
/** Work in flight: listed in the brief, never planned again while it runs. */
const IN_FLIGHT_STATUSES: TaskStatus[] = ["running", "review", "merging"];
const BRIEF_TOKEN_BUDGET = 4_000;
const CHARS_PER_TOKEN = 4;

export const approxTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Trim a section list to fit the remaining budget, keeping the first entries (callers pre-sort by importance). */
function fit(lines: string[], budgetTokens: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const t = approxTokens(line) + 1;
    if (used + t > budgetTokens) {
      out.push(`… ${lines.length - out.length} more`);
      break;
    }
    out.push(line);
    used += t;
  }
  return out;
}

export function createBriefActivities(deps: OrchestratorDeps) {
  return {
    async loadBrief(input: { businessId: string }): Promise<BusinessBrief> {
      const { db, clock } = deps;
      const businessId = input.businessId;
      const now = clock.now();
      // Agents that rested after a failure, or are under their wage cap again, go back to work before the plan; an agent
      // that went over its cap while it worked is paused (with its note) before the planner sees the team.
      await recoverAgents(deps, businessId);
      await enforceWageCaps(deps, businessId);
      const [business, departmentsRaw, agentsPage, candidates, inFlight, pendingApprovals, blockingInboxItems, holiday, chief, wages, roadmap] = await Promise.all([
        repos.businesses.get(db, businessId),
        repos.departments.list(db, businessId),
        repos.agents.list(db, businessId, { limit: 200 }),
        repos.tasks.planningCandidates(db, businessId, { limit: PLANNING_CANDIDATE_LIMIT }),
        repos.tasks.list(db, businessId, { status: IN_FLIGHT_STATUSES, limit: 50 }),
        repos.approvals.countPending(db, businessId),
        repos.inbox.countBlocking(db, businessId),
        repos.holidays.current(db, businessId, now),
        repos.agents.chiefOfStaff(db, businessId),
        repos.usage.wages(db, businessId, periodOf(now)),
        repos.product.untaskedRoadmap(db, businessId, 20),
      ]);
      const retriedIds = candidates.items.filter((t) => t.status === "failed" || t.status === "blocked").map((t) => t.id);
      const recent = await repos.agents.recentOutcomes(db, businessId, { taskIds: retriedIds, limit: 20 * retriedIds.length });
      const spentBy = new Map(wages.map((w) => [w.agentId, w.costMinor]));
      const holds = await repos.approvals.holds(db, businessId, candidates.items.map((t) => t.id));
      const currency = business.currency;

      const departments: BriefDepartment[] = departmentsRaw.map((d) => ({ id: d.id, name: d.name, slug: d.slug, leadAgentId: d.leadAgentId, moduleKeys: d.moduleKeys, budgetMinor: d.budgetMinor === null ? null : Number(d.budgetMinor) }));
      const agents: BriefAgent[] = agentsPage.items.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        agentType: a.agentType,
        layer: a.layer,
        modelKey: a.modelKey,
        status: a.status,
        departmentIds: a.departmentIds,
        wageCapMinor: a.wageCapMinor === null ? null : Number(a.wageCapMinor),
        wageRemainingMinor: a.wageCapMinor === null ? null : Number(a.wageCapMinor) - (spentBy.get(a.id) ?? 0),
      }));
      const openTasks: BriefTask[] = candidates.items.map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        status: t.status,
        departmentId: t.departmentId,
        assigneeAgentId: t.assigneeAgentId,
        priority: t.priority,
        fileScope: t.fileScope,
        dependsOn: t.dependsOn,
        budgetMinor: t.budgetMinor === null ? null : Number(t.budgetMinor),
        // Any unfinished dependency blocks dispatch, however old (computed in SQL over every task).
        blocked: t.blocked,
        awaitingApproval: t.awaitingApproval,
        approvalHold: holds.get(t.id) ?? null,
        retry: t.status === "failed" ? taskRetry(failureStreak(recent.filter((s) => s.taskId === t.id)), now) : t.status === "blocked" ? taskRetry(failureStreak(recent.filter((s) => s.taskId === t.id), ["blocked", "failed"]), now) : null,
      }));
      const untaskedRoadmap = roadmap.map((r) => ({ id: r.id, title: r.title, horizon: r.horizon }));
      const agentsStopped = business.agentsStoppedAt !== null;

      // Credits (USD) for a business on credits: the period's balance, or what its tier includes before the first charge
      // of the month. A business on its own key has no Foundmill budget here (null).
      let budgetRemainingMinor: number | null = null;
      try {
        const credits = await creditsState(db, business, periodOf(now));
        if (credits) budgetRemainingMinor = credits.balanceMinor;
      } catch (err) {
        deps.log.debug({ err: (err as Error).message }, "credit balance unavailable");
      }

      // The monthly model budget (0059), whoever pays the model: dispatch refuses new sessions once it is used up, and the
      // plan is not drafted either (a planning call costs money too).
      const monthlyBudget = await modelBudgetState(db, business, now);

      // The plan tier's concurrent-agent limit (BUILD §10.5), less the sessions still open from earlier cycles or starts.
      const concurrency = await concurrencyAllowance(db, business, now);
      const maxAgents = concurrency.room;
      const capacity = deps.models.mode === "mock" ? "mock models: unlimited" : "requests 50/min, input 80k tok/min, output 16k tok/min (Estimate until headers are read)";

      // ---- prose brief (≈ 4k tokens) ------------------------------------------------------------------------------
      const sections: string[] = [];
      sections.push(`# ${business.name}\nMode: ${business.businessMode}${holiday ? " (founder on vacation; Chief of Staff decides within authority)" : ""}. Archetype: ${business.archetype ?? "not committed"}. Game mode: ${business.gameMode}. Plan tier: ${business.planTier}. Currency: ${currency}.`);
      if (Object.keys(business.glossary).length) sections.push(`## Glossary\n${Object.entries(business.glossary).map(([k, v]) => `- say "${v}" for "${k}"`).join("\n")}`);
      sections.push(`## Departments\n${fit(departments.map((d) => `- ${d.name} (${d.id}): modules ${d.moduleKeys.join(", ") || "none"}; lead ${d.leadAgentId ?? "none"}; budget ${d.budgetMinor === null ? "unset" : formatMinor(d.budgetMinor, currency) + " (Estimate)"}`), 400).join("\n")}`);
      sections.push(`## Team (${agents.length})\n${fit(agents.map((a) => `- ${a.name} — ${a.role || a.agentType} [${a.layer}, ${a.modelKey}, ${a.status}${a.wageRemainingMinor !== null && a.wageRemainingMinor !== undefined && a.wageRemainingMinor <= 0 ? ", wage cap reached" : ""}] id ${a.id}`), 900).join("\n")}`);
      // Most important, then oldest first (the candidates' order); identical titles are folded into one line with a count.
      const taskLines = foldDuplicates(openTasks).map(({ task: t, count }) => `- [${t.status}] ${t.title}${count > 1 ? ` (×${count})` : ""} (${t.kind}, id ${t.id}${t.assigneeAgentId ? `, assignee ${t.assigneeAgentId}` : ""}${t.departmentId ? `, dept ${t.departmentId}` : ""}${t.blocked ? ", blocked by dependencies" : ""}${t.awaitingApproval ? ", waiting for the founder's approval" : ""}${t.fileScope.length ? `, files ${t.fileScope.slice(0, 3).join(" ")}` : ""})`);
      sections.push(`## Open tasks (${candidates.total})\n${fit(taskLines, 1400).join("\n") || "- none"}`);
      if (inFlight.items.length) sections.push(`## In flight (${inFlight.items.length}${inFlight.nextCursor ? "+" : ""})\n${fit(inFlight.items.map((t) => `- [${t.status}] ${t.title} (${t.kind}, id ${t.id})`), 300).join("\n")}`);
      if (untaskedRoadmap.length) sections.push(`## Roadmap without tasks (${untaskedRoadmap.length})\n${fit(untaskedRoadmap.map((r) => `- [${r.horizon}] ${r.title} (roadmap item ${r.id}): needs a task graph (Development › Plan) before anyone can start it`), 300).join("\n")}`);
      sections.push(`## Governance\n${agentsStopped ? "The team is stopped (Stop all agents, a revoked key or used-up credits): no work starts until an owner or admin resumes it. " : ""}Approvals waiting: ${pendingApprovals}. Inbox items blocking Continue: ${blockingInboxItems}. Concurrency limit: ${maxAgents} agents (plan ${business.planTier}: ${concurrency.limit} at once, ${concurrency.running} already running). Model budget remaining this period: ${budgetRemainingMinor === null ? "the founder's own Anthropic key (no credits)" : formatMinor(budgetRemainingMinor, CREDITS_CURRENCY) + " of credits (Estimate)"}. Rate-limit capacity: ${capacity}.`);
      sections.push(`## Rules of engagement\nFacts live in the database; query them through tools rather than guessing. Every external action or spend goes through the gateway and its policy. Hard gates (money movement, signing, filings in the founder's name, deletions, security settings) always become founder tasks. Label estimates and forecasts.`);
      let text = sections.join("\n\n");
      if (approxTokens(text) > BRIEF_TOKEN_BUDGET) text = text.slice(0, BRIEF_TOKEN_BUDGET * CHARS_PER_TOKEN - 1) + "…";

      return {
        businessId,
        businessName: business.name,
        businessMode: business.businessMode,
        archetype: business.archetype,
        currency,
        glossary: business.glossary,
        holidayActive: holiday !== null,
        departments,
        agents,
        chiefOfStaffId: chief?.id ?? null,
        openTasks,
        openTaskTotal: candidates.total,
        untaskedRoadmap,
        pendingApprovals,
        blockingInboxItems,
        agentsStopped,
        budgetRemainingMinor,
        modelBudgetRemainingMinor: monthlyBudget.remainingMinor,
        creditsCurrency: CREDITS_CURRENCY,
        maxAgents,
        capacity,
        text,
        approxTokens: approxTokens(text),
        builtAt: now.toISOString(),
      };
    },
  };
}

export type BriefActivities = ReturnType<typeof createBriefActivities>;

/** Tasks in order, identical ones (same title, kind and status) folded into the first with a count. */
export function foldDuplicates(tasks: readonly BriefTask[]): { task: BriefTask; count: number }[] {
  const byKey = new Map<string, { task: BriefTask; count: number }>();
  for (const t of tasks) {
    const key = `${t.status}|${t.kind}|${t.title.trim().toLowerCase()}`;
    const seen = byKey.get(key);
    if (seen) seen.count += 1;
    else byKey.set(key, { task: t, count: 1 });
  }
  return [...byKey.values()];
}
