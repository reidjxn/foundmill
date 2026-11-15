/**
 * Speech accent → the vendor's id. How an agent sounds is its accent (`SPEECH_ACCENTS`, packages/shared team-call.ts); ElevenLabs
 * calls the thing it speaks with a `voice_id`, and that word stays in this connector. The defaults are ElevenLabs'
 * permanent replacement voices (the library's defaults retire Dec 31, 2026), checked against their docs on Nov 12, 2026.
 * `ELEVENLABS_SPEECH_ACCENT_IDS` (JSON `{ "<accent>": "<voice_id>" }`) replaces them key by key, so an operator can point an
 * accent at a cloned or licensed voice without a deploy of code.
 */
import { SPEECH_ACCENTS, isSpeechAccentKey } from "@foundmill/shared";

export const SPEECH_ACCENT_IDS: Readonly<Record<string, string>> = Object.freeze({
  talia: "OZ0L6eISlOejga3XjDFt",
  darian: "gOupLcAkjEnguROwi4oS",
  elara: "WQP7cQUF5aAS6Axh5yaa",
  baxter: "jSuBIjxMKhqIfb0wCK1F",
  elowen: "dvbL7qkNGZY1IqPGZAjM",
  eldrin: "6WwXjDDEMyNmFG95zycZ",
  alicia: "BFd5oBc2DDna33pSi4Gf",
  lawrence: "ktkP7Nsj67dw2zcplQYt",
  maisie: "QtY3JBOUKEB5xzrRfOKc",
  warren: "7QN34D2r3hCNwbOYIeK0",
  jade: "g7LVvkPWALzPxOQbF6OE",
  eddie: "l7kNoIfnJKPg7779LI2t",
  florence: "22N9cF8z0o7y23njdyaY",
  caleb: "AaOhDHYJ1XLZk74lXhdE",
  sawyer: "8dEUmyPMdDdK91vboYih",
  finley: "fnYMz3F5gMEDGMWcH1ex",
  wyatt: "FrS6cKLB1wg4WYgPa9GW",
  callum: "fs2OqxduwXgp9foh2xjK",
  kaelen: "10NkTYmU7tSz3Kkl3Lex",
});

/** What an id may look like: it goes into a URL path, so nothing else is accepted from configuration. */
const ID_SHAPE = /^[A-Za-z0-9]{10,40}$/;

export interface ResolvedSpeechAccentIds {
  /** One id per accent in `SPEECH_ACCENTS`: the default, or the operator's override. */
  ids: Readonly<Record<string, string>>;
  /** Sentences for the operator's log (accent keys only, never an id's value); empty when the override was clean. */
  warnings: string[];
}

/** Parses `ELEVENLABS_SPEECH_ACCENT_IDS` once. A bad override is ignored with a warning and never stops the call. */
export function resolveSpeechAccentIds(raw?: string): ResolvedSpeechAccentIds {
  const ids: Record<string, string> = { ...SPEECH_ACCENT_IDS };
  const warnings: string[] = [];
  const text = raw?.trim();
  if (!text) return { ids, warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ids, warnings: ["ELEVENLABS_SPEECH_ACCENT_IDS is not valid JSON; the default accents are used"] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ids, warnings: ['ELEVENLABS_SPEECH_ACCENT_IDS must be a JSON object like {"talia":"<id>"}; the default accents are used'] };
  for (const [key, value] of Object.entries(parsed)) {
    const label = key.slice(0, 40);
    if (!isSpeechAccentKey(key)) warnings.push(`ELEVENLABS_SPEECH_ACCENT_IDS names an unknown accent "${label}"; it is ignored`);
    else if (typeof value !== "string" || !ID_SHAPE.test(value)) warnings.push(`ELEVENLABS_SPEECH_ACCENT_IDS has an invalid id for "${label}"; the default is used`);
    else ids[key] = value;
  }
  return { ids, warnings };
}

/** The vendor's id for an accent: the override table when given, else the defaults; null for a key that is not an accent. */
export const speechAccentId = (key: string, ids: Readonly<Record<string, string>> = SPEECH_ACCENT_IDS): string | null => (isSpeechAccentKey(key) ? (ids[key] ?? null) : null);

/** Every accent has an id (the tests hold this to `SPEECH_ACCENTS`). */
export const speechAccentsWithoutId = (ids: Readonly<Record<string, string>>): string[] => SPEECH_ACCENTS.filter((s) => !ids[s.key]).map((s) => s.key);
