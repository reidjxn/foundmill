/**
 * The agent's voice kit (audit-conversation §3): how an agent greets, what its typing line says while a reply is in
 * flight, and how it acknowledges a nudge or a quick "thanks", all without a model call so they appear instantly.
 *
 * Derived from the template's family and tone in `defineTemplate`, so a terse engineer sounds terse ("Checking the
 * branch…", "Understood.") and the Chief of Staff sounds calm ("Looking across the team…"). Agents feel like colleagues
 * through voice, presence and current work; they never claim to be human (house rule 3), so no line here says or
 * implies a person, a body or a place.
 */
import { stableHash } from "@foundmill/models";
import type { AgentVoice, TemplateFamily } from "./types";

export type VoiceRegister = "silent" | "terse" | "numerate" | "measured" | "marketer" | "practical" | "calm" | "plain";

const REGISTER_VOICES: Record<VoiceRegister, AgentVoice> = {
  silent: { greeting: "Ready.", thinking: ["Processing the input…", "Checking the fields…"], ack: ["Noted.", "Understood."] },
  terse: {
    greeting: "Hi. Ask me about the code, the tests or my changes.",
    thinking: ["Checking my changes…", "Reading the test output…", "Looking at the diff…"],
    ack: ["Understood.", "Noted. Changing course in this step.", "Clear."],
  },
  numerate: {
    greeting: "Hi. Which figures shall we look at?",
    thinking: ["Pulling the figures…", "Checking the basis…", "Reconciling the records…"],
    ack: ["Noted.", "Understood. I'll keep the figures labeled.", "Clear."],
  },
  measured: {
    greeting: "Hello. What would you like me to look at?",
    thinking: ["Reading the relevant terms…", "Checking the wording…", "Looking up the deadline…"],
    ack: ["Understood.", "Noted. I'll flag anything that needs a professional.", "Thank you, that's clear."],
  },
  marketer: {
    greeting: "Hi. Want the latest on the channel?",
    thinking: ["Checking the channel numbers…", "Looking at the audience…", "Pulling the campaign results…"],
    ack: ["Got it.", "Noted. I'll keep it within the cap.", "Understood."],
  },
  practical: {
    greeting: "Hello. What do you need checked?",
    thinking: ["Checking the spec sheet…", "Looking at the dates…", "Going through the supplier notes…"],
    ack: ["Understood.", "Noted. I'll keep the tolerances in view.", "Clear."],
  },
  calm: {
    greeting: "Hi. Ask me about the plan, the team or anything waiting on you.",
    thinking: ["Checking the plan…", "Looking across the team…", "Pulling up what's open…"],
    ack: ["Got it.", "Understood. I'll fold it into the plan.", "Noted."],
  },
  plain: {
    greeting: "Hi. What can I help with?",
    thinking: ["Looking into it…", "Checking the sources…", "Reading through the notes…"],
    ack: ["Got it.", "Understood.", "Noted, thanks."],
  },
};

/** Which register a template speaks in: its family first (utilities are silent, channels market), then its tone. */
export function voiceRegister(family: TemplateFamily, tone: string): VoiceRegister {
  const t = tone.toLowerCase();
  if (family === "utility" || /\bsilent\b|json only/.test(t)) return "silent";
  if (family === "channel" || /marketer/.test(t)) return "marketer";
  if (family === "assistant") return "calm";
  if (/\bterse\b|engineering notes|operational log|technical\b/.test(t) && !/tolerances|units/.test(t)) return "terse";
  if (/disclaimer|plain english|measured/.test(t)) return "measured";
  if (/tolerances|sequenced|practical/.test(t)) return "practical";
  if (/numerate|basis|units|labels/.test(t)) return "numerate";
  if (/\bcalm\b/.test(t)) return "calm";
  return "plain";
}

export interface DeriveVoiceInput {
  family: TemplateFamily;
  tone: string;
}

/** The voice for a template. Deterministic: the same family and tone always give the same voice. */
export function deriveVoice(input: DeriveVoiceInput): AgentVoice {
  const base = REGISTER_VOICES[voiceRegister(input.family, input.tone)];
  return { greeting: base.greeting, thinking: [...base.thinking], ack: [...base.ack] };
}

/** The voice of an agent whose type has no template (a custom agent): the plain register. */
export const DEFAULT_VOICE: AgentVoice = deriveVoice({ family: "worker", tone: "" });

const pick = <T>(items: readonly T[], seed: string): T => items[Number.parseInt(stableHash(seed).slice(0, 8), 16) % items.length] as T;

/** Lower-case the first letter unless the word looks like a name or an acronym ("Carton proof" → "carton proof", "PR 12" stays). */
function inSentence(title: string): string {
  const first = title.split(/\s+/)[0] ?? "";
  if (first.length > 1 && first === first.toUpperCase()) return title;
  return title.charAt(0).toLowerCase() + title.slice(1);
}

/**
 * The typing line while a reply is in flight. It names what the agent is looking at when there is something to name
 * ("Checking carton artwork proof round 2…"); otherwise a line from the voice, picked deterministically by `seed`.
 */
export function thinkingLine(voice: AgentVoice, options: { lookingAt?: string | null; seed?: string } = {}): string {
  const at = options.lookingAt?.trim();
  // A subject that is itself a question ("Where should the first customer come from?") reads badly after "Checking",
  // so the agent's own thinking line is used instead.
  if (at && !/\?\s*$/.test(at)) {
    const short = at.length > 44 ? `${at.slice(0, 43).replace(/\s+\S*$/, "")}` : at;
    return `Checking ${inSentence(short)}…`;
  }
  return pick(voice.thinking, `thinking:${options.seed ?? ""}`);
}

/** A one-bubble acknowledgement in the agent's voice (nudges, "Thanks"), picked deterministically by `seed`. */
export function ackLine(voice: AgentVoice, seed = ""): string {
  return pick(voice.ack, `ack:${seed}`);
}
