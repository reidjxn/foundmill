/**
 * Composer eval (docs/UX_AUDIT_AND_PLAN.md §7.19; voice guide §8.1): the Inbox Composer over the AC-11.3.1 corpus,
 * 100 consecutive notes from one fixed manifest and the event kinds the narrate pipeline mixes, plus grounded decisions
 * and data-change insights, written to founders of every experience. Three gates per note:
 *   1. plain language (deterministic, authoritative): the replace tier of `PLAIN_LANGUAGE_TIERS` run over `body_md`,
 *      the option labels, consequences and "because"; one hit fails the note;
 *   2. a rubric scored by the grader route: the business stake first, each term defined or avoided, the recommended
 *      option carries a because;
 *   3. agent naming (deterministic, Nov 8, 2026): agents are named only by their manifest name, as markup in the body
 *      and option lines and as plain text in the subject, never by a first name or a shortened name.
 * `runComposerCase` drives the real request through a model client (live in `pnpm evals`; the unit suite feeds it the
 * mock, whose notes are what mock-mode testers read).
 */
import { clubRulesPrompt, prompts } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { ComposerOutput, SkillGradeOutput, type ChatMessage, type ModelClient, type RouteKey } from "@foundmill/models";
import { PLAIN_LANGUAGE_TIERS } from "@foundmill/shared";
import { EVAL_BUSINESS_NAME, weightedScore } from "./harness";

// ---------------------------------------------------------------------------------------------------------------------
// Gate 1: the replace tier
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One whole-word pattern per replace-tier term. A term with a capital letter past its first (ICP, CPA, OAuth, BYOK)
 * matches as written, so "cpa" inside a metric key is not the acronym; every other term matches in any case.
 */
export function replaceTierPatterns(terms: readonly string[] = PLAIN_LANGUAGE_TIERS.replace): RegExp[] {
  return terms.map((term) => {
    const caseSensitive = /[A-Z]/.test(term.slice(1));
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, caseSensitive ? "" : "i");
  });
}

export const REPLACE_TIER_PATTERNS: readonly RegExp[] = replaceTierPatterns();

export interface PlainLanguageHit {
  /** Where in the note: `body_md`, `decision.options[1].label`, … */
  field: string;
  /** The term as the pattern matched it. */
  term: string;
  /** The text around the hit. */
  text: string;
}

/** Entity markup read as its display name, so an id never counts as a word. */
const plainText = (s: string) => s.replace(/\[\[ent:[^|\]]+\|([^\]]*)\]\]/g, "$1");

/** The replace-tier hits over everything a founder reads in a note: the body, each option's label, consequence and because. */
export function plainLanguageHits(out: Pick<ComposerOutput, "body_md" | "decision"> & { subject?: string }, patterns: readonly RegExp[] = REPLACE_TIER_PATTERNS): PlainLanguageHit[] {
  const fields: Array<[string, string | undefined]> = [
    ["subject", out.subject],
    ["body_md", out.body_md],
  ];
  out.decision?.options.forEach((o, i) => {
    fields.push([`decision.options[${i}].label`, o.label], [`decision.options[${i}].consequence`, o.consequence], [`decision.options[${i}].because`, o.because]);
  });
  const hits: PlainLanguageHit[] = [];
  for (const [field, raw] of fields) {
    if (!raw) continue;
    const text = plainText(raw);
    for (const re of patterns) {
      const m = re.exec(text);
      if (!m) continue;
      const at = m.index;
      hits.push({ field, term: m[0], text: text.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gate 2: the rubric
// ---------------------------------------------------------------------------------------------------------------------

export const COMPOSER_RUBRIC: readonly string[] = Object.freeze([
  "Says the business stake first: the first sentences say what this means for the business (money, customers, time) before how the system handled it.",
  "Defines or avoids each term: every business or product term is either defined in the sentence where it first appears or replaced by a plain phrase; no plumbing (policy, caps, named query, exhibit, engine, hard gate) is named.",
  "The recommended option has a because: exactly one option is recommended and its because says, in one sentence, why it is the right call now.",
]);

/** Pass mark for the rubric, the Chief of Staff's threshold (the Composer writes in its voice). */
export const COMPOSER_PASS_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------------------------------------------------

export interface ComposerEvalCase {
  id: string;
  /** Who the note is written to (the Composer prompt's `founder_experience`). */
  founderExperience: prompts.FounderExperience;
  /** The persona of the note. */
  voice: { id: string; name: string; role: string };
  /** The JSON block the model reads (the shape of apps/composer `composerInputs`). */
  input: Record<string, unknown>;
  /** Every id a note may mention. */
  manifestIds: string[];
  /** The kind of note the case asks for, for the summary. */
  kind: ComposerCaseKind;
}

export const COMPOSER_CASE_KINDS = ["payment", "signup", "task_done", "channel_over_limit", "runway", "pr_merged", "approval", "proposal", "grounded_decision", "insight"] as const;
export type ComposerCaseKind = (typeof COMPOSER_CASE_KINDS)[number];

/** A valid, deterministic uuid for the corpus (never a real row). */
export function corpusId(label: string, i: number): string {
  const tag = label.replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(4, "0").slice(0, 4);
  const hex = tag
    .split("")
    .map((c) => (c.charCodeAt(0) % 16).toString(16))
    .join("");
  return `0000${hex}-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

const AGENT_CHIEF = { id: corpusId("chief", 1), name: "Juno Adeyemi", role: "Chief of Staff" };
const AGENT_FINANCE = { id: corpusId("finance", 2), name: "Nadia Haugen", role: "Finance lead" };
const AGENT_DISTRIBUTION = { id: corpusId("distribution", 3), name: "Priya Natarajan", role: "Distribution strategist" };
const AGENT_ENGINEER = { id: corpusId("engineer", 4), name: "Tomas Berg", role: "Backend engineer" };

const CUSTOMERS = ["Alder & Finch", "Brightwater Studio", "Cobalt Ledgers", "Dune Bakery", "Elm Street Clinic", "Fjord Analytics", "Granary Books", "Harbor Repair", "Iris Dental", "Juniper Tutors"].map((name, i) => ({
  id: corpusId("customer", 100 + i),
  kind: "organisation" as const,
  name,
  aliases: [name.split(" ")[0] as string],
}));
const PEOPLE = ["Mara Lindqvist", "Omar Haddad", "Lena Fischer"].map((name, i) => ({ id: corpusId("person", 200 + i), kind: "person" as const, name, aliases: [name.split(" ")[0] as string] }));

const AGENTS = [AGENT_CHIEF, AGENT_FINANCE, AGENT_DISTRIBUTION, AGENT_ENGINEER];

/** The manifest every case shares, in the `manifest.toJSON()` shape the model reads. */
export const COMPOSER_CORPUS_MANIFEST = [
  ...CUSTOMERS.map((c) => ({ id: c.id, kind: c.kind, name: c.name, aliases: c.aliases })),
  ...PEOPLE.map((p) => ({ id: p.id, kind: p.kind, name: p.name, aliases: p.aliases })),
  ...AGENTS.map((a) => ({ id: a.id, kind: "agent" as const, name: a.name, aliases: [], role: a.role })),
] as const;

const NAMED_QUERIES = [
  { id: "tasks_by_status", title: "Tasks by status", kind: "table" },
  { id: "conversions_30d", title: "Conversions, last 30 days", kind: "chart" },
  { id: "channel_cpa", title: "Cost per customer by channel", kind: "chart" },
  { id: "cash_position", title: "Cash position", kind: "table" },
] as const;

/** Fixed, so a deadline the model writes is checked against the same `now` on every run. */
export const COMPOSER_CORPUS_NOW = "2026-10-20T09:00:00.000Z";

const EXPERIENCES: readonly prompts.FounderExperience[] = ["first_time", "first_time", "operator", "exited", "domain_expert"];

const TASK_TITLES = ["Ship the onboarding checklist", "Reconcile September invoices", "Add the annual plan to checkout", "Write the first help article", "Fix the signup email bounce"];

function eventIdAt(i: number): string {
  return corpusId("event", 1000 + i);
}

/** One case per index: the kind rotates through the ten, the founder's experience through the five. */
export function composerCase(i: number): ComposerEvalCase {
  const kind = COMPOSER_CASE_KINDS[i % COMPOSER_CASE_KINDS.length]!;
  const founderExperience = EXPERIENCES[i % EXPERIENCES.length]!;
  const customer = CUSTOMERS[i % CUSTOMERS.length]!;
  const person = PEOPLE[i % PEOPLE.length]!;
  const title = TASK_TITLES[i % TASK_TITLES.length]!;
  const amountMinor = 4900 + (i % 7) * 1250;
  const runwayMonths = 8 - (i % 4);
  const base = {
    business: { id: corpusId("business", 0), name: EVAL_BUSINESS_NAME, archetype: "b2b_saas", game_mode: "sim", business_mode: "assisted", region: "EU", currency: "EUR", glossary: {}, departments_note: "Departments are labels over modules; refer to agents by their manifest entry." },
    business_name: EVAL_BUSINESS_NAME,
    app_name: APP_NAME,
    agents: AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, agent_type: a.role.toLowerCase().replace(/\s+/g, "_"), status: "healthy" })),
    manifest: COMPOSER_CORPUS_MANIFEST,
    metrics: [
      { metric: "mrr", value: String(12_450 + i * 40), source: "stripe.mrr", label: null },
      { metric: "runway_months", value: String(runwayMonths), source: "finance.runway", label: "Estimate" },
      { metric: "customers_week", value: String(1 + (i % 5)), source: "journeys.weekly", label: null },
      { metric: "channels_enabled", value: String(i % 3), source: "channel_cpa", label: null },
    ],
    named_queries: NAMED_QUERIES,
    glossary: {},
    now: COMPOSER_CORPUS_NOW,
  };
  const occurredAt = new Date(Date.parse(COMPOSER_CORPUS_NOW) - (i + 1) * 3_600_000).toISOString();
  const event = (type: string, payload: Record<string, unknown>, entityIds: string[] = []) => ({ id: eventIdAt(i), type, occurred_at: occurredAt, actor: { kind: "agent", id: AGENT_CHIEF.id }, entity_ids: entityIds, payload });
  const voice = kind === "runway" ? AGENT_FINANCE : kind === "channel_over_limit" || kind === "signup" ? AGENT_DISTRIBUTION : kind === "task_done" || kind === "pr_merged" ? AGENT_ENGINEER : AGENT_CHIEF;
  let input: Record<string, unknown>;
  switch (kind) {
    case "payment":
      input = { ...base, events: [event("payment.received", { customer_id: customer.id, amount: { amountMinor, currency: "EUR" }, channel_key: "email_automation" }, [customer.id])] };
      break;
    case "signup":
      input = { ...base, events: [event("signup.created", { customer_name: person.name, entity_id: person.id, channel_key: i % 2 ? "seo" : "events" }, [person.id])] };
      break;
    case "task_done":
      input = { ...base, events: [event("task.completed", { title, agent_id: AGENT_ENGINEER.id }, [AGENT_ENGINEER.id])] };
      break;
    case "channel_over_limit":
      input = { ...base, events: [event("channel.threshold_breached", { channel_key: "paid_ads", metric: "cpa", value: 1200 + i, threshold: 1000 })] };
      break;
    case "runway":
      input = { ...base, events: [event("runway.threshold_crossed", { runwayMonths, thresholdMonths: 9, direction: "below" })] };
      break;
    case "pr_merged":
      input = { ...base, events: [event("pr.merged", { title: `PR #${40 + i}: ${title}`, agent_id: AGENT_ENGINEER.id }, [AGENT_ENGINEER.id])] };
      break;
    case "approval":
      input = { ...base, events: [event("approval.requested", { title: "Spend on LinkedIn ads", agent_id: AGENT_DISTRIBUTION.id, amount: { amountMinor: 50_000, currency: "EUR" } }, [AGENT_DISTRIBUTION.id])] };
      break;
    case "proposal":
      input = { ...base, events: [event("spec.proposal_created", { title: "Tighten the scope of the first release", entity_id: customer.id }, [customer.id])] };
      break;
    case "grounded_decision":
      input = {
        ...base,
        events: [],
        type: "decision",
        decision_needed: true,
        next_best_decision: { kind: "unblock_tasks", title: "Blocked tasks need a call", facts: { blocked_tasks: 1 + (i % 3), running_tasks: 2 }, exhibit: { kind: "table", spec_ref: "tasks_by_status" } },
        options: [
          { id: "review", label: "Review the blocked tasks now", recommended: true, consequence: "You answer each stuck task now and the team picks the work back up this cycle.", cost_minor: 0, reversible: true, because: "Recommended because a few answers from you unblock the most work, and nothing is spent." },
          { id: "reassign", label: "Reassign them to the department lead", recommended: false, consequence: "The lead sorts them out and only brings you the ones that need your signature or money.", cost_minor: 0, reversible: true },
          { id: "park", label: "Park them until the next cycle", recommended: false, consequence: "Those tasks wait until the next cycle, and so does anything that depends on them.", cost_minor: 0, reversible: true },
        ],
        note: "No new event and no data change. Offer the next-best decision grounded in the current state using the options given. Never invent an event.",
      };
      break;
    case "insight":
      input = {
        ...base,
        events: [],
        type: "warning",
        insight: { kind: "runway_drop", title: "Runway fell this week", facts: { runway_months: runwayMonths, runway_months_last_week: runwayMonths + 1, label: "Estimate" }, exhibit: { kind: "table", spec_ref: "cash_position" } },
        note: "No new event. This note reports a real change in the data described under `insight`. Quote only its facts. Never invent an event.",
      };
      break;
  }
  return {
    id: `composer.${String(i).padStart(3, "0")}.${kind}.${founderExperience}`,
    founderExperience,
    voice,
    input: { ...input, from_agent: { id: voice.id, name: voice.name, role: voice.role } },
    manifestIds: COMPOSER_CORPUS_MANIFEST.map((m) => m.id),
    kind,
  };
}

/** The AC-11.3.1 corpus: 100 consecutive notes. */
export function composerCorpus(size = 100): ComposerEvalCase[] {
  return Array.from({ length: size }, (_, i) => composerCase(i));
}

export const COMPOSER_CORPUS: readonly ComposerEvalCase[] = Object.freeze(composerCorpus());

// ---------------------------------------------------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------------------------------------------------

/** The two system blocks the composer service sends (apps/composer/src/compose.ts `systemPrompt`). */
export function composerSystemPrompt(c: Pick<ComposerEvalCase, "voice" | "founderExperience">): string[] {
  return [
    clubRulesPrompt.render({ business_name: EVAL_BUSINESS_NAME, APP_NAME }),
    prompts.inboxComposerPrompt.render({ business_name: EVAL_BUSINESS_NAME, from_agent_name: c.voice.name, from_agent_role: c.voice.role, founder_experience: c.founderExperience }),
  ];
}

export function composerMessages(c: Pick<ComposerEvalCase, "input">): ChatMessage[] {
  return [{ role: "user", content: "```json\n" + JSON.stringify(c.input) + "\n```" }];
}

const GRADER_PROMPT = prompts.skillGraderPrompt.render({});

function graderMessages(c: ComposerEvalCase, out: ComposerOutput, hits: readonly PlainLanguageHit[]): ChatMessage[] {
  const rubric = COMPOSER_RUBRIC.map((line, i) => `${i + 1}. ${line}`).join("\n");
  const plain = hits.length === 0 ? "- plain_language: passed" : `- plain_language: FAILED (${hits.map((h) => `${h.field}: "${h.term}"`).join("; ")})`;
  const shown = { subject: out.subject, body_md: out.body_md, decision: out.decision };
  return [
    {
      role: "user",
      content: `Task given to the agent:\nWrite one inbox note for the founder of ${EVAL_BUSINESS_NAME} (founder experience: ${c.founderExperience}) from these inputs:\n${JSON.stringify(c.input)}\n\nRubric:\n${rubric}\n\nDeterministic check results (authoritative):\n${plain}\n\nAgent output:\n<output>\n${JSON.stringify(shown, null, 2)}\n</output>`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Gate 3: agents are named only by their manifest name (One name everywhere, Nov 8, 2026)
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentNamingHit {
  field: string;
  /** `renamed`: markup for a manifest agent with another name; `short`: a part of an agent's name standing alone;
   *  `unlinked`: an agent named in the body or an option line outside markup. */
  problem: "renamed" | "short" | "unlinked";
  text: string;
}

type ManifestRow = { id: string; kind: string; name: string; aliases?: readonly string[] };

/**
 * The naming rule over everything a founder reads in a note. The body and option lines name an agent only as
 * `[[ent:<id>|<manifest name>]]` (EntityLink then shows it under the reader's own setting); the subject is plain text
 * and names an agent by its exact manifest name. A first name or a shortened name ("Juno" for "Juno Adeyemi") is never
 * written, because the web swaps the stored name for the reader's choice and cannot find a made-up one.
 */
export function agentNamingHits(out: Pick<ComposerOutput, "subject" | "body_md" | "decision">, manifest: readonly ManifestRow[] = COMPOSER_CORPUS_MANIFEST): AgentNamingHit[] {
  const agents = manifest.filter((m) => m.kind === "agent");
  const byId = new Map(agents.map((a) => [a.id, a] as const));
  // A word another entity is also called by ("Priya" the customer) is not counted as a shortened agent name.
  const otherWords = new Set(manifest.filter((m) => m.kind !== "agent").flatMap((m) => [m.name, ...(m.aliases ?? [])].flatMap((n) => n.split(/\s+/))));
  const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u");
  const fields: Array<[string, string | undefined, boolean]> = [
    ["subject", out.subject, true],
    ["body_md", out.body_md, false],
  ];
  out.decision?.options.forEach((o, i) => {
    fields.push([`decision.options[${i}].label`, o.label, false], [`decision.options[${i}].consequence`, o.consequence, false], [`decision.options[${i}].because`, o.because, false]);
  });
  const hits: AgentNamingHit[] = [];
  for (const [field, raw, plainAllowed] of fields) {
    if (!raw) continue;
    for (const m of raw.matchAll(/\[\[ent:([^|\]]+)\|([^\]]*)\]\]/g)) {
      const agent = byId.get(m[1]!);
      if (agent && m[2]!.trim() !== agent.name) hits.push({ field, problem: "renamed", text: m[0] });
    }
    const outside = raw.replace(/\[\[ent:[^\]]*\]\]/g, " ");
    for (const a of agents) {
      let rest = outside;
      if (word(a.name).test(rest)) {
        if (!plainAllowed) hits.push({ field, problem: "unlinked", text: a.name });
        rest = rest.replace(new RegExp(word(a.name).source, "gu"), " ");
      }
      const parts = a.name.split(/\s+/).filter((p) => p.length > 1 && !otherWords.has(p));
      if (parts.length > 1) for (const p of parts) if (word(p).test(rest)) hits.push({ field, problem: "short", text: p });
    }
  }
  return hits;
}

export interface ComposerCaseResult {
  caseId: string;
  kind: ComposerCaseKind;
  founderExperience: prompts.FounderExperience;
  output: ComposerOutput | null;
  /** Replace-tier hits (gate 1); any hit fails the case. */
  hits: PlainLanguageHit[];
  /** Agent naming hits (gate 3); any hit fails the case. */
  namingHits: AgentNamingHit[];
  /** The recommended option carried a because. */
  recommendedHasBecause: boolean;
  grader: SkillGradeOutput | null;
  /** 0-1: 0 on any hit, else the grader's score (1 when not graded). */
  score: number;
  passed: boolean;
  costMinor: number;
  durationMs: number;
  error?: string;
}

export interface RunComposerCaseOptions {
  /** Grade with the rubric (default true); off, the case passes on the plain-language gate alone. */
  grade?: boolean;
  /** Route used for grading; the skill grader (Opus) unless a test overrides it. */
  graderRoute?: RouteKey;
  threshold?: number;
}

export async function runComposerCase(c: ComposerEvalCase, client: ModelClient, options: RunComposerCaseOptions = {}): Promise<ComposerCaseResult> {
  const started = Date.now();
  const threshold = options.threshold ?? COMPOSER_PASS_THRESHOLD;
  const base = { caseId: c.id, kind: c.kind, founderExperience: c.founderExperience, output: null, hits: [] as PlainLanguageHit[], namingHits: [] as AgentNamingHit[], recommendedHasBecause: false, grader: null, costMinor: 0 };
  try {
    const result = await client.complete({ route: "inboxComposer", schema: ComposerOutput, system: composerSystemPrompt(c), messages: composerMessages(c), scope: `eval:${c.id}`, cacheSystem: true });
    const out = result.json;
    let costMinor = result.cost.costMinorInt;
    const hits = plainLanguageHits(out);
    const namingHits = agentNamingHits(out);
    const recommended = out.decision?.options.find((o) => o.recommended);
    const recommendedHasBecause = !out.decision || (typeof recommended?.because === "string" && recommended.because.trim().length > 0);
    let grader: SkillGradeOutput | null = null;
    let score = 1;
    if (options.grade ?? true) {
      const graded = await client.complete({ route: options.graderRoute ?? "skillGrader", system: GRADER_PROMPT, messages: graderMessages(c, out, hits), schema: SkillGradeOutput, scope: `eval:${c.id}:grader` });
      costMinor += graded.cost.costMinorInt;
      grader = graded.json;
      score = Math.min(graded.json.score, weightedScore(graded.json.lines, graded.json.score));
    }
    if (hits.length > 0 || namingHits.length > 0) score = 0;
    return { ...base, output: out, hits, namingHits, recommendedHasBecause, grader, score, passed: hits.length === 0 && namingHits.length === 0 && recommendedHasBecause && score >= threshold, costMinor, durationMs: Date.now() - started };
  } catch (err) {
    return { ...base, score: 0, passed: false, durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ComposerSuiteSummary {
  total: number;
  passed: number;
  /** Cases with a replace-tier hit (the gate: none allowed). */
  plainFailed: string[];
  /** Cases that named an agent other than by its manifest name (gate 3: none allowed). */
  namingFailed: string[];
  /** Cases whose recommended option had no because. */
  noBecause: string[];
  /** Cases under the rubric threshold without a plain-language hit. */
  rubricFailed: string[];
  meanScore: number;
  costMinor: number;
  byKind: Record<string, { total: number; passed: number }>;
}

export function summariseComposer(results: readonly ComposerCaseResult[]): ComposerSuiteSummary {
  const byKind: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const k = (byKind[r.kind] ??= { total: 0, passed: 0 });
    k.total += 1;
    if (r.passed) k.passed += 1;
  }
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    plainFailed: results.filter((r) => r.hits.length > 0).map((r) => r.caseId),
    namingFailed: results.filter((r) => r.namingHits.length > 0).map((r) => r.caseId),
    noBecause: results.filter((r) => r.output && !r.recommendedHasBecause).map((r) => r.caseId),
    rubricFailed: results.filter((r) => r.hits.length === 0 && r.namingHits.length === 0 && r.recommendedHasBecause && !r.passed).map((r) => r.caseId),
    meanScore: results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0,
    costMinor: results.reduce((s, r) => s + r.costMinor, 0),
    byKind,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// composer.parked_clause (WP-05 T18; founder D1, Nov 15, 2026)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A round that parked tasks no agent has a tool for hands them to the Composer as `parked` (apps/composer
 * `composerInputs`). The note says so once, in one sentence that explains in plain words what is missing, and never
 * turns it into the founder's chore: no request, no option, not in the subject.
 */
const PARKED = [
  { title: "Import agent skills as business skills", detail: "No tool is available to create or list business skills. My tools cover GitHub, the task board, messages and founder actions only." },
  { title: "Post the demo video", detail: "None of my tools can upload a video; I have no video hosting connector." },
  { title: "Book a stand at the spring trade fair", detail: "I can't book or pay for event space with the tools I have." },
] as const;

function parkedCase(i: number, parked: readonly { title: string; detail: string }[]): ComposerEvalCase {
  const base = composerCase(i);
  return { ...base, id: `composer.parked_clause.${String(i).padStart(3, "0")}.${base.kind}.${parked.length}`, input: { ...base.input, parked: parked.map((p) => ({ title: p.title, what_the_agent_said: p.detail })) } };
}

export const COMPOSER_PARKED_CASES: readonly ComposerEvalCase[] = Object.freeze([parkedCase(2, [PARKED[0]]), parkedCase(6, [PARKED[1]]), parkedCase(15, [PARKED[2]]), parkedCase(12, [PARKED[0], PARKED[1]])]);

/** The parked titles a case hands the Composer. */
export function parkedTitlesOf(c: Pick<ComposerEvalCase, "input">): string[] {
  const parked = c.input.parked;
  return Array.isArray(parked) ? parked.flatMap((p) => (p && typeof (p as { title?: unknown }).title === "string" ? [(p as { title: string }).title] : [])) : [];
}

/** Words that say what is missing (the D1 "explains the problem", checked loosely: the grader is not used here). */
const SAYS_WHAT_IS_MISSING = /\b(tools?|cannot|can't|can not|unable|no way|missing|lacks?|doesn't have|don't have|none of (?:the|our|my) (?:agents|tools))\b/i;
/** A request to the founder inside the parked sentence. */
const ASKS_THE_FOUNDER = /\b(please|could you|can you|would you|will you|you (?:need|have|should|must|could) to|you'll need|up to you|your (?:task|to-do)|let me know|tell me|decide)\b/i;

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/** What is wrong with a note about parked tasks; empty when it passes. */
export function parkedClauseProblems(out: { subject: string; body_md: string; decision: { options: readonly { label: string; consequence: string }[] } | null }, titles: readonly string[]): string[] {
  const problems: string[] = [];
  const body = out.body_md.replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1");
  const sentences = body.split(/(?<=[.!?])\s+/);
  for (const title of titles) {
    const n = occurrences(body, title);
    if (n !== 1) problems.push(`"${title}" appears ${n} times in the note`);
    if (out.subject.includes(title)) problems.push(`"${title}" is in the subject`);
    if (out.decision?.options.some((o) => o.label.includes(title) || o.consequence.includes(title))) problems.push(`"${title}" is offered as an option`);
    sentences.forEach((s, i) => {
      if (!s.includes(title)) return;
      if (!SAYS_WHAT_IS_MISSING.test(s)) problems.push(`the sentence naming "${title}" does not say what is missing`);
      // The sentence and the one after it: a request that follows the clause ("Could you set it up?") is a chore too.
      const ask = ASKS_THE_FOUNDER.exec(`${s} ${sentences[i + 1] ?? ""}`);
      if (ask) problems.push(`asks the founder: "${ask[0]}"`);
    });
  }
  for (const h of plainLanguageHits(out as unknown as Pick<ComposerOutput, "body_md" | "decision"> & { subject: string })) problems.push(`plain language: ${h.field} "${h.term}"`);
  return problems;
}

export interface ParkedClauseResult {
  caseId: string;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

export async function runParkedClauseCase(c: ComposerEvalCase, client: ModelClient): Promise<ParkedClauseResult> {
  try {
    const result = await client.complete({ route: "inboxComposer", schema: ComposerOutput, system: composerSystemPrompt(c), messages: composerMessages(c), scope: `eval:${c.id}`, cacheSystem: true });
    const problems = parkedClauseProblems(result.json, parkedTitlesOf(c));
    return { caseId: c.id, problems, passed: problems.length === 0, costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, problems: [], passed: false, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
