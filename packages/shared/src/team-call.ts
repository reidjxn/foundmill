/**
 * Team call (docs/TEAM_CALL.md): a spoken call between the founder and their team of agents, and a one-to-one call with
 * one agent. The one shared contract every package codes against: the kinds and states, the limits, the accents and how
 * an agent gets its accent, the views the API answers with and the founder's sentences.
 *
 * Words (founder, Nov 12, 2026): the feature is "Team call"; how an agent sounds is its **accent**, because "voice"
 * already means how an agent writes (`AgentVoice`, the templates' `voice`). The vendor's own term (ElevenLabs'
 * `voice_id`) stays inside the connector.
 *
 * No Zod here (browser code imports this file, like `constants.ts`); the API's input schemas are built from these tuples.
 *
 * - A call is a business's record (`team_calls`, with `team_call_turns` and `team_call_actions`). `kind` is `team` (the
 *   founder and several agents) or `one_to_one` (the founder and one agent, started with Call on the agent's profile).
 *   Chat at the agent's desk (`agent.conversation.*`) is a separate surface and is unchanged.
 * - Agents speak to the founder and to each other: each round the turn director answers one to four spoken turns, each
 *   addressed to the founder, the whole team or one teammate. With "Let the team discuss" on, agents take further rounds
 *   on their own, at most `TEAM_CALL_LIMITS.agentRoundsWithoutFounder` in a row, then hand back to the founder.
 * - Agent text names a teammate as `[[ent:<agent uuid>|Name]]`; every reader renders it with their own display rules
 *   (anthropomorphic names or roles), and speech is rendered with the listener's rules before it is spoken aloud.
 * - Ending a call writes its summary and its action items. Each action item is a typed plan action (`create_task`,
 *   `update_roadmap`, `set_budget`, …) checked by the same policies as every decision: what is allowed is filed at once
 *   (a task in its department, an item on the roadmap); what needs the founder's go-ahead (money, contact with someone
 *   outside) waits as a plan to confirm; a hard gate is the founder's own step. Nothing in a call is ever reported as
 *   done before it is.
 */
import type { PersonaPresentation } from "./personas";
import { personaByKey } from "./personas";
import type { PlanActionType } from "./constants";

export const TEAM_CALL_KINDS = ["team", "one_to_one"] as const;
export type TeamCallKind = (typeof TEAM_CALL_KINDS)[number];

/** `live` while people speak; `wrapping_up` while the summary and actions are written; `ended` after. */
export const TEAM_CALL_STATUSES = ["live", "wrapping_up", "ended"] as const;
export type TeamCallStatus = (typeof TEAM_CALL_STATUSES)[number];

export const TEAM_CALL_SPEAKERS = ["founder", "agent"] as const;
export type TeamCallSpeaker = (typeof TEAM_CALL_SPEAKERS)[number];

/**
 * What became of one action item: `filed` (the task or roadmap item exists), `awaiting_go_ahead` (staged as a plan that
 * waits for the founder's confirmation), `founder_step` (a hard gate: the founder does it personally), `not_filed`
 * (refused by policy or a section wall; `reason` says why).
 */
export const TEAM_CALL_ACTION_STATUSES = ["filed", "awaiting_go_ahead", "founder_step", "not_filed"] as const;
export type TeamCallActionStatus = (typeof TEAM_CALL_ACTION_STATUSES)[number];

/** What a filed action item points at. */
export const TEAM_CALL_TARGET_KINDS = ["task", "roadmap_item", "plan"] as const;
export type TeamCallTargetKind = (typeof TEAM_CALL_TARGET_KINDS)[number];

/** Whom a spoken agent turn is addressed to: the founder (or founders), the whole room, or one teammate (an agent id). */
export type TeamCallAddressee = "founder" | "team" | { agentId: string };

export const TEAM_CALL_LIMITS = {
  /** Agents in one team call: the Chief of Staff and the leads first. A one-to-one call has exactly one. */
  maxAgentsInTeamCall: 8,
  /** One spoken agent turn, in characters (a few sentences; it is spoken aloud). */
  maxTurnChars: 600,
  /** What the founder says in one go, in characters (typed or transcribed). */
  maxFounderChars: 2000,
  /** Agent turns the director may answer in one round. */
  maxTurnsPerRound: 4,
  /** Rounds the agents take on their own before they hand back to the founder. */
  agentRoundsWithoutFounder: 3,
  /** Turns in one call, founder and agents together; past it the call asks to be wrapped up. */
  maxTurnsPerCall: 300,
  /** Turns of history the director reads (the newest). */
  historyTurns: 40,
  /** A topic, in characters. */
  maxTopicChars: 200,
  /** Action items written when a call ends. */
  maxActionsPerCall: 20,
  /**
   * One recording sent for transcription: 1.4 MB, so its base64 stays inside the api's 2 MB request body (about a
   * minute and a half of speech in opus). A longer turn is cut there by the call's own 60-second cap first.
   */
  maxAudioBytes: 1_400_000,
  /** Audio transcribed per business per UTC day, in bytes (the gateway's ceiling; about three hours of opus speech). */
  transcriptionBytesPerBusinessPerDay: 50_000_000,
  /**
   * Model rounds in one call (opening, replies, agent-only rounds; the wrap-up is one more): the call's spend ceiling,
   * since agents talking to each other could otherwise run up cost. Past it the call asks to be wrapped up.
   */
  maxModelRoundsPerCall: 60,
  /** Characters spoken aloud per business per UTC day, across every call (the gateway's ceiling). */
  speechCharsPerBusinessPerDay: 60_000,
  /** How long the founder stays silent before "Let the team discuss" lets the agents carry on, in ms. */
  discussAfterSilenceMs: 4_000,
} as const;

/** The audio types a recording may be sent in (what MediaRecorder makes in the browsers we support). */
export const TEAM_CALL_AUDIO_MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;
export type TeamCallAudioMime = (typeof TEAM_CALL_AUDIO_MIMES)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Accents: how each agent sounds
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One accent an agent can speak with. The vendor's id for it is not here: the gateway maps an accent key to the speech
 * vendor's voice id (`packages/connectors` `elevenlabs/speech-accents.ts`, overridable by `ELEVENLABS_SPEECH_ACCENT_IDS`), so the api
 * only ever names an accent. Keys are stable identifiers: never rename or reuse one; add accents at the end.
 *
 * `fallback` is how the browser's own speech is tuned for this accent when speech is simulated (mock mode), so agents
 * still sound different from each other in development.
 */
export interface SpeechAccent {
  key: string;
  presentation: PersonaPresentation;
  /** A few words on how it sounds (for Settings and tests; never spoken). */
  tone: string;
  fallback: { pitch: number; rate: number };
}

/** ElevenLabs' permanent voices (their replacements for the default voices retired Dec 31, 2026), checked Nov 12, 2026. */
export const SPEECH_ACCENTS: readonly SpeechAccent[] = [
  { key: "talia", presentation: "woman", tone: "warm, soft", fallback: { pitch: 1.1, rate: 0.98 } },
  { key: "darian", presentation: "man", tone: "warm, grounded", fallback: { pitch: 0.85, rate: 0.96 } },
  { key: "elara", presentation: "woman", tone: "crisp, professional", fallback: { pitch: 1.0, rate: 1.04 } },
  { key: "baxter", presentation: "man", tone: "dry, calm, Australian", fallback: { pitch: 0.95, rate: 1.0 } },
  { key: "elowen", presentation: "woman", tone: "upbeat, modern", fallback: { pitch: 1.2, rate: 1.06 } },
  { key: "eldrin", presentation: "man", tone: "crisp British baritone", fallback: { pitch: 0.75, rate: 0.97 } },
  { key: "alicia", presentation: "woman", tone: "polished, clear", fallback: { pitch: 1.05, rate: 1.02 } },
  { key: "lawrence", presentation: "man", tone: "bright, informative", fallback: { pitch: 1.0, rate: 1.05 } },
  { key: "maisie", presentation: "woman", tone: "friendly, casual", fallback: { pitch: 1.25, rate: 1.0 } },
  { key: "warren", presentation: "man", tone: "easy, cool", fallback: { pitch: 0.9, rate: 0.99 } },
  { key: "jade", presentation: "woman", tone: "upbeat, natural", fallback: { pitch: 1.15, rate: 1.08 } },
  { key: "eddie", presentation: "man", tone: "natural, helpful", fallback: { pitch: 1.05, rate: 1.02 } },
  { key: "florence", presentation: "woman", tone: "calm, atmospheric", fallback: { pitch: 0.95, rate: 0.95 } },
  { key: "caleb", presentation: "man", tone: "steady, trusted", fallback: { pitch: 0.88, rate: 1.0 } },
  { key: "sawyer", presentation: "man", tone: "low, unhurried", fallback: { pitch: 0.7, rate: 0.93 } },
  { key: "finley", presentation: "man", tone: "articulate, clear", fallback: { pitch: 0.98, rate: 1.03 } },
  { key: "wyatt", presentation: "man", tone: "seasoned, kind", fallback: { pitch: 0.8, rate: 0.94 } },
  { key: "callum", presentation: "man", tone: "husky, playful", fallback: { pitch: 0.92, rate: 1.07 } },
  { key: "kaelen", presentation: "man", tone: "bold, lively", fallback: { pitch: 1.0, rate: 1.1 } },
];

export type SpeechAccentKey = string;

const SPEECH_ACCENT_BY_KEY = new Map(SPEECH_ACCENTS.map((s) => [s.key, s] as const));

export function speechAccent(key: string | null | undefined): SpeechAccent | null {
  return key ? (SPEECH_ACCENT_BY_KEY.get(key) ?? null) : null;
}

export const isSpeechAccentKey = (v: unknown): v is SpeechAccentKey => typeof v === "string" && SPEECH_ACCENT_BY_KEY.has(v);

/** FNV-1a, so a key always prefers the same accent without a crypto dependency. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** What accent assignment reads of an agent. Pass every agent the business ever hired, released ones too. */
export interface SpeechAccentAgent {
  id: string;
  personaKey?: string | null;
  /** Hire order: an earlier agent keeps its default accent when a later one would want the same. */
  createdAt: Date | string;
  /** The founder's own choice for this agent (`agents.speech_accent`), which wins over the default. */
  speechAccent?: string | null;
}

/**
 * The presentation an agent's accent matches: its persona's (`presentation` only; never `heritage`, which exists only to
 * make the set of portraits diverse), else a stable pick from the id. Not the character style: the style changes the name
 * and face on screen, while an agent's accent stays the same for its whole life (founder, Nov 12, 2026).
 */
export function speechAccentPresentation(agent: Pick<SpeechAccentAgent, "id" | "personaKey">): PersonaPresentation {
  const persona = personaByKey(agent.personaKey);
  if (persona) return persona.presentation;
  return hash32(agent.id) % 2 === 0 ? "woman" : "man";
}

/**
 * Each agent's default accent, by agent id. Deterministic: agents are taken in hire order (then id); each prefers the
 * accent its persona key (or id) hashes to among the accents of its presentation and takes the first one after it nobody
 * has yet, so a business gets a varied set (unique while accents last) and an agent's default never changes when a later
 * agent is hired. Past the accents of one presentation, they repeat. The founder's own choices are not read here, so
 * changing one agent's accent never moves another's.
 */
export function defaultSpeechAccents(agents: readonly SpeechAccentAgent[]): Map<string, SpeechAccentKey> {
  const ordered = [...agents].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return ta !== tb ? ta - tb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const used = new Set<string>();
  const out = new Map<string, SpeechAccentKey>();
  for (const agent of ordered) {
    const presentation = speechAccentPresentation(agent);
    const pool = SPEECH_ACCENTS.filter((s) => s.presentation === presentation);
    const start = hash32(agent.personaKey || agent.id) % pool.length;
    let chosen = pool[start]!;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[(start + i) % pool.length]!;
      if (!used.has(candidate.key)) {
        chosen = candidate;
        break;
      }
    }
    used.add(chosen.key);
    out.set(agent.id, chosen.key);
  }
  return out;
}

/**
 * Each agent's accent, by agent id: the founder's choice where they made one (and it is still an accent we have), else the
 * default. The only way any surface learns how an agent sounds, so it is the same in every call, team or one-to-one.
 */
export function assignSpeechAccents(agents: readonly SpeechAccentAgent[]): Map<string, SpeechAccentKey> {
  const out = defaultSpeechAccents(agents);
  for (const agent of agents) if (isSpeechAccentKey(agent.speechAccent)) out.set(agent.id, agent.speechAccent);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Views (what `teamCall.*` answers)
// ---------------------------------------------------------------------------------------------------------------------

/** One agent on the call: everything the persona rules need to name and picture it as everywhere else. */
export interface TeamCallParticipantView {
  agentId: string;
  /** Stored name and role; the screen names the agent through `useAgentPersona()` like every other surface. */
  name: string;
  role: string;
  personaKey: string | null;
  avatarSeed: string;
  layer: string;
  agentType: string;
  /** The first department's color token (the tile's ring); null outside a department. */
  colourToken: string | null;
  departmentId: string | null;
  speechAccent: SpeechAccentKey;
  isChiefOfStaff: boolean;
}

export interface TeamCallTurnView {
  id: string;
  seq: number;
  speaker: TeamCallSpeaker;
  /** The agent who spoke (agent turns). */
  agentId: string | null;
  /** The person who spoke (founder turns). */
  userId: string | null;
  /** Agent text may name teammates as `[[ent:<uuid>|Name]]`; render it with EntityLink / `withNames`. */
  text: string;
  /** Whom an agent turn is addressed to. */
  to: TeamCallAddressee | null;
  /** How a founder turn arrived: spoken (transcribed) or typed. */
  via: "spoken" | "typed" | null;
  createdAt: string;
}

export interface TeamCallActionView {
  id: string;
  actionType: PlanActionType;
  /** One line in founder words ("Draft the launch email for the waitlist"). */
  title: string;
  detail: string | null;
  /** The department that does it (its name is read from the department, never hard-coded); null for business-wide. */
  departmentId: string | null;
  agentId: string | null;
  status: TeamCallActionStatus;
  target: { kind: TeamCallTargetKind; id: string } | null;
  planId: string | null;
  /** Why it was not filed, or what the go-ahead is for. */
  reason: string | null;
}

/**
 * Who reads a call (founder, Nov 12, 2026): a team call is the project's; a one-to-one call is `private` to the person who
 * made it unless they share their one-to-one calls with the project in Settings › Preferences (default: private). The
 * work a call files is the project's either way.
 */
export const TEAM_CALL_VISIBILITIES = ["project", "private"] as const;
export type TeamCallVisibility = (typeof TEAM_CALL_VISIBILITIES)[number];

export interface TeamCallView {
  id: string;
  kind: TeamCallKind;
  status: TeamCallStatus;
  visibility: TeamCallVisibility;
  topic: string | null;
  startedAt: string;
  endedAt: string | null;
  startedBy: string | null;
  participants: TeamCallParticipantView[];
  turns: TeamCallTurnView[];
  /** Plain text, written when the call ends. */
  summary: string | null;
  actions: TeamCallActionView[];
  /** Agent rounds since the founder last spoke: "Let the team discuss" stops at the limit. */
  agentRoundsSinceFounder: number;
  /** True when the viewer may speak, let the team continue and end the call (Team write). */
  canSpeak: boolean;
}

export interface TeamCallSummaryView {
  id: string;
  kind: TeamCallKind;
  status: TeamCallStatus;
  visibility: TeamCallVisibility;
  topic: string | null;
  startedAt: string;
  endedAt: string | null;
  agentIds: string[];
  turnCount: number;
  actionCount: number;
  filedCount: number;
  awaitingCount: number;
  /** The first sentence of the summary, once written. */
  summaryLine: string | null;
}

/** One round's answer: the founder's turn when they spoke, and the agents' replies in speaking order. */
export interface TeamCallRoundView {
  founderTurn: TeamCallTurnView | null;
  turns: TeamCallTurnView[];
  /** True when the agents expect the founder next (a question to them, or the agent-round limit reached). */
  handBack: boolean;
  agentRoundsSinceFounder: number;
}

/** Whether speech and transcription are real here. `simulated`: the browser's own speech and recognizer stand in. */
export interface TeamCallSpeechModes {
  speech: "live" | "simulated";
  transcription: "live" | "simulated";
  /** Shown once on the call when anything is simulated. */
  notice: string | null;
}

export interface TeamCallSpeechView {
  turnId: string;
  speechAccent: SpeechAccentKey;
  /** Live: the spoken turn. Simulated: a short silent WAV the call plays for timing (or the browser's speech speaks). */
  mime: "audio/mpeg" | "audio/wav";
  base64: string;
  simulated: boolean;
  /** The words spoken, with names as this listener reads them (what the browser's speech says when simulated). */
  spokenText: string;
}

export interface TeamCallTranscriptView {
  text: string;
  simulated: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------

export const TEAM_CALL_WORDS = {
  title: "Team call",
  lobbyLine: "Talk your project through with your team. They discuss it with you and with each other, and file what you agree when you end the call.",
  startTeam: "Start a team call",
  call: "Call",
  chat: "Chat",
  endTeamCall: "End call and file actions",
  endCall: "End call",
  discuss: "Let the team discuss",
  typeInstead: "Type instead",
  you: "You",
  listening: "Listening",
  muted: "Mic off",
  wrappingUp: "Writing up what you agreed",
  simulatedNotice: "Your team is speaking with your browser's built-in speech, and your browser is recognizing what you say: their own accents are not switched on here.",
  emptyHistory: "No calls yet. Your first one takes a minute: say what is on your mind and the team picks it up.",
  actionsHeading: "What the team will do",
  awaiting: "Needs your go-ahead",
  founderStep: "Yours to do",
  notFiled: "Not filed",
  roundLimit: "The team has talked it through. Your turn.",
  noMic: "Your browser did not give access to the microphone. You can type instead.",
  privateCall: "Only you can see this call",
  shareSettingTitle: "Share my one-to-one calls",
  shareSettingHint: "Off: only you can see your calls with one agent. On: everyone on the project can read them. Team calls are always the project's, and what a call files (tasks, roadmap items) is the project's either way.",
} as const;

/** "3 filed · 1 needs your go-ahead": the line under a finished call. */
export function teamCallActionsLine(actions: readonly Pick<TeamCallActionView, "status">[]): string {
  if (actions.length === 0) return "Nothing to file from this call.";
  const count = (s: TeamCallActionStatus) => actions.filter((a) => a.status === s).length;
  const awaiting = count("awaiting_go_ahead");
  const parts = [
    count("filed") > 0 ? `${count("filed")} filed` : null,
    awaiting > 0 ? `${awaiting} need${awaiting === 1 ? "s" : ""} your go-ahead` : null,
    count("founder_step") > 0 ? `${count("founder_step")} yours to do` : null,
    count("not_filed") > 0 ? `${count("not_filed")} not filed` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Spoken words: entity markup reduced to the names given (the listener's display rules), anything unspeakable dropped. */
export function spokenText(text: string, nameFor: (id: string, storedName: string) => string): string {
  return text
    .replace(/\[\[ent:([0-9a-f-]{36})\|([^\]]*)\]\]/gi, (_m, id: string, name: string) => nameFor(id.toLowerCase(), name))
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
