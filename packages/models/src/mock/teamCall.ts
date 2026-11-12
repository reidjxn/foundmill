/**
 * Mock Team call routes (docs/TEAM_CALL.md §4): `teamCallTurn` (the next spoken turns of a call) and `teamCallWrapUp`
 * (the call's summary and action items). Deterministic: the same input always gives the same answer. Both read the JSON
 * that packages/agents `buildTeamCallTurnRequest` / `buildTeamCallWrapUpRequest` send, and build every line from it
 * (the founder's own words, the participants' roles, departments and remits): never a canned business fact, and no
 * figure that is not in the founder's words.
 *
 * Turns. The most relevant participant answers first: by the keywords of what the founder just said against each
 * agent's role, department and remit (the Chief of Staff, or the called agent, first in an opening and when nothing
 * matches). On a team call a second agent builds on it, naming the first as `[[ent:<id>|Name]]`. An agent-only round
 * (`continue`) picks up from whoever spoke last. `hand_back` alternates by round (an opening always hands back, and the
 * last agent-only round before the limit does too), and a turn that hands back ends with a question to the founder.
 *
 * Wrap-up. The plan compiler's rule engine (`compilePlanRuleBased`) reads each founder line and the actions it finds are
 * kept (a clarifying question is not an action item); a line that names the roadmap becomes a roadmap item. The
 * summary lists what the founder raised.
 *
 * Inputs (trusted JSON): `founder_name`, `kind`, `mode`, `topic`, `round`, `agent_rounds_since_founder`,
 * `participants[{ id, name, display_name, role, department, remit, talks_like, is_chief_of_staff }]`, `founder_lines[{ n,
 * text }]`, `founder_just_said`; the wrap-up adds `agents`, `roadmap` and `business.currency`. The agents' own turns
 * arrive in an untrusted block as `call_transcript[{ n, agent_id, text }]`: only who spoke last is read from it.
 */
import { CHANNEL_KEYS, CHANNEL_META, TEAM_CALL_LIMITS, type ChannelKey, type PlanActionType, type TaskKind } from "@foundmill/shared";
import { uuidFromSeed } from "../hash";
import type { PlanAction } from "../schemas";
import type { TeamCallTurnOutput, TeamCallTurnsOutput, TeamCallWrapUpAction, TeamCallWrapUpOutput } from "../team-call-schema";
import { type MockContext, agentsFrom, formatMoneyMinor, isRecord, keywords, sentenceCase, truncate } from "./inputs";
import { compilePlanRuleBased, detectHardGates } from "./planCompiler";

interface Participant {
  id: string;
  /** The name a mention carries. */
  name: string;
  role: string;
  area: string;
  remit: string;
  ack: string | null;
  isChief: boolean;
}

/** The line every round falls back to (also packages/agents `TEAM_CALL_FALLBACK_LINE`). */
export const MOCK_TEAM_CALL_FALLBACK = "Over to you: what would you like to look at first?";

const isChannelKey = (v: unknown): v is ChannelKey => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ent = (p: Participant): string => `[[ent:${p.id}|${p.name}]]`;

function participantsOf(ctx: MockContext): Participant[] {
  const out: Participant[] = [];
  for (const raw of ctx.getArray<Record<string, unknown>>("participants")) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id) || str(raw.agent_id);
    if (!id || out.some((p) => p.id === id)) continue;
    const name = str(raw.name) || str(raw.display_name) || "a teammate";
    const role = str(raw.role);
    const talks = isRecord(raw.talks_like) ? raw.talks_like : isRecord(raw.voice) ? raw.voice : {};
    const ack = Array.isArray(talks.ack) ? str(talks.ack.find((a) => typeof a === "string")) : "";
    out.push({
      id,
      name,
      role,
      area: str(raw.department) || role || "my",
      remit: str(raw.remit),
      // Only the acknowledgement's first sentence ("Got it."), so a longer one never says more than it means.
      ack: ack ? (/^.*?[.!](?=\s|$)/.exec(ack)?.[0] ?? null) : null,
      isChief: raw.is_chief_of_staff === true || /chief of staff/i.test(role),
    });
  }
  return out;
}

/** First five letters, so "pricing" meets "price" and "customers" meets "customer". */
const stem = (w: string) => w.slice(0, 5);

function relevance(p: Participant, words: string): number {
  const asked = new Set(keywords(words, 12).map(stem));
  if (asked.size === 0) return 0;
  return new Set(keywords(`${p.role} ${p.area} ${p.remit}`, 40).map(stem).filter((w) => asked.has(w))).size;
}

/** The participant whose remit fits the words best; the Chief of Staff (else the first) when none fits. */
function mostRelevant(people: readonly Participant[], words: string, exclude?: string): Participant | undefined {
  const pool = people.filter((p) => p.id !== exclude);
  let best: Participant | undefined;
  let bestScore = 0;
  for (const p of pool) {
    const score = relevance(p, words);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best ?? pool.find((p) => p.isChief) ?? pool[0];
}

/** The founder's words as a phrase inside a sentence: the first sentence, on one line, no closing punctuation. */
function phraseOf(words: string): string {
  const line = words.replace(/\s+/g, " ").trim();
  const first = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  const clipped = truncate(first.replace(/[.!?…]+$/, ""), 90).replace(/[.!?]+$/, "");
  return /^[A-Z][a-z]/.test(clipped) ? clipped.charAt(0).toLowerCase() + clipped.slice(1) : clipped;
}

/** "I turn your idea into a roadmap" from a remit line, as a clause (no closing punctuation). */
function remitClause(remit: string): string {
  const first = /^.*?[.!?](?=\s|$)/.exec(remit.replace(/\s+/g, " ").trim())?.[0] ?? remit;
  return truncate(first, 110).replace(/[.!?…]+$/, "");
}

/** "the Product", "the team's": the side an agent speaks for (the Chief of Staff speaks for the whole team). */
const areaOf = (p: Participant) => (p.isChief ? "the team's" : /^my$/i.test(p.area) ? "my" : `the ${p.area}`);
const askFounder = (founder: string, question: string) => (founder ? `${founder}, ${question.charAt(0).toLowerCase()}${question.slice(1)}` : question);

function turn(agent: Participant, to: TeamCallTurnOutput["to"], sentences: Array<string | null | false>): TeamCallTurnOutput {
  const text = sentences.filter((s): s is string => typeof s === "string" && s.length > 0).join(" ");
  return { agent_id: agent.id, to, text: truncate(text, TEAM_CALL_LIMITS.maxTurnChars) };
}

export function generateTeamCallTurns(ctx: MockContext): TeamCallTurnsOutput {
  const people = participantsOf(ctx);
  const kind = ctx.getString("kind") === "one_to_one" ? "one_to_one" : "team";
  const mode = ((m) => (m === "continue" || m === "opening" ? m : "founder_spoke"))(ctx.getString("mode"));
  const founder = str(ctx.getString("founder_name"));
  const topic = str(ctx.getString("topic"));
  const founderLines = ctx.getArray<Record<string, unknown>>("founder_lines").map((l) => (isRecord(l) ? str(l.text) : "")).filter(Boolean);
  const said = str(ctx.getString("founder_just_said")) || founderLines[founderLines.length - 1] || topic;
  const sinceFounder = ctx.getNumber("agent_rounds_since_founder") ?? 0;
  const round = ctx.getNumber("round") ?? founderLines.length + sinceFounder + (mode === "continue" ? 1 : 0);

  if (people.length === 0) return { turns: [{ agent_id: uuidFromSeed(`${ctx.hash}:speaker`), to: "founder", text: MOCK_TEAM_CALL_FALLBACK }], hand_back: true };

  // A one-to-one call has nobody else to carry on: the agent always hands back to the founder.
  const handBack = mode === "opening" || kind === "one_to_one" || round % 2 === 0 || (mode === "continue" && sinceFounder + 1 >= TEAM_CALL_LIMITS.agentRoundsWithoutFounder);
  const solo = kind === "one_to_one" || people.length === 1;
  const transcript = ctx.getArray<Record<string, unknown>>("call_transcript").filter(isRecord);
  const lastSpeaker = people.find((p) => p.id === str(transcript[transcript.length - 1]?.agent_id));

  const first =
    kind === "one_to_one"
      ? people[0]!
      : mode === "opening"
        ? (people.find((p) => p.isChief) ?? people[0]!)
        : mode === "continue"
          ? mostRelevant(people, said, lastSpeaker?.id)!
          : mostRelevant(people, said)!;
  const second = solo ? undefined : mostRelevant(people, said || first.remit, first.id);

  const turns: TeamCallTurnOutput[] = [];
  if (mode === "opening") {
    const hello = founder ? `Hi ${founder}, good to have you on the call.` : "Hi, good to have you on the call.";
    const about = topic ? `You wanted to talk about ${phraseOf(topic)}.` : null;
    turns.push(turn(first, "founder", [hello, about, second ? null : "What is on your mind first?"]));
    if (second) turns.push(turn(second, "founder", [`I'm here for ${areaOf(second)} side, alongside ${ent(first)}.`, "What is on your mind first?"]));
    return { turns, hand_back: true };
  }

  const phrase = phraseOf(said) || "where things stand";
  if (mode === "continue") {
    const from = lastSpeaker && lastSpeaker.id !== first.id ? `Picking up from ${ent(lastSpeaker)},` : "Picking up where we left off,";
    const lastOfRound = !second;
    turns.push(turn(first, lastOfRound && handBack ? "founder" : "team", [`${from} the next thing to settle is who takes the first step on what you raised.`, lastOfRound && handBack ? askFounder(founder, "Do you want us to write that up as an action when the call ends?") : null]));
    if (second) {
      turns.push(
        turn(second, handBack ? "founder" : { agent_id: first.id }, [
          `I agree with ${ent(first)}, and I can take ${areaOf(second)} part of it.`,
          handBack ? askFounder(founder, "Do you want us to write that up as an action when the call ends?") : `${ent(first)}, shall we agree the first step between us?`,
        ]),
      );
    }
    return { turns, hand_back: handBack };
  }

  // The founder just spoke.
  const remit = first.remit ? `That sits with me: ${remitClause(first.remit)}.` : `That sits with ${areaOf(first)} side.`;
  const lastOfRound = !second;
  turns.push(
    turn(first, "founder", [
      first.ack,
      `${/\?\s*$/.test(said.trim().split(/(?<=[.!?])\s+/)[0] ?? "") ? "You asked" : "You said"} ${phrase}. Here is how I see it from ${areaOf(first)} side.`,
      remit,
      lastOfRound ? (handBack ? "What would you like me to look at first?" : "I would start by agreeing what a good first step looks like.") : null,
    ]),
  );
  if (second) {
    turns.push(
      turn(second, handBack ? "founder" : { agent_id: first.id }, [
        `Building on what ${ent(first)} said, I would look at it from ${areaOf(second)} side too.`,
        handBack ? askFounder(founder, "Which part should we take first?") : `${ent(first)}, shall we draw up the first step together?`,
      ]),
    );
  }
  return { turns, hand_back: handBack };
}

// ---------------------------------------------------------------------------------------------------------------------
// Wrap-up
// ---------------------------------------------------------------------------------------------------------------------

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const countWord = (n: number) => COUNT_WORDS[n] ?? "many";

const ROADMAP_LINE_RE = /\broadmap\b/i;
const ROADMAP_ADD_RE = /\b(?:add|put|include|plan|get)\b/i;

/** What opens a spoken instruction without being part of it: "First,", "And", "Let's", "The engineering side should". */
const LEAD_IN_RES: readonly RegExp[] = [
  /^(?:first|second|third|also|and|so|then|next|finally|ok(?:ay)?|right|yes|great|agreed)\b[,:]?\s+/i,
  /^(?:let's|let us|please|can we|could we|i want to|i'd like to|we need to|i think we should)\s+/i,
  /^(?:the\s+)?(?:[a-z]+\s+){0,2}?(?:side\s+|team\s+|lead\s+)?(?:should|could|can|will|needs?\s+to)\s+/i,
];
function withoutLeadIn(sentence: string): string {
  let out = sentence.trim();
  for (let i = 0; i < 4; i++) {
    const next = LEAD_IN_RES.reduce((t, re) => t.replace(re, ""), out).trim();
    if (next === out) break;
    out = next;
  }
  return out || sentence.trim();
}
/** The founder's sentence as a title: no lead-in, sentence case, no closing punctuation, a long one cut at its first comma. */
function asTitle(sentence: string): string {
  const plain = withoutLeadIn(sentence.replace(/[.!?]+$/, ""));
  const short = plain.length > 60 && plain.indexOf(",") > 10 ? plain.slice(0, plain.indexOf(",")) : plain;
  return truncate(sentenceCase(short), 120);
}

/** A sentence that turns something down or only frames the call ("Let's not do the journalists yet", "I want to plan the next few weeks"): nothing to file. */
const NOT_AGREED_RE = /\b(?:let's\s+not|let\s+us\s+not|don't|do\s+not|not\s+yet|not\s+now|hold\s+off|skip\s+(?:it|that|the)|no\s+need|never\s*mind|leave\s+(?:it|that)\s+for\s+now)\b/i;
const FRAMING_RE = /^(?:i\s+want\s+to|i'd\s+like\s+to|let's|we\s+should)\s+(?:plan|talk|discuss|go\s+over|look\s+at|think\s+about|catch\s+up)\b[^,;]*$/i;

/** The kind of work each module's department does (docs/TEAM_CALL.md §4: a task's kind follows its department's work). */
const MODULE_TASK_KIND: Readonly<Record<string, TaskKind>> = { development: "code", distribution: "channel", finance: "finance", legal: "legal", product: "research", team: "ops" };

/** "Add a referral program to the roadmap" → "Referral program": what goes on the roadmap, in the founder's words. */
function roadmapTitle(sentence: string): string {
  const what = withoutLeadIn(sentence.replace(/[.!?]+$/, ""))
    .replace(/^(?:add|put|include|plan|get)\s+(?:a|an|the)?\s*/i, "")
    .replace(/\s+(?:to|on|onto|in|into)\s+(?:the|our)?\s*roadmap\b.*$/i, "")
    .trim();
  return truncate(sentenceCase(what || sentence.replace(/[.!?]+$/, "")), 200);
}

/** One line in the founder's words for an action the rule engine found. */
function titleFor(action: PlanAction, line: string): string {
  const p = action.params;
  const label = isChannelKey(p.channel) ? CHANNEL_META[p.channel].label : null;
  switch (action.type) {
    case "create_task":
    case "update_roadmap":
    case "hire_agent":
      return asTitle(str(p.title) || str(p.change) || (str(p.role) ? `Hire ${str(p.role)}` : "") || line);
    case "request_human_action":
      return str(p.request) || sentenceCase(line);
    case "enable_channel":
      return label ? `Turn on ${label}` : sentenceCase(line);
    case "disable_channel":
      return label ? `Turn off ${label}` : sentenceCase(line);
    case "set_budget": {
      const amount = typeof p.amount_minor === "number" ? formatMoneyMinor(p.amount_minor, str(p.currency) || "USD") : null;
      const target = label ?? (str(p.department) ? `the ${str(p.department)} work` : "the business");
      return amount ? `Set a ${amount} budget for ${target}` : `Set a budget for ${target}`;
    }
    default:
      return sentenceCase(line);
  }
}

export function generateTeamCallWrapUp(ctx: MockContext): TeamCallWrapUpOutput {
  const founder = str(ctx.getString("founder_name"));
  const lines = ctx
    .getArray<Record<string, unknown>>("founder_lines")
    .map((l) => (isRecord(l) ? str(l.text) : typeof l === "string" ? str(l) : ""))
    .filter(Boolean);
  const business = ctx.getRecord("business");
  const currency = str(business?.currency) || ctx.getString("currency") || undefined;
  const roadmap = ctx.getArray<Record<string, unknown>>("roadmap").flatMap((r) => (isRecord(r) && typeof r.id === "string" && typeof r.title === "string" ? [{ id: r.id, title: r.title }] : []));
  const agents = agentsFrom(ctx);
  const moduleOf = new Map(ctx.getArray<Record<string, unknown>>("departments").flatMap((d) => (isRecord(d) && str(d.name) ? [[str(d.name).toLowerCase(), str(d.module)] as const] : [])));
  const departmentOf = new Map(ctx.getArray<Record<string, unknown>>("agents").flatMap((a) => (isRecord(a) && str(a.id) ? [[str(a.id), str(a.department)] as const] : [])));
  /** The agent the sentence names by department or role ("marketing should…", "the engineering side"), with its department's kind of work. */
  const namedOwner = (sentence: string): { id: string; kind: TaskKind | null } | null => {
    const lower = sentence.toLowerCase();
    for (const a of agents) {
      const department = departmentOf.get(a.id) ?? "";
      const words = [department, ...a.role.split(/\s+/)].map((w) => w.toLowerCase()).filter((w) => w.length > 4 && !/^(?:head|chief|staff|lead)$/.test(w));
      if (words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower))) return { id: a.id, kind: MODULE_TASK_KIND[moduleOf.get(department.toLowerCase()) ?? ""] ?? null };
    }
    return null;
  };

  const actions: TeamCallWrapUpAction[] = [];
  const seen = new Set<string>();
  const add = (action: PlanAction, line: string) => {
    const title = truncate(titleFor(action, line).replace(/[.!?]+$/, ""), 200);
    const key = `${action.type}:${title.toLowerCase()}`;
    if (!title || seen.has(key) || actions.length >= TEAM_CALL_LIMITS.maxActionsPerCall) return;
    seen.add(key);
    actions.push({ title, detail: truncate(line, 1000), agent_id: action.agent_id, action });
  };

  // Sentence by sentence, as the plan compiler reads a reply: one gated sentence never turns the others into the founder's step.
  const sentences = lines.flatMap((l) => l.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const gated = detectHardGates(sentence).length > 0;
    if (!gated && (NOT_AGREED_RE.test(sentence) || FRAMING_RE.test(sentence.replace(/[.!?]+$/, "")))) continue;
    // A sentence that puts something on the roadmap ("add a referral program to the roadmap") is a roadmap item, and
    // only that: never the channel work its words also name.
    const roadmapAdd = !gated && ROADMAP_LINE_RE.test(sentence) && ROADMAP_ADD_RE.test(sentence);
    const found = roadmapAdd
      ? [{ type: "update_roadmap" as const, params: { roadmap_item_id: null, change: sentenceCase(sentence) }, agent_id: null }]
      : compilePlanRuleBased(sentence, { agents, defaultCurrency: currency, roadmap }).actions.filter((a) => a.type !== ("reply_only" satisfies PlanActionType));
    for (const a of found) {
      // An item the words do not match on the roadmap is a new one, titled in the founder's words.
      const params = a.type === "update_roadmap" && !a.params.roadmap_item_id ? { ...a.params, create: true, title: roadmapTitle(sentence) } : a.params;
      if (a.type === "create_task") {
        // Work a sentence gives to a department goes to its agent, with the kind of work that department does.
        const owner = a.params.channel ? null : namedOwner(sentence);
        const kind = owner?.kind ?? (a.params.kind as TaskKind);
        const agentId = owner?.id ?? a.agent_id;
        // Channel work keeps the rule engine's name for it ("Paid advertising campaign"); other work is the founder's sentence.
        const title = asTitle(a.params.channel ? str(params.title) || sentence : sentence);
        add({ type: "create_task", params: { ...params, kind, title }, agent_id: agentId }, sentence);
      } else add({ ...a, params }, sentence);
    }
  }

  const raised = sentences.map((l) => phraseOf(l)).filter(Boolean);
  const who = founder || "You";
  const summary = raised.length
    ? `${who} raised ${raised.length === 1 ? "one point" : `${countWord(raised.length)} points`} on the call: ${raised.join("; ")}. The team wrote up ${countWord(actions.length)} action item${actions.length === 1 ? "" : "s"} from it.`
    : "The call had nothing from you to write up, so no action items were filed.";
  return { summary: truncate(summary, 1200), actions };
}
