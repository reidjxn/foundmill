/** Platform limits and defaults (BUILD §9, §10, §11). */
export const LIMITS = {
  minViewportWidth: 1280,
  referenceViewportWidth: 1440,
  cycleTimeBoxAgentHours: 4,
  defaultMaxConcurrentAgents: 16,
  hardMaxConcurrentAgents: 64,
  inboxRefreshDebounceMs: 3000,
  inboxBufferSize: 3,
  /**
   * The first week's note budget (WP-04 T8, `noteVerdict` in @foundmill/shared): for this many days after commit an
   * agent's plain update is folded into the Chief of Staff's "What your team did today". Lower it (to 3, say) if
   * founders miss updates; 0 turns the fold off.
   */
  firstWeekDays: 7,
  /**
   * The most open notes a project left alone should hold on a day of its first week (WP-04 Done-when 3). Nothing counts
   * against it when a note is written: the fold above holds it, and the note-budget tests check it.
   */
  firstWeekNotesPerDay: 3,
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
  /**
   * Roadmap items in Now without tasks that one business cycle plans into tasks (one Planner call each) before the
   * Chief of Staff's plan (lead, 2026-10-24: the team plans the roadmap; nobody builds a task graph by hand). More
   * means more Opus spend per cycle; fewer leaves imported items waiting for more cycles.
   */
  cyclePlanRoadmapItems: 2,
  /** LIVE writes per person (audit GLS2F-05): connection requests, messages and posts are throttled so one account cannot flood a person, a thread, a community or the event outbox. */
  liveRequestsPerUserPerHour: 20,
  /** Requests to one person per day, so request, withdraw and request again is stopped quickly. */
  liveRequestsPerPairPerDay: 3,
  liveMessagesPerUserPerMinute: 20,
  liveMessagesPerUserPerHour: 200,
  liveMessagesPerThreadPerMinute: 10,
  livePostsPerUserPerMinute: 6,
  livePostsPerUserPerHour: 40,
  /** New communities, invitations to a community and post reports per person (counted in the shared store, so every replica agrees). */
  liveCommunitiesPerUserPerDay: 3,
  liveInvitesPerUserPerDay: 50,
  liveReportsPerUserPerHour: 30,
  /** Messages a thread shows at first (and per "Load earlier"). */
  liveMessagePageSize: 50,
  /** Largest tRPC request body the api reads (bytes); a request carrying a logo file may be larger (`trpcMaxLogoBodyBytes`). */
  trpcMaxBodyBytes: 2 * 1024 * 1024,
  /** Largest body of a request that uploads a logo (a 2 MB SVG travels base64-encoded inside JSON). */
  trpcMaxLogoBodyBytes: 6 * 1024 * 1024,
  /** Largest skill file a founder may upload for an agent (UTF-8 bytes); checked in the browser and again by the api. */
  skillFileMaxBytes: 64 * 1024,
  /** Library and file skills one agent may carry (WP-06 T4): the api refuses more, the picker counts down to it. */
  skillsPerAgentMax: 40,
  /** Largest plan file a founder may import on Product › Vision (UTF-8 bytes); checked in the browser and again by the api. */
  planFileMaxBytes: 256 * 1024,
  /** Largest body of one specification section in an imported plan file (UTF-8 bytes). */
  planSectionMaxBytes: 64 * 1024,
  /** Longest line of an imported plan file (characters); longer lines are refused before the parser reads them. */
  planLineMaxChars: 10_000,
} as const;

/**
 * Most items one api input may carry in a list (`z.array(...).max(n)`) or keys in a map (`boundedRecord(n, ...)` from
 * `@foundmill/shared`), GHSA-mrhx-c7xc-m3w5: zod builds an issue per failing element of an unbounded array or record,
 * so a 2 MB body could make the api hold hundreds of MB. Each is well above what the product or a founder sends; a
 * list of enum values is bounded by the enum's own length beside its schema instead.
 */
export const INPUT_LIMITS = {
  /** Ids of a business's departments (reorder, an agent's departments): departments are unpaged; 500 is the repos' page size. */
  departmentIds: 500,
  /** People and agents who approve for one department. */
  departmentApprovers: 500,
  /** Tool grants of one agent version: one per connector (37 today). */
  agentToolGrants: 100,
  /** Tools granted on one connector (16 at most today). */
  agentToolsPerGrant: 100,
  /** Lines in one list of an agent's instructions (goals, rules, playbook, examples): templates carry a few dozen at most. */
  agentInstructionLines: 500,
  /** Topics an agent may negotiate on. */
  negotiationTopics: 100,
  /** Other names of one CRM record; a merge adds the merged record's names. */
  entityAliases: 1000,
  /** Identifiers of one CRM record (email, domain, LinkedIn, company number, Stripe customer, and the rest). */
  entityIdentifiers: 100,
  /** Terms in a business's glossary. */
  glossaryTerms: 500,
  /** Rated skills, target markets and constraints on a founder's profile. */
  founderProfileList: 200,
  /** Officers in a company register import (Companies House pages 100 at most) or deadlines it names. */
  registerOfficers: 500,
  registerDeadlines: 200,
  /** Lines of a registered address. */
  addressLines: 50,
  /** Obligations of one contract. */
  contractObligations: 500,
  /** Widgets on one screen or dashboard, and settings of one widget. */
  screenWidgets: 200,
  widgetSettings: 100,
  /** Spec blocks or tasks linked to one roadmap item, and sources backing one spec block. */
  linkedIds: 1000,
  /** Months of one forecast series (the runway horizon is 60 months at most). */
  forecastSeries: 1000,
  /**
   * Top-level keys of a free-form JSON object an api input takes (a spec block's content, a quiz definition, campaign
   * config, security terms, forecast drivers, simulation params, a connector's connect fields). Its depth and size stay
   * bounded by the request body and by the service that reads it.
   */
  jsonObjectKeys: 100,
} as const;

/**
 * The approval threshold a spend is checked against (Cedar `principal.approvalThresholdMinor`): the agent's own (the
 * policy default when it has none), lowered to the business's "Spend cap per action" when the founder set one (Commit,
 * Settings › What the team can do; `businesses.spend_cap_minor`). Undefined when neither is set: the policy default applies. The gateway
 * sends it and the agent profile shows it, so both read the same number.
 */
export function effectiveApprovalThresholdMinor(agentThresholdMinor: number | null | undefined, businessCapMinor: number | null | undefined): number | undefined {
  if (businessCapMinor === null || businessCapMinor === undefined) return agentThresholdMinor ?? undefined;
  return Math.min(agentThresholdMinor ?? LIMITS.approvalThresholdMinorDefault, businessCapMinor);
}
