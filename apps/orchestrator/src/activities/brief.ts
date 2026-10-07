/**
 * `loadBrief`: the ~4,000-token business brief rebuilt each cycle (BUILD §9.7) and prompt-cached for every agent call.
 * Facts come from the repositories; nothing is invented and every non-real number carries its label.
 */
import { LIMITS } from "@foundmill/config";
import { periodOf, repos } from "@foundmill/db";
import type { TaskStatus } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import type { BriefAgent, BriefDepartment, BriefTask, BusinessBrief } from "./types";

const OPEN_STATUSES: TaskStatus[] = ["planned", "ready", "running", "paused", "blocked", "review", "merging"];
const BRIEF_TOKEN_BUDGET = 4_000;
const CHARS_PER_TOKEN = 4;

export const approxTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
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
      const [business, departmentsRaw, agentsPage, tasksPage, pendingApprovals, blockingInboxItems, holiday, chief] = await Promise.all([
        repos.businesses.get(db, businessId),
        repos.departments.list(db, businessId),
        repos.agents.list(db, businessId, { limit: 200 }),
        repos.tasks.list(db, businessId, { status: OPEN_STATUSES, limit: 200 }),
        repos.approvals.countPending(db, businessId),
        repos.inbox.countBlocking(db, businessId),
        repos.holidays.current(db, businessId),
        repos.agents.chiefOfStaff(db, businessId),
      ]);
      const currency = (await repos.channels.enabledBudget(db, businessId)).currencies[0] ?? "EUR";
      const edges = await repos.tasks.listEdges(db, businessId, tasksPage.items.map((t) => t.id));
      const openIds = new Set(tasksPage.items.map((t) => t.id));
      const dependsOn = new Map<string, string[]>();
      for (const e of edges) {
        const list = dependsOn.get(e.toTask) ?? [];
        list.push(e.fromTask);
        dependsOn.set(e.toTask, list);
      }

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
      }));
      const openTasks: BriefTask[] = tasksPage.items.map((t) => {
        const deps = dependsOn.get(t.id) ?? [];
        return {
          id: t.id,
          title: t.title,
          kind: t.kind,
          status: t.status,
          departmentId: t.departmentId,
          assigneeAgentId: t.assigneeAgentId,
          priority: t.priority,
          fileScope: t.fileScope,
          dependsOn: deps,
          budgetMinor: t.budgetMinor === null ? null : Number(t.budgetMinor),
          // A dependency still open (in this list) blocks dispatch; done dependencies are no longer listed.
          blocked: deps.some((d) => openIds.has(d)),
        };
      });

      let budgetRemainingMinor: number | null = null;
      try {
        const credits = await repos.usage.creditBalance(db, businessId, periodOf(now));
        if (credits) budgetRemainingMinor = Number(credits.balanceMinor);
      } catch (err) {
        deps.log.debug({ err: (err as Error).message }, "credit balance unavailable");
      }

      const maxAgents = business.planTier === "scale" ? LIMITS.hardMaxConcurrentAgents : LIMITS.defaultMaxConcurrentAgents;
      const capacity = deps.models.mode === "mock" ? "mock models: unlimited" : "requests 50/min, input 80k tok/min, output 16k tok/min (Estimate until headers are read)";

      // ---- prose brief (≈ 4k tokens) ------------------------------------------------------------------------------
      const sections: string[] = [];
      sections.push(`# ${business.name}\nMode: ${business.businessMode}${holiday ? " (founder on holiday; Chief of Staff decides within authority)" : ""}. Archetype: ${business.archetype ?? "not committed"}. Game mode: ${business.gameMode}. Plan tier: ${business.planTier}. Currency: ${currency}.`);
      if (Object.keys(business.glossary).length) sections.push(`## Glossary\n${Object.entries(business.glossary).map(([k, v]) => `- say "${v}" for "${k}"`).join("\n")}`);
      sections.push(`## Departments\n${fit(departments.map((d) => `- ${d.name} (${d.id}): modules ${d.moduleKeys.join(", ") || "none"}; lead ${d.leadAgentId ?? "none"}; budget ${d.budgetMinor === null ? "unset" : formatMinor(d.budgetMinor, currency) + " (Estimate)"}`), 400).join("\n")}`);
      sections.push(`## Squad (${agents.length})\n${fit(agents.map((a) => `- ${a.name} — ${a.role || a.agentType} [${a.layer}, ${a.modelKey}, ${a.status}] id ${a.id}`), 900).join("\n")}`);
      const taskLines = [...openTasks]
        .sort((a, b) => b.priority - a.priority)
        .map((t) => `- [${t.status}] ${t.title} (${t.kind}, id ${t.id}${t.assigneeAgentId ? `, assignee ${t.assigneeAgentId}` : ""}${t.departmentId ? `, dept ${t.departmentId}` : ""}${t.blocked ? ", blocked by dependencies" : ""}${t.fileScope.length ? `, files ${t.fileScope.slice(0, 3).join(" ")}` : ""})`);
      sections.push(`## Open tasks (${openTasks.length})\n${fit(taskLines, 1600).join("\n") || "- none"}`);
      sections.push(`## Governance\nApprovals waiting: ${pendingApprovals}. Inbox items blocking Continue: ${blockingInboxItems}. Concurrency limit: ${maxAgents} agents. Budget remaining this period: ${budgetRemainingMinor === null ? "not capped" : formatMinor(budgetRemainingMinor, currency) + " (Estimate)"}. Rate-limit capacity: ${capacity}.`);
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
        pendingApprovals,
        blockingInboxItems,
        budgetRemainingMinor,
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
