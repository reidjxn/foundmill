/**
 * Voice activity for the call's microphone (docs/TEAM_CALL.md §6): an utterance starts when the level rises above a
 * threshold and ends after 1.2 s of silence, or at 60 s whatever is said. Pure: the hook feeds it one level reading at
 * a time with the clock, so the timing logic is tested without a microphone.
 */

export interface VadConfig {
  /** Level (0..1) at or above which an utterance starts. */
  startLevel: number;
  /** Level at or above which the founder still counts as speaking (lower than the start: hysteresis). */
  holdLevel: number;
  /** Start threshold while an agent is speaking, raised so the speakers do not trigger a barge-in. */
  bargeInLevel: number;
  silenceMs: number;
  maxMs: number;
  /** An utterance with less voiced time than this (a click, a cough) is discarded. */
  minVoicedMs: number;
}

export const VAD_DEFAULTS: VadConfig = { startLevel: 0.12, holdLevel: 0.07, bargeInLevel: 0.22, silenceMs: 1_200, maxMs: 60_000, minVoicedMs: 250 };

export interface VadState {
  speaking: boolean;
  startedAt: number | null;
  /** The last reading at or above the hold level. */
  lastVoicedAt: number | null;
}

export const VAD_IDLE: VadState = { speaking: false, startedAt: null, lastVoicedAt: null };

export type VadEvent = { type: "start" } | { type: "end"; reason: "silence" | "cap"; durationMs: number; discard: boolean };

/** One reading. `agentSpeaking` raises the start threshold (barge-in needs a clearly louder voice than the speakers). */
export function vadStep(state: VadState, level: number, now: number, agentSpeaking = false, cfg: VadConfig = VAD_DEFAULTS): { state: VadState; event: VadEvent | null } {
  if (!state.speaking) {
    const threshold = agentSpeaking ? cfg.bargeInLevel : cfg.startLevel;
    if (level >= threshold) return { state: { speaking: true, startedAt: now, lastVoicedAt: now }, event: { type: "start" } };
    return { state, event: null };
  }
  const startedAt = state.startedAt ?? now;
  const lastVoicedAt = level >= cfg.holdLevel ? now : (state.lastVoicedAt ?? startedAt);
  const next: VadState = { speaking: true, startedAt, lastVoicedAt };
  const silent = now - lastVoicedAt >= cfg.silenceMs;
  const capped = now - startedAt >= cfg.maxMs;
  if (!silent && !capped) return { state: next, event: null };
  return {
    state: VAD_IDLE,
    event: { type: "end", reason: capped && !silent ? "cap" : "silence", durationMs: now - startedAt, discard: lastVoicedAt - startedAt < cfg.minVoicedMs },
  };
}

/** The level (0..1) of a time-domain byte buffer from an AnalyserNode: RMS around the 128 midpoint, boosted so speech reads near 0.3 to 0.8. */
export function levelFromTimeDomain(data: ArrayLike<number>): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}
