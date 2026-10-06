/** Feature flags. Defaults are safe for staging in mock mode. */
export const FLAGS = {
  liveMode: false, // LIVE game mode surfaces (Phase 4)
  devSimulatePanel: true, // Settings → Integrations → Simulate (dev/staging only)
  holidayMode: true,
  trainingGround: true,
  matchDaySound: false,
} as const;
export type FlagKey = keyof typeof FLAGS;
