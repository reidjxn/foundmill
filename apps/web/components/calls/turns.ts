/**
 * Pure rules of the call screen (docs/TEAM_CALL.md §6): merging a round's turns into the call, which turns to speak when
 * the screen opens, and when "Let the team discuss" lets the agents carry on.
 */
import { TEAM_CALL_LIMITS, type TeamCallKind, type TeamCallRoundView, type TeamCallTurnView } from "@foundmill/shared/team-call";

/** The call's turns with a round's turns added: by `seq`, each turn once (a retried send returns the same turns). */
export function mergeTurns(existing: readonly TeamCallTurnView[], round: Pick<TeamCallRoundView, "founderTurn" | "turns">): TeamCallTurnView[] {
  const byId = new Map(existing.map((t) => [t.id, t] as const));
  for (const t of [round.founderTurn, ...round.turns]) if (t) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** How recent an agent turn must be to be spoken when the screen opens (a call just started, not one reloaded long after). */
export const FRESH_TURN_MS = 60_000;

/** The agent turns after the founder's last words that were written just now: spoken when the call screen opens. */
export function turnsToSpeakOnOpen(turns: readonly TeamCallTurnView[], now: number, freshMs = FRESH_TURN_MS): TeamCallTurnView[] {
  let lastFounder = -1;
  turns.forEach((t, i) => {
    if (t.speaker === "founder") lastFounder = i;
  });
  return turns.slice(lastFounder + 1).filter((t) => t.speaker === "agent" && t.agentId !== null && now - new Date(t.createdAt).getTime() <= freshMs);
}

export interface DiscussInput {
  kind: TeamCallKind;
  discussOn: boolean;
  live: boolean;
  /** The agents expect the founder next: the last round handed back. */
  handBack: boolean;
  agentRoundsSinceFounder: number;
  /** A round (or the end) is being written. */
  busy: boolean;
  /** Every spoken turn has played. */
  playbackIdle: boolean;
  /** The founder is speaking, or has a typed line in progress. */
  founderActive: boolean;
}

/** "Let the team discuss": true when the agents should take another round now (after the founder's silence has run). */
export function shouldContinue(i: DiscussInput): boolean {
  return i.kind === "team" && i.discussOn && i.live && !i.handBack && !i.busy && i.playbackIdle && !i.founderActive && i.agentRoundsSinceFounder < TEAM_CALL_LIMITS.agentRoundsWithoutFounder;
}

/** A client turn id the api treats as one send: a retry of the same line reuses it. */
export function newClientTurnId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
