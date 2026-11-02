/**
 * Founder titles for tasks (founder, 2026-11-01; `POST /v1/founder-titles`). The planner and the agents name tasks in
 * engineering terms; every founder-facing surface (the Plan, the department cards, the Inbox decision about putting a
 * change live) reads `tasks.founder_title` instead (0070). This asks the `founderTitle` route for a batch of tasks that
 * have none yet, checks every answer against the title rules of @foundmill/shared (`founderTitleProblems`: ten words,
 * no engineering word, no identifier) and stores what passes; an answer that fails falls back to the deterministic
 * rewrite when that passes, else the task keeps only its technical title and is asked about again next time.
 */
import { prompts } from "@foundmill/agents";
import { repos, type Db, type Task } from "@foundmill/db";
import { FounderTitlesOutput, type ModelClient, type ModelLogger } from "@foundmill/models";
import { FOUNDER_WORDS, PLAIN_LANGUAGE_TIERS, TERMS, TITLE_BANNED_TERM_IDS, founderTitleFallback, founderTitleProblems } from "@foundmill/shared";

/** Tasks titled in one model call; a plan is rarely larger, and a longer list is finished over the next cycles. */
export const FOUNDER_TITLES_BATCH = 40;
/** The statuses whose tasks a founder still meets; ended tasks keep what they had. */
const OPEN_STATUSES = ["planned", "ready", "running", "paused", "blocked", "review", "merging"] as const;

export interface FounderTitlesResult {
  /** Tasks whose founder title was written in this call. */
  written: { taskId: string; title: string; source: "model" | "fallback" }[];
  /** Tasks the model's answer failed the rules for and the rewrite could not title either. */
  skipped: { taskId: string; reason: string }[];
  costMinor: number;
}

/** The prompt's vocabulary block: one "technical → founder" line per map entry. */
export function vocabularyLines(): string {
  return FOUNDER_WORDS.map(([technical, founder]) => `  - "${technical}" → "${founder}"`).join("\n");
}

/** The words a title may never carry, for the prompt: the replace tier and the code-hosting define-tier words. */
export function bannedWordsLine(): string {
  return [...PLAIN_LANGUAGE_TIERS.replace, ...TITLE_BANNED_TERM_IDS.map((id) => TERMS[id].word)].join(", ");
}

/**
 * Titles the business's open tasks that have none (or exactly `taskIds`, when given, whatever their state): one model
 * call per batch, each answer checked and stored. Never throws for a task: a bad answer is a skip, so a founder waits for
 * a title, never for a cycle.
 */
export async function composeFounderTitles(deps: { db: Db; models: ModelClient; log: ModelLogger }, businessId: string, taskIds?: readonly string[]): Promise<FounderTitlesResult> {
  const business = await repos.businesses.get(deps.db, businessId);
  const candidates: Task[] = taskIds?.length
    ? await repos.tasks.byIds(deps.db, businessId, taskIds)
    : (await repos.tasks.list(deps.db, businessId, { status: [...OPEN_STATUSES], founderTitleMissing: true, limit: FOUNDER_TITLES_BATCH })).items;
  const out: FounderTitlesResult = { written: [], skipped: [], costMinor: 0 };
  if (candidates.length === 0) return out;

  const system = prompts.taskFounderTitlePrompt.render({ business_name: business.name, vocabulary: vocabularyLines(), banned_words: bannedWordsLine() });
  const input = { business_name: business.name, tasks: candidates.map((t) => ({ id: t.id, title: t.title, goal: t.goalMd.slice(0, 400), kind: t.kind })) };
  let answered = new Map<string, string>();
  try {
    const result = await deps.models.complete({
      route: "founderTitle",
      schema: FounderTitlesOutput,
      system,
      messages: [{ role: "user", content: "```json\n" + JSON.stringify(input) + "\n```" }],
      attribution: { businessId, kind: "founder_title" },
      scope: `composer:${businessId}`,
    });
    out.costMinor = result.cost.costMinorInt;
    if (!result.repaired) answered = new Map(result.json.titles.map((t) => [t.id, t.title.trim()]));
  } catch (err) {
    deps.log.warn({ businessId, tasks: candidates.length, err: (err as Error).message }, "founder titles: the model did not answer; the deterministic rewrite stands in");
  }

  for (const task of candidates) {
    const fromModel = answered.get(task.id);
    const problems = fromModel ? founderTitleProblems(fromModel) : null;
    const chosen = fromModel && problems && problems.length === 0 ? { title: fromModel, source: "model" as const } : titleFallback(task);
    if (!chosen) {
      out.skipped.push({ taskId: task.id, reason: problems?.length ? problems.map((p) => `${p.rule}${p.text ? ` (${p.text})` : ""}`).join(", ") : "no answer and no rewrite passed the rules" });
      continue;
    }
    if (chosen.title === task.founderTitle) continue;
    await repos.tasks.update(deps.db, businessId, task.id, { founderTitle: chosen.title });
    out.written.push({ taskId: task.id, ...chosen });
  }
  if (out.skipped.length) deps.log.info({ businessId, skipped: out.skipped }, "founder titles: some tasks keep their technical title for now");
  return out;
}

/** The deterministic rewrite of the title, then of the goal's first sentence, when either passes the rules. */
export function titleFallback(task: Pick<Task, "title" | "goalMd">): { title: string; source: "fallback" } | null {
  const fromTitle = founderTitleFallback(task.title);
  if (fromTitle) return { title: fromTitle, source: "fallback" };
  const firstSentence = task.goalMd.split(/(?<=[.!?])\s|\n/)[0] ?? "";
  const fromGoal = firstSentence ? founderTitleFallback(firstSentence) : null;
  return fromGoal ? { title: fromGoal, source: "fallback" } : null;
}
