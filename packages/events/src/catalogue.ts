/**
 * Event catalogue (BUILD §8.1, §2.1 rule 4, docs/ARCHITECTURE.md §5).
 *
 * Every event type in `EVENT_TYPES` (packages/shared) is declared exactly once here with a Zod payload
 * schema. `writeEvent` validates against this catalogue, so an unknown type or a malformed payload fails
 * at write time, never at read time. Consumers get a typed `PlatformEvent` back from `parseEvent`.
 *
 * Conventions for payloads:
 * - ids are UUID strings (`Id`), amounts are `Money` (minor units + ISO 4217 currency), counts are
 *   non-negative integers, times are ISO-8601 strings on the wire.
 * - payloads carry what a consumer needs to act *without* re-querying the row that caused the event
 *   (the composer narrates from the payload; the journey builder attributes from it; metrics roll it up).
 * - the envelope (`businessId`, `actor`, `entityIds`, `occurredAt`) is not repeated inside payloads.
 */
import { z } from "zod";
import {
  Actor,
  AgentStatus,
  Archetype,
  BusinessMode,
  ChannelKey,
  ConversationAuthorKind,
  ConversationSubjectKind,
  ConversionKind,
  DecisionType,
  EVENT_TYPES,
  EventType,
  GameMode,
  InboxItemType,
  MatchdayLevel,
  Money,
  Severity,
  SkillGroup,
  SourceKind,
  TaskKind,
  TaskPhase,
  ValidationError,
  type EventType as EventTypeT,
} from "@foundmill/shared";

// ---------------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------------

/** UUID (any variant; seeds use deterministic ids that are not RFC-9562 v4). */
export const Id = z.guid();
export type Id = z.infer<typeof Id>;

/** ISO-8601 date-time with offset (`2026-10-05T12:34:56.000Z`, `...+02:00`). */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Non-negative integer count. */
export const Count = z.number().int().nonnegative();

/** Fraction in [0, 1]. */
export const Fraction = z.number().min(0).max(1);

/** Platform consumers (BUILD §8.1). Used for documentation and for routing tests, not enforced at runtime. */
export const EVENT_CONSUMERS = [
  "composer",
  "journey",
  "source-watcher",
  "metrics",
  "health",
  "playbooks",
  "stream",
] as const;
export type EventConsumer = (typeof EVENT_CONSUMERS)[number];

// ---------------------------------------------------------------------------------------------------
// Declaration helper and registry
// ---------------------------------------------------------------------------------------------------

export interface EventDeclaration<
  T extends EventTypeT = EventTypeT,
  S extends z.ZodType = z.ZodType,
> {
  readonly type: T;
  readonly schema: S;
  /** One or two sentences: when it fires and what the payload carries. */
  readonly doc: string;
  /** Consumers that are expected to act on it (BUILD §8.1). */
  readonly consumers: readonly EventConsumer[];
  /** Whether the Inbox Composer may narrate this event as an inbox item (false = internal / already narrated). */
  readonly narratable: boolean;
}

interface DeclareOptions {
  doc: string;
  consumers: readonly EventConsumer[];
  narratable?: boolean;
}

/**
 * Declare one event type. The type must be a member of `EVENT_TYPES`; this is enforced both by the
 * TypeScript signature and at runtime (so a stale catalogue cannot register a type the vocabulary dropped).
 */
export function declareEvent<T extends EventTypeT, S extends z.ZodType>(
  type: T,
  schema: S,
  opts: DeclareOptions,
): EventDeclaration<T, S> {
  if (!EventType.safeParse(type).success) {
    throw new Error(`declareEvent: "${type}" is not in EVENT_TYPES (packages/shared/src/types.ts)`);
  }
  return Object.freeze({
    type,
    schema,
    doc: opts.doc,
    consumers: Object.freeze([...opts.consumers]),
    narratable: opts.narratable ?? true,
  });
}

// ---------------------------------------------------------------------------------------------------
// Ideas and product
// ---------------------------------------------------------------------------------------------------

const ideaCommitted = declareEvent(
  "idea.committed",
  z.object({
    ideaId: Id,
    ideaVersionId: Id,
    businessName: z.string().min(1).max(120),
    archetype: Archetype,
    gameMode: GameMode,
    businessMode: BusinessMode,
    /** Departments seeded from the archetype at commit. */
    departmentIds: z.array(Id),
    /** Agents hired from the archetype at commit. */
    agentIds: z.array(Id),
  }),
  {
    doc: "The founder took charge of an idea: the business exists, departments and team are seeded. The first businessCycle starts after this.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

const specProposalCreated = declareEvent(
  "spec.proposal_created",
  z.object({
    proposalId: Id,
    /** Sources that triggered the proposal (customer interview, competitor page, issue...). */
    sourceIds: z.array(Id),
    /** Spec blocks / roadmap items the proposal touches. */
    hunkCount: Count.min(1),
    affectedBlockIds: z.array(Id),
    severity: Severity,
    /** One line for the inbox subject; the rationale lives on the proposal row. */
    summary: z.string().min(1).max(280),
    /** Set once the composer has narrated it as a red decision. */
    inboxItemId: Id.nullable().default(null),
  }),
  {
    doc: "Source Watcher drafted a change proposal with three-way hunks against the spec. Critical/legal/safety proposals are narrated immediately; low severity is batched daily.",
    consumers: ["composer", "playbooks"],
  },
);

const specVersionPublished = declareEvent(
  "spec.version_published",
  z.object({
    specVersionId: Id,
    version: z.number().int().positive(),
    previousVersion: z.number().int().positive().nullable(),
    /** Which proposal (if any) produced this version. */
    proposalId: Id.nullable().default(null),
    changedBlockIds: z.array(Id),
    changelog: z.string().max(4000),
    /** Hunks accepted / rejected / edited to reach this version. */
    hunksAccepted: Count,
    hunksRejected: Count,
    hunksEdited: Count,
  }),
  {
    doc: "An immutable spec version was published (after accepting proposal hunks or a manual publish). Development re-plans and Distribution reviews messaging when relevant.",
    consumers: ["composer", "source-watcher", "playbooks"],
  },
);

const sourceAdded = declareEvent(
  "source.added",
  z.object({
    sourceId: Id,
    kind: SourceKind,
    title: z.string().max(400),
    uri: z.string().max(2048).nullable(),
    /** Who added it: the founder by hand, an import, or a connector feeding the Sources tab. */
    addedBy: z.enum(["user", "import", "connector", "agent"]),
  }),
  {
    doc: "A source joined Product › Sources. The Source Watcher reads it (public pages through the gateway's web connector), scores it against the spec and may raise a change proposal.",
    consumers: ["source-watcher", "stream"],
    narratable: false,
  },
);

const sourceScored = declareEvent(
  "source.scored",
  z.object({
    sourceId: Id,
    kind: SourceKind,
    /** `scored`: read and scored; `unreachable`: the page could not be read (robots.txt, a login, an error); `failed`: the read did not finish (retried on the next sweep). */
    status: z.enum(["scored", "unreachable", "failed"]),
    /** Spec blocks the source is relevant to (score at or above the watcher's threshold), best first. */
    relevantBlockIds: z.array(Id),
    /** Best relevance score across the spec, 0 to 1 (an Estimate from the classifier); null when nothing was scored. */
    topScore: Fraction.nullable(),
    severity: Severity.nullable(),
  }),
  {
    doc: "The Source Watcher read a source and wrote its relevance (summary, spec blocks, topics) so Sources and Research fill in; when a block is out of date because of it, `spec.proposal_created` follows.",
    consumers: ["stream"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Development
// ---------------------------------------------------------------------------------------------------

const TaskRef = { taskId: Id, kind: TaskKind, title: z.string().min(1).max(200) };

const taskStarted = declareEvent(
  "task.started",
  z.object({
    ...TaskRef,
    assigneeAgentId: Id,
    /** Agent session running the task (stream `as:{sessionId}`). */
    sessionId: Id.nullable().default(null),
    roadmapItemId: Id.nullable().default(null),
    workflowId: z.string().min(1).nullable().default(null),
    branch: z.string().min(1).nullable().default(null),
  }),
  {
    doc: "An agent began working a task: a sandbox and worktree exist and the session stream is live.",
    consumers: ["metrics", "health", "stream"],
    narratable: false,
  },
);

const taskProgressed = declareEvent(
  "task.progressed",
  z.object({
    taskId: Id,
    assigneeAgentId: Id,
    sessionId: Id.nullable().default(null),
    /** BUILD §11.6 formula: 0.2 plan + 0.5 acceptance tests + 0.2 review + 0.1 merged. Never token-based. */
    progress: Fraction,
    phase: TaskPhase,
    planStepsDone: Count,
    planSteps: Count,
    acceptanceTestsPassing: Count,
    acceptanceTests: Count,
    reviewPassed: z.boolean(),
    merged: z.boolean(),
    /** Estimate (median of similar completed tasks); label "Estimate" in UI. */
    etaAt: IsoDateTime.nullable().default(null),
  }),
  {
    doc: "A task's progress ring or phase changed. Emitted on phase transitions and when acceptance test counts move, not on every tool call.",
    consumers: ["metrics", "stream"],
    narratable: false,
  },
);

const taskCompleted = declareEvent(
  "task.completed",
  z.object({
    ...TaskRef,
    assigneeAgentId: Id,
    sessionId: Id.nullable().default(null),
    outcome: z.enum(["success", "partial"]),
    durationMs: Count,
    /** Tokens + sandbox + tool cost attributed to the task (wage bill). */
    cost: Money,
    acceptanceTestsPassing: Count,
    acceptanceTests: Count,
    prNumber: z.number().int().positive().nullable().default(null),
    branch: z.string().min(1).nullable().default(null),
    summary: z.string().max(2000),
  }),
  {
    doc: "A task passed its acceptance tests and review (or ended partially complete). The Update inbox item links the PR, preview and session replay.",
    consumers: ["composer", "metrics", "health", "playbooks"],
  },
);

export const TASK_BLOCKED_REASONS = [
  "awaiting_approval",
  "dependency",
  "credential",
  "budget",
  "rate_limit",
  "loop_detected",
  "error",
  "shout",
  "stopped",
] as const;
export const TaskBlockedReason = z.enum(TASK_BLOCKED_REASONS);
export type TaskBlockedReason = z.infer<typeof TaskBlockedReason>;

const taskBlocked = declareEvent(
  "task.blocked",
  z.object({
    ...TaskRef,
    assigneeAgentId: Id,
    sessionId: Id.nullable().default(null),
    reason: TaskBlockedReason,
    detail: z.string().min(1).max(2000),
    blockedByTaskId: Id.nullable().default(null),
    approvalId: Id.nullable().default(null),
    /** How many times this task has been blocked; the composer escalates repeat blocks. */
    occurrence: z.number().int().positive(),
  }),
  {
    doc: "A task cannot continue: waiting on approval, a dependency, a credential, budget, a rate limit, a detected loop or a failure. Narrated as a warning (or decision when an approval is needed).",
    consumers: ["composer", "metrics", "health", "playbooks"],
  },
);

const prMerged = declareEvent(
  "pr.merged",
  z.object({
    taskId: Id.nullable().default(null),
    /** `owner/name`. */
    repo: z.string().min(1).max(200),
    prNumber: z.number().int().positive(),
    title: z.string().min(1).max(300),
    branch: z.string().min(1),
    baseBranch: z.string().min(1),
    mergeCommitSha: z.string().min(7).max(64),
    /** Who merged: an agent (integration agent), the founder, or the webhook when merged on GitHub. */
    mergedBy: Actor,
    additions: Count,
    deletions: Count,
    filesChanged: Count,
    url: z.url().nullable().default(null),
  }),
  {
    doc: "A pull request merged to the base branch (merge queue in Assisted/Automated, founder approval in Augmented). Milestone material when it is a release.",
    consumers: ["composer", "metrics", "journey", "playbooks"],
  },
);

const deploySucceeded = declareEvent(
  "deploy.succeeded",
  z.object({
    taskId: Id.nullable().default(null),
    environment: z.enum(["preview", "staging", "production"]),
    provider: z.string().min(1).max(60),
    url: z.url().nullable().default(null),
    commitSha: z.string().min(7).max(64),
    branch: z.string().min(1).nullable().default(null),
    durationMs: Count.nullable().default(null),
  }),
  {
    doc: "A deployment finished successfully. Preview deploys attach to a task; production deploys are release flags on the Journey Ribbon.",
    consumers: ["composer", "metrics", "journey", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------------------------------

const leadCreated = declareEvent(
  "lead.created",
  z.object({
    /** CRM entity (person or organisation) created or promoted to lead. */
    entityId: Id,
    channelKey: ChannelKey,
    campaignId: Id.nullable().default(null),
    /** Lead score 0–100 from the lead-generation engine; null when not yet scored. */
    score: z.number().int().min(0).max(100).nullable().default(null),
    /** Connector / list / referrer that produced the lead. */
    source: z.string().min(1).max(200),
    /** Recorded lawful basis for contacting this person (BUILD §11.12 data duties). */
    lawfulBasis: z.enum(["consent", "legitimate_interest", "contract", "none"]),
    country: z.string().length(2).nullable().default(null),
  }),
  {
    doc: "A new lead entered the CRM from a channel engine or an import. Metrics roll it into channel_metrics.leads for the day.",
    consumers: ["metrics", "journey", "playbooks"],
    narratable: false,
  },
);

export const LEAD_REPLY_SENTIMENTS = [
  "positive",
  "neutral",
  "negative",
  "unsubscribe",
  "out_of_office",
] as const;
export const LeadReplySentiment = z.enum(LEAD_REPLY_SENTIMENTS);
export type LeadReplySentiment = z.infer<typeof LeadReplySentiment>;

const leadReplied = declareEvent(
  "lead.replied",
  z.object({
    entityId: Id,
    channelKey: ChannelKey,
    campaignId: Id.nullable().default(null),
    /** Interaction row holding the (encrypted) reply body. */
    interactionId: Id,
    sentiment: LeadReplySentiment,
    /** Typed summary from the quarantined reader; never the raw body. */
    summary: z.string().min(1).max(500),
    /** Whether the reply asked for a meeting / call / demo. */
    requestsMeeting: z.boolean(),
  }),
  {
    doc: "A lead replied to outreach. Positive replies are narrated as decisions (reply, book a call); unsubscribes update suppression and never get another message.",
    consumers: ["composer", "metrics", "journey", "playbooks"],
  },
);

const campaignLaunched = declareEvent(
  "campaign.launched",
  z.object({
    campaignId: Id,
    channelId: Id,
    channelKey: ChannelKey,
    name: z.string().min(1).max(200),
    goal: z.string().max(500),
    budget: Money,
    startsAt: IsoDateTime,
    endsAt: IsoDateTime.nullable().default(null),
    /** Kit mode: the agent prepared everything and the founder submitted it (BUILD §2.3). */
    kitMode: z.boolean(),
    assetIds: z.array(Id),
    /** Approval that authorised the spend/launch, when one was required. */
    approvalId: Id.nullable().default(null),
  }),
  {
    doc: "A channel engine launched a campaign (API or kit mode) after policy approval. Starts the measure → learn → report loop.",
    consumers: ["composer", "metrics", "journey", "playbooks"],
  },
);

export const CHANNEL_THRESHOLD_METRICS = [
  "cpa",
  "spend",
  "budget_percent",
  "spam_rate",
  "bounce_rate",
  "unsubscribe_rate",
  "reply_rate",
  "ctr",
  "cpc",
] as const;
export const ChannelThresholdMetric = z.enum(CHANNEL_THRESHOLD_METRICS);
export type ChannelThresholdMetric = z.infer<typeof ChannelThresholdMetric>;

const channelThresholdBreached = declareEvent(
  "channel.threshold_breached",
  z.object({
    channelId: Id,
    channelKey: ChannelKey,
    campaignId: Id.nullable().default(null),
    metric: ChannelThresholdMetric,
    /** Observed value and the configured threshold, in the metric's own unit (minor units for money metrics, ratio for rates, percent for budget_percent). */
    value: z.number(),
    threshold: z.number(),
    direction: z.enum(["above", "below"]),
    /** Hours the metric has been past the threshold (e.g. CPA > cap for 48 h pauses paid campaigns). */
    windowHours: z.number().nonnegative(),
    /** What the engine did about it. */
    action: z.enum(["none", "alerted", "paused", "reallocated"]),
  }),
  {
    doc: "A channel guardrail fired: CPA over cap, budget at 50/80/100 %, SendGrid spam rate over 0.3 %, etc. Narrated as a warning with the action already taken.",
    consumers: ["composer", "metrics", "health", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Journey (signup → activation → payment → customer won)
// ---------------------------------------------------------------------------------------------------

const TouchSource = z.object({
  utmSource: z.string().nullable().default(null),
  utmMedium: z.string().nullable().default(null),
  utmCampaign: z.string().nullable().default(null),
  referrer: z.string().nullable().default(null),
  /** Promo / affiliate / offline code redeemed at the conversion, if any. */
  code: z.string().nullable().default(null),
});

/**
 * Who converted, as the vendor reported them: ingest links the conversion to the CRM record with this external id
 * or email, or adds the customer to the CRM (null when the vendor reported nobody).
 */
const ConvertingCustomer = z.object({
  /** The vendor's own customer id (Stripe `cus_…`, Shopify customer id). */
  externalId: z.string().min(1).max(200).nullable().default(null),
  email: z.string().max(320).nullable().default(null),
  name: z.string().max(200).nullable().default(null),
});

const signupCreated = declareEvent(
  "signup.created",
  z.object({
    entityId: Id,
    conversionId: Id,
    /** Anonymous visitor stitched to this person at signup (first-party only). */
    visitorId: Id.nullable().default(null),
    channelKey: ChannelKey.nullable().default(null),
    campaignId: Id.nullable().default(null),
    source: TouchSource,
    /** Where the signup came from (auth provider, product analytics, Shopify customer...). */
    provider: z.string().min(1).max(60),
    consentState: z.enum(["granted", "denied", "unknown"]),
    customer: ConvertingCustomer.nullable().default(null),
  }),
  {
    doc: "A new signup (conversion kind `signup`). Triggers journeyBuild; Match Day level friendly.",
    consumers: ["journey", "metrics", "playbooks"],
    narratable: false,
  },
);

const activationReached = declareEvent(
  "activation.reached",
  z.object({
    entityId: Id,
    conversionId: Id,
    /** The activation criterion that was met (e.g. "first project created"). */
    criterion: z.string().min(1).max(200),
    /** Time from signup to activation. */
    daysSinceSignup: z.number().nonnegative(),
    provider: z.string().min(1).max(60),
  }),
  {
    doc: "A signed-up user met the activation criterion (conversion kind `activation`). Triggers journeyBuild; Match Day level league.",
    consumers: ["journey", "metrics", "playbooks"],
    narratable: false,
  },
);

export const PAYMENT_PROVIDERS = [
  "stripe",
  "shopify",
  "paddle",
  "contract",
  "bank",
  "manual",
  "other",
] as const;
export const PaymentProvider = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof PaymentProvider>;

const paymentReceived = declareEvent(
  "payment.received",
  z.object({
    entityId: Id,
    conversionId: Id,
    amount: Money,
    provider: PaymentProvider,
    /** Provider's own id (invoice, checkout session, order...) for de-duplication. */
    externalId: z.string().min(1).max(200),
    /** First payment by this customer (what makes it a cup tie). */
    firstPayment: z.boolean(),
    recurring: z.boolean(),
    /** Plan / SKU / product label when known. */
    productRef: z.string().max(200).nullable().default(null),
    /** Net of refunds known at the time; null when the provider does not report fees. */
    fee: Money.nullable().default(null),
    customer: ConvertingCustomer.nullable().default(null),
    /** Where the order came from when the provider reports it (Shopify landing site, referrer, discount code). */
    source: TouchSource.nullable().default(null),
  }),
  {
    doc: "Money came in from a customer (Stripe invoice.paid, checkout.session.completed, Shopify orders/create, signed contract). Only a first payment (`firstPayment`) is a conversion that wins a customer and triggers journeyBuild (Match Day level cup); renewals and repeat orders count as revenue only.",
    consumers: ["journey", "metrics", "playbooks"],
    narratable: false,
  },
);

const customerConverted = declareEvent(
  "customer.converted",
  z.object({
    entityId: Id,
    conversionId: Id,
    journeyId: Id,
    kind: ConversionKind,
    matchdayLevel: MatchdayLevel,
    amount: Money.nullable().default(null),
    /** 1st, 10th, 100th... of this kind for the business (trophy cabinet). */
    nthOfKind: z.number().int().positive(),
    /** False once volume rules roll this conversion into the daily round-up (BUILD §11.4). */
    fullMatchDay: z.boolean(),
    /** Channel with the highest attribution weight (captain). */
    captainChannelKey: ChannelKey.nullable().default(null),
    touchCount: Count,
    timeToConvertHours: z.number().nonnegative().nullable().default(null),
    acquisitionCost: Money.nullable().default(null),
  }),
  {
    doc: "The journey builder finished a conversion's journey record: team sheet, attribution and xC are ready. The composer writes the red/gold customer_won item that opens the replay.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------------------------------

const bankBalanceUpdated = declareEvent(
  "bank.balance_updated",
  z.object({
    accountId: Id,
    provider: z.string().min(1).max(60),
    accountName: z.string().min(1).max(120),
    balance: Money,
    previousBalance: Money.nullable(),
    /** Change since the previous sync (same currency as balance). */
    delta: Money,
    balanceAt: IsoDateTime,
    /** Transactions imported in this sync. */
    newTransactions: Count,
    /** Open-banking consent expiry, so the composer can warn 7 days before lapse (AC-11.8.2). */
    consentExpiresAt: IsoDateTime.nullable().default(null),
  }),
  {
    doc: "A bank sync completed with a new balance. Large deltas and approaching consent expiry are narrated; routine syncs only feed the cash widgets.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

const runwayThresholdCrossed = declareEvent(
  "runway.threshold_crossed",
  z.object({
    /** Forecast runway in months (label "Forecast"). */
    runwayMonths: z.number().nonnegative(),
    /** One of LIMITS.runwayWarnMonths (12, 9, 6) or LIMITS.runwayBlockMonths (3). */
    thresholdMonths: z.number().int().positive(),
    direction: z.enum(["below", "above"]),
    cash: Money,
    /** Trailing 3-month net burn per month, financing excluded. */
    netBurnMonthly: Money,
    scenario: z.enum(["base", "upside", "downside"]),
    /** True for the < 3 months case, which blocks Continue until acknowledged (AC-11.8.3). */
    blocksContinue: z.boolean(),
  }),
  {
    doc: "Forecast runway crossed a warning threshold (12/9/6 months) or the 3-month block. Warning inbox item; also a vacation wake event.",
    consumers: ["composer", "metrics", "health", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Agents, credentials, training
// ---------------------------------------------------------------------------------------------------

const agentHealthChanged = declareEvent(
  "agent.health_changed",
  z.object({
    agentId: Id,
    from: AgentStatus,
    to: AgentStatus,
    reason: z.string().min(1).max(500),
    /** The signals the health computation saw (BUILD §9.10). */
    signals: z.object({
      heartbeatAgeMs: Count.nullable().default(null),
      errorRate: Fraction.nullable().default(null),
      loopDetected: z.boolean().default(false),
      credentialExpired: z.boolean().default(false),
      rateLimited: z.boolean().default(false),
      budgetRemaining: Money.nullable().default(null),
    }),
    /** For `injured`: when the agent is expected back (credential reconnect, rate-limit reset). */
    expectedReturnAt: IsoDateTime.nullable().default(null),
    sessionId: Id.nullable().default(null),
  }),
  {
    doc: "An agent's computed status changed (healthy → degraded → failing / injured / paused / idle). Team table and department cards update within 2 s via the stream.",
    consumers: ["composer", "health", "metrics", "stream", "playbooks"],
  },
);

const credentialExpiring = declareEvent(
  "credential.expiring",
  z.object({
    integrationId: Id,
    credentialId: Id,
    connectorKey: z.string().min(1).max(60),
    accountLabel: z.string().max(200).nullable().default(null),
    expiresAt: IsoDateTime,
    daysRemaining: z.number().int(),
    /** Agents whose tools depend on this credential (they become injured when it lapses). */
    affectedAgentIds: z.array(Id),
    /** Already expired (daysRemaining <= 0). */
    expired: z.boolean(),
  }),
  {
    doc: "A connector credential or open-banking consent is about to expire (nightly credentialExpiryScan) or has expired. Warning inbox item with a reconnect action; a vacation wake event when expired.",
    consumers: ["composer", "health", "playbooks"],
  },
);

const SkillDelta = z.object({
  skillKey: z.string().min(1),
  group: SkillGroup,
  before: z.number().int().min(1).max(20),
  after: z.number().int().min(1).max(20),
});

const trainingCompleted = declareEvent(
  "training.completed",
  z.object({
    trainingRunId: Id,
    agentId: Id,
    fromVersionId: Id,
    toVersionId: Id,
    status: z.enum(["succeeded", "failed", "cancelled"]),
    cost: Money,
    durationMs: Count,
    testsRun: Count,
    skillDeltas: z.array(SkillDelta),
    coachSummary: z.string().max(4000),
    /** Coach's recommendation; the founder still presses Promote or Discard. */
    recommendation: z.enum(["promote", "discard"]).nullable().default(null),
  }),
  {
    doc: "A training run finished re-scoring a draft agent version. Results (old → new per skill) are narrated as a decision: Promote or Discard. The live version is untouched until Promote.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

const agentPromoted = declareEvent(
  "agent.promoted",
  z.object({
    agentId: Id,
    trainingRunId: Id.nullable().default(null),
    fromVersionId: Id.nullable(),
    toVersionId: Id,
    version: z.number().int().positive(),
    /** End of the 7-day watch window during which one-click rollback is offered. */
    watchUntil: IsoDateTime,
    /** True when this promotion is itself a rollback to a previous version. */
    rollback: z.boolean(),
  }),
  {
    doc: "A draft version became the live version (or a rollback restored a previous one). Starts the watch window.",
    consumers: ["composer", "metrics", "health", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------------

const approvalRequested = declareEvent(
  "approval.requested",
  z.object({
    approvalId: Id,
    planActionId: Id.nullable().default(null),
    agentId: Id,
    sessionId: Id.nullable().default(null),
    connectorKey: z.string().min(1).max(60),
    tool: z.string().min(1).max(120),
    /** Spend the action would commit, when it spends money. */
    amount: Money.nullable().default(null),
    /** Policy outcome details from the gateway (`reasons`, `policyIds`). */
    reasons: z.array(z.string()),
    policyIds: z.array(z.string()),
    decisionType: DecisionType.nullable().default(null),
    /** Hard gates (BUILD §2.2) always need the founder: never auto-approved, even in Automated mode. */
    hardGate: z.boolean(),
    /** Recipient / counterparty summary for the inbox note (never raw untrusted content). */
    summary: z.string().min(1).max(1000),
    expiresAt: IsoDateTime.nullable().default(null),
  }),
  {
    doc: "The gateway's policy evaluation returned `ask` (or a hard gate): an approvals row exists and the agent session is paused. Narrated as a decision; routed to the responsible handler.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

const approvalResolved = declareEvent(
  "approval.resolved",
  z.object({
    approvalId: Id,
    planActionId: Id.nullable().default(null),
    agentId: Id,
    outcome: z.enum(["approved", "rejected", "expired", "withdrawn"]),
    /** Founder, delegated human, or the Chief of Staff within holiday authority. */
    resolvedBy: Actor,
    note: z.string().max(2000).nullable().default(null),
    /** Time from request to resolution (approval latency dashboard). */
    latencyMs: Count,
  }),
  {
    doc: "An approval was approved, rejected, expired or withdrawn. The paused session resumes or the action is dropped; agent metrics count rejections.",
    consumers: ["metrics", "health", "playbooks"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Modes and holiday
// ---------------------------------------------------------------------------------------------------

/** Settings › Business fields `business.update` changes (and the glossary). */
export const BUSINESS_SETTINGS_FIELDS = ["name", "slug", "archetype", "kitPrimary", "kitSecondary", "glossary"] as const;

const businessUpdated = declareEvent(
  "business.updated",
  z.object({
    /** The fields this save changed (values are read back through `business.get`, never carried here). */
    fields: z.array(z.enum(BUSINESS_SETTINGS_FIELDS)).min(1),
  }),
  {
    doc: "An owner or admin saved Settings › Business or the glossary. apps/stream pushes it so every open tab (another tab of the same founder, a co-founder) refetches `business.get`: the top bar and the settings form show the new name and brand colors at once, and a stale form never saves over them (audit RES-07, RUI-08). Never narrated.",
    consumers: ["stream"],
    narratable: false,
  },
);

const modeChanged = declareEvent(
  "mode.changed",
  z.discriminatedUnion("scope", [
    z.object({
      scope: z.literal("game"),
      from: GameMode,
      to: GameMode,
      reason: z.string().max(500).nullable().default(null),
    }),
    z.object({
      scope: z.literal("business"),
      from: BusinessMode,
      to: BusinessMode,
      reason: z.string().max(500).nullable().default(null),
    }),
  ]),
  {
    doc: "Game mode (LIVE ↔ Personal) or business mode (Augmented / Assisted / Automated) changed. LIVE → Personal starts the 15-minute removal from search and leaderboards.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

const holidayStarted = declareEvent(
  "holiday.started",
  z.object({
    holidayId: Id,
    workflowId: z.string().min(1),
    untilAt: IsoDateTime.nullable(),
    /** Plain-language condition compiled into the holiday workflow, when not a date. */
    untilCondition: z.string().max(1000).nullable(),
    budgetCeiling: Money.nullable(),
    /** Decision types the Chief of Staff may take on the founder's behalf. */
    authority: z.array(DecisionType),
    /** Event types that end the holiday early (kill switch, credential failure, legal deadline, runway warning...). */
    wakeEvents: z.array(EventType),
    cadenceAgentHours: z.number().positive(),
  }),
  {
    doc: "The founder went on vacation (Automated mode): Continue runs itself on the cadence; the Chief of Staff decides within authority; gated items queue.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

export const HOLIDAY_END_REASONS = [
  "until_reached",
  "condition_met",
  "founder_returned",
  "wake_event",
  "budget_exhausted",
  "kill_switch",
] as const;
export const HolidayEndReason = z.enum(HOLIDAY_END_REASONS);
export type HolidayEndReason = z.infer<typeof HolidayEndReason>;

const holidayEnded = declareEvent(
  "holiday.ended",
  z.object({
    holidayId: Id,
    startedAt: IsoDateTime,
    endedAt: IsoDateTime,
    reason: HolidayEndReason,
    /** The wake event that ended it, when reason = wake_event. */
    wakeEventType: EventType.nullable().default(null),
    cyclesRun: Count,
    decisionsMade: Count,
    customersWon: Count,
    spent: Money,
    /** Hard-gated items that queued for the founder. */
    gatedItemsQueued: Count,
    /** "While you were away" report, written by the composer. */
    reportInboxItemId: Id.nullable().default(null),
  }),
  {
    doc: "The vacation ended (date, condition, founder return, wake event, budget, kill switch). The Inbox opens on the While-you-were-away report.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------------------------------

const filingDue = declareEvent(
  "filing.due",
  z.object({
    filingId: Id,
    legalEntityId: Id.nullable().default(null),
    kind: z.string().min(1).max(120),
    jurisdiction: z.string().min(2).max(60),
    dueAt: IsoDateTime,
    daysRemaining: z.number().int(),
    status: z.enum(["upcoming", "due", "overdue"]),
    /** Whether the filing needs the founder's identity (always a founder task, BUILD §2.2). */
    requiresFounderIdentity: z.boolean(),
    estimatedFee: Money.nullable().default(null),
  }),
  {
    doc: "A compliance filing is approaching, due today or overdue (compliance calendar scan). Warning inbox item; legal deadlines are vacation wake events.",
    consumers: ["composer", "playbooks"],
  },
);

const contractSigned = declareEvent(
  "contract.signed",
  z.object({
    contractId: Id,
    counterpartyEntityId: Id,
    kind: z.string().min(1).max(120),
    title: z.string().min(1).max(300),
    signedAt: IsoDateTime,
    /** Signing is founder-only (hard gate); recorded here as the actor who signed. */
    signedBy: Actor,
    value: Money.nullable().default(null),
    provider: z.enum(["dropbox_sign", "docusign", "manual", "other"]),
    docRef: z.string().max(500).nullable().default(null),
    /** Obligations extracted for tracking (count only; details on the contract row). */
    obligationCount: Count,
  }),
  {
    doc: "An e-signature provider reported a fully signed contract. Customer contracts can also be a payment source (first enterprise contract = trophy).",
    consumers: ["composer", "journey", "metrics", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// LIVE social
// ---------------------------------------------------------------------------------------------------

const connectionRequested = declareEvent(
  "connection.requested",
  z.object({
    connectionId: Id,
    fromUserId: Id,
    toUserId: Id,
    fromBusinessId: Id.nullable().default(null),
    /** Platform-member entity for the requester in this business's CRM. */
    fromEntityId: Id.nullable().default(null),
    message: z.string().max(1000).nullable().default(null),
  }),
  {
    doc: "Another LIVE founder asked to connect. Shown in the Inbox Messages tab; accept/block are human actions.",
    consumers: ["composer", "playbooks"],
  },
);

const messageReceived = declareEvent(
  "message.received",
  z.object({
    messageId: Id,
    threadId: Id,
    fromUserId: Id,
    fromEntityId: Id.nullable().default(null),
    /** First 280 characters; the body lives on the messages row. */
    preview: z.string().max(280),
    hasAttachments: z.boolean(),
    /** True when this message belongs to a negotiation thread rather than a human conversation. */
    negotiation: z.boolean(),
  }),
  {
    doc: "A human-to-human LIVE message arrived. Agents may draft a reply but never send it without the founder pressing Send.",
    consumers: ["composer", "playbooks"],
  },
);

export const NEGOTIATION_STATUSES = [
  "open",
  "countered",
  "agreed",
  "walked_away",
  "needs_founder",
] as const;
export const NegotiationStatus = z.enum(NEGOTIATION_STATUSES);
export type NegotiationStatus = z.infer<typeof NegotiationStatus>;

const negotiationMessage = declareEvent(
  "negotiation.message",
  z.object({
    threadId: Id,
    messageId: Id,
    fromBusinessId: Id,
    toBusinessId: Id,
    fromAgentId: Id.nullable(),
    toAgentId: Id.nullable(),
    /** Counterparty entity in this business's CRM (transcripts are recorded on its profile). */
    counterpartyEntityId: Id,
    round: z.number().int().positive(),
    proposal: z.object({
      price: Money.nullable().default(null),
      quantity: Count.nullable().default(null),
      terms: z.array(z.string().max(500)),
    }),
    /** Whether the proposal is inside the founder-set limits (price range, walk-away, max concession). */
    withinLimits: z.boolean(),
    status: NegotiationStatus,
    /** Agreed terms always create a hard-gate founder task (AC-11.14.3). */
    requiresFounderAction: z.boolean(),
  }),
  {
    doc: "A message in a B2B negotiation between two LIVE businesses' agents. The other side always knows it is an agent; final terms, signing and payment stay hard-gated.",
    consumers: ["composer", "metrics", "playbooks"],
  },
);

// ---------------------------------------------------------------------------------------------------
// Platform-internal (cycles, inbox, decisions)
// ---------------------------------------------------------------------------------------------------

const cycleStarted = declareEvent(
  "cycle.started",
  z.object({
    cycleId: Id,
    cycleNumber: z.number().int().positive(),
    workflowId: z.string().min(1),
    trigger: z.enum(["continue", "holiday", "schedule", "wake"]),
    timeBoxAgentHours: z.number().positive(),
    /** Tasks the Chief of Staff planned for this cycle. */
    plannedTaskIds: z.array(Id),
    /** Budget available to this cycle (credits or BYOK estimate; label "Estimate"). */
    budget: Money.nullable().default(null),
  }),
  {
    doc: "Continue was pressed (or auto-ran): the businessCycle workflow started with the Chief of Staff's plan.",
    consumers: ["metrics", "stream", "playbooks"],
    narratable: false,
  },
);

const cycleCompleted = declareEvent(
  "cycle.completed",
  z.object({
    cycleId: Id,
    cycleNumber: z.number().int().positive(),
    workflowId: z.string().min(1),
    outcome: z.enum(["completed", "time_box", "waiting", "stopped", "failed"]),
    tasksDispatched: Count,
    tasksCompleted: Count,
    tasksBlocked: Count,
    agentHours: z.number().nonnegative(),
    cost: Money,
    /** Inbox items the composer wrote during the cycle. */
    inboxItemIds: z.array(Id),
    durationMs: Count,
  }),
  {
    doc: "The businessCycle ended (all branches done, time box reached, waiting on decisions, stopped or failed). The composer narrates the cycle summary.",
    consumers: ["composer", "metrics", "stream", "playbooks"],
  },
);

const inboxItemCreated = declareEvent(
  "inbox.item_created",
  z.object({
    inboxItemId: Id,
    type: InboxItemType,
    fromAgentId: Id.nullable(),
    subject: z.string().min(1).max(80),
    blocksContinue: z.boolean(),
    /** Events this item narrated (marked `narrated = true`). */
    sourceEventIds: z.array(Id),
    /** Composer cost for this item (metered). */
    cost: Money.nullable().default(null),
  }),
  {
    doc: "The composer wrote an inbox item. apps/stream pushes it to open tabs; metrics count decisions outstanding. Never narrated again.",
    consumers: ["metrics", "stream"],
    narratable: false,
  },
);

const decisionMade = declareEvent(
  "decision.made",
  z.object({
    decisionId: Id,
    inboxItemId: Id,
    /** Option id when the founder clicked an option; null for free text. */
    chosenOption: z.string().max(40).nullable(),
    /** Free text as typed; the compiled Plan is on `planId`. */
    freeText: z.string().max(4000).nullable(),
    decidedBy: z.enum(["user", "chief_of_staff"]),
    planId: Id.nullable(),
    planActionCount: Count,
    /** Any plan action that compiled to request_human_action (hard gate). */
    hardGateActions: Count,
  }),
  {
    doc: "A decision was taken on an inbox item (option click or free text compiled to a Plan). The item is archived as Decided and the plan executes.",
    consumers: ["metrics", "journey", "playbooks", "stream"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Foundations (BUILD §11.1 first open, §11.5)
// ---------------------------------------------------------------------------------------------------

/** What a foundations drafting run just stored (audit P3: the vision first, then sections and roadmap items as they land). */
export const FOUNDATIONS_PROGRESS_STEPS = ["started", "vision", "plan", "section", "roadmap", "ready"] as const;

const foundationsProgressed = declareEvent(
  "foundations.progressed",
  z.object({
    /** The drafting attempt that stored it (a newer attempt's progress supersedes it). */
    attempt: z.number().int().positive(),
    step: z.enum(FOUNDATIONS_PROGRESS_STEPS),
    /** The outline section just stored (step `section`); null otherwise. */
    section: z.string().min(1).max(200).nullable().default(null),
    sectionsDone: Count,
    sectionsTotal: Count,
    /** Roadmap items written so far (the skeleton's planned items are not counted). */
    roadmapItems: Count,
    /** The vision is stored and readable (`product.foundations.get` returns it while drafting). */
    visionReady: z.boolean(),
  }),
  {
    doc: "A business's first-open drafting stored more of its foundations: a fresh start, the vision, the plan (one thesis per section and the roadmap titles), one specification section, roadmap items, or (`ready`) the apply that wrote it all. apps/stream pushes it so open tabs refetch `product.foundations.get`; the vision shows within seconds and the rest fills in. Never narrated (the Product lead posts one note when the drafting is ready).",
    consumers: ["stream"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Founder ↔ agent conversations (audit-conversation §4)
// ---------------------------------------------------------------------------------------------------

const conversationMessagePosted = declareEvent(
  "conversation.message_posted",
  z.object({
    threadId: Id,
    messageId: Id,
    agentId: Id,
    subjectKind: ConversationSubjectKind,
    subjectId: Id,
    author: ConversationAuthorKind,
    /** The start of the message as plain text (mentions reduced to names), for stream toasts and metrics. */
    preview: z.string().max(140),
    /** The quick replies an agent message offers (empty for a founder message). */
    quickReplyIds: z.array(z.string().regex(/^[a-z0-9_-]{1,24}$/)).max(4).default([]),
    /** The founder message pressed this quick reply (null when typed, always null for an agent message). */
    chosenQuickReplyId: z.string().regex(/^[a-z0-9_-]{1,24}$/).nullable().default(null),
    /** The agent message carries a hand-off (work the founder asked for; it runs only as a confirmed plan). */
    handOff: z.boolean(),
  }),
  {
    doc: "A founder or agent message was posted at an agent's desk (one thread per agent and subject). apps/stream pushes it so another open tab shows the reply; metrics counts conversations and quick-reply use. Never narrated: a chat is not an Inbox note, and a hand-off becomes a decision only when its plan runs (decision.made).",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------

/**
 * Every declared event, keyed by type. `satisfies Record<EventType, ...>` makes the compiler fail if a
 * type is added to EVENT_TYPES without a declaration here, or declared twice.
 */
export const EVENTS = {
  "idea.committed": ideaCommitted,
  "spec.proposal_created": specProposalCreated,
  "spec.version_published": specVersionPublished,
  "source.added": sourceAdded,
  "source.scored": sourceScored,
  "task.started": taskStarted,
  "task.progressed": taskProgressed,
  "task.completed": taskCompleted,
  "task.blocked": taskBlocked,
  "pr.merged": prMerged,
  "deploy.succeeded": deploySucceeded,
  "lead.created": leadCreated,
  "lead.replied": leadReplied,
  "campaign.launched": campaignLaunched,
  "channel.threshold_breached": channelThresholdBreached,
  "signup.created": signupCreated,
  "activation.reached": activationReached,
  "payment.received": paymentReceived,
  "customer.converted": customerConverted,
  "bank.balance_updated": bankBalanceUpdated,
  "runway.threshold_crossed": runwayThresholdCrossed,
  "agent.health_changed": agentHealthChanged,
  "credential.expiring": credentialExpiring,
  "training.completed": trainingCompleted,
  "agent.promoted": agentPromoted,
  "approval.requested": approvalRequested,
  "approval.resolved": approvalResolved,
  "mode.changed": modeChanged,
  "holiday.started": holidayStarted,
  "holiday.ended": holidayEnded,
  "business.updated": businessUpdated,
  "filing.due": filingDue,
  "contract.signed": contractSigned,
  "connection.requested": connectionRequested,
  "message.received": messageReceived,
  "negotiation.message": negotiationMessage,
  "cycle.started": cycleStarted,
  "cycle.completed": cycleCompleted,
  "inbox.item_created": inboxItemCreated,
  "decision.made": decisionMade,
  "foundations.progressed": foundationsProgressed,
  "conversation.message_posted": conversationMessagePosted,
} as const satisfies { readonly [K in EventTypeT]: EventDeclaration<K> };

export type EventsRegistry = typeof EVENTS;

/** All declared types, in catalogue order (identical set to EVENT_TYPES). */
export const DECLARED_EVENT_TYPES = Object.keys(EVENTS) as EventTypeT[];

/** Payload type (output of the schema, defaults applied) for one event type. */
export type EventPayload<T extends EventTypeT> = z.output<EventsRegistry[T]["schema"]>;
/** Payload type as accepted on input (before defaults). */
export type EventPayloadInput<T extends EventTypeT> = z.input<EventsRegistry[T]["schema"]>;

export function getEventDeclaration<T extends EventTypeT>(type: T): EventsRegistry[T] {
  const decl = (EVENTS as Record<string, EventDeclaration | undefined>)[type];
  if (!decl) throw new ValidationError(`Unknown event type "${type}"`, { type });
  return decl as EventsRegistry[T];
}

export function isEventType(value: unknown): value is EventTypeT {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EVENTS, value);
}

// ---------------------------------------------------------------------------------------------------
// PlatformEvent
// ---------------------------------------------------------------------------------------------------

/**
 * The envelope every event shares (BUILD §8.1). `occurredAt` is a `Date` in TypeScript and an ISO
 * string on the wire (docs/ARCHITECTURE.md §2); `JSON.stringify` does the right thing.
 */
export type PlatformEvent<T extends EventTypeT = EventTypeT> = {
  [K in EventTypeT]: {
    id: string;
    businessId: string;
    type: K;
    occurredAt: Date;
    actor: Actor;
    entityIds: string[];
    payload: EventPayload<K>;
    narrated: boolean;
  };
}[T];

/** Wire form: what goes into `events.payload`'s row JSON and the Redis `json` field. */
export type PlatformEventWire<T extends EventTypeT = EventTypeT> = Omit<
  PlatformEvent<T>,
  "occurredAt"
> & { occurredAt: string };

const OccurredAt = z
  .union([z.date(), IsoDateTime.transform((s) => new Date(s))])
  .refine((d) => !Number.isNaN(d.getTime()), "occurredAt must be a valid date");

/** Envelope without payload validation (payload is validated per type by `parseEvent`). */
export const PlatformEventEnvelope = z.object({
  id: Id,
  businessId: Id,
  type: EventType,
  occurredAt: OccurredAt,
  actor: Actor,
  entityIds: z.array(Id).default([]),
  payload: z.unknown(),
  narrated: z.boolean().default(false),
});

export type ParseEventFailure = { ok: false; error: ValidationError };
export type ParseEventSuccess = { ok: true; value: PlatformEvent };

/**
 * Validate an unknown value (a DB row, a parsed Redis `json` field, an HTTP body) as a PlatformEvent.
 * Envelope and payload are both checked; the payload schema is looked up from the catalogue by type.
 */
export function safeParseEvent(raw: unknown): ParseEventSuccess | ParseEventFailure {
  const env = PlatformEventEnvelope.safeParse(raw);
  if (!env.success) {
    return {
      ok: false,
      error: new ValidationError(
        `Invalid event envelope: ${z.prettifyError(env.error)}`,
        env.error.issues,
      ),
    };
  }
  const decl = (EVENTS as Record<string, EventDeclaration | undefined>)[env.data.type];
  if (!decl) {
    return {
      ok: false,
      error: new ValidationError(`Unknown event type "${env.data.type}"`, { type: env.data.type }),
    };
  }
  const payload = decl.schema.safeParse(env.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      error: new ValidationError(
        `Invalid payload for ${env.data.type}: ${z.prettifyError(payload.error)}`,
        payload.error.issues,
      ),
    };
  }
  return { ok: true, value: { ...env.data, payload: payload.data } as PlatformEvent };
}

/** Like `safeParseEvent` but throws `ValidationError`. */
export function parseEvent(raw: unknown): PlatformEvent {
  const r = safeParseEvent(raw);
  if (!r.ok) throw r.error;
  return r.value;
}

/** Validate just a payload for a known type (used by `writeEvent` and connector `simulate`). Throws `ValidationError`. */
export function parsePayload<T extends EventTypeT>(type: T, payload: unknown): EventPayload<T> {
  const decl = getEventDeclaration(type);
  const r = decl.schema.safeParse(payload);
  if (!r.success)
    throw new ValidationError(
      `Invalid payload for ${type}: ${z.prettifyError(r.error)}`,
      r.error.issues,
    );
  return r.data as EventPayload<T>;
}

/** Serialise for the Redis `json` field / HTTP. Dates become ISO strings. */
export function serializeEvent(event: PlatformEvent): string {
  return JSON.stringify(toWire(event));
}

export function toWire<T extends EventTypeT>(event: PlatformEvent<T>): PlatformEventWire<T> {
  return { ...event, occurredAt: event.occurredAt.toISOString() } as PlatformEventWire<T>;
}

/** Narrow a PlatformEvent to one type (type guard for consumers with a switch per type). */
export function isEventOfType<T extends EventTypeT>(
  event: PlatformEvent,
  type: T,
): event is PlatformEvent<T> {
  return event.type === type;
}

// Keep the vocabulary and the catalogue in lock-step at runtime too (the `satisfies` above covers compile time).
for (const t of EVENT_TYPES) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, t))
    throw new Error(`packages/events catalog is missing a declaration for "${t}"`);
}
