/**
 * The browser's own speech and recording for the call (docs/TEAM_CALL.md §6): the helpers that choose a voice for an
 * accent when speech is simulated, estimate how long a line takes to say, and prepare a recording for transcription.
 * Pure where it can be; the DOM objects arrive as arguments so the rules are tested without a browser.
 */
import { TEAM_CALL_AUDIO_MIMES, speechAccent, type SpeechAccentKey, type TeamCallAudioMime } from "@foundmill/shared/team-call";

type Presentation = "woman" | "man";

/** Spoken words a minute, the same figure the mock speech uses for its silent clip. */
const WORDS_PER_MINUTE = 150;

/** How long a line takes to say, in ms (at least 600): the timing of a silent clip and of a line whose speech failed. */
export function estimateSpeakMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(600, Math.round((words / WORDS_PER_MINUTE) * 60_000));
}

/** `data:<mime>;base64,<data>` for an <audio> element. */
export const toDataUrl = (mime: string, base64: string) => `data:${mime};base64,${base64}`;

const FEMALE_HINT = /\b(female|woman|samantha|karen|moira|tessa|fiona|victoria|allison|ava|susan|zira|hazel|serena|kate|jenny|aria|libby|sonia|catherine|veena|google uk english female|google us english)\b/i;
const MALE_HINT = /\b(male|man|alex|daniel|david|fred|tom|oliver|arthur|aaron|mark|james|guy|ryan|george|rishi|google uk english male)\b/i;

/** A stable index from a key, so an accent always picks the same voice among those that fit. */
function hashIndex(key: string, length: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return length === 0 ? 0 : h % length;
}

export interface VoiceLike {
  name: string;
  lang: string;
  default?: boolean;
}

/**
 * The browser voice for an accent: English voices first (US before the rest), those that sound like the accent's
 * presentation (by the voice's name; browsers publish no gender), and among them a stable pick from the accent key, so
 * two agents of one presentation usually differ. Null when the browser has no voices (it then uses its default).
 */
export function pickBrowserVoice<V extends VoiceLike>(voices: readonly V[], accentKey: SpeechAccentKey): V | null {
  if (voices.length === 0) return null;
  const presentation: Presentation = speechAccent(accentKey)?.presentation === "woman" ? "woman" : "man";
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = english.length > 0 ? english : voices;
  const us = pool.filter((v) => /^en[-_]us$/i.test(v.lang));
  const base = us.length > 0 ? us : pool;
  const fitting = base.filter((v) => (presentation === "woman" ? FEMALE_HINT.test(v.name) && !MALE_HINT.test(v.name) : MALE_HINT.test(v.name) && !FEMALE_HINT.test(v.name)));
  const choices = fitting.length > 0 ? fitting : pool.filter((v) => (presentation === "woman" ? FEMALE_HINT : MALE_HINT).test(v.name));
  const from = choices.length > 0 ? choices : base;
  return from[hashIndex(accentKey, from.length)] ?? null;
}

/** The pitch and rate the browser's speech uses for an accent (the accent's `fallback`; neutral for an unknown key). */
export function utteranceTuning(accentKey: SpeechAccentKey): { pitch: number; rate: number } {
  return speechAccent(accentKey)?.fallback ?? { pitch: 1, rate: 1 };
}

/** What MediaRecorder should record in, best first: opus in webm where the browser supports it. */
const RECORDER_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"] as const;

export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  return RECORDER_MIMES.find((m) => isSupported(m)) ?? null;
}

/** The type `teamCall.transcribe` accepts for a recorder's mime ("audio/webm;codecs=opus" → "audio/webm"), else null. */
export function audioMimeOf(mime: string): TeamCallAudioMime | null {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return (TEAM_CALL_AUDIO_MIMES as readonly string[]).includes(base) ? (base as TeamCallAudioMime) : null;
}

/** A recording as base64 (no data-URL prefix), for `teamCall.transcribe`. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** The browser's recognizer constructor, when it has one (Chrome and Safari prefix it). */
export interface RecognizerLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognizerCtor = new () => RecognizerLike;

export function recognizerCtor(w: Window | undefined = typeof window === "undefined" ? undefined : window): RecognizerCtor | null {
  const g = w as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor } | undefined;
  return g?.SpeechRecognition ?? g?.webkitSpeechRecognition ?? null;
}
