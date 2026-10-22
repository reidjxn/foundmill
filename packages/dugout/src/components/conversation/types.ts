/**
 * Conversation types and pure helpers (audit-conversation §4 "Components", DIRECTION #6). Server-safe: no React.
 *
 * The shapes match `agent.conversation.get` (apps/api/src/services/conversation.ts) closely enough that its persona,
 * messages and quick replies can be passed straight through: a server `QuickReply` is a `QuickReplyItem`, a
 * `ConversationMessageView` is a `DeskMessage`, and the persona needs only `dept` (from `colourToken`), `doingNow` and
 * `progress` (from `currentTask`) mapped.
 */
import type {
  AgentPresence,
  AgentReaction,
  AgentStatus,
  DeptColourToken,
  QuickReplyKind,
} from "@foundmill/shared";

/** A tappable reply: what the founder "says" with one press. `say` defaults to the label. */
export interface QuickReplyItem {
  id: string;
  /** Sentence case, ≤ 36 characters from the server; two lines at most on screen, never truncated. */
  label: string;
  /**
   * A second line under the label in small text ("This answers the note" on a `choose_option`, the consequence of a
   * "Take a break"; UX plan B20, §6.2 ConsequenceLine). Never spoken: the founder's words stay `say` or the label.
   */
  description?: string;
  say?: string;
  /** `write` opens the one-line field instead of sending. */
  kind?: QuickReplyKind;
  option_id?: string | null;
  /** The likeliest reply: brand-tinted. At most one. */
  recommended?: boolean;
  /** Set on replies the component added to reach two (sent as typed text through `onSend`, not by id). */
  fallback?: boolean;
}

/** The agent behind the desk. */
export interface DeskPersona {
  id: string;
  /** The agent's name (its role title unless the founder renamed it): "Juno", "Formulation Chemist". */
  name: string;
  /** "Head of Retail Partnerships". */
  role: string;
  avatarSeed: string | number;
  /** The agent's department colour: bubbles, the typing dots, the Now bar, reactions. */
  dept: DeptColourToken;
  /** Health (the portrait's status ring). */
  status?: AgentStatus;
  /** Where the agent is: in a session (working), free (available), paused (away), down. */
  presence?: AgentPresence;
  /** The server's presence words ("In a session · Second batch purchase order pack"); shown when there is no Now card. */
  presenceLabel?: string | null;
  /** What the agent is doing right now (the Now card). */
  doingNow?: string | null;
  /** Progress through `doingNow`, 0–1. */
  progress?: number | null;
  /** When a down agent is expected back ("14:30"). */
  expectedBack?: string | null;
  /** The agent's voice kit: the greeting opens an empty thread; `thinking` names what it is looking at while typing. */
  voice?: {
    greeting?: string | null;
    thinking?: readonly string[];
    ack?: readonly string[];
  } | null;
  /** The server's typing line for this conversation ("reading Boots UK's supplier terms"). */
  thinkingLine?: string | null;
}

export type DeskMessageState = "sending" | "seen" | "failed";

export interface DeskMessage {
  id: string;
  author: "founder" | "agent";
  /** One to three short bubbles; Markdown with `[[ent:<uuid>|Name]]` mentions (render them with `renderBubble`). */
  bubbles: readonly string[];
  at: string | Date | number;
  /**
   * The agent's reaction. On an agent message it is the agent's reaction to the founder's message before it, and is
   * drawn on that founder bubble's corner; on a founder message it is drawn on that message.
   */
  reaction?: AgentReaction | null;
  /** The chips offered after this agent message. */
  quickReplies?: readonly QuickReplyItem[];
  /** On an agent message: the chip the founder pressed in reply. */
  chosenQuickReplyId?: string | null;
  /** Founder messages: sending (optimistic), seen (the server has it), failed. */
  state?: DeskMessageState;
  /** Work the agent would hand off if the founder confirms; `gated` work is the founder's own to do. */
  handOff?: { instruction: string; gated?: boolean } | null;
  /** The staged plan for the hand-off, once staged. */
  planId?: string | null;
  /**
   * The staged plan was confirmed (it runs or ran): the strip says so and offers nothing. Until then a staged plan can be
   * reviewed again, after a reload or from another device (it waits for the founder's go-ahead in the database).
   */
  planConfirmed?: boolean;
  /** The agent's last bubble is still streaming in (the caret stays open). */
  streaming?: boolean;
}

/** The states the presence line can show, in order of precedence (typing wins). */
export type DeskLiveState = "live" | "working" | "available" | "away" | "down";

/** Words for the presence line: "Live · typing", "In a session", "Available", "Away", "Down · back 14:30". */
export function presenceWords(
  persona: Pick<DeskPersona, "presence" | "presenceLabel" | "doingNow" | "expectedBack">,
  replying: boolean,
): { state: DeskLiveState; words: string } {
  if (replying) return { state: "live", words: "Live · typing" };
  switch (persona.presence) {
    case "working":
      return {
        state: "working",
        words: !persona.doingNow && persona.presenceLabel ? persona.presenceLabel : "In a session",
      };
    case "away":
      return {
        state: "away",
        words: !persona.doingNow && persona.presenceLabel ? persona.presenceLabel : "Away",
      };
    case "down":
      return {
        state: "down",
        words: persona.expectedBack
          ? `Down · back ${persona.expectedBack}`
          : (persona.presenceLabel ?? "Down"),
      };
    case "available":
    default:
      return {
        state: "available",
        words: !persona.doingNow && persona.presenceLabel ? persona.presenceLabel : "Available",
      };
  }
}

/** Lower-case a leading gerund ("Reading Boots UK's terms" → "reading Boots UK's terms"); leave names alone. */
export function lowerLeadingVerb(phrase: string): string {
  const m = /^([A-Z][a-z]+ing)\b/.exec(phrase);
  return m ? phrase[0]!.toLowerCase() + phrase.slice(1) : phrase;
}

/**
 * What the agent is looking at while it types. Always names something: the given phrase, the voice's first thinking
 * line, the current task, or the thread itself.
 */
export function thinkingPhraseFor(
  persona: Pick<DeskPersona, "voice" | "doingNow" | "thinkingLine">,
  phrase?: string | null,
): string {
  const p =
    phrase?.trim() ||
    persona.thinkingLine?.trim() ||
    persona.voice?.thinking?.find((t) => t.trim())?.trim();
  if (p) return lowerLeadingVerb(p);
  if (persona.doingNow) return `checking ${persona.doingNow}`;
  return "reading back through the thread";
}

/** "Juno is typing · reading Boots UK's supplier terms". */
export function typingSentence(name: string, phrase: string): string {
  const p = phrase.trim();
  return p ? `${name} is typing · ${lowerLeadingVerb(p)}` : `${name} is typing`;
}

/** Replies the component adds when fewer than two arrive. Sent as text, never by id (the server would not know it). */
export const FALLBACK_QUICK_REPLIES: readonly QuickReplyItem[] = [
  { id: "fallback-more", label: "Tell me more", say: "Tell me more", kind: "ask", fallback: true },
  {
    id: "fallback-thanks",
    label: "Thanks, carry on",
    say: "Thanks, carry on",
    kind: "acknowledge",
    fallback: true,
  },
  { id: "fallback-next", label: "What's next?", say: "What's next?", kind: "ask", fallback: true },
];

export const QUICK_REPLY_MAX = 4;
export const QUICK_REPLY_MIN = 2;

/**
 * The replies to draw: 2–4 numbered choices (deduplicated by label, `write` chips set aside), padded to two from
 * `fallbacks` whenever any were provided, and the write chip (its label names the ghost Write button). Nothing is
 * provided → no choices.
 */
export function settleQuickReplies(
  replies: readonly QuickReplyItem[] | null | undefined,
  fallbacks: readonly QuickReplyItem[] = FALLBACK_QUICK_REPLIES,
): { choices: QuickReplyItem[]; write: QuickReplyItem | null; likeliest: string | null } {
  const list = replies ?? [];
  const write = list.find((r) => r.kind === "write") ?? null;
  const seen = new Set<string>();
  const choices: QuickReplyItem[] = [];
  for (const r of list) {
    if (r.kind === "write") continue;
    const key = r.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    choices.push(r);
    if (choices.length === QUICK_REPLY_MAX) break;
  }
  if (list.length > 0) {
    for (const f of fallbacks) {
      if (choices.length >= QUICK_REPLY_MIN) break;
      const key = f.label.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      choices.push({ ...f, fallback: true });
    }
  }
  const likeliest = choices.find((c) => c.recommended)?.id ?? choices[0]?.id ?? null;
  return { choices, write, likeliest };
}

/** Consecutive messages by one author, for the portrait on the last bubble of a group. */
export interface DeskGroup {
  author: "founder" | "agent";
  messages: DeskMessage[];
}

export function groupMessages(messages: readonly DeskMessage[]): DeskGroup[] {
  const groups: DeskGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.author === m.author) last.messages.push(m);
    else groups.push({ author: m.author, messages: [m] });
  }
  return groups;
}

/**
 * The reaction drawn on each founder message: its own, or the agent's reaction carried on the next agent message.
 * `none` never draws.
 */
export function reactionsByFounderMessage(
  messages: readonly DeskMessage[],
): Map<string, AgentReaction> {
  const out = new Map<string, AgentReaction>();
  let lastFounder: string | null = null;
  for (const m of messages) {
    if (m.author === "founder") {
      lastFounder = m.id;
      if (m.reaction && m.reaction !== "none") out.set(m.id, m.reaction);
    } else {
      if (lastFounder && m.reaction && m.reaction !== "none" && !out.has(lastFounder))
        out.set(lastFounder, m.reaction);
      lastFounder = null;
    }
  }
  return out;
}

/** When each founder message was read: the time of the agent message that answered it. */
export function readTimesByFounderMessage(
  messages: readonly DeskMessage[],
): Map<string, DeskMessage["at"]> {
  const out = new Map<string, DeskMessage["at"]>();
  const waiting: string[] = [];
  for (const m of messages) {
    if (m.author === "founder") waiting.push(m.id);
    else {
      for (const id of waiting) out.set(id, m.at);
      waiting.length = 0;
    }
  }
  return out;
}

/** Whether the founder is expected to respond: the thread is empty, or its last message is the agent's. */
export function founderTurn(messages: readonly DeskMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !last || (last.author === "agent" && !last.streaming);
}

/** The chips to show now: the latest agent message's, else the starters. */
export function currentQuickReplies(
  messages: readonly DeskMessage[],
  starters: readonly QuickReplyItem[] = [],
): readonly QuickReplyItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.author === "agent")
      return m.quickReplies && m.quickReplies.length ? m.quickReplies : starters;
  }
  return starters;
}

/** Department colour token → its `tone-*` class (literal strings, so Tailwind sees them). */
const DEPT_TONE: Record<DeptColourToken, string> = {
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

/** A department's tone class, or the brand's kit-lift (never violet as a generic "AI" colour). */
export function toneClass(dept: DeptColourToken | "kit" | null | undefined): string {
  return dept && dept !== "kit" ? DEPT_TONE[dept] : "tone-kit-lift";
}

/** Replies for a thread with nothing on offer at all: the founder still never has to type. Sent as text. */
export const OPENING_FALLBACK_REPLIES: readonly QuickReplyItem[] = [
  {
    id: "fallback-working-on",
    label: "What are you working on?",
    say: "What are you working on?",
    kind: "ask",
    fallback: true,
  },
  {
    id: "fallback-blocking",
    label: "Anything blocking you?",
    say: "Is anything blocking you?",
    kind: "ask",
    fallback: true,
  },
];

/**
 * The persona `agent.conversation.get` returns (apps/api ConversationPersona), as the desk's persona: the department
 * from `colourToken` (`fallbackDept` when the agent has none), the Now card from `currentTask`.
 */
export function deskPersonaFrom(
  p: {
    id: string;
    name: string;
    role: string;
    avatarSeed: string | number;
    colourToken?: DeptColourToken | null;
    status?: AgentStatus;
    presence?: AgentPresence;
    presenceLabel?: string | null;
    currentTask?: { title: string; progress?: number | null } | null;
    voice?: DeskPersona["voice"];
    thinkingLine?: string | null;
  },
  fallbackDept: DeptColourToken = "dept-1",
): DeskPersona {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    avatarSeed: p.avatarSeed,
    dept: p.colourToken ?? fallbackDept,
    status: p.status,
    presence: p.presence,
    presenceLabel: p.presenceLabel ?? null,
    doingNow: p.currentTask?.title ?? null,
    progress: p.currentTask?.progress ?? null,
    voice: p.voice ?? null,
    thinkingLine: p.thinkingLine ?? null,
  };
}
