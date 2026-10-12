/** Platform limits and defaults (BUILD §9, §10, §11). */
export const LIMITS = {
  minViewportWidth: 1280,
  referenceViewportWidth: 1440,
  cycleTimeBoxAgentHours: 4,
  defaultMaxConcurrentAgents: 16,
  hardMaxConcurrentAgents: 64,
  inboxRefreshDebounceMs: 3000,
  inboxBufferSize: 3,
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

/**
 * The approval threshold a spend is checked against (Cedar `principal.approvalThresholdMinor`): the agent's own (the
 * policy default when it has none), lowered to the business's "Spend cap per action" when the founder set one (Commit,
 * Settings › Mode; `businesses.spend_cap_minor`). Undefined when neither is set: the policy default applies. The gateway
 * sends it and the agent profile shows it, so both read the same number.
 */
export function effectiveApprovalThresholdMinor(agentThresholdMinor: number | null | undefined, businessCapMinor: number | null | undefined): number | undefined {
  if (businessCapMinor === null || businessCapMinor === undefined) return agentThresholdMinor ?? undefined;
  return Math.min(agentThresholdMinor ?? LIMITS.approvalThresholdMinorDefault, businessCapMinor);
}
