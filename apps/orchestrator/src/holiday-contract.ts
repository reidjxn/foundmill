/**
 * Limits the vacation and autopilot workflows and their activities agree on. Pure (no imports): workflow code bundles
 * it, and so do the activities (the away report names the safety limit).
 */

/** Safety valve: a vacation never runs more cycles than this without the founder coming back (reason `cycle_cap`). */
export const MAX_HOLIDAY_CYCLES = 400;

/** Cycles one vacation or autopilot run holds before it continues as new (about 40 history events each). */
export const HOLIDAY_CYCLES_PER_RUN = 50;
