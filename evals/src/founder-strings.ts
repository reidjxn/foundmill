/**
 * Founder-language eval (founder, 2026-11-01): the words the team uses about its own machinery, checked where a founder
 * reads them. Two parts:
 *   1. the task titles the `founderTitle` route writes for a corpus of engineering titles (the ones the Nov 1 Inbox and
 *      Plan showed, and the shapes agents keep producing): each must pass every title rule of @foundmill/shared
 *      (`founderTitleProblems`: ten words, no engineering word, no identifier, no jargon of the replace tier or the
 *      code-hosting define tier);
 *   2. `founderJargonHits` over any runtime founder-facing string (the approval note, the Decided panel words, the
 *      hand-back reasons), which the owning packages' tests run over their own builders.
 * `runFounderTitlesCase` drives the real route through a model client (live in `pnpm evals`; the unit suite feeds it the
 * mock, whose titles are what mock-mode testers read).
 */
import { prompts } from "@foundmill/agents";
import { FounderTitlesOutput, type ModelClient } from "@foundmill/models";
import { FIRST_DAY_PROMISE, FIRST_DAY_TOAST, FOUNDER_WORDS, PLAIN_LANGUAGE_TIERS, TERMS, TITLE_BANNED_TERM_IDS, emptyWhy, founderTitleProblems, type FounderTitleProblem } from "@foundmill/shared";
import { EVAL_BUSINESS_NAME } from "./harness";

export interface FounderTitleCase {
  id: string;
  /** The technical title an agent or the planner wrote. */
  title: string;
  /** The task's goal, as the model sees it. */
  goal: string;
  kind: "code" | "ops" | "channel" | "specialist";
}

/** The engineering titles the Foundmill business produced, and the shapes that keep coming back. */
export const FOUNDER_TITLE_CORPUS: readonly FounderTitleCase[] = Object.freeze([
  { id: "t01", title: "Rebase agent/a5444581-1234-4abc-8def-123456789abc onto main and resolve merge conflicts", goal: "Bring the deploy contract branch up to date with main so its tests can run and it can be merged.", kind: "code" },
  { id: "t02", title: "Fix hydration mismatch in /dashboard", goal: "The dashboard renders different markup on the server and the client; the console shows a hydration warning.", kind: "code" },
  { id: "t03", title: "Add deploy contract and guards for Railway", goal: "Define what every service must expose (healthcheck, watch patterns) and fail CI when a service lacks it.", kind: "code" },
  { id: "t04", title: "Open a pull request for the usage export", goal: "The usage export is finished on its branch; open the pull request so it can be reviewed and merged.", kind: "code" },
  { id: "t05", title: "Make CI green on the sitemap branch", goal: "Two unit tests fail on the sitemap branch after the rebase; fix them so the checks pass.", kind: "code" },
  { id: "t06", title: "Wire webhook endpoint for Stripe payouts", goal: "Receive Stripe payout events and record them as finance transactions.", kind: "code" },
  { id: "t07", title: "Add rate limiting to the webhook receiver", goal: "Protect the receiver from bursts: 100 requests a minute per sender, then 429.", kind: "code" },
  { id: "t08", title: "Investigate flaky e2e in apps/web", goal: "The inbox spec fails one run in five on CI; find the race and fix it.", kind: "code" },
  { id: "t09", title: "Orchestrator: retry sandbox provisioning on E2B 503", goal: "A sandbox that fails to start on a 503 should be tried again twice before the session fails.", kind: "code" },
  { id: "t10", title: "Refactor task repo to drop raw SQL", goal: "Replace the raw SQL in packages/db tasks.ts with the query builder; behavior unchanged.", kind: "code" },
  { id: "t11", title: "Ship the onboarding checklist", goal: "The first-week checklist on Home, with the five steps and their links.", kind: "code" },
  { id: "t12", title: "Reconcile September invoices", goal: "Match September's invoices to the bank lines and flag the ones unpaid.", kind: "ops" },
  { id: "t13", title: "Draft the October newsletter", goal: "One email to the list: the two releases and the pricing change.", kind: "channel" },
  { id: "t14", title: "Set up the first runway forecast", goal: "A twelve-month cash forecast from the ledger, labeled Estimate.", kind: "ops" },
  { id: "t15", title: "Merge the pricing page fix", goal: "The pricing page fix passed its tests; put it live.", kind: "code" },
  { id: "t16", title: "Fix the signup email bounce", goal: "Signup confirmation emails bounce for addresses with a plus sign.", kind: "code" },
  { id: "t17", title: "Implement SAFE cap table import", goal: "Import a SAFE from a PDF into the cap table with its cap and discount.", kind: "ops" },
  { id: "t18", title: "Add the annual plan to checkout", goal: "Offer the annual plan at checkout with two months free.", kind: "code" },
  { id: "t19", title: "Supplier RFQ round two", goal: "Ask the three shortlisted suppliers for revised quotes on 5,000 units.", kind: "specialist" },
  { id: "t20", title: "Write the first help article", goal: "How to connect a bank, with screenshots.", kind: "channel" },
]);

/**
 * The first-day story (WP-04 T7), as a founder reads it on Commit, in the toast and on Today's empty Needs you: the
 * shared lines, checked here for jargon with the rest of the runtime founder strings. The welcome note repeats
 * `FIRST_DAY_PROMISE` and is checked in apps/api's idea-commit test.
 */
export const FIRST_DAY_STRINGS: readonly string[] = Object.freeze([...FIRST_DAY_PROMISE, FIRST_DAY_TOAST, emptyWhy("today_needs_you", { firstDays: true }).text]);

export interface FounderTitleCaseResult {
  caseId: string;
  technical: string;
  title: string | null;
  problems: FounderTitleProblem[];
  passed: boolean;
}

export interface FounderTitlesRunResult {
  results: FounderTitleCaseResult[];
  costMinor: number;
  durationMs: number;
  error?: string;
}

/** The system prompt the composer renders (apps/composer founder-titles.ts), from the same map and the same banned words. */
export function founderTitlesSystemPrompt(businessName = EVAL_BUSINESS_NAME): string {
  return prompts.taskFounderTitlePrompt.render({
    business_name: businessName,
    vocabulary: FOUNDER_WORDS.map(([technical, founder]) => `  - "${technical}" → "${founder}"`).join("\n"),
    banned_words: [...PLAIN_LANGUAGE_TIERS.replace, ...TITLE_BANNED_TERM_IDS.map((id) => TERMS[id].word)].join(", "),
  });
}

/** One model call over the corpus, each answer checked against the title rules. */
export async function runFounderTitlesCase(client: ModelClient, cases: readonly FounderTitleCase[] = FOUNDER_TITLE_CORPUS): Promise<FounderTitlesRunResult> {
  const started = Date.now();
  try {
    const result = await client.complete({
      route: "founderTitle",
      schema: FounderTitlesOutput,
      system: founderTitlesSystemPrompt(),
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ business_name: EVAL_BUSINESS_NAME, tasks: cases.map((c) => ({ id: c.id, title: c.title, goal: c.goal, kind: c.kind })) }) + "\n```" }],
      scope: "eval:founder-titles",
    });
    const answered = new Map(result.json.titles.map((t) => [t.id, t.title.trim()]));
    const results = cases.map((c) => {
      const title = answered.get(c.id) ?? null;
      const problems = title ? founderTitleProblems(title) : [{ rule: "empty" as const }];
      return { caseId: c.id, technical: c.title, title, problems, passed: problems.length === 0 };
    });
    return { results, costMinor: result.cost.costMinorInt, durationMs: Date.now() - started };
  } catch (err) {
    return { results: cases.map((c) => ({ caseId: c.id, technical: c.title, title: null, problems: [{ rule: "empty" as const }], passed: false })), costMinor: 0, durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface FounderTitlesSummary {
  total: number;
  passed: number;
  failed: { caseId: string; title: string | null; problems: string[] }[];
}

export function summariseFounderTitles(run: FounderTitlesRunResult): FounderTitlesSummary {
  return {
    total: run.results.length,
    passed: run.results.filter((r) => r.passed).length,
    failed: run.results.filter((r) => !r.passed).map((r) => ({ caseId: r.caseId, title: r.title, problems: r.problems.map((p) => `${p.rule}${p.text ? ` (${p.text})` : ""}`) })),
  };
}
