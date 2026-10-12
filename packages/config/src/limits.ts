/** Platform limits and defaults (BUILD §9, §10, §11). */
export const LIMITS = {
  minViewportWidth: 1280,
  referenceViewportWidth: 1440,
  cycleTimeBoxAgentHours: 4,
  defaultMaxConcurrentAgents: 16,
  hardMaxConcurrentAgents: 64,
  inboxRefreshDebounceMs: 3000,
  inboxBufferSize: 3,
  /** Longest one composer note may take (Opus call, re-ask, entity sweep) before it is abandoned with nothing written. */
  composerDeadlineMs: 150_000,
  /** How long the api and the orchestrator wait for the composer: above the deadline, so they never give up on a note still being written. */
  composerClientTimeoutMs: 180_000,
  approvalThresholdMinorDefault: 25000, // €250.00
  runwayWarnMonths: [12, 9, 6] as const,
  runwayBlockMonths: 3,
  matchDayFullUntilCount: 100,
  matchDayValuePercentile: 75,
  attributionPositionBasedUntilConversions: 200,
  xcArchetypePriorUntilConversions: 50,
  spamRateAutoPause: 0.003,
  killSwitchSeconds: 30,
  skillTestsPerSkill: { min: 12, max: 30 },
  rollbackWatchDays: 7,
  leadRetentionMonths: 24,
  budgetAlertPercents: [50, 80, 100] as const,
  /** Logo generation (one Opus call per set): marks per set, sets per signed-in user per hour, sets per business per day. */
  logoOptionsPerSet: 4,
  logoSetsPerUserPerHour: 10,
  logoSetsPerBusinessPerDay: 24,
  /** Logo uploads checked (prepare and upload) per signed-in user per hour: the SVG check is CPU work on the api. */
  logoChecksPerUserPerHour: 60,
} as const;
