/**
 * The one vocabulary for an Inbox note's status tag (DIRECTION #8, DESIGN §9 Inbox): an icon and a word, the tone a
 * second signal. The Inbox list, the reading pane and Home's Inbox preview all read it, so a note says the same thing
 * wherever it appears ("Needs you", "Customer", "Milestone", never "Respond" here and "Win" there; "Needs you" since Nov 7, 2026). Every tag carries
 * one legend sentence (UX plan B21), shown as the chip's tooltip.
 */
import { Check, FileText, Flag, Mail, MessageSquareReply, RefreshCw, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import type { InboxItemType, InboxState } from "@foundmill/shared";

export type NoteTagTone = "bad" | "warn" | "info" | "good" | "neutral" | "gold";
export type NoteTagIcon = "respond" | "win" | "milestone" | "warning" | "update" | "report" | "message" | "decided";
export interface NoteTag {
  word: string;
  tone: NoteTagTone;
  icon: NoteTagIcon;
}

/** Lucide glyph per tag (the word carries the meaning; the icon and the tone repeat it). */
export const NOTE_TAG_ICONS: Record<NoteTagIcon, LucideIcon> = {
  respond: MessageSquareReply,
  win: UserCheck,
  milestone: Flag,
  warning: TriangleAlert,
  update: RefreshCw,
  report: FileText,
  message: Mail,
  decided: Check,
};

/**
 * The legend: one sentence per tag kind, the chip's tooltip wherever the tag appears (UX plan B21). Keyed by the icon,
 * which names the kind, so the reading pane's fuller words ("Needs your answer", "Customer won") share it.
 */
export const NOTE_TAG_LEGEND: Record<NoteTagIcon, string> = {
  win: "A new paying customer, with its Customer Update",
  respond: "Waiting for your answer; the rest of the work carries on",
  warning: "Something to watch; it holds Continue only when credits run out or a key needs replacing",
  update: "Progress from an agent, nothing to do",
  milestone: "A first your business reached",
  report: "A regular summary",
  message: "A person wrote to you",
  decided: "You answered this",
};

/** "Customer: A new paying customer, with its Customer Update": the chip's tooltip, the word first so the legend reads as one. */
export function noteTagLegend(tag: Pick<NoteTag, "word" | "icon">): string {
  return `${tag.word}: ${NOTE_TAG_LEGEND[tag.icon]}`;
}

/** A note waiting on the founder (Nov 7, 2026: "Needs you", amber; a decision is a question, not an alarm). */
export const RESPOND_TAG: NoteTag = { word: "Needs you", tone: "warn", icon: "respond" };

export const NOTE_TYPE_TAGS: Record<InboxItemType, NoteTag> = {
  decision: { word: "Decided", tone: "neutral", icon: "decided" },
  customer_won: { word: "Customer", tone: "gold", icon: "win" },
  warning: { word: "Warning", tone: "warn", icon: "warning" },
  update: { word: "Update", tone: "info", icon: "update" },
  milestone: { word: "Milestone", tone: "good", icon: "milestone" },
  report: { word: "Report", tone: "neutral", icon: "report" },
  human_message: { word: "Message", tone: "info", icon: "message" },
};

/**
 * One tag per row: a won customer reads "Customer" (gold), anything waiting on the founder says "Needs you" (an answered
 * note whose plan still waits for their go-ahead too: inbox.list's `awaitingConfirmation`), the rest name their kind
 * ("Milestone", "Update", "Report", "Decided" once a decision is answered).
 */
export function noteRowTag(item: { type: InboxItemType; state: InboxState; blocksContinue: boolean; awaitingConfirmation?: boolean }): NoteTag {
  if (item.type === "customer_won") return NOTE_TYPE_TAGS.customer_won;
  if (item.awaitingConfirmation && item.state !== "archived") return RESPOND_TAG;
  const answered = item.state === "answered" || item.state === "archived";
  if (!answered && (item.blocksContinue || item.type === "decision")) return RESPOND_TAG;
  return NOTE_TYPE_TAGS[item.type];
}

/** "1 note needs your answer" / "3 notes need your answer": the one phrase for notes waiting on the founder (UX plan B7). */
export function needsAnswerWords(count: number): string {
  return count === 1 ? "1 note needs your answer" : `${count} notes need your answer`;
}

/** The name a note in another person's words goes under. (Network traffic is never filed in an Inbox: FU-S-2.) */
export const NETWORK_SENDER = "Network";

/**
 * Whose words a human message carries, for its avatar and name: the viewer's own note ("self"), or another person's
 * ("other": a note by someone else; a connection request or a message from another founder is never filed in an Inbox).
 * Someone else's words never read as "You". Null for an item with no person behind it (an agent's or the team's).
 */
export function humanSender(fromUserId: string | null | undefined, viewerId: string | null | undefined): "self" | "other" | null {
  if (!fromUserId) return null;
  return fromUserId === viewerId ? "self" : "other";
}
