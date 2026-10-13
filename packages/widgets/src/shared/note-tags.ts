/**
 * The one vocabulary for an Inbox note's status tag (DIRECTION #8, DESIGN §9 Inbox): an icon and a word, the tone a
 * second signal. The Inbox list, the reading pane and Home's Inbox preview all read it, so a note says the same thing
 * wherever it appears ("Respond", "Customer", "Milestone", never "Needs you" here and "Win" there).
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

export const RESPOND_TAG: NoteTag = { word: "Respond", tone: "bad", icon: "respond" };

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
 * One tag per row: a won customer reads "Customer" (gold), anything waiting on the founder says "Respond", the rest
 * name their kind ("Milestone", "Update", "Report", "Decided" once a decision is answered).
 */
export function noteRowTag(item: { type: InboxItemType; state: InboxState; blocksContinue: boolean }): NoteTag {
  if (item.type === "customer_won") return NOTE_TYPE_TAGS.customer_won;
  const answered = item.state === "answered" || item.state === "archived";
  if (!answered && (item.blocksContinue || item.type === "decision")) return RESPOND_TAG;
  return NOTE_TYPE_TAGS[item.type];
}

/** The name a note in another person's words goes under: where it came from (its subject names the person). */
export const NETWORK_SENDER = "Network";

/**
 * Whose words a human message carries, for its avatar and name: the viewer's own note ("self"), or another person's
 * ("other": a connection request or a message from another founder, which Network files in this business's Inbox).
 * Someone else's words never read as "You". Null for an item with no person behind it (an agent's or the team's).
 */
export function humanSender(fromUserId: string | null | undefined, viewerId: string | null | undefined): "self" | "other" | null {
  if (!fromUserId) return null;
  return fromUserId === viewerId ? "self" : "other";
}
