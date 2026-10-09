/**
 * Motion tokens for scripts (DESIGN §7). CSS reads the same values from tokens.css (`--dur-*`, `--stream-*`,
 * `--caret-blink`, `--typing-*`); a test keeps the two in step. Pure and server-safe.
 *
 * Use these where a value has to live in JavaScript: the streaming cadence of agent text, timers that wait for a CSS
 * transition, staggered reveals. Under reduced motion (`prefersReducedMotion()` / `usePrefersReducedMotion()`) streams
 * render whole and nothing waits.
 */

/** Durations in milliseconds, by use. */
export const DURATION_MS = {
  /** Press feedback. */
  press: 90,
  /** Hover. */
  hover: 140,
  /** Overlays: scale .98 → 1 from their origin, plus fade. */
  overlay: 200,
  /** Sliding indicators: tab underline, segmented plate. */
  slide: 260,
  /** Route and tab cross-fades; a landed card rising in. */
  view: 320,
  /** One-shot ring (Continue, a live event). */
  pulse: 600,
  /** A sheen crossing the generate control once. */
  sheen: 700,
  /** The Journey line drawing in; a landed card's edge settling. */
  draw: 1200,
  /** One turn of the generate control's fan while running. */
  fan: 1400,
  /** Skeleton band, processing heads. */
  shimmer: 1600,
  /** Presence ring, orbit on the generate edge. */
  breathe: 2400,
} as const;

/** Streaming text: 22–34 ms per character, a 120 ms pause at commas, the caret blinking on 1060 ms steps. */
export const STREAM_CADENCE = {
  charMinMs: 22,
  charMaxMs: 34,
  commaPauseMs: 120,
  caretBlinkMs: 1060,
} as const;

/** Typing dots loop every 1200 ms, 160 ms apart. */
export const TYPING_DOTS = { loopMs: 1200, staggerMs: 160 } as const;

/** Stagger steps: skeleton bars start 60 ms apart; quick replies and landed cards rise 40 ms apart. */
export const STAGGER_MS = { skeleton: 60, reply: 40 } as const;

/** The three curves, as CSS strings (for the Web Animations API or motion/react). */
export const MOTION_EASE = {
  out: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  spring: "cubic-bezier(0.34, 1.45, 0.64, 1)",
  inout: "cubic-bezier(0.65, 0, 0.35, 1)",
} as const;

/**
 * Delay before the next character of a stream: a steady cadence inside [charMinMs, charMaxMs] (varied by the
 * character's code so the rhythm feels typed, deterministically), plus a pause after a comma or full stop.
 */
export function streamDelayMs(char: string): number {
  const span = STREAM_CADENCE.charMaxMs - STREAM_CADENCE.charMinMs;
  const code = char.codePointAt(0) ?? 0;
  const base = STREAM_CADENCE.charMinMs + (code % (span + 1));
  return /[,;:.!?]/.test(char) ? base + STREAM_CADENCE.commaPauseMs : base;
}
