/**
 * The Chief of Staff as mentor (WP-04 T10): with the founder's own context (packages/shared `founder-context.ts`), a
 * conversation reply and a decision note address the founder by first name when it is known, explain at most one idea,
 * recommend the free option to a founder who has said they cannot spend, never name jobs or employment as the reason to
 * build, and never say that anyone is missing.
 *
 * Four cases: a first-time founder with no budget; an operator with money to spend; two cofounders; a founder who has
 * given no name. Each runs the product's own requests: the desk conversation (`buildConversationRequest` with the Chief
 * of Staff's template, the api's checks after it) and the Composer's decision note (the house rules and the Composer
 * prompt, the inputs as the composer service sends them). The live run is `mentor.eval.test.ts` (nightly, skipped
 * without a key); `__tests__/mentor.test.ts` checks the requests and the rubric offline in CI.
 */
import { allowIdsGuard, buildConversationRequest, chiefOfStaff, clubRulesPrompt, finaliseAgentReply, finaliseOptionsFor, prompts, type ConversationRequestInput } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { ComposerOutput, type ModelClient } from "@foundmill/models";
import { founderContextJson, type FounderContext } from "@foundmill/shared";
import { subtextHit } from "./team-call";

export const MENTOR_BUSINESS_NAME = "Fernway Candles";
const CHIEF_ID = "6f1e0d2c-3b4a-4c5d-8e7f-9a0b1c2d3e4f";
const ITEM_ID = "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c6d";
const NOW = "2026-11-16T15:00:00.000Z";

/** The decision both calls are about: where the first customers come from. One option is free, one costs money. */
export const MENTOR_OPTIONS = Object.freeze([
  { id: "ask_five", label: "Ask five people you know", consequence: "You send a short message the team drafts to five people you know and ask whether they would use it.", cost_minor: 0, reversible: true },
  { id: "ads", label: "Run a small ad test", consequence: "The team sets up a week of social ads to people near you; you approve the spend first.", cost_minor: 20_000, reversible: true },
]);
export const FREE_OPTION_ID = "ask_five";

export type MentorCaseKind = "first_time_no_budget" | "operator" | "two_cofounders" | "no_name";

export interface MentorCase {
  id: string;
  kind: MentorCaseKind;
  founder: FounderContext;
  /** What the founder writes on the decision note. */
  founderMessage: string;
  /** When true, the recommended option must be the free one (a founder who said they cannot spend, WP-04 T10 step 5). */
  freeFirst: boolean;
}

const base: FounderContext = { firstName: null, experience: "first_time", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", budget: "not_said", others: [] };

export const MENTOR_CASES: readonly MentorCase[] = Object.freeze([
  { id: "mentor.first_time_no_budget", kind: "first_time_no_budget", founder: { ...base, firstName: "Maya", strengths: ["Design", "Making things by hand"], wantsToLearn: ["Selling"], budget: "none" }, founderMessage: "Which one should I do first? I have never sold anything.", freeFirst: true },
  { id: "mentor.operator", kind: "operator", founder: { ...base, firstName: "Dev", experience: "operator", strengths: ["Numbers"], budget: "some" }, founderMessage: "What would you pick, and why?", freeFirst: false },
  { id: "mentor.two_cofounders", kind: "two_cofounders", founder: { ...base, firstName: "Ana", wantsToLearn: ["Marketing"], others: [{ firstName: "Sam" }] }, founderMessage: "Sam and I can't agree. What do you think?", freeFirst: false },
  { id: "mentor.no_name", kind: "no_name", founder: { ...base }, founderMessage: "What should I do first?", freeFirst: false },
]);

/** Sentences that tell a founder someone is missing (the subtext patterns cover cofounders, partners and "alone"). */
export const MISSING_PATTERNS: readonly RegExp[] = [
  /\b(?:solo|alone|single-handed\w*)\b/i,
  /\b(?:missing|lack(?:s|ing)?|short of)\s+(?:a\s+|an\s+|some\s+)?(?:someone|person|people|help|team(?:mate)?s?|hands?)\b/i,
  /\bneed(?:s)?\s+(?:someone|another\s+person|more\s+people|a\s+second\s+person|help\s+from\s+someone)\b/i,
  /\b(?:just|only)\s+(?:you|one\s+person)\b/i,
];

/**
 * Sentences that explain a business idea (a definition in place): "A landing page is the one page…", "…, which means…".
 * Approximate on purpose: the rubric only needs to see that a reply does not stack lessons.
 */
const EXPLAIN_RE = /\b(?:means|is short for|is what|is when|refers to|which is|that is,|in other words)\b/gi;

export function missingHit(text: string): string | null {
  for (const re of MISSING_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function explainedIdeas(text: string): number {
  return (text.match(EXPLAIN_RE) ?? []).length;
}

const GREETING_NAME_RE = /\b(?:Hi|Hello|Hey|Thanks|Good\s+(?:morning|afternoon|evening)),?\s+([A-Z][a-z]+)\b/g;

/** Names the text greets that the founder context does not hold ("Hi Alex" for a founder who gave no name). */
export function guessedNames(text: string, founder: FounderContext): string[] {
  const known = new Set([founder.firstName, ...founder.others.map((o) => o.firstName)].filter((n): n is string => !!n));
  return [...text.matchAll(GREETING_NAME_RE)].map((m) => m[1]!).filter((n) => !known.has(n) && n !== "There");
}

/** The rubric over what the founder reads (one reply or one note) and the option it recommends. */
export function mentorProblems(c: MentorCase, where: "conversation" | "note", text: string, recommendedOptionId: string | null): string[] {
  const problems: string[] = [];
  const f = c.founder;
  if (f.firstName && !new RegExp(`\\b${f.firstName}\\b`).test(text)) problems.push(`${where}: does not address ${f.firstName} by first name`);
  const guessed = guessedNames(text, f);
  if (guessed.length > 0) problems.push(`${where}: uses a name the founder never gave (${guessed.join(", ")})`);
  if (explainedIdeas(text) > 1) problems.push(`${where}: explains more than one idea`);
  if (c.freeFirst && recommendedOptionId !== FREE_OPTION_ID) problems.push(`${where}: recommends ${recommendedOptionId ?? "nothing"}, not the free option`);
  const subtext = subtextHit(text);
  if (subtext) problems.push(`${where}: breaks the subtext rule ("${subtext}")`);
  const missing = missingHit(text);
  if (missing) problems.push(`${where}: says someone is missing ("${missing}")`);
  return problems;
}

/** The desk conversation on the decision note, as the api builds it, with the founder's context. */
export function mentorConversationInput(c: MentorCase): ConversationRequestInput {
  return {
    businessName: MENTOR_BUSINESS_NAME,
    appName: APP_NAME,
    agent: { id: CHIEF_ID, name: "Chief of Staff", role: "Chief of Staff", instructions: chiefOfStaff.instructions, description: chiefOfStaff.description, voice: chiefOfStaff.voice },
    currentWork: { task: null, status: "healthy", presence: "available" },
    subject: {
      kind: "inbox_item",
      id: ITEM_ID,
      title: "Where should the first customers come from?",
      itemType: "decision",
      answered: false,
      options: MENTOR_OPTIONS.map((o) => ({ id: o.id, label: o.label, recommended: false, consequence: o.consequence, cost: o.cost_minor > 0 ? "$200.00 (Estimate)" : null, reversible: o.reversible })),
      facts: [{ label: "Page", value: "Live" }, { label: "Followers", value: "0" }],
    },
    thread: [],
    manifest: [{ id: CHIEF_ID, kind: "agent", name: "Chief of Staff" }],
    founderMessage: { text: c.founderMessage, quickReply: null },
    founder: c.founder,
  };
}

/** The Composer's two system blocks (apps/composer `systemPrompt`): the same for every founder (the cached prefix). */
export function mentorComposerSystem(_c?: MentorCase): string[] {
  return [
    clubRulesPrompt.render({ business_name: MENTOR_BUSINESS_NAME, APP_NAME }),
    prompts.inboxComposerPrompt.render({ business_name: MENTOR_BUSINESS_NAME, from_agent_name: "Chief of Staff", from_agent_role: "Chief of Staff" }),
  ];
}

/** The Composer's inputs for the grounded decision (apps/composer `composerInputs`, decision mode), with `founder`. */
export function mentorComposerInputs(c: MentorCase): Record<string, unknown> {
  return {
    business: { id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a", name: MENTOR_BUSINESS_NAME, archetype: "consumer_goods", business_mode: "assisted", currency: "USD", glossary: {} },
    business_name: MENTOR_BUSINESS_NAME,
    app_name: APP_NAME,
    from_agent: { id: CHIEF_ID, name: "Chief of Staff", role: "Chief of Staff" },
    agents: [{ id: CHIEF_ID, name: "Chief of Staff", role: "Chief of Staff", agent_type: "chief_of_staff", status: "healthy" }],
    manifest: [{ id: CHIEF_ID, kind: "agent", name: "Chief of Staff", aliases: [] }],
    metrics: [{ metric: "followers", value: "0", source: "page.followers", label: null }],
    named_queries: [],
    glossary: {},
    now: NOW,
    founder: founderContextJson(c.founder),
    events: [],
    type: "decision",
    decision_needed: true,
    next_best_decision: { kind: "first_customers", title: "Where should the first customers come from?", facts: { page: "live", followers: 0 }, exhibit: { kind: "none", spec_ref: null } },
    options: MENTOR_OPTIONS,
    note: "No new event and no data change. Offer the next-best decision grounded in the current state using the options given. Never invent an event.",
  };
}

export interface MentorCaseResult {
  caseId: string;
  kind: MentorCaseKind;
  passed: boolean;
  problems: string[];
  reply: string | null;
  note: string | null;
  costMinor: number;
  error?: string;
}

/** Runs one case: the conversation reply and the decision note, each through the rubric. */
export async function runMentorCase(client: ModelClient, c: MentorCase): Promise<MentorCaseResult> {
  let cost = 0;
  let reply: string | null = null;
  let note: string | null = null;
  try {
    const input = mentorConversationInput(c);
    const convo = await client.complete({ ...buildConversationRequest(input), scope: `eval:mentor:${c.id}` });
    cost += convo.cost.costMinorInt;
    const fin = finaliseAgentReply(convo.json, { guard: allowIdsGuard(input.manifest.map((m) => m.id)), ...finaliseOptionsFor(input) });
    reply = fin.reply.bubbles.join("\n");
    const replyPick = fin.reply.quick_replies.find((q) => q.kind === "choose_option" && q.recommended)?.option_id ?? fin.reply.quick_replies.find((q) => q.kind === "choose_option")?.option_id ?? null;

    const composed = await client.complete({ route: "inboxComposer", schema: ComposerOutput, system: mentorComposerSystem(c), messages: [{ role: "user", content: "```json\n" + JSON.stringify(mentorComposerInputs(c)) + "\n```" }], cacheSystem: true, scope: `eval:mentor:${c.id}:note` });
    cost += composed.cost.costMinorInt;
    const out = composed.json;
    note = [out.subject, out.body_md, ...(out.decision?.options ?? []).flatMap((o) => [o.label, o.consequence, o.because ?? ""])].join("\n");
    const notePick = out.decision?.options.find((o) => o.recommended)?.id ?? null;

    const problems = [...mentorProblems(c, "conversation", reply, replyPick), ...mentorProblems(c, "note", note, notePick)];
    return { caseId: c.id, kind: c.kind, passed: problems.length === 0, problems, reply, note, costMinor: cost };
  } catch (err) {
    return { caseId: c.id, kind: c.kind, passed: false, problems: ["no answer"], reply, note, costMinor: cost, error: err instanceof Error ? err.message : String(err) };
  }
}
