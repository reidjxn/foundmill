/**
 * Mock Planner (BUILD §11.6 "Roadmap → agents"): builds a task graph (goal, acceptance criteria, test expectations,
 * file-scope hints, dependencies) from roadmap items or a goal.
 */
import type { TaskKind } from "@foundmill/shared";
import type { PlannedTask, TaskGraphOutput } from "../schemas";
import { type MockContext, isRecord, sentenceCase, truncate } from "./inputs";

interface RoadmapItemIn {
  id: string | null;
  title: string;
  description?: string;
}

const HARD = /\b(migration|payment|billing|auth|security|encryption|rls|cap table|webhook signature|rate limit|concurrency|yjs|crdt)\b/i;

const SCOPE_HINTS: Array<[RegExp, string[]]> = [
  [/\b(api|endpoint|trpc|router|procedure)\b/i, ["apps/api/src/routers/"]],
  [/\b(screen|page|ui|widget|dashboard|button|dialog|form|table|chart)\b/i, ["apps/web/app/", "packages/widgets/src/"]],
  [/\b(schema|migration|table|column|database|rls|repo)\b/i, ["packages/db/src/", "packages/db/migrations/"]],
  [/\b(connector|integration|stripe|sendgrid|github|shopify|webhook)\b/i, ["packages/connectors/src/", "apps/ingest/src/"]],
  [/\b(workflow|cycle|session|temporal|activity)\b/i, ["apps/orchestrator/src/"]],
  [/\b(inbox|composer|narrate|note)\b/i, ["apps/composer/src/"]],
  [/\b(policy|cedar|permission|gate)\b/i, ["packages/policy/"]],
  [/\b(event|outbox|stream)\b/i, ["packages/events/src/", "apps/stream/src/"]],
  [/\b(design|token|component|dugout)\b/i, ["packages/dugout/src/"]],
];

export function generatePlanner(ctx: MockContext): TaskGraphOutput {
  const items = readRoadmap(ctx);
  const goal = ctx.getString("goal", "objective", "epic");
  const sources: RoadmapItemIn[] = items.length > 0 ? items : [{ id: null, title: goal ?? firstLine(ctx.lastUser) ?? "Deliver the next roadmap step" }];
  const tasks: PlannedTask[] = [];
  const noDestination = ctx.getString("destination") === "none";

  sources.forEach((item, idx) => {
    const base = `${idx + 1}`;
    const text = `${item.title} ${item.description ?? ""}`;
    const kind = kindFor(text);
    const scope = scopeFor(text);
    const hard = HARD.test(text);
    const ui = /\b(screen|page|ui|widget|dashboard|button|dialog|form)\b/i.test(text);
    const hours = hard ? 6 : 3;

    const design: PlannedTask = {
      id: `t${base}.1`,
      title: truncate(`Define scope and what counts as done for ${item.title}`, 80),
      goal: `Turn "${item.title}" into a written scope that says what counts as done, with test expectations${item.description ? `: ${truncate(item.description, 160)}` : ""}.`,
      kind: "research",
      acceptance_criteria: [`A spec block for ${item.title} lists the user-visible behavior`, "What counts as done is testable and agreed by the lead", "Open questions are listed with owners"],
      test_expectations: ["No code; review by the department lead"],
      file_scope_hints: ["docs/", "spec blocks"],
      depends_on: [],
      estimate_hours: 1,
      hard: false,
      roadmap_item_id: item.id,
    };
    const implement: PlannedTask = {
      id: `t${base}.2`,
      title: truncate(`Implement ${item.title}`, 80),
      goal: `Build ${item.title} in a separate copy of the code until everything that counts as done passes.`,
      kind,
      acceptance_criteria: [`The behavior described for ${item.title} works end to end against the test connectors`, "Typecheck and lint pass", ui ? "The screen uses design-system components and tokens only" : "Data functions take businessId first, so one business never sees another's data"],
      test_expectations: ["Unit tests cover the new module and its edge cases", ui ? "A Playwright test exercises the screen" : "Contract tests run against fixtures"],
      file_scope_hints: scope,
      depends_on: [design.id],
      estimate_hours: hours,
      hard,
      roadmap_item_id: item.id,
    };
    const verify: PlannedTask = {
      id: `t${base}.3`,
      title: truncate(`Verify and review ${item.title}`, 80),
      goal: `Run the tests for what counts as done on ${item.title}, review the changes, and get them ready to add to the product.`,
      kind: "code",
      acceptance_criteria: ["Every test for what counts as done passes in the automated checks", "Review agent approves with no critical findings", "Changelog entry written"],
      test_expectations: ["Full test suite green", "Preview deployment reachable"],
      file_scope_hints: scope,
      depends_on: [implement.id],
      estimate_hours: 1,
      hard: false,
      roadmap_item_id: item.id,
    };
    if (noDestination) {
      // Nowhere for code to go live yet (WP-05 T5): no code task; the work that moves the goal, and building says when it starts.
      const kept = [implement, verify].filter((t) => t.kind !== "code");
      const writePlan: PlannedTask = {
        id: `t${base}.4`,
        title: truncate(`Write the build plan for ${item.title}`, 80),
        goal: `Write down, step by step, what building ${item.title} takes and what counts as done for each step. Building starts once the project has a place to publish.`,
        kind: "research",
        acceptance_criteria: [`A written plan for ${item.title} lists each step and what counts as done for it`],
        test_expectations: [],
        file_scope_hints: ["docs/", "spec blocks"],
        depends_on: [design.id],
        estimate_hours: 1,
        hard: false,
        roadmap_item_id: item.id,
      };
      tasks.push(design, ...kept.map((t) => ({ ...t, depends_on: [design.id] })), writePlan);
      return;
    }
    tasks.push(design, implement, verify);
  });

  // Serialise hard tasks behind each other so overlapping file scopes never run concurrently (AC-11.6.2 hint).
  const hardTasks = tasks.filter((t) => t.hard);
  for (let i = 1; i < hardTasks.length; i++) {
    const prev = hardTasks[i - 1] as PlannedTask;
    const cur = hardTasks[i] as PlannedTask;
    if (prev.file_scope_hints.some((h) => cur.file_scope_hints.includes(h)) && !cur.depends_on.includes(prev.id)) cur.depends_on.push(prev.id);
  }
  return { tasks };
}

function readRoadmap(ctx: MockContext): RoadmapItemIn[] {
  const raw = ctx.getArray<unknown>("roadmap_items", "roadmap", "items", "features");
  const out: RoadmapItemIn[] = [];
  raw.forEach((r, i) => {
    if (typeof r === "string") {
      out.push({ id: null, title: sentenceCase(r) });
      return;
    }
    if (!isRecord(r)) return;
    const title = typeof r.title === "string" ? r.title : typeof r.name === "string" ? r.name : undefined;
    if (!title) return;
    out.push({ id: typeof r.id === "string" ? r.id : `roadmap-${i + 1}`, title, description: typeof r.description === "string" ? r.description : undefined });
  });
  return out;
}

const firstLine = (s: string): string | undefined => s.split(/\n|\.\s/).map((l) => l.trim()).find(Boolean);

function kindFor(text: string): TaskKind {
  if (/\b(research|interview|survey|benchmark|compare)\b/i.test(text)) return "research";
  if (/\b(contract|legal|privacy|terms|gdpr)\b/i.test(text)) return "legal";
  if (/\b(runway|forecast|p&l|cash|invoice|pricing model)\b/i.test(text)) return "finance";
  if (/\b(supplier|sourcing|formulation|packaging|sample)\b/i.test(text)) return "specialist";
  if (/\b(campaign|ads|newsletter|seo|social|outreach)\b/i.test(text)) return "channel";
  return "code";
}

function scopeFor(text: string): string[] {
  const out = new Set<string>();
  for (const [re, hints] of SCOPE_HINTS) if (re.test(text)) hints.forEach((h) => out.add(h));
  if (out.size === 0) out.add("apps/web/app/");
  return [...out];
}
