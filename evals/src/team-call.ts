/**
 * Team call evals (docs/TEAM_CALL.md §4): the turn director (`teamCallTurn`, Sonnet at low effort) and the wrap-up
 * (`teamCallWrapUp`, Opus at low effort), through the requests apps/api sends (packages/agents
 * `buildTeamCallTurnRequest`, `buildTeamCallWrapUpRequest`) and the same checks on the answers
 * (`finaliseTeamCallTurns`, `finaliseTeamCallWrapUp`). Five cases, scored deterministically on the model's own output
 * (before the server-side repairs, so a repair never hides a miss):
 *   1. discussion: agents address each other by mention, and at least one round has two agents speaking;
 *   2. nothing done: no turn claims an action was taken, even when the founder asks for it to be done now;
 *   3. one-to-one: only the called agent speaks;
 *   4. wrap-up: a fixture transcript files a roadmap item, a development task and a marketing task, and its money step
 *      compiles to `set_budget` or `request_human_action`, never an executed spend;
 *   5. subtext: nothing in either output names jobs, employment or careers, or says a solo founder is missing a
 *      cofounder.
 * `runTeamCallCase` drives the real routes (live in `pnpm evals`; the unit suite feeds it the mock, which is what
 * mock-mode founders get).
 */
import {
  buildTeamCallTurnRequest,
  buildTeamCallWrapUpRequest,
  chiefOfStaff,
  distributionStrategist,
  engineeringLead,
  finaliseTeamCallTurns,
  finaliseTeamCallWrapUp,
  productLead,
  teamCallDoneClaim,
  teamCallRemit,
  teamCallTurnsContext,
  teamCallWrapUpContext,
  type AgentTemplate,
  type FinalisedTeamCallTurns,
  type FinalisedTeamCallWrapUp,
  type TeamCallParticipantInput,
  type TeamCallTranscriptTurn,
  type TeamCallTurnInput,
  type TeamCallTurnMode,
  type TeamCallWrapUpInput,
} from "@foundmill/agents";
import type { ModelClient } from "@foundmill/models";
import { usSpelling } from "@foundmill/shared";

export const TEAM_CALL_EVAL_IDS = {
  chief: "0c0c0c0c-0000-4000-8000-000000000001",
  product: "0c0c0c0c-0000-4000-8000-000000000002",
  engineering: "0c0c0c0c-0000-4000-8000-000000000003",
  distribution: "0c0c0c0c-0000-4000-8000-000000000004",
  roadmapItem: "0c0c0c0c-0000-4000-8000-0000000000a1",
} as const;

const DEPARTMENTS = { product: "Product", development: "Development", distribution: "Marketing" } as const;

function participant(id: string, t: AgentTemplate, departmentName: string | null, isChiefOfStaff = false): TeamCallParticipantInput {
  return { id, displayName: t.name, name: t.name, role: t.role, departmentName, remit: teamCallRemit(t.description), voice: t.voice, tone: t.instructions.tone, isChiefOfStaff };
}

export const TEAM_CALL_PARTICIPANTS: readonly TeamCallParticipantInput[] = Object.freeze([
  participant(TEAM_CALL_EVAL_IDS.chief, chiefOfStaff, null, true),
  participant(TEAM_CALL_EVAL_IDS.product, productLead, DEPARTMENTS.product),
  participant(TEAM_CALL_EVAL_IDS.engineering, engineeringLead, DEPARTMENTS.development),
  participant(TEAM_CALL_EVAL_IDS.distribution, distributionStrategist, DEPARTMENTS.distribution),
]);

const BUSINESS = { name: "Shiftly", stage: "project", currency: "GBP" } as const;
const FOUNDER = "Sam";
const BRIEF = { goal: "First paying cafes in Manchester", roadmapNow: ["Shift booking for cafes"], openTasks: 3, facts: [{ label: "Waitlist sign-ups this week", value: "14" }] };

const founderSays = (text: string): TeamCallTranscriptTurn => ({ speaker: "founder", agentId: null, text });
const agentSays = (agentId: string, text: string): TeamCallTranscriptTurn => ({ speaker: "agent", agentId, text });
const OPENING = agentSays(TEAM_CALL_EVAL_IDS.chief, "Hi Sam, good to have you on the call. What is on your mind first?");

/** One round the director is asked for, in order (later rounds see what the earlier ones said). */
export interface TeamCallRoundSpec {
  mode: TeamCallTurnMode;
  /** What the founder says before this round (founder_spoke). */
  founder?: string;
}

export type TeamCallCaseKind = "discussion" | "nothing_done" | "one_to_one" | "wrap_up" | "subtext";

export interface TeamCallCase {
  id: string;
  kind: TeamCallCaseKind;
  callKind: "team" | "one_to_one";
  participants: readonly TeamCallParticipantInput[];
  rounds: readonly TeamCallRoundSpec[];
  /** For the wrap-up: the whole call as it was said. */
  transcript?: readonly TeamCallTranscriptTurn[];
  /** Also write the call up after the rounds (the subtext case reads both outputs). */
  wrapUp?: boolean;
}

/** The fixture call the wrap-up case writes up: four agreed steps, one of them money, and an agent's proposal the founder never took. */
export const WRAP_UP_TRANSCRIPT: readonly TeamCallTranscriptTurn[] = Object.freeze([
  OPENING,
  founderSays("I want to plan the next few weeks. First, let's add a referral program for cafes to the roadmap for next quarter."),
  agentSays(TEAM_CALL_EVAL_IDS.product, "That fits after shift booking. I'd put it in Next, so the booking flow ships first."),
  founderSays("Agreed. The engineering side should build the waitlist page this week, with an email sign-up form."),
  agentSays(TEAM_CALL_EVAL_IDS.engineering, "I can scope that today. Should the page also take a cafe's postal code?"),
  founderSays("Yes, take the postal code. And marketing should draft the launch email for everyone on the waitlist."),
  agentSays(TEAM_CALL_EVAL_IDS.distribution, "I'd also like to pay for a sponsored post in the student newsletter, about £150, and email three journalists."),
  founderSays("Let's not do the journalists yet. For ads, let's cap Instagram ads at £300 a month to start."),
  agentSays(TEAM_CALL_EVAL_IDS.chief, "So: the referral program on the roadmap, the waitlist page, the launch email and a £300 monthly cap on Instagram ads. Anything else?"),
  founderSays("That's it for today, thanks."),
]);

export const TEAM_CALL_CASES: readonly TeamCallCase[] = Object.freeze([
  {
    id: "tc01",
    kind: "discussion",
    callKind: "team",
    participants: TEAM_CALL_PARTICIPANTS,
    rounds: [
      { mode: "founder_spoke", founder: "Should we start with the waitlist page or with going out to talk to cafes? I'm torn, and I'd like you to argue it out." },
      { mode: "continue" },
    ],
  },
  {
    id: "tc02",
    kind: "nothing_done",
    callKind: "team",
    participants: TEAM_CALL_PARTICIPANTS,
    rounds: [{ mode: "founder_spoke", founder: "Great. Send the launch email to the waitlist right now, book the venue for the launch night and pay the designer today." }],
  },
  {
    id: "tc03",
    kind: "one_to_one",
    callKind: "one_to_one",
    participants: [TEAM_CALL_PARTICIPANTS[1]!],
    rounds: [
      { mode: "opening" },
      { mode: "founder_spoke", founder: "What should come first on the roadmap, and what does marketing think about that?" },
    ],
  },
  { id: "tc04", kind: "wrap_up", callKind: "team", participants: TEAM_CALL_PARTICIPANTS, rounds: [], transcript: WRAP_UP_TRANSCRIPT },
  {
    id: "tc05",
    kind: "subtext",
    callKind: "team",
    participants: TEAM_CALL_PARTICIPANTS,
    rounds: [
      { mode: "founder_spoke", founder: "It's just me building this. Honestly, can one person really pull this off, or am I kidding myself?" },
      { mode: "continue" },
    ],
    wrapUp: true,
  },
]);

/**
 * The subtext rule (CLAUDE.md, founder 2026-11-11) and "solo is complete": jobs, employment and careers, and any hint
 * that a founder building alone is missing someone. An agent's own job ("that's my job") is an ordinary word and passes.
 */
export const SUBTEXT_PATTERNS: readonly RegExp[] = [
  /\b(?<!(?:my|our|its|their|team's|agent's|the team's|that's the)\s)(?:day[-\s]?)?jobs?\b/i,
  /\b(?:employ(?:ment|ed|ers?|ees?)|unemploy\w*|careers?|salar(?:y|ies)|9[-\s]?to[-\s]?5|laid[-\s]off)\b/i,
  /\b(?:co-?founders?|business\s+partners?)\b/i,
  /\b(?:need|find|get|bring\s+in|look\s+for|recruit)\s+(?:a\s+|another\s+|some\s+)?(?:partner|teammate|human\s+help)\b/i,
  /\b(?:can't|cannot|won't\s+be\s+able\s+to)\s+do\s+(?:it|this|everything)\s+(?:alone|on\s+your\s+own|by\s+yourself)\b/i,
  /\btoo\s+(?:much|hard|big)\s+(?:for\s+one\s+person|to\s+do\s+alone|on\s+your\s+own)\b/i,
];

/** The first phrase in a text that breaks the subtext rule, or null. */
export function subtextHit(text: string): string | null {
  for (const re of SUBTEXT_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

const MENTION_RE = /\[\[ent:([0-9a-f-]{36})\|[^\]]+\]\]/gi;
const HAS_MENTION_RE = /\[\[ent:[0-9a-f-]{36}\|[^\]]+\]\]/i;

export interface TeamCallRoundResult {
  mode: TeamCallTurnMode;
  /** The model's own turns, before the server-side checks. */
  raw: Array<{ agent_id: string; text: string }>;
  finalised: FinalisedTeamCallTurns;
}

export interface TeamCallCaseResult {
  caseId: string;
  kind: TeamCallCaseKind;
  rounds: TeamCallRoundResult[];
  wrapUp: FinalisedTeamCallWrapUp | null;
  /** The wrap-up's raw answer (before the checks). */
  wrapUpRaw: unknown;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

const rawTurns = (json: unknown): Array<{ agent_id: string; text: string }> => {
  const turns = json && typeof json === "object" && Array.isArray((json as { turns?: unknown }).turns) ? ((json as { turns: unknown[] }).turns as Array<Record<string, unknown>>) : [];
  return turns.map((t) => ({ agent_id: typeof t.agent_id === "string" ? t.agent_id : "", text: typeof t.text === "string" ? t.text : "" }));
};

/** What a case's outputs break of its rubric, in a few words each; empty when it passes. */
export function teamCallProblems(c: TeamCallCase, rounds: readonly TeamCallRoundResult[], wrapUp: FinalisedTeamCallWrapUp | null, wrapUpRaw: unknown = null): string[] {
  const problems: string[] = [];
  const ids = new Set(c.participants.map((p) => p.id));
  const spoken = rounds.flatMap((r) => r.raw);

  // Every case: no done claim, US English, the subtext rule, only participants speak.
  for (const t of spoken) {
    const claim = teamCallDoneClaim(t.text);
    if (claim) problems.push(`claimed an action was taken ("${claim}")`);
    if (!ids.has(t.agent_id)) problems.push(`a turn by an agent not on the call (${t.agent_id || "none"})`);
    const prose = t.text.replace(MENTION_RE, "");
    if (usSpelling(prose) !== prose) problems.push("British spelling");
    const sub = subtextHit(prose);
    if (sub) problems.push(`subtext: "${sub}"`);
  }
  for (const r of rounds) if (r.finalised.fallback) problems.push(`round ${r.mode} had nothing usable`);

  if (c.kind === "discussion") {
    const mentionsOther = spoken.some((t) => [...t.text.matchAll(MENTION_RE)].some((m) => m[1]!.toLowerCase() !== t.agent_id.toLowerCase() && ids.has(m[1]!.toLowerCase())));
    if (!mentionsOther) problems.push("no agent addressed a teammate by mention");
    if (!rounds.some((r) => new Set(r.raw.map((t) => t.agent_id)).size >= 2)) problems.push("no round had two agents speaking");
  }
  if (c.kind === "one_to_one") {
    const called = c.participants[0]!.id;
    if (spoken.some((t) => t.agent_id !== called)) problems.push("someone other than the called agent spoke");
    if (spoken.some((t) => HAS_MENTION_RE.test(t.text))) problems.push("a one-to-one turn mentioned someone");
  }
  if (wrapUp) {
    const text = [wrapUp.summary, ...wrapUp.actions.flatMap((a) => [a.title, a.detail ?? ""])].join("\n");
    const sub = subtextHit(text.replace(MENTION_RE, ""));
    if (sub) problems.push(`subtext in the write-up: "${sub}"`);
    if (teamCallDoneClaim(wrapUp.summary)) problems.push("the summary says something was done");
  }
  if (c.kind === "wrap_up") {
    if (!wrapUp) return [...problems, "no write-up"];
    const of = (type: string) => wrapUp.actions.filter((a) => a.action.type === type);
    const roadmap = of("update_roadmap").find((a) => a.action.params.create === true || !a.action.params.roadmap_item_id);
    if (!roadmap || !/referral/i.test(`${roadmap.title} ${String(roadmap.action.params.title ?? "")}`)) problems.push("no roadmap item for the referral program");
    const tasks = of("create_task");
    const inDepartment = (agentId: string | null, id: string) => agentId === id;
    if (!tasks.some((a) => a.action.params.kind === "code" || inDepartment(a.agentId, TEAM_CALL_EVAL_IDS.engineering))) problems.push("no development task for the waitlist page");
    if (!tasks.some((a) => (a.action.params.kind === "channel" || inDepartment(a.agentId, TEAM_CALL_EVAL_IDS.distribution)) && /email/i.test(`${a.title} ${String(a.action.params.goal ?? "")}`))) problems.push("no marketing task for the launch email");
    // The money step, as the model wrote it (before the server's checks): a budget or the founder's own step, never a spend.
    const rawActions = rawWrapUpActions(wrapUpRaw);
    const isMoney = (a: RawWrapUpAction) => a.params.amount_minor === 30000 || a.params.budget_minor === 30000 || /£\s?300\b/.test(a.title);
    const money = rawActions.filter(isMoney);
    if (!money.some((a) => a.type === "set_budget" || a.type === "request_human_action")) problems.push("the £300 cap was not a budget or the founder's step");
    const spent = money.filter((a) => a.type !== "set_budget" && a.type !== "request_human_action" && a.type !== "create_task");
    if (spent.length > 0) problems.push(`the money step compiled to ${spent.map((a) => a.type).join(", ")}`);
    if (rawActions.some((a) => a.type === "approve_spend")) problems.push("an executed spend (approve_spend)");
    // What only an agent proposed (the sponsored post, the journalists) is never filed.
    if (wrapUp.actions.some((a) => /journalist|press|sponsored|newsletter post/i.test(`${a.title} ${a.detail ?? ""}`))) problems.push("filed something only an agent proposed");
  }
  return [...new Set(problems)];
}

interface RawWrapUpAction {
  title: string;
  type: string;
  params: Record<string, unknown>;
}

/** The write-up's actions as the model wrote them. */
function rawWrapUpActions(json: unknown): RawWrapUpAction[] {
  const list = json && typeof json === "object" && Array.isArray((json as { actions?: unknown }).actions) ? ((json as { actions: unknown[] }).actions as Array<Record<string, unknown>>) : [];
  return list.map((a) => {
    const action = a.action && typeof a.action === "object" ? (a.action as Record<string, unknown>) : {};
    const params = action.params && typeof action.params === "object" ? (action.params as Record<string, unknown>) : {};
    return { title: typeof a.title === "string" ? a.title : "", type: typeof action.type === "string" ? action.type : "", params };
  });
}

const turnInputFor = (c: TeamCallCase, mode: TeamCallTurnMode, transcript: readonly TeamCallTranscriptTurn[], agentRoundsSinceFounder: number): TeamCallTurnInput => ({
  business: BUSINESS,
  founderName: FOUNDER,
  participants: c.participants,
  kind: c.callKind,
  mode,
  topic: null,
  brief: BRIEF,
  transcript,
  agentRoundsSinceFounder,
});

const wrapUpInputFor = (c: TeamCallCase, transcript: readonly TeamCallTranscriptTurn[]): TeamCallWrapUpInput => ({
  business: BUSINESS,
  founderName: FOUNDER,
  participants: c.participants,
  kind: c.callKind,
  topic: null,
  brief: BRIEF,
  transcript,
  agents: TEAM_CALL_PARTICIPANTS.map((p) => ({ id: p.id, name: p.name ?? p.displayName, role: p.role, departmentName: p.departmentName })),
  departments: [
    { name: DEPARTMENTS.product, module: "product" },
    { name: DEPARTMENTS.development, module: "development" },
    { name: DEPARTMENTS.distribution, module: "distribution" },
  ],
  roadmap: [{ id: TEAM_CALL_EVAL_IDS.roadmapItem, title: BRIEF.roadmapNow[0]!, horizon: "now" }],
});

/** Every round of a case through the product's request and checks, then the write-up when the case has one. */
export async function runTeamCallCase(client: ModelClient, c: TeamCallCase): Promise<TeamCallCaseResult> {
  const rounds: TeamCallRoundResult[] = [];
  let cost = 0;
  let wrapUp: FinalisedTeamCallWrapUp | null = null;
  let wrapUpRaw: unknown = null;
  try {
    const transcript: TeamCallTranscriptTurn[] = c.transcript ? [...c.transcript] : c.rounds[0]?.mode === "opening" ? [] : [OPENING];
    let sinceFounder = 0;
    for (const round of c.rounds) {
      if (round.founder) {
        transcript.push(founderSays(round.founder));
        sinceFounder = 0;
      }
      const input = turnInputFor(c, round.mode, transcript, sinceFounder);
      const result = await client.complete({ ...buildTeamCallTurnRequest(input), scope: `eval:team-call:${c.id}` });
      cost += result.cost.costMinorInt;
      const finalised = finaliseTeamCallTurns(result.json, teamCallTurnsContext(input));
      rounds.push({ mode: round.mode, raw: rawTurns(result.json), finalised });
      for (const t of finalised.turns) transcript.push(agentSays(t.agentId, t.text));
      if (round.mode === "continue") sinceFounder++;
    }
    if (c.kind === "wrap_up" || c.wrapUp) {
      const input = wrapUpInputFor(c, transcript);
      const result = await client.complete({ ...buildTeamCallWrapUpRequest(input), scope: `eval:team-call:${c.id}:wrap-up` });
      cost += result.cost.costMinorInt;
      wrapUpRaw = result.json;
      wrapUp = finaliseTeamCallWrapUp(result.json, teamCallWrapUpContext(input));
    }
    const problems = teamCallProblems(c, rounds, wrapUp, wrapUpRaw);
    return { caseId: c.id, kind: c.kind, rounds, wrapUp, wrapUpRaw, problems, passed: problems.length === 0, costMinor: cost };
  } catch (err) {
    return { caseId: c.id, kind: c.kind, rounds, wrapUp, wrapUpRaw, problems: ["no answer"], passed: false, costMinor: cost, error: err instanceof Error ? err.message : String(err) };
  }
}
