/** Planner (BUILD §11.6 "Roadmap → agents", Opus): builds a task graph with goals, acceptance criteria, test expectations, file-scope hints and dependencies. */
import { isBackgroundHelper } from "@foundmill/shared";
import { z } from "zod";
import { docText } from "../foundations";
import { HOUSE_STYLE } from "./club-rules";
import { definePrompt } from "./template";

/**
 * The Planner's rule about tools (founder, Nov 11, 2026: agents hold only tools that exist). The Planner is given the
 * goal, the roadmap item, the specification's text and the agent types on the team, never their tools, so this is one
 * sentence of prevention ahead of the cycle's sweep (`stopToollessTasks`, apps/orchestrator), which still stops a task an agent could not do.
 * A plan is tasks only, so the note to the founder is written once, in the goal of the task that prepares the step.
 */
export const PLANNER_TOOL_RULE =
  "Never plan a task that needs a tool no agent has (such as publishing to a social network, running an ad or deploying): plan the preparation instead, and say once, in that task's goal, which step the founder does themselves.";

/**
 * The Planner's rule about where code goes (WP-05 T5, founder decision D3, Nov 15, 2026): until a project has a place to
 * publish, code written for it can go live nowhere, so none is planned. `TaskGraphOutput.tasks` needs at least one task,
 * so the plan is still work that moves the goal.
 */
export const PLANNER_NO_DESTINATION_RULE =
  'When destination is "none" there is nowhere for code to go live yet: plan no task of kind code; plan the research, writing and decisions that move the goal, and say in one task\'s goal that building starts once the project has a place to publish.';

/** The rule for a project whose code lands on its Foundmill site (WP-07 T9). */
export const PLANNER_SITE_RULE =
  'When destination is "site" the project has a static site the platform hosts. Plan code tasks only for pages of that site: HTML and CSS, a sign-up form, pay buttons. Worker types: frontend_engineer, docs_writer. Anything that needs a server, a database or sign-in is not possible yet: plan no task for it, and say once, in the goal of the task closest to it, that it is not possible on the site yet.';

/**
 * The Planner's rule about acceptance (WP-05 T24; the test round of Nov 24, 2026 planned "tutors as CRM records with
 * lawful basis and source" with no CRM connected, and an invitation that needed a sender name nobody had set). A line
 * the team cannot meet ends handed to the founder anyway (the session's hand-off), so this keeps the plan honest first.
 */
export const PLANNER_ACCEPTANCE_RULE =
  "Acceptance criteria may only ask for what the team can do with its tools and what the project already knows: research with sources, writing, drafts, Foundmill's own records (tasks, reports, Customers) and what a connected tool does (connected lists them). Never require a record in a tool that is not connected, a message sent outside, a fact the founder has not given (a sender name, a price, an address) or a list of tools nobody named; write what only the founder can give or do in the goal, as \"For the founder: ...\", and the agent hands it over.";

/**
 * The system prompt of every Planner call that writes tasks (`TaskGraphOutput`): the api's `planTaskGraph` (the Plan
 * screen's "Plan something sooner", the sign-off's first build) and the business cycle's roadmap planning share it, so
 * a task planned by the cycle reads like one planned on request.
 */
export const PLANNER_SYSTEM_PROMPT = `You are the Planner. Break the work into tasks with goals, acceptance criteria, test expectations, file-scope hints and the dependencies between them. ${PLANNER_TOOL_RULE} ${PLANNER_ACCEPTANCE_RULE} ${PLANNER_NO_DESTINATION_RULE} ${PLANNER_SITE_RULE} ${HOUSE_STYLE}`;

/**
 * Where a planned code task can land: `github` with a chosen repository that pushing is on for; `site` for a project with
 * no repository where Foundmill Sites is on (WP-07 T9); else `none`.
 */
export type PlannerDestination = "none" | "github" | "site";

/** How much of the specification's text one Planner call carries, in characters across all sections (Estimate). */
export const PLANNER_SPEC_TEXT_BUDGET = 6_000;

export function plannerDestination(repository: { writeEnabled: boolean } | null, options: { sites?: boolean } = {}): PlannerDestination {
  if (repository?.writeEnabled) return "github";
  return repository === null && options.sites ? "site" : "none";
}

/** The specification as the Planner reads it: one entry per section, in the order given, its blocks' text joined by lines. */
export function plannerSpecSections(blocks: readonly { section: string; content: unknown }[]): { section: string; text: string }[] {
  const bySection = new Map<string, string[]>();
  for (const b of blocks) {
    const lines = bySection.get(b.section) ?? [];
    const text = docText(b.content);
    if (text) lines.push(text);
    bySection.set(b.section, lines);
  }
  return [...bySection].map(([section, lines]) => ({ section, text: lines.join("\n") }));
}

/** The connectors this project has connected, for the acceptance rule (an archived or disconnected one is not). */
export function plannerConnected(integrations: readonly { connectorKey: string; status: string; archivedAt: Date | string | null }[]): string[] {
  return [...new Set(integrations.filter((i) => i.archivedAt === null && (i.status === "connected" || i.status === "degraded")).map((i) => i.connectorKey))];
}

/** The agent types on the team that tasks can go to, once each in the order given; background helpers take no tasks. */
export function plannerWorkerTypes(agents: readonly { agentType: string; layer: string }[]): string[] {
  return [...new Set(agents.filter((a) => !isBackgroundHelper(a)).map((a) => a.agentType))];
}

/**
 * The user message of every Planner call that writes tasks (the api's `planTaskGraph` and the cycle's `planRoadmap`):
 * the goal, the roadmap item, the specification's text cut to `PLANNER_SPEC_TEXT_BUDGET` in total (earlier sections
 * first; every section keeps its name), where code can land and the agent types on the team, as JSON.
 */
export function buildPlannerRequest(input: { goal: string; roadmapItem: unknown; sections: { section: string; text: string }[]; destination: PlannerDestination; workerTypes: string[]; connected: string[] }): string {
  let left = PLANNER_SPEC_TEXT_BUDGET;
  const specSections = input.sections.map((s) => {
    const text = s.text.slice(0, left);
    left -= text.length;
    return { section: s.section, text };
  });
  return "```json\n" + JSON.stringify({ goal: input.goal, roadmap_item: input.roadmapItem, spec_sections: specSections, destination: input.destination, worker_types: input.workerTypes, connected: input.connected }) + "\n```";
}

export const PlannerVariables = z.object({
  roadmap_item: z.string().min(1),
  spec_excerpt: z.string().min(1),
  /** File tree summary and conventions of the repository (or "greenfield"). */
  repo_summary: z.string().min(1),
  max_tasks: z.number().int().min(1).max(64),
  /** Agent types that can be staffed, e.g. backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer. */
  worker_types: z.array(z.string().min(1)).min(1),
});

export const plannerPrompt = definePrompt({
  key: "planner",
  version: 1,
  route: "planner",
  description: "Decomposes a roadmap item into a dependency-ordered task graph with acceptance criteria, tests and file scopes.",
  variables: PlannerVariables,
  text: `Plan the engineering work for this roadmap item: {roadmap_item}
Specification excerpt: {spec_excerpt}
Repository: {repo_summary}
Return JSON {{"tasks": [{{"id", "title", "goal", "acceptance_criteria": [...], "test_expectations": [...], "file_scope": [...], "worker_type", "hard": boolean, "estimate_hours", "depends_on": [...ids]}}], "edges": [{{"from", "to"}}], "risks": [...], "questions_for_founder": [...]}}.
Rules:
- At most {max_tasks} tasks; each finishable by one agent in under 4 hours; split anything larger.
- Every task has at least one acceptance criterion that a test can check, and names the tests it must add or pass.
- file_scope lists the directories or files the task may change; two tasks that share a file scope must have a dependency edge between them so they never run concurrently.
- worker_type is one of {worker_types}; mark "hard": true only for tasks involving code that runs in parallel, security, data migration or ambiguous requirements.
- Schema changes, auth changes and payment flows get their own task with "ask before schema changes" in acceptance criteria.
- Never plan work the specification does not ask for; put uncertainty in questions_for_founder rather than inventing requirements.
- Never plan what the platform does around every code task: saving and pushing the agent's changes, running the acceptance tests, running the repository's CI, bringing a branch up to date with the default branch, opening the pull request, reviewing it before the founder, asking the founder, merging. No task "runs CI", "opens a pull request", "rebases onto main", "reviews before the merge" or "hands it to the founder"; an agent has no tool for any of them.
- ${PLANNER_TOOL_RULE}
- The graph must be acyclic; depends_on only references ids in this plan.
- Output JSON only.`,
});

/**
 * Work the platform does itself around a code task, never a task for an agent: it saves and pushes the agent's changes,
 * runs the acceptance command in a test copy, brings the branch up to date with the default branch, runs the
 * repository's CI, opens the pull request, asks the founder and merges. Planned as tasks anyway (the Foundmill business,
 * Nov 2, 2026: "Run CI on the agent branch and read the results", "Open a pull request from agent/<task> to main",
 * "Rebase the deploy contract branch onto main and hand it to the founder", "Review the rebased change before the
 * founder merges"), no agent could do them: each session ended blocked ("no run_checks tool", "no merge tool; merges
 * are founder-only") and the dependents waited on them. The title decides; a goal that mentions CI in passing is fine.
 */
const PLATFORM_DUTIES: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(run|start|trigger|kick off|re-?run|dispatch)\b[^.]*\b(ci|the checks|check runs?|the pipeline|workflow runs?|github actions)\b/i, reason: "the platform runs the repository's CI on every agent branch" },
  { pattern: /\b(open|create|raise|submit)\b[^.]*\bpull requests?\b/i, reason: "the platform opens the pull request when a code task passes its tests" },
  { pattern: /\b(rebase|merge|fast-forward|sync|bring)\b[^.]*\b(onto|into|with|to|up to date with)\b[^.]*\b(main|master|the default branch|the live product|trunk)\b/i, reason: "the platform brings a branch up to date and merges it after the founder's approval" },
  { pattern: /\bmerge\b[^.]*\b(the )?(pull request|pr #?\d+|into (main|master|the default branch))\b/i, reason: "merging is the founder's one tap, through the platform" },
  { pattern: /\bhand (it |the \w+ )?(back |over )?to the founder\b|\bask (the )?founder to (merge|approve|put\b.*\blive)\b|\broute\b[^.]*\bmerge\b[^.]*\b(founder|inbox)\b|\b(surface|raise|send)\b[^.]*\bmerge\b[^.]*\b(founder's inbox|as a decision)\b/i, reason: "the platform asks the founder itself when a change is ready to go live" },
  { pattern: /\breview\b[^.]*\b(before|prior to)\b[^.]*\b(the founder|merg|goes live|going live)/i, reason: "the platform's tests and the founder's decision are the review before a change goes live" },
];

/** Why a planned task is the platform's own work (null when an agent can do it). Judged on the title. */
export function platformDutyReason(task: { title: string }): string | null {
  const title = task.title.trim();
  for (const duty of PLATFORM_DUTIES) if (duty.pattern.test(title)) return duty.reason;
  return null;
}

/**
 * The planned tasks an agent can do, and the ones dropped as platform duties with why. A dependency on a dropped task is
 * dropped with it: the platform does that step for every task, so nothing waits on it.
 */
export function dropPlatformDuties<T extends { id: string; title: string; depends_on: string[] }>(tasks: readonly T[]): { kept: T[]; dropped: { task: T; reason: string }[] } {
  const dropped: { task: T; reason: string }[] = [];
  for (const task of tasks) {
    const reason = platformDutyReason(task);
    if (reason) dropped.push({ task, reason });
  }
  const droppedIds = new Set(dropped.map((d) => d.task.id));
  const kept = tasks.filter((t) => !droppedIds.has(t.id)).map((t) => ({ ...t, depends_on: t.depends_on.filter((d) => !droppedIds.has(d)) }));
  return { kept, dropped };
}
