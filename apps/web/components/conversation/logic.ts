/**
 * Pure helpers for talking to an agent at their desk (audit-conversation §4; `agent.conversation.*`): the server view
 * → the desk's persona and messages, merging a send into the cached view without a refetch, the local acknowledgement
 * in the agent's own voice (no model call), and the persona-line de-duplication ("Chief of Staff · Chief of Staff").
 */
import { consequenceText, deskPersonaFrom, type DeskMessage, type DeskPersona, type QuickReplyItem } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import type { RouterOutputs } from "@/lib/trpc";

export type ConversationView = RouterOutputs["agent"]["conversation"]["get"];
export type ConversationSend = RouterOutputs["agent"]["conversation"]["send"];
export type ConversationInboxReply = RouterOutputs["agent"]["conversation"]["inboxReply"];
export type HandOffPreview = RouterOutputs["agent"]["conversation"]["handOff"];
export type ConversationPersonaView = ConversationView["persona"];
export type ConversationSubjectKind = "inbox_item" | "agent" | "task";
export interface ConversationSubject {
  kind: ConversationSubjectKind;
  id: string;
}

/** The quick reply the server maps to the existing `dev.tasks.pause` (audit §4 "Agent profile"). */
export const TAKE_A_BREAK_ID = "take_a_break";

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** True when two persona words say the same thing ("Chief of Staff" and "chief of staff"). */
export function samePersonaWords(a: string | null | undefined, b: string | null | undefined): boolean {
  return norm(a) !== "" && norm(a) === norm(b);
}

/** The role to show beside a name, or null when it would only repeat the name (the "Chief of Staff Chief of Staff" bug). */
export function roleBesideName(name: string | null | undefined, role: string | null | undefined): string | null {
  const r = (role ?? "").trim();
  if (!r || samePersonaWords(name, r)) return null;
  return r;
}

/**
 * The server persona as the desk's persona: department colour (the caller's fallback when the agent has none), the
 * Now card from the current task, and a role that never repeats the name.
 */
export function deskPersonaOf(p: ConversationPersonaView, fallbackDept: DeptColourToken = "dept-1"): DeskPersona {
  const persona = deskPersonaFrom(p, fallbackDept);
  return { ...persona, role: roleBesideName(p.name, p.role) ?? "" };
}

/**
 * The second line of a "Go with: …" quick reply (UX plan B20): a `choose_option` chip decides the note from the chat,
 * and says so. It travels as the reply's `description` (QuickReplies draws it in small text under the label, never in
 * the label), so the founder's own words (`say`, else the label) stay what they were and are never spoken with it.
 */
export const CHOICE_SUBLINE = "This answers the note";

/**
 * The second line of "Take a break" (the chip that pauses the agent's running task through `dev.tasks.pause`): what it
 * does and that it can be undone, the way every stop-style action carries its consequence (UX plan §6.2 ConsequenceLine).
 */
export const TAKE_A_BREAK_SUBLINE = consequenceText({ consequence: "Pauses the current task; resume it from Development.", reversible: true })!;

type SublineReply = Pick<QuickReplyItem, "id" | "kind" | "label" | "say" | "description">;

/**
 * A quick reply with its subline: "This answers the note" on a `choose_option`, the pause consequence on "Take a break",
 * as is for every other reply. A description the server already wrote is kept. Idempotent.
 */
export function withChoiceSubline<Q extends SublineReply>(reply: Q): Q {
  if (reply.description) return reply;
  if (reply.kind === "choose_option") return { ...reply, description: CHOICE_SUBLINE };
  if (reply.id === TAKE_A_BREAK_ID) return { ...reply, description: TAKE_A_BREAK_SUBLINE };
  return reply;
}

/** Every reply of a list, the `choose_option` ones (and "Take a break") with their subline. */
export function withChoiceSublines<Q extends SublineReply>(replies: readonly Q[]): Q[] {
  return replies.map(withChoiceSubline);
}

/** Server messages as desk messages (ids aliased so an optimistic bubble keeps its identity once the server has it). */
export function deskMessagesOf(view: Pick<ConversationView, "messages">, alias: ReadonlyMap<string, string> = new Map()): DeskMessage[] {
  return view.messages.map((m) => ({
    id: alias.get(m.id) ?? m.id,
    author: m.author,
    bubbles: m.bubbles,
    at: m.at,
    reaction: m.reaction,
    quickReplies: withChoiceSublines(m.quickReplies as readonly QuickReplyItem[]),
    chosenQuickReplyId: m.chosenQuickReplyId,
    handOff: m.handOff,
    planId: m.planId,
    // A staged plan stays reviewable until it is confirmed (audit OL-01); the server says where it stands.
    planConfirmed: Boolean(m.planId && m.planStatus && m.planStatus !== "pending_confirmation"),
    state: m.state,
  }));
}

/* ---------- a reply streamed bubble by bubble ---------- */

/** One event of a streamed reply (`agent.conversation.sendStream` / `inboxReplyStream`), as the API sends it. */
export type ReplyStreamEvent<R> = { type: "bubble"; index: number; text: string } | { type: "reset" } | { type: "done"; result: R };

/** What a stream that ends without its result says: a dropped connection, so the desk asks whether the message arrived. */
export const STREAM_CUT_MESSAGE = "The connection dropped before the reply arrived.";

/**
 * Reads a streamed reply (audit MB-1): the bubbles shown so far go to `onBubbles` as each arrives (a `reset` withdraws
 * them: the reply is being written again), and the stored result resolves the promise. The server stores nothing until
 * the whole reply has passed its checks, so these bubbles are only ever a preview of the reply the result carries. A
 * stream that ends without a result rejects with `STREAM_CUT_MESSAGE` (`deskFailureOf` reads it as offline).
 */
export async function readReplyStream<R>(stream: AsyncIterable<ReplyStreamEvent<R>>, onBubbles: (bubbles: string[]) => void): Promise<R> {
  let bubbles: string[] = [];
  for await (const event of stream) {
    if (event.type === "done") return event.result;
    if (event.type === "reset") bubbles = [];
    else {
      bubbles = [...bubbles];
      bubbles[event.index] = event.text;
    }
    onBubbles(bubbles.filter((b) => typeof b === "string"));
  }
  throw new Error(STREAM_CUT_MESSAGE);
}

/** The id of the agent's reply while it streams in (and of the stored reply once it is merged, so nothing re-renders). */
export const streamingIdOf = (localId: string): string => `streaming:${localId}`;

/** The cached view with a send's messages appended (deduplicated by id) and its quick replies: no refetch. */
export function withSent<V extends Pick<ConversationView, "thread" | "messages" | "quickReplies">>(view: V, sent: Pick<ConversationSend, "thread" | "messages" | "quickReplies">): V {
  const seen = new Set(view.messages.map((m) => m.id));
  const added = sent.messages.filter((m) => !seen.has(m.id));
  return { ...view, thread: sent.thread ?? view.thread, messages: [...view.messages, ...added], quickReplies: sent.quickReplies };
}

/** A message's plan once its hand-off is staged (the strip then reads "Plan staged"), or its status once it is confirmed. */
export function withPlanId<V extends Pick<ConversationView, "messages">>(view: V, messageId: string, planId: string, planStatus: ConversationView["messages"][number]["planStatus"] = "pending_confirmation"): V {
  return { ...view, messages: view.messages.map((m) => (m.id === messageId ? { ...m, planId, planStatus } : m)) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * One acknowledgement in the agent's own voice (`voice.ack`), deterministic per seed and with no model call: the first
 * sentence only ("Noted."), so it never promises anything the founder has not confirmed.
 */
export function voiceAck(voice: { ack?: readonly string[] | null } | null | undefined, seed: string, fallback = "Noted."): string {
  const acks = (voice?.ack ?? []).map((a) => a.trim()).filter(Boolean);
  if (!acks.length) return fallback;
  const line = acks[hash(seed) % acks.length]!;
  return line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
}

/** True when a bubble needs the Markdown renderer (emphasis, lists, code, links); plain text and mentions do not. */
export function bubbleNeedsMarkdown(text: string): boolean {
  return /(\*\*|__|`|^\s*[-*+]\s|^\s*\d+\.\s|\]\(https?:)/m.test(text);
}

/** The founder's words for a quick reply (what the bubble shows): its `say`, else its label. */
export const sayOf = (r: Pick<QuickReplyItem, "say" | "label">): string => (r.say?.trim() ? r.say.trim() : r.label);

/* ---------- when a send fails ---------- */

/** The "Try again" chip on a failure reply: handled on the client (it resends the founder's kept message), never sent. */
export const RETRY_REPLY_ID = "local-retry";
/** Local failure replies carry this id prefix (never stored; dropped when the founder sends something else). */
export const FAILURE_PREFIX = "failure:";

export type DeskFailureKind = "offline" | "limited" | "failed" | "stale" | "refused" | "credits";

/**
 * Why a send failed, from the tRPC error: no response at all (the api is down or the connection dropped), a limit, the
 * model or the server failing (worth a retry), a chip or decision that is no longer open, no permission, or the
 * business's credits for the month used up (PAYMENT_REQUIRED, `credits_exhausted`: a retry is refused the same way).
 */
export function deskFailureOf(err: unknown): { kind: DeskFailureKind; message: string } {
  const e = err as { data?: { code?: string; httpStatus?: number } | null; message?: string; name?: string } | null | undefined;
  const message = (e?.message ?? "").trim();
  const code = e?.data?.code;
  if (!code) return { kind: /fetch|network|load failed|connect|socket|ECONN|offline/i.test(message) || e?.name === "TypeError" || !message ? "offline" : "failed", message };
  if (code === "TOO_MANY_REQUESTS") return { kind: "limited", message };
  if (code === "PAYMENT_REQUIRED") return { kind: "credits", message };
  if (code === "BAD_REQUEST" || code === "CONFLICT" || code === "PRECONDITION_FAILED" || code === "PARSE_ERROR") return { kind: "stale", message };
  if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || code === "NOT_FOUND") return { kind: "refused", message };
  return { kind: "failed", message };
}

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

/**
 * The agent's own reply when the founder's message could not be answered: first person, plain, never a claim to be
 * human, and always saying that the founder's words are kept. `retry` offers "Try again" (the message is resent as is).
 */
export function failureReply(kind: DeskFailureKind, serverMessage = ""): { bubbles: string[]; retry: boolean } {
  switch (kind) {
    case "offline":
      return { bubbles: ["I couldn't confirm your message: the connection dropped.", "It's kept here. Try again once you're back online."], retry: true };
    case "limited": {
      const when = /try again in ([^.]+)/i.exec(serverMessage)?.[1]?.trim() ?? "a minute";
      return { bubbles: ["That's a lot of messages in a short time, so I've paused for a moment.", `Try again in ${when}; your message is kept here.`], retry: true };
    }
    case "stale":
      return { bubbles: [sentence(serverMessage) || "That one isn't open any more.", "Here's what's open now."], retry: false };
    case "refused":
      return { bubbles: [`I can't take that from here: ${sentence(serverMessage.replace(/^./, (c) => c.toLowerCase())) || "you don't have access."}`], retry: false };
    case "credits":
      // The API's own sentence says what lifts it (a top-up, or next month's credits on a date); trying again cannot.
      return { bubbles: [sentence(serverMessage) || "This month's credits are used up, so I can't reply until there are more.", "Your message is kept here."], retry: false };
    case "failed":
    default:
      return { bubbles: ["I couldn't put a reply together just then.", "Your message is kept here. Shall I try again?"], retry: true };
  }
}

/** Why the conversation could not be opened, in plain words (never a raw "Failed to fetch"). */
export function openFailureLine(err: unknown): string {
  const f = deskFailureOf(err);
  if (f.kind === "offline") return "The conversation couldn't be opened: the connection dropped.";
  return `The conversation couldn't be opened: ${sentence(f.message.replace(/^./, (c) => c.toLowerCase())) || "something went wrong."}`;
}

/**
 * The replies under a failure: "Try again" first when a retry can help, then what was on offer before (minus the reply
 * that failed and, once the item is decided, any "Go with"), at most four. Empty when nothing is left: the desk then
 * falls back to the starters.
 */
export function failureQuickReplies(retry: boolean, before: readonly QuickReplyItem[], failedReplyId: string | null, decided = false): QuickReplyItem[] {
  const rest = before.filter((r) => r.id !== failedReplyId && r.id !== RETRY_REPLY_ID && r.kind !== "write" && !(decided && r.kind === "choose_option")).map((r) => withChoiceSubline({ ...r, recommended: retry ? false : r.recommended }));
  const out = retry ? [{ id: RETRY_REPLY_ID, label: "Try again", say: "Try again", kind: "ask" as const, recommended: true }, ...rest] : rest;
  return out.slice(0, 4);
}

/** Quick replies without "Go with: …" once the decision is taken (the DecisionBar, another tab). */
export function withoutChoices<M extends { quickReplies?: readonly QuickReplyItem[] }>(messages: readonly M[], decided: boolean): M[] {
  if (!decided) return [...messages];
  return messages.map((m) => (m.quickReplies?.some((q) => q.kind === "choose_option") ? { ...m, quickReplies: m.quickReplies.filter((q) => q.kind !== "choose_option") } : m));
}
