/**
 * The Chief of Staff on every page (founder, Phase 3): three questions the founder can ask from any screen, answered in
 * two to four plain sentences from the facts Today already reads. No model call and no cost: the answer is a pure
 * function of `ChiefFacts`, which the api (`chiefOfStaff.answer`, services/chief-of-staff.ts) gathers with Today's own
 * reads (`needsYouFor`, `weekFactsFor`, `goalView`), and the sentences themselves come from the same builders Today's
 * "This week and next" and the goal bar use (today-words.ts, goals.ts).
 *
 * - **What's happening?**  what the team is doing now or does next, what it finished this week, and where the goal stands.
 * - **What's blocking us?** the team stopped or paused, what waits on the founder, a round that did not finish, work
 *   waiting on other work (and on which). "Nothing is blocking the team." when nothing does.
 * - **Why am I seeing this?** what the page the founder is on is for (the screen's own "What this screen is for" line
 *   when the client passes it, else the words of the area or page kind) and why it matters now.
 *
 * Agents and records are named as `[[ent:<uuid>|Name]]` markup, which the screen renders as EntityLink under the reader's
 * naming preference. A projected number keeps its Forecast label and a worked-out one its Estimate label (the pace line
 * carries "(Forecast)", the roadmap date "(Estimate)"). US dates, en-US numbers, no jargon.
 */
import { isAreaKey, type AreaKey } from "./areas";
import { formatCount } from "./copy";
import { goalPaceState, goalValueText, type GoalStandingLike } from "./goals";
import { agentMention } from "./personas";
import { weekDoneSentence, weekNextSentence, weekRoundSentence, weekWaitingSentence, type WeekFacts } from "./today-words";

export const CHIEF_QUESTIONS = ["happening", "blocking", "why"] as const;
export type ChiefQuestion = (typeof CHIEF_QUESTIONS)[number];

/** The starter questions as the founder reads them (the menu rows, and the first message when the chat continues). */
export const CHIEF_QUESTION_LABELS: Readonly<Record<ChiefQuestion, string>> = {
  happening: "What's happening?",
  blocking: "What's blocking us?",
  why: "Why am I seeing this?",
};

/** The menu's last row: the desk opens with nothing typed. */
export const CHIEF_ASK_ELSE_LABEL = "Ask something else…";

/** Why the team stopped, completing "The team is stopped because …" (the reasons `business.agents_stopped_reason` holds). */
export const AGENT_STOP_REASON_WORDS = {
  kill_switch: "Stop all agents was pressed",
  key_revoked: "the Anthropic key was revoked",
  credits_exhausted: "this month's credits ran out",
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// The page the founder is on
// ---------------------------------------------------------------------------------------------------------------------

export type ChiefPageKind = "today" | "details" | "needs_you" | "area" | "agent" | "settings" | "contacts" | "milestones" | "journey" | "other";

/** What the client says about the page: the path, and (when it knows them) its area and its own purpose line. */
export interface ChiefPage {
  path: string;
  screenId?: string | null;
  area?: string | null;
  /** The registered screen's "What this screen is for" line, when it is plain text. */
  purpose?: string | null;
}

/** Longest purpose line taken from the client; anything longer is ignored and the page kind's words stand in. */
export const CHIEF_PURPOSE_MAX = 300;

/** The kind of page a business path is: `/b/<id>/today` → today, `/b/<id>/d/<dept>/<tab>` → area. Pure. */
export function chiefPageKind(path: string): ChiefPageKind {
  const clean = path.split(/[?#]/)[0] ?? "";
  const segments = clean.split("/").filter(Boolean);
  const rest = segments[0] === "b" ? segments.slice(2) : segments;
  switch (rest[0]) {
    case "today":
      return "today";
    case undefined:
    case "home":
      return "details";
    case "inbox":
      return "needs_you";
    case "d":
      return "area";
    case "agents":
      return "agent";
    case "settings":
      return "settings";
    case "crm":
      return "contacts";
    case "milestones":
    case "trophies":
      return "milestones";
    case "journey":
      return "journey";
    default:
      return "other";
  }
}

const AREA_PURPOSE: Readonly<Record<AreaKey, string>> = {
  plan: "Plan is where the goal, the roadmap and your milestones live: where the business is heading and how far along it is.",
  customers: "Customers is where you see how people find the business, who has bought and what the team is doing to bring in more.",
  money: "Money is where the cash, the runway and the company's paperwork live.",
  product: "Product is what the team is building: the vision, the specification, the work in progress and what has gone live.",
  team: "Team is everyone who works for the business: the agents, the staff and who is down or failing.",
};

const PAGE_PURPOSE: Readonly<Record<Exclude<ChiefPageKind, "area">, string>> = {
  today: "Today is the front door: your goal, what needs you, the week's plan and the business's health in one place.",
  details: "Details is the full dashboard behind Today, with every figure the business keeps.",
  needs_you: "Needs you holds the notes the team cannot go on without you for: decisions, approvals and warnings.",
  agent: "This is one agent's profile: what it does, how it is trained and what it has done lately.",
  settings: "Settings is where you decide how the business and the team work: limits, keys, access and billing.",
  contacts: "Contacts is everyone the business knows, from customers to partners, with what happened with each.",
  milestones: "Milestones is the record of what the business has achieved so far.",
  journey: "The customer journey shows how people move from first hearing about the business to paying for it.",
  other: "This page is part of your business.",
};

/** What the page is for: the screen's own line when the client sent one, else the area's or the page kind's words. */
export function chiefPagePurpose(page: ChiefPage): string {
  // Text from the browser never carries entity markup of its own: only the server names an agent or a record.
  const own = page.purpose?.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  if (own && own.length <= CHIEF_PURPOSE_MAX) return /[.!?]$/.test(own) ? own : `${own}.`;
  const kind = chiefPageKind(page.path);
  if (kind === "area") return isAreaKey(page.area) ? AREA_PURPOSE[page.area] : "This tab is part of one of your departments.";
  return PAGE_PURPOSE[kind];
}

// ---------------------------------------------------------------------------------------------------------------------
// The facts
// ---------------------------------------------------------------------------------------------------------------------

export interface ChiefAgentRef {
  id: string;
  name: string;
}

/** The facts behind the answers; each part is null when the reader may not see it (the same walls as Today). */
export interface ChiefFacts {
  /** "2026-11-09": the business's day. */
  today: string;
  /** Null without Development read. `week` is Today's own `WeekFacts`. */
  work: {
    week: WeekFacts;
    /** Work in hand now, with who is doing it (title in the founder's words). */
    running: { title: string; agent: ChiefAgentRef | null }[];
    /** Work waiting on other work, with the titles it waits for (open steps ahead of it). */
    blocked: { title: string; waitingOn: string[] }[];
  } | null;
  /** The active goal as `goal.current` returns it; null when none. */
  goal: (GoalStandingLike & { sentence: string }) | null;
  /** Null without Inbox read. `top` is the first note; `holding` counts the ones that hold Continue. */
  needsYou: { total: number; holding: number; top: { subject: string; from: ChiefAgentRef | null } | null } | null;
  /** The team is stopped: why, completing "because …". */
  stopped: { reason: string } | null;
  /** The founder is on vacation: what it lasts until ("Oct 21", "you return"). */
  vacation: { untilLabel: string } | null;
  /** The round of work is paused. */
  paused: boolean;
  /** The last round could not finish: what stopped it (not shown while a round runs). */
  failure: string | null;
  /** The agents currently working, for Team pages. */
  agentsWorking: number;
}

export interface ChiefAnswer {
  question: ChiefQuestion;
  /** Two to four sentences; may carry `[[ent:<uuid>|Name]]` markup. */
  text: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------------------------------------------------

const noFullStop = (s: string): string => s.trim().replace(/[.!?\s]+$/, "");
const quoted = (title: string): string => `“${noFullStop(title)}”`;
const things = (n: number): string => `${formatCount(n)} ${n === 1 ? "note" : "notes"}`;
const list = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const stoppedSentence = (reason: string): string => `The team is stopped because ${reason}. Nothing starts again until an owner or admin resumes the agents.`;

/** "Your goal is “Get the first 10 paying customers by Dec 19”. 4 of 10 so far, 42 days left: on pace (Forecast)." */
function goalSentences(goal: NonNullable<ChiefFacts["goal"]>): string[] {
  const head = `Your goal is ${quoted(goal.sentence)}.`;
  if (goal.progress) return [`${head} ${goal.progress.pace.trim()}`];
  return [head];
}

/** Who is working on what, naming each agent once as entity markup. */
function runningSentence(running: NonNullable<ChiefFacts["work"]>["running"]): string {
  const named = running.filter((r) => r.agent);
  const first = running[0]!;
  if (running.length === 1) return first.agent ? `${agentMention(first.agent)} is working on ${quoted(first.title)}.` : `The team is working on ${quoted(first.title)}.`;
  const agents = [...new Map(named.map((r) => [r.agent!.id, r.agent!])).values()].slice(0, 2);
  const who = agents.length ? list(agents.map(agentMention)) : "The team";
  const more = running.length - 1;
  return `${who} ${agents.length === 1 ? "is" : "are"} working on ${quoted(first.title)}, and ${formatCount(more)} other ${more === 1 ? "piece" : "pieces"} of work ${more === 1 ? "is" : "are"} in hand.`;
}

function happening(f: ChiefFacts): string[] {
  const out: string[] = [];
  if (f.stopped) out.push(stoppedSentence(f.stopped.reason));
  else if (f.vacation) out.push(`You are on vacation until ${f.vacation.untilLabel}; the team keeps working on its own.`);
  if (f.work && !f.stopped) {
    const { week, running } = f.work;
    if (f.paused) out.push("The round of work is paused. Press Continue to pick up where the team stopped.");
    else if (running.length) out.push(runningSentence(running));
    else out.push(weekNextSentence(week), weekRoundSentence(week.rounds, week.today));
    out.push(weekDoneSentence(week.done, week.rounds.completed));
  }
  if (f.goal) out.push(...goalSentences(f.goal));
  if (!out.length) out.push("There is nothing to report yet: the team has not started, and no goal is set.");
  return out.slice(0, 4);
}

function blocking(f: ChiefFacts): string[] {
  const out: string[] = [];
  if (f.stopped) out.push(stoppedSentence(f.stopped.reason));
  if (f.needsYou && f.needsYou.total > 0) {
    const n = f.needsYou;
    const top = n.top ? ` The first is ${quoted(n.top.subject)}${n.top.from ? `, from ${agentMention(n.top.from)}` : ""}.` : "";
    const holding = n.holding > 0 ? ` ${n.holding === 1 ? "One holds" : `${formatCount(n.holding)} of them hold`} Continue until you answer.` : "";
    out.push(`${things(n.total)} ${n.total === 1 ? "waits" : "wait"} for you in Needs you.${top}${holding}`);
  }
  if (f.failure && !f.stopped) out.push(`The last round of work did not finish: ${noFullStop(f.failure)}.`);
  if (f.paused && !f.stopped) out.push("The round of work is paused. Press Continue to pick up where the team stopped.");
  if (f.work && f.work.week.waiting > 0) {
    out.push(weekWaitingSentence(f.work.week.waiting)!);
    const why = f.work.blocked.find((b) => b.waitingOn.length);
    if (why) out.push(`${quoted(why.title)} is waiting for ${list(why.waitingOn.slice(0, 2).map(quoted))} to finish first.`);
  }
  if (!out.length) return ["Nothing is blocking the team."];
  return out.slice(0, 4);
}

/** Why it matters now, from the page's kind: a count or a state the page itself shows. */
function whyNow(f: ChiefFacts, kind: ChiefPageKind, area: AreaKey | null): string[] {
  if (f.stopped) return [stoppedSentence(f.stopped.reason)];
  const needs = f.needsYou && f.needsYou.total > 0 ? `${things(f.needsYou.total)} ${f.needsYou.total === 1 ? "waits" : "wait"} for you in Needs you.` : null;
  const goal = f.goal ? goalSentences(f.goal) : [];
  const state = f.goal ? goalPaceState(f.goal, f.today) : null;
  const standing = f.goal && f.goal.progress && state !== "untracked" ? `Your goal stands at ${goalValueText(f.goal)}.` : null;
  const nothing = "Nothing needs you right now.";
  if (kind === "needs_you") return [needs ? `${needs}${f.needsYou!.holding ? ` ${formatCount(f.needsYou!.holding)} hold${f.needsYou!.holding === 1 ? "s" : ""} Continue.` : ""}` : "Nothing waits for you right now, so this list is empty."];
  if (kind === "today" || kind === "details") return [needs ?? nothing, ...(goal.length ? goal : [])].slice(0, 3);
  if (area === "plan" || kind === "milestones") return goal.length ? goal : [needs ?? nothing];
  if (area === "team" || kind === "agent") {
    const working = f.agentsWorking > 0 ? `${formatCount(f.agentsWorking)} ${f.agentsWorking === 1 ? "agent is" : "agents are"} working now.` : "No agent is working right now.";
    return [working, ...(needs ? [needs] : [])];
  }
  if (area === "product" && f.work) return [weekNextSentence(f.work.week), ...(needs ? [needs] : [])];
  if (kind === "settings") return [needs ?? "Nothing needs you right now, so this is a good time to look at how the business is set up."];
  return [needs ?? nothing, ...(standing ? [standing] : [])];
}

function why(f: ChiefFacts, page: ChiefPage): string[] {
  const kind = chiefPageKind(page.path);
  const area = isAreaKey(page.area) ? page.area : null;
  return [chiefPagePurpose(page), ...whyNow(f, kind, area)].slice(0, 4);
}

/** The answer to one question, as two to four sentences. Pure. */
export function chiefAnswer(question: ChiefQuestion, facts: ChiefFacts, page: ChiefPage): ChiefAnswer {
  const sentences = question === "happening" ? happening(facts) : question === "blocking" ? blocking(facts) : why(facts, page);
  return { question, text: sentences.join(" ") };
}
