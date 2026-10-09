/**
 * Founder ↔ agent conversation contract (route `conversation`; audit-conversation §4 "Data contract").
 *
 * An agent reply is 1–3 short bubbles in the agent's voice plus 2–4 quick replies, so the founder can always answer by
 * pressing a button and never has to type. The agent never acts from a conversation: work the founder asks for comes
 * back as `hand_off`, which the api compiles into a plan that runs only through the existing policy + confirm paths.
 *
 * The server (packages/agents `finaliseAgentReply`) re-checks every reply: entity mentions against the manifest, hard
 * gates on every quick reply and hand-off, and the 2–4 quick-reply rule, so a model output that slips past this schema's
 * refinements is still repaired before anyone sees it.
 */
import { AGENT_REACTIONS, QUICK_REPLY_KINDS } from "@foundmill/shared";
import { z } from "zod";

/** A chip holds one short line of sentence case (two lines at most when wrapped). */
export const QUICK_REPLY_LABEL_MAX = 36;
/** What the founder "says" when the chip is pressed (the founder message stored in the thread). */
export const QUICK_REPLY_SAY_MAX = 280;
export const QUICK_REPLY_ID_RE = /^[a-z0-9_-]{1,24}$/;
export const AGENT_BUBBLE_MAX = 320;
export const AGENT_BUBBLES_MAX = 3;
export const QUICK_REPLIES_MIN = 2;
export const QUICK_REPLIES_MAX = 4;
export const HAND_OFF_MAX = 600;
/** Source record ids an answer relies on (house rule 4). */
export const REFERS_TO_MAX = 5;

/** Sentence case: the first letter is not lower case and the label is not shouted in capitals. */
export function isSentenceCase(label: string): boolean {
  const letters = label.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return true;
  const first = label.trim().charAt(0);
  if (first !== first.toUpperCase()) return false;
  // "OK", "FAQ" are fine; a whole label in capitals is not.
  return !(letters.length > 4 && letters === letters.toUpperCase());
}

export const QuickReply = z.object({
  id: z.string().regex(QUICK_REPLY_ID_RE, "quick reply ids are 1-24 characters of a-z, 0-9, _ or -"),
  label: z.string().trim().min(2).max(QUICK_REPLY_LABEL_MAX).refine(isSentenceCase, "quick reply labels are sentence case"),
  say: z.string().trim().min(1).max(QUICK_REPLY_SAY_MAX),
  kind: z.enum(QUICK_REPLY_KINDS),
  /** For `choose_option`: the Inbox decision option id the press picks (`inbox.decide` chosenOption). */
  option_id: z.string().max(40).nullable().default(null),
  recommended: z.boolean().default(false),
});
export type QuickReply = z.infer<typeof QuickReply>;
export type QuickReplyInput = z.input<typeof QuickReply>;

export const AgentHandOff = z.object({
  /** The work, in the founder's terms, that the plan compiler turns into typed actions. */
  instruction: z.string().trim().min(1).max(HAND_OFF_MAX),
});
export type AgentHandOff = z.infer<typeof AgentHandOff>;

const AgentReplyShape = z.object({
  /** Markdown with `[[ent:<id>|Name]]` mentions from the manifest only. */
  bubbles: z.array(z.string().trim().min(1).max(AGENT_BUBBLE_MAX)).min(1).max(AGENT_BUBBLES_MAX),
  reaction: z.enum(AGENT_REACTIONS).default("none"),
  quick_replies: z.array(QuickReply).min(QUICK_REPLIES_MIN).max(QUICK_REPLIES_MAX),
  hand_off: AgentHandOff.nullable().default(null),
  refers_to: z.array(z.string().min(1).max(120)).max(REFERS_TO_MAX).default([]),
});

export const AgentReplyOutput = AgentReplyShape.refine((v) => v.quick_replies.filter((q) => q.recommended).length <= 1, {
  message: "at most one quick reply is recommended",
  path: ["quick_replies"],
})
  .refine((v) => new Set(v.quick_replies.map((q) => q.label.toLowerCase())).size === v.quick_replies.length, {
    message: "quick reply labels are unique",
    path: ["quick_replies"],
  })
  .refine((v) => new Set(v.quick_replies.map((q) => q.id)).size === v.quick_replies.length, {
    message: "quick reply ids are unique",
    path: ["quick_replies"],
  });
export type AgentReplyOutput = z.infer<typeof AgentReplyOutput>;
export type AgentReplyOutputInput = z.input<typeof AgentReplyOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// The founder's intent (deterministic; shared by the api's Inbox routing, the request builder and the mock)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What a founder message asks for. `question` and `acknowledge` / `decline` / `greeting` are conversation; only an
 * `instruction` is work, which becomes a hand-off (and, in the Inbox, may decide the item through the plan compiler).
 */
export type FounderIntent = "question" | "instruction" | "acknowledge" | "decline" | "greeting";

const ACK_RE = /^(?:thanks?|thank\s+you|cheers|great|perfect|nice|good|lovely|brilliant|ok(?:ay)?|got\s+it|sounds\s+good|makes\s+sense|carry\s+on|fine|noted)\b/i;
const DECLINE_RE = /^(?:no\b|nope|not\s+now|not\s+yet|hold\s+off|leave\s+it|skip\s+it|never\s*mind|let'?s\s+not|don'?t\b)/i;
const GREETING_RE = /^(?:hi|hello|hey|morning|good\s+(?:morning|afternoon|evening))\b[\s!.,]*$/i;
/** Verbs that make a "No, …" / "OK, …" reply an instruction ("go ahead" alone stays an acknowledgement). */
const WORK_RE =
  /\b(?:go\s+(?:with|for)|go\s+ahead\s+(?:with|and)|spend|start|pause|stop|enable|disable|launch|hire|book|send|pay|use|choose|pick|approve|reject|set|switch|cancel|order|buy|move|make|create|write|publish|ship|schedule|increase|decrease|raise|lower|cut|add|remove|delete|run|try|wait\s+for|hold\s+(?:the|it|until|for))\b/i;
/** "Can you pause the ads?" is work asked politely; "Can it ship this week?" is a question. */
const POLITE_REQUEST_RE = /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|will\s+you\s+)/i;
/** "Do we have budget" is a question; "Do the outbound option" / "Do what the note says" are instructions. */
const QUESTION_RE = /\?\s*$|^(?:why|what|what'?s|how|how'?s|when|where|who|which|is|are|was|were|does|did|should|shall|could|would|can|have|has|any)\b|^do\s+(?:we|you|i|they|it|he|she|these|those|people|customers|our|my|your|any)\b/i;
/**
 * Asking to be told something is a question however politely it is put ("Tell me more about the risk", "Can you explain
 * the cost", "I'm not sure about this"): in the Inbox it must reach the conversation, never decide the item.
 */
const INFO_REQUEST_RE =
  /^(?:(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|will\s+you\s+)*(?:explain|tell\s+me|walk\s+me\s+through|talk\s+me\s+through|remind\s+me|clarify|elaborate|describe|summari[sz]e|help\s+me\s+understand|say\s+more|give\s+me\s+(?:more\s+|some\s+)?(?:detail|details|context|background)|more\s+(?:detail|details|context|info)|expand\s+on)\b|i\s+(?:don'?t|do\s+not)\s+(?:understand|get\s+it|follow)|i'?m\s+not\s+sure|i\s+am\s+not\s+sure|i\s+wonder|i'?d\s+like\s+to\s+(?:know|understand)|i\s+want\s+to\s+(?:know|understand))/i;

/** The founder's intent: the pressed chip's kind when there is one, otherwise the shape of the text. */
export function founderIntent(text: string, chipKind?: string | null): FounderIntent {
  if (chipKind === "acknowledge") return "acknowledge";
  if (chipKind === "decline") return "decline";
  if (chipKind === "hand_off") return "instruction";
  if (chipKind === "ask") return "question";
  const t = text.trim();
  if (GREETING_RE.test(t)) return "greeting";
  // "No, go with content first" and "OK, spend €200 on Meta" open like a reply but carry work: they are instructions.
  const carriesWork = WORK_RE.test(t.replace(DECLINE_RE, "").replace(ACK_RE, ""));
  if (DECLINE_RE.test(t) && !carriesWork) return "decline";
  if (ACK_RE.test(t) && !carriesWork && !/\?\s*$/.test(t) && t.split(/\s+/).length <= 8) return "acknowledge";
  if (INFO_REQUEST_RE.test(t)) return "question";
  if (POLITE_REQUEST_RE.test(t)) return "instruction";
  if (QUESTION_RE.test(t)) return "question";
  return "instruction";
}

/**
 * A looser shape for the model call itself: the server (`finaliseAgentReply` in packages/agents) trims, pads, de-dupes
 * and re-checks into `AgentReplyOutput`, so a reply with a long label or a fifth quick reply is repaired locally instead
 * of costing a second model call.
 */
export const AgentReplyDraft = z.object({
  bubbles: z.array(z.string().describe("One short chat bubble, at most 320 characters; Markdown and [[ent:<id>|Name]] mentions from the manifest only.")).min(1).describe("1-3 bubbles, 60 words at most in total."),
  reaction: z.enum(AGENT_REACTIONS).describe("How you react to the founder's message."),
  quick_replies: z
    .array(
      z.object({
        id: z.string().describe("1-24 characters of a-z, 0-9, _ or -; unique in this reply."),
        label: z.string().describe("Sentence case, at most 36 characters; unique in this reply."),
        say: z.string().describe("What the founder says when they press it, at most 280 characters."),
        kind: z.enum(QUICK_REPLY_KINDS),
        option_id: z.string().nullable().describe("For choose_option: the decision option id from subject.options; otherwise null."),
        recommended: z.boolean().describe("At most one quick reply is recommended."),
      }),
    )
    .describe("2-4 quick replies the founder is likely to press next."),
  hand_off: z.object({ instruction: z.string().describe("The work in the founder's own terms, at most 600 characters.") }).nullable().describe("Set when the founder asks for work to be done; otherwise null."),
  refers_to: z.array(z.string()).describe("Source record ids the answer relies on (at most 5)."),
});
export type AgentReplyDraft = z.infer<typeof AgentReplyDraft>;
