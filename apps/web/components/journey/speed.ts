/**
 * Replay speed remembered per founder (BUILD §11.4 "Speed: … remembered per founder"). A per-viewer convenience, so
 * it lives in localStorage keyed by the founder's user id; every access is guarded (private mode, SSR).
 */
import { REPLAY_SPEEDS, type ReplaySpeed } from "@foundmill/dugout";

export const SPEED_STORAGE_PREFIX = "fm:replay-speed:";
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = "full";

export function speedStorageKey(userId: string | null | undefined): string {
  return `${SPEED_STORAGE_PREFIX}${userId || "founder"}`;
}

export function isReplaySpeed(v: unknown): v is ReplaySpeed {
  return typeof v === "string" && (REPLAY_SPEEDS as readonly string[]).includes(v);
}

export interface SpeedStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): SpeedStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readReplaySpeed(userId: string | null | undefined, store: SpeedStore | null = defaultStore()): ReplaySpeed {
  try {
    const raw = store?.getItem(speedStorageKey(userId));
    return isReplaySpeed(raw) ? raw : DEFAULT_REPLAY_SPEED;
  } catch {
    return DEFAULT_REPLAY_SPEED;
  }
}

export function writeReplaySpeed(userId: string | null | undefined, speed: ReplaySpeed, store: SpeedStore | null = defaultStore()): void {
  try {
    store?.setItem(speedStorageKey(userId), speed);
  } catch {
    /* private mode: the choice lasts for the session only */
  }
}
