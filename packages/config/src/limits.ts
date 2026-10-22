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
  /** Most events one `POST /v1/narrate` takes (one note); a cycle with more is narrated in several calls. */
  narrateMaxEvents: 50,
  approvalThresholdMinorDefault: 25000, // €250.00
  /**
   * The most an agent's own spend cap or approval threshold may be set to (minor units of the business currency;
   * 100,000.00): a larger spend is always the founder's to approve, whatever an owner or admin sets per agent.
   */
  agentCapMaxMinor: 10_000_000,
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
  /**
   * Most procedure calls one tRPC request may batch: the api refuses a longer batch (400) and the web's batch link
   * splits at the same size, so one request can never multiply a procedure (a model call, a write) many times over.
   */
  trpcMaxBatchSize: 25,
  /**
   * Roadmap items in Now the api plans (one Planner call each) when the founder's second sign-off starts the first build
   * (founder, 2026-10-18). More means more Opus spend on the first approval; fewer leaves graphs to build by hand.
   */
  signoffPlanRoadmapItems: 2,
  /** LIVE writes per person (audit GLS2F-05): connection requests, messages and posts are throttled so one account cannot flood a person, a thread, a community or the event outbox. */
  liveRequestsPerUserPerHour: 20,
  /** Requests to one person per day, so request, withdraw and request again is stopped quickly. */
  liveRequestsPerPairPerDay: 3,
  liveMessagesPerUserPerMinute: 20,
  liveMessagesPerThreadPerMinute: 10,
  livePostsPerUserPerMinute: 6,
  livePostsPerUserPerHour: 60,
  /** Messages a thread shows at first (and per "Load earlier"). */
  liveMessagePageSize: 50,
  /** Largest tRPC request body the api reads (bytes); a request carrying a logo file may be larger (`trpcMaxLogoBodyBytes`). */
  trpcMaxBodyBytes: 2 * 1024 * 1024,
  /** Largest body of a request that uploads a logo (a 2 MB SVG travels base64-encoded inside JSON). */
  trpcMaxLogoBodyBytes: 6 * 1024 * 1024,
  /** Largest skill file a founder may upload for an agent (UTF-8 bytes); checked in the browser and again by the api. */
  skillFileMaxBytes: 64 * 1024,
  /** Largest plan file a founder may import on Product › Vision (UTF-8 bytes); checked in the browser and again by the api. */
  planFileMaxBytes: 256 * 1024,
  /** Largest body of one specification section in an imported plan file (UTF-8 bytes). */
  planSectionMaxBytes: 64 * 1024,
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
