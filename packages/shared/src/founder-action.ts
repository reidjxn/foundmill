/**
 * Founder-executed actions (founder, 2026-11-22): "the agent never decides or calls submit and pay; the founder's press
 * does, so this is the founder filing, not agent code acting in their name." An agent prepares a request (a row and one
 * Needs you note that shows exactly what the press will do); the founder's one press, in a signed-in session, asks the
 * gateway to run the vendor tool from a single-use token bound to the hash of that exact payload. This file holds the
 * words both sides share: the note's key, the hash of a payload, and the sentences the note and its answer use.
 */
import { createHash } from "node:crypto";

export const FOUNDER_ACTION_KEY_PREFIX = "founder_action:";
/** How long a press token lives: it is minted at the press and spent in the same second or two. */
export const FOUNDER_ACTION_PRESS_TTL_SECONDS = 120;

/** The founder-executed request a note decides (its `decision.key` is `founder_action:<id>`), or null for any other note. */
export function founderActionIdOfDecision(decision: unknown): string | null {
  const key = decision && typeof decision === "object" ? (decision as { key?: unknown }).key : null;
  if (typeof key !== "string" || !key.startsWith(FOUNDER_ACTION_KEY_PREFIX)) return null;
  const id = key.slice(FOUNDER_ACTION_KEY_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** Deterministic JSON (sorted keys): the same canonical form the gateway's `canonicalJson` writes. */
export const canonicalPayload = (payload: unknown): string => JSON.stringify(sortKeys(payload));

/** sha256, lowercase hex (all 64 characters), of a payload's canonical JSON. */
export const founderActionPayloadHash = (payload: unknown): string => createHash("sha256").update(canonicalPayload(payload)).digest("hex");

/** The Lightbringer patent request: the note's words (founder, 2026-11-22). The press asks; it files nothing and pays nothing. */
export const PATENT_REQUEST_NOTE = {
  subject: "Ask Lightbringer to prepare your patent filing",
  options: { run: "founder_action_run", later: "founder_action_later" },
  runLabel: "Ask Lightbringer to prepare this patent",
  laterLabel: "Not now",
  timing: "Showing an invention in public before you file can cost the right to patent it.",
  /** Shown in the note: what the press does and does not do. */
  does: "What this press does: it tells Lightbringer you want this invention prepared for a patent filing. Their team emails you next.",
  doesNot: "What it does not do: it files nothing and pays nothing. Lightbringer quotes its fee and takes payment and terms itself, with you.",
  sentTo: "Sent to: Lightbringer's patent team, from your own Lightbringer account",
  /** The answers the press gets back. */
  done: "Lightbringer has your request. Their team emails you next.",
  simulated: "This was simulated and not sent: Lightbringer is not connected for real here.",
  voided: "The invention changed after you were asked. Here is a new request to check.",
  /** The vendor call may have run and nothing proves it did not: never "Nothing was sent". */
  unknown: "The request may have reached Lightbringer. Check in your Lightbringer account before you ask again.",
  /** The first lines of a new request for an invention whose earlier request had an unknown result. */
  earlierUnknown: "A previous request for this invention had an unknown result: it may have reached Lightbringer. Check in your Lightbringer account before you press this one.",
  notSent: (reason: string): string => `Nothing was sent: ${reason}`,
  later: "Not now. The request stays unsent.",
} as const;


/** The invention a note shows: typed fields only (`get_innovation`'s typed read), never free text from the vendor. */
export interface InventionFacts {
  inventionId: string;
  title: string | null;
  refNum: string | null;
  contentHash: string;
}

/** The note the founder reads: every line says what the press does, and nothing is taken from the vendor beyond the typed title and reference. */
export function patentRequestNote(input: { facts: InventionFacts; founderName: string | null; intro?: string }): { subject: string; bodyMd: string; lines: string[]; options: unknown[] } {
  const quotedTitle = input.facts.title ? `"${input.facts.title}"` : "(its title is shown in Lightbringer)";
  const lines = [
    `Invention: ${quotedTitle}${input.facts.refNum ? `, Lightbringer reference ${input.facts.refNum}` : ""}`,
    `Requested by: ${input.founderName ?? "you"}`,
    PATENT_REQUEST_NOTE.sentTo,
    PATENT_REQUEST_NOTE.does,
    PATENT_REQUEST_NOTE.doesNot,
    PATENT_REQUEST_NOTE.timing,
  ];
  return {
    subject: PATENT_REQUEST_NOTE.subject,
    bodyMd: [...(input.intro ? [input.intro] : []), ...lines].join("\n\n"),
    lines,
    options: [
      { id: PATENT_REQUEST_NOTE.options.run, label: PATENT_REQUEST_NOTE.runLabel, recommended: true, consequence: "Lightbringer's patent team is asked to prepare this invention and emails you next. Nothing is filed or paid.", because: PATENT_REQUEST_NOTE.timing, cost_minor: 0, reversible: false },
      { id: PATENT_REQUEST_NOTE.options.later, label: PATENT_REQUEST_NOTE.laterLabel, recommended: false, consequence: "Nothing is sent. The request stays unsent.", cost_minor: 0, reversible: true },
    ],
  };
}
