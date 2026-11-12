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
  TEAM_CALL_KINDS,
  TEAM_CALL_LIMITS,
  AgentStatus,
  Archetype,
  AUTOPILOT_CADENCES,
  AUTOPILOT_PAUSE_REASONS,
  BusinessMode,
  ChannelKey,
  CONTINUE_RUN_END_REASONS,
  ConversationAuthorKind,
  ConversationSubjectKind,
  ConversionKind,
  DecisionType,
  EVENT_TYPES,
  EventType,
  FOUNDER_RETURN_VIA,
  GameMode,
  GOAL_METRIC_KINDS,
  GOAL_PROPOSAL_REASONS,
  GUIDANCE_OFF_SOURCES,
  InboxItemType,
  MatchdayLevel,
  Money,
  NOTIFICATION_KINDS,
  EMAIL_NOTIFICATION_KINDS,
  PUSH_PROVIDERS,
  SHARE_DESTINATIONS,
  SHARE_OPEN_TARGETS,
  SHARE_SUBJECT_KINDS,
  SIGNOFF_KINDS,
  Severity,
  SkillGroup,
  SourceKind,
  TaskKind,
  TaskPhase,
  ValidationError,
  isAccountEventType,
  PersonHandle,
  type AccountEventType,
  type BusinessEventType,
  type EventScope,
  type EventType as EventTypeT,
} from "@foundmill/shared";
import { VIA_KINDS } from "@foundmill/shared/via";
import { assertAccountPayloadSchema } from "./account-payload";

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

/** The scope an event type has in the shared vocabulary (`ACCOUNT_EVENT_TYPES`): what its declaration must state. */
export type EventScopeOf<T extends EventTypeT> = T extends AccountEventType ? "account" : "business";

export interface EventDeclaration<
  T extends EventTypeT = EventTypeT,
  S extends z.ZodType = z.ZodType,
  Sc extends EventScope = EventScope,
> {
  readonly type: T;
  /**
   * Where the event belongs: `business` (a fact about a project: `events`, `ev:{businessId}`, written with
   * `writeEvent`) or `account` (a fact about one person: `account_events`, `ae:{userId}`, written with
   * `writeAccountEvent`). Each writer refuses the other scope, at compile time and at run time.
   */
  readonly scope: Sc;
  readonly schema: S;
  /** One or two sentences: when it fires and what the payload carries. */
  readonly doc: string;
  /** Consumers that are expected to act on it (BUILD §8.1). */
  readonly consumers: readonly EventConsumer[];
  /** Whether the Inbox Composer may narrate this event as an inbox item (false = internal / already narrated). */
  readonly narratable: boolean;
  /** Account scope only: the payload keys allowed to hold a UUID (ids of records, never of accounts). */
  readonly recordIds: readonly string[];
}

interface DeclareOptions {
  /** Business is the scope of `declareEvent`; an account-scoped event is declared with `declareAccountEvent`. */
  scope?: "business";
  doc: string;
  consumers: readonly EventConsumer[];
  narratable?: boolean;
}

interface DeclareAccountOptions {
  doc: string;
  consumers: readonly EventConsumer[];
  /** Payload keys allowed to hold a UUID: ids of records (an ask, a thread), never of accounts. */
  recordIds?: readonly string[];
}

/**
 * Declare one business-scoped event type (the scope of every event of a project; `scope: "business"` may be written
 * out, and is what this helper states when it is not). The type must be a member of `EVENT_TYPES` and not one of
 * `ACCOUNT_EVENT_TYPES`; both are enforced by the TypeScript signature and at runtime (so a stale catalog cannot
 * register a type the vocabulary dropped, or move a person's fact into a project's events).
 */
export function declareEvent<T extends BusinessEventType, S extends z.ZodType>(
  type: T,
  schema: S,
  opts: DeclareOptions,
): EventDeclaration<T, S, "business"> {
  if (!EventType.safeParse(type).success) {
    throw new Error(`declareEvent: "${type}" is not in EVENT_TYPES (packages/shared/src/types.ts)`);
  }
  if (isAccountEventType(type) || (opts.scope ?? "business") !== "business") {
    throw new Error(`declareEvent: "${type}" is account-scoped; declare it with declareAccountEvent`);
  }
  return Object.freeze({
    type,
    scope: "business" as const,
    schema,
    doc: opts.doc,
    consumers: Object.freeze([...opts.consumers]),
    narratable: opts.narratable ?? true,
    recordIds: Object.freeze([]),
  });
}

/**
 * Declare one account-scoped event type: a fact about one person, stored in their own `account_events` rows and never
 * in a project's events. The type must be one of `ACCOUNT_EVENT_TYPES`, and a new one also needs a migration that
 * redefines `fm_account_event_types()` with it (the database lets only the listed types into `account_events` and
 * keeps them out of `events`; packages/db `rls/account-events.test.ts` compares the two lists). The payload schema is checked against the
 * account payload conventions as the catalog loads (./account-payload: a closed object, nobody named by an account id,
 * an email address or a private field; another person only by something public about them, such as a handle). Never
 * narrated: the Composer writes a project's Inbox, and this is not a project's fact.
 */
export function declareAccountEvent<T extends AccountEventType, S extends z.ZodType>(
  type: T,
  schema: S,
  opts: DeclareAccountOptions,
): EventDeclaration<T, S, "account"> {
  if (!EventType.safeParse(type).success) {
    throw new Error(`declareAccountEvent: "${type}" is not in EVENT_TYPES (packages/shared/src/types.ts)`);
  }
  if (!isAccountEventType(type)) {
    throw new Error(`declareAccountEvent: "${type}" is not in ACCOUNT_EVENT_TYPES (packages/shared/src/constants.ts); declare it with declareEvent`);
  }
  const recordIds = Object.freeze([...(opts.recordIds ?? [])]);
  assertAccountPayloadSchema(type, schema, recordIds);
  return Object.freeze({
    type,
    scope: "account" as const,
    schema,
    doc: opts.doc,
    consumers: Object.freeze([...opts.consumers]),
    narratable: false,
    recordIds,
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
  "approval_rejected",
  "dependency",
  "credential",
  "budget",
  "rate_limit",
  "loop_detected",
  "error",
  "shout",
  "stopped",
  /** The task's change clashes with newer work on the default branch (or its checks failed there): its agent brings it up to date. */
  "needs_update",
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
export const BUSINESS_SETTINGS_FIELDS = ["name", "slug", "archetype", "kitPrimary", "kitSecondary", "currency", "glossary"] as const;

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
    doc: "Game mode (LIVE ↔ Personal) or business mode (Augmented / Assisted / Automated) changed. LIVE → Personal starts the 15-minute removal from search.",
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
  /** The vacation reached its safety limit of cycles without the founder coming back (MAX_HOLIDAY_CYCLES). */
  "cycle_cap",
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
    doc: "The vacation ended (date, condition, founder return, wake event, budget, kill switch, cycle safety limit). The Inbox opens on the While-you-were-away report.",
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
    doc:
      "Another LIVE founder asked to connect. Addressed to the RECIPIENT as a person (PERSON_ADDRESSED_EVENT_TYPES), once per new request: it is never written " +
      "to any business's events, Inbox or ev: stream, whose members and advisors would read the founder's private network traffic, and the composer never narrates it. " +
      "The recipient gets a content-free signal on their own u: stream (connection_requested) and reads the request on Network, where accept, ignore and block are human actions.",
    consumers: ["stream"],
    narratable: false,
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
    doc:
      "A human-to-human LIVE message arrived. Addressed to the people in its thread (PERSON_ADDRESSED_EVENT_TYPES), not for a thread a recipient muted: it is never written " +
      "to any business's events, Inbox or ev: stream, whose members and advisors would read the founder's private network messages, and the composer never narrates it. " +
      "Each recipient gets a content-free signal on their own u: stream (message_received) and reads the thread on Network. " +
      "Agents may draft a reply but never send it without the founder pressing Send.",
    consumers: ["stream"],
    narratable: false,
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
    trigger: z.enum(["continue", "holiday", "schedule", "wake", "autopilot"]),
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
    /** A cycle that ended `failed`: what stopped it, for Home's banner (a model account out of credit, a missing key, an error). */
    failure: z.object({ kind: z.enum(["billing", "credential", "request", "error"]), message: z.string().min(1).max(500) }).nullable().default(null),
  }),
  {
    doc: "The businessCycle ended (all branches done, time box reached, waiting on decisions, stopped or failed). The composer narrates the cycle summary.",
    consumers: ["composer", "metrics", "stream", "playbooks"],
  },
);

const cycleRunStarted = declareEvent(
  "cycle.run_started",
  z.object({
    /** One id per press: the rounds the press runs and the run's end carry it. */
    runId: Id,
    /** The first round's cycle number; null when a cycle was already open and the run picks up after it. */
    firstCycleNumber: z.number().int().positive().nullable(),
  }),
  {
    doc: "One press of Continue started a run: the autopilot workflow starts round after round (businessCycle) until nothing is left the team can do, a hard stop, a vacation, Pause or the day's limits end it.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const cycleRunEnded = declareEvent(
  "cycle.run_ended",
  z.object({
    runId: Id,
    /**
     * `done`: the last round did nothing (decisions waiting in Needs you never hold a run); `hard_stop`: the stop flag,
     * used-up credits or an Inbox item that blocks Continue; `paused`: the founder pressed Pause; `stopped`: Stop all
     * agents or a stopped round; `daily_cycles` / `daily_spend`: the day's limits from Settings › What the team can do; `lost`: its
     * workflow was gone (closed by the API's reconciler).
     */
    reason: z.enum(CONTINUE_RUN_END_REASONS),
    /** Rounds of the run that finished. */
    rounds: Count,
    /** Model cost of those rounds (an Estimate). */
    cost: Money,
    /** The day's cycle cap when the run ended at it (`daily_cycles`), for the founder's words; null otherwise. */
    maxCyclesPerDay: z.number().int().min(1).max(24).nullable().default(null),
  }),
  {
    doc: "A run that one press of Continue started ended (written once per run, by the workflow or by the API for Pause, Stop all agents and a lost workflow).",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const autopilotChanged = declareEvent(
  "autopilot.changed",
  z.object({
    /** What happened: an owner or admin turned it on or off or changed its settings, or a guard rail paused it. */
    change: z.enum(["turned_on", "turned_off", "settings_changed", "paused"]),
    pausedReason: z.enum(AUTOPILOT_PAUSE_REASONS).nullable().default(null),
    cadence: z.enum(AUTOPILOT_CADENCES),
    dailyHour: z.number().int().min(0).max(23),
    maxCyclesPerDay: z.number().int().min(1).max(24),
    /** The day's spend ceiling in USD (an Estimate); null: the credits left. */
    spendCeiling: Money.nullable().default(null),
    maxIdleCycles: z.number().int().min(1).max(10),
    /** Autopilot's own limits (0084): cycles it starts itself per day, and their spend ceiling in USD; null: none. */
    ownMaxCyclesPerDay: z.number().int().min(1).max(24).nullable().default(null),
    ownSpendCeiling: Money.nullable().default(null),
  }),
  {
    doc: "Autopilot was turned on or off, its settings changed, or a guard rail (Stop all agents, used-up credits, failed or empty cycles) paused it. Only an owner or admin turns it back on.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const autopilotCycleStarted = declareEvent(
  "autopilot.cycle_started",
  z.object({
    cycleNumber: z.number().int().positive(),
    workflowId: z.string().min(1),
    cadence: z.enum(AUTOPILOT_CADENCES),
    /** Cycles started today (UTC) that count toward the daily cap, this one included. */
    cyclesToday: z.number().int().positive(),
    /** Set when the cycle is a follow-on round of a run one press of Continue started. */
    runId: Id.optional(),
  }),
  {
    doc: "Autopilot started the next businessCycle through the same entry point as Continue (trigger `autopilot`); every approval, hard gate and policy check applies as for a founder press.",
    consumers: ["stream", "metrics"],
    narratable: false,
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

const inboxItemUpdated = declareEvent(
  "inbox.item_updated",
  z.object({
    inboxItemId: Id,
    /** Archived by a member, the plan the item was answered with confirmed (its follow-up Update written), or the note revised in place (the Chief of Staff updating a warning about the same problem). */
    change: z.enum(["archived", "plan_confirmed", "revised"]),
    /** The confirmed plan (`plan_confirmed`); null otherwise. */
    planId: Id.nullable().default(null),
    /** The follow-up Update the confirmation wrote; null when none. */
    followUpItemId: Id.nullable().default(null),
  }),
  {
    doc: "An inbox item changed without a new decision: archived, or its plan confirmed (BUILD §11.3). apps/stream pushes it so every member's open Inbox, reading pane and Respond count refetch at once instead of acting on an item that is gone. Ids only, no subject, so it tells a member walled from the item nothing.",
    consumers: ["stream"],
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
// Product research (BUILD §11.5 Research tab; the Product Researcher's plan)
// ---------------------------------------------------------------------------------------------------

const productResearchDrafted = declareEvent(
  "product.research_drafted",
  z.object({
    researchId: Id,
    /** The drafting attempt that wrote it. */
    attempt: z.number().int().positive(),
    /** The Product Researcher the plan is attributed to (null when the business has none hired). */
    agentId: Id.nullable(),
    /** The artifacts written (interview plan and script, smoke test, survey, demo script). */
    artifactIds: z.array(Id).max(12),
    /** The follow-up research tasks created for the cycles. */
    taskIds: z.array(Id).max(8),
    /** The researcher's Inbox note announcing the plan. */
    inboxItemId: Id.nullable(),
  }),
  {
    doc: "The Product Researcher's research plan is ready: artifacts on Product › Research, follow-up tasks on Development › Plan and one Inbox note. apps/stream pushes it so open tabs refetch `product.research.get`. Never narrated (the researcher posts the note itself).",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// The guided layer's product signals (docs/UX_AUDIT_AND_PLAN.md §11)
// ---------------------------------------------------------------------------------------------------

/** A tour id as the preferences store it (`toursDone` keys: "home", "inbox", "first-continue", ...). */
const TourId = z.string().trim().min(1).max(120);
/** A screen id as `explainersSeen` stores it ("finance/runway", "team/agents", ...). */
const ScreenId = z.string().trim().min(1).max(120);
/** A TERMS id (packages/shared/src/terms.ts), never the display word, so a business glossary never splits the count. */
const TermId = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);
const GUIDANCE_DOC_TAIL =
  " Written by founder.preferences.signal into the business the founder was in (the envelope's actor is the founder); for metrics only, never narrated, and on the business stream walled to the readers of Settings.";

const guidanceTourCompleted = declareEvent(
  "guidance.tour_completed",
  z.object({
    tourId: TourId,
    /** How many steps the tour showed (targets missing on the page are skipped, so this can be fewer than defined). */
    steps: z.number().int().positive().max(20),
  }),
  { doc: "A founder finished a first-visit tour (Home, Inbox, a department tab, a one-step callout) by reaching its last step." + GUIDANCE_DOC_TAIL, consumers: ["metrics"], narratable: false },
);

const guidanceTourSkipped = declareEvent(
  "guidance.tour_skipped",
  z.object({
    tourId: TourId,
    /** The step the founder left on, 1-based. */
    atStep: z.number().int().positive().max(20),
    steps: z.number().int().positive().max(20),
  }),
  { doc: "A founder left a tour before its last step (Skip tour or Esc), with the step they left on." + GUIDANCE_DOC_TAIL, consumers: ["metrics"], narratable: false },
);

const guidanceExplainerDismissed = declareEvent(
  "guidance.explainer_dismissed",
  z.object({ screenId: ScreenId }),
  { doc: "A founder pressed Got it on a screen's explainer, which collapses it to one line for their account." + GUIDANCE_DOC_TAIL, consumers: ["metrics"], narratable: false },
);

const guidanceTermOpened = declareEvent(
  "guidance.term_opened",
  z.object({
    termId: TermId,
    /** The screen it was opened on, when the client knows it ("home", "finance/runway"). */
    screenId: ScreenId.nullable().default(null),
  }),
  {
    doc: "A founder opened a defined word's definition card (a Term, an InfoTip with a definition). A term opened by more than 20% of new accounts is a candidate for an in-sentence definition (§11)." + GUIDANCE_DOC_TAIL,
    consumers: ["metrics"],
    narratable: false,
  },
);

const guidanceTurnedOff = declareEvent(
  "guidance.turned_off",
  z.object({
    /** Where the switch was flipped. */
    from: z.enum(GUIDANCE_OFF_SOURCES),
    /** How much of the guided layer the founder had been through: tours done and explainers seen at that moment. */
    toursDone: Count,
    explainersSeen: Count,
  }),
  { doc: "A founder turned guidance off (Explain things as I go). The automatic default for Exited and Operator profiles is not this event: it happens before any business exists." + GUIDANCE_DOC_TAIL, consumers: ["metrics"], narratable: false },
);

// ---------------------------------------------------------------------------------------------------
// Push notifications (the mobile companion app, docs/mobile)
// ---------------------------------------------------------------------------------------------------

const pushSent = declareEvent(
  "push.sent",
  z.object({
    /** Which kind of notification (`NOTIFICATION_KINDS`): the per-kind switch each person holds in their preferences. */
    kind: z.enum(NOTIFICATION_KINDS),
    /** The business event the notification was about. */
    sourceEventId: Id,
    sourceEventType: EventType,
    /** People it went to (after walls and preferences) and the phones among them it was sent to. */
    recipients: Count,
    devices: Count,
    provider: z.enum(PUSH_PROVIDERS),
    mode: z.enum(["mock", "live"]),
    /** The provider's notification ids (one per text variant sent); empty when it accepted nothing. */
    providerMessageIds: z.array(z.string().max(120)).max(50),
  }),
  {
    doc: "The api's push notifier sent a notification about a business event to the registered phones of the people who may see it (section walls and their own switches applied). The audit of what reached a founder's phone; never the title or the body.",
    consumers: ["metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// The return loop (retention plan, founder 2026-11-11): founders coming back, and what brought them
// ---------------------------------------------------------------------------------------------------

const founderSessionStarted = declareEvent(
  "founder.session_started",
  z.object({
    /** How the session started: on their own, from a founder email, or from a browser notification. */
    via: z.enum(FOUNDER_RETURN_VIA),
    /** The notification whose link started it, when there was one. */
    notificationId: Id.nullable().default(null),
    /** Minutes since the end of the session before it; null on the founder's first session in this business. */
    minutesAway: Count.nullable(),
    /** The founder's sessions in this business so far, this one included. */
    sessions: z.number().int().positive(),
  }),
  {
    doc: "A founder opened the business after more than 30 minutes away (or for the first time). Written by founder.presence.ping (the envelope's actor is the founder); the retention report counts returns and returns from notifications from it. Metrics only, never narrated.",
    consumers: ["metrics"],
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
// Staff access (security review S1)
// ---------------------------------------------------------------------------------------------------

export const MEMBERSHIP_CHANGES = ["added", "updated", "removed"] as const;

const membershipChanged = declareEvent(
  "membership.changed",
  z.object({
    /** The staff member whose access changed. Nothing else: the role and section permissions stay on the row. */
    userId: Id,
    change: z.enum(MEMBERSHIP_CHANGES),
  }),
  {
    doc: "A person was added to the business, removed from it, or had their role or section permissions changed (team.humans.*). apps/stream re-checks that person's open subscriptions at once and closes the ones they may no longer read; open tabs refetch the business and the staff list. Never narrated.",
    consumers: ["stream"],
    narratable: false,
  },
);

// -------------------------------------------------------------------------------------------------
// Agent ↔ agent typed messages (BUILD §9.9)
// ---------------------------------------------------------------------------------------------------

export const AGENT_MESSAGE_TYPES = ["request", "inform", "review"] as const;

const agentMessageSent = declareEvent(
  "agent.message_sent",
  z.object({
    messageId: Id,
    /** request (asks for something), inform (reports something), review (asks for a review): no free-form chat. */
    type: z.enum(AGENT_MESSAGE_TYPES),
    fromAgentId: Id,
    toAgentId: Id,
    /** The agent session it was sent from (null outside one). */
    sessionId: Id.nullable().default(null),
    taskId: Id.nullable().default(null),
    subject: z.string().min(1).max(200),
    /** Agent-written text: the recipient reads it as data from another agent, never as instructions. */
    body: z.string().min(1).max(4000),
  }),
  {
    doc: "An agent sent a typed message (request, inform or review) to another agent of the team through the platform tools (`platform.send_message`); the recipient reads it with `platform.list_messages`. The event is the message's only store. Never narrated: agents coordinating is not Inbox news.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// The first days: sign-offs and the start of distribution (founder, 2026-10-18)
// ---------------------------------------------------------------------------------------------------

const productSignoffDecided = declareEvent(
  "product.signoff_decided",
  z.object({
    signoffId: Id,
    kind: z.enum(SIGNOFF_KINDS),
    round: z.number().int().positive(),
    decision: z.enum(["approved", "changes_requested", "declined"]),
    decidedBy: z.object({ kind: z.enum(["user", "system"]), id: Id.nullable() }),
    /** The founder's own words with the decision (what to change, or notes with an approval); null when none. */
    notes: z.string().max(2000).nullable().default(null),
    /** The specification version an approval of the spec published; null for the roadmap and for Request changes. */
    specVersionId: Id.nullable().default(null),
    /** This decision was the second approval: the api planned the first build and started the next cycle. */
    buildStarted: z.boolean().default(false),
    /** The tasks the Planner wrote when the build started (empty otherwise). */
    plannedTaskIds: z.array(Id).max(64).default([]),
    /** The cycle the build start queued (or ran in-process); null when none started. */
    cycle: z.object({ queued: z.boolean(), workflowId: z.string().max(200) }).nullable().default(null),
  }),
  {
    doc: "The founder decided a sign-off round of the product specification or the roadmap (or answered Ready to start selling): approved, sent back with notes, or declined. apps/stream pushes it so the Product tabs show the pill and Development › Plan the first build. Never narrated: the Product lead's own follow-up note says what happens next.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const distributionStarted = declareEvent(
  "distribution.started",
  z.object({
    startedBy: z.object({ kind: z.literal("user"), id: Id }),
    /** Where it was started: the Distribution › Board button, or the Chief of Staff's Ready to start selling? note. */
    via: z.enum(["board", "inbox"]),
    /** The channels on the board whose engines start with it. */
    channelIds: z.array(Id).max(15),
    /** The archetype's Board question posted with the start ("Where should the first customer come from?"); null when it existed. */
    boardItemId: Id.nullable().default(null),
    /** Engines Temporal took now (the reconciler starts the rest). */
    engines: Count,
  }),
  {
    doc: "The founder started distribution (BUILD §11.7, founder 2026-10-18: nothing is spent on distribution until the product is ready to show). The channel engines start from here, the channel-scoring task is created and the Board asks which route to the first customer comes first. apps/stream pushes it so the Board and the Channels table drop 'Waiting for the product'. Never narrated: the Distribution strategist's note says it.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// The business's goal (founder, 2026-11-07: "Your goal"; migration 0072)
// ---------------------------------------------------------------------------------------------------

/** What the founder reads about a goal, in the words packages/shared goals.ts writes (no free text of anyone's). */
const GoalFacts = z.object({
  goalId: Id,
  revision: z.number().int().positive(),
  metricKind: z.enum(GOAL_METRIC_KINDS),
  /** A count, or minor units for revenue_month; null for a custom goal. */
  targetValue: z.number().int().positive().nullable(),
  currency: z.string().length(3).nullable().default(null),
  /** "2026-12-19". */
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const goalProposed = declareEvent(
  "goal.proposed",
  GoalFacts.extend({
    /** Why: the first goal, a revision of the founder's words, the next after one was reached, a new date after a miss. */
    reason: z.enum(GOAL_PROPOSAL_REASONS),
    /** The Chief of Staff who proposed it (null when the business has none). */
    proposedByAgentId: Id.nullable(),
    /** The Chief of Staff's decision note. */
    inboxItemId: Id.nullable(),
    /** The goal it follows (the changed proposal, the reached goal or the missed one); null for the first. */
    replacesGoalId: Id.nullable().default(null),
    /** How the revision was read from the founder's words: the model route, the deterministic reader, or neither (a default). */
    source: z.enum(["default", "model", "parser"]).default("default"),
  }),
  {
    doc: "The Chief of Staff proposed the business's goal as an Inbox decision note (never holding Continue, 0071): after both sign-offs and a round of work, after a change request, after a goal was reached, or when a goal's date passed. apps/stream pushes it so open tabs refetch `goal.current`. Never narrated: the note is the Chief of Staff's own.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const goalApproved = declareEvent(
  "goal.approved",
  GoalFacts.extend({
    approvedBy: z.object({ kind: z.literal("user"), id: Id }),
    /** Where the number stood at the approval (null for custom). */
    startValue: z.number().int().nullable(),
    /** The previous active goal this one replaced; null when there was none. */
    replacedGoalId: Id.nullable().default(null),
    via: z.enum(["inbox", "goal"]),
  }),
  {
    doc: "The founder approved the proposed goal: it is the active goal from now and the previous one is replaced. apps/stream pushes it so Home and the Inbox follow. Never narrated.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const goalChangeRequested = declareEvent(
  "goal.change_requested",
  z.object({
    goalId: Id,
    revision: z.number().int().positive(),
    requestedBy: z.object({ kind: z.literal("user"), id: Id }),
    /** The founder's own words (at most 2,000 characters). */
    words: z.string().min(1).max(2000),
    /** The revised proposal written from them. */
    revisedGoalId: Id,
    via: z.enum(["inbox", "goal"]),
  }),
  {
    doc: "The founder asked for a change to a proposed goal in their own words: the proposal is replaced and the Chief of Staff's revised proposal follows as goal.proposed. apps/stream pushes it (the words are hidden from readers who may not see the Inbox). Never narrated.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const goalAchieved = declareEvent(
  "goal.achieved",
  GoalFacts.extend({
    /** The value it reached (a count, or minor units). */
    achievedValue: z.number().int().nullable(),
    /** The Chief of Staff's "Goal reached: …" note; null when the business has no Chief of Staff. */
    inboxItemId: Id.nullable().default(null),
  }),
  {
    doc: "The active goal was reached (a payment or a signup arrived, or `goal.ensure` counted it): marked achieved, and the Chief of Staff posted a milestone-style note; the next proposal follows on the next `goal.ensure`. Never narrated.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// A project's public page (0077)
// ---------------------------------------------------------------------------------------------------

/** What both page events carry: the page, its address, and the full public URL it is (or was) served at. */
const PageFacts = z.object({
  pageId: Id,
  /** The address under /p/ (3 to 40 lowercase letters, digits and hyphens). */
  slug: z.string().min(3).max(40),
  url: z.string().url().max(2048),
});

// Team call (docs/TEAM_CALL.md §5): a spoken call between the founder and their team of agents, or one agent.
const teamCallStarted = declareEvent(
  "team_call.started",
  z.object({
    callId: Id,
    kind: z.enum(TEAM_CALL_KINDS),
    agentIds: z.array(Id).min(1).max(TEAM_CALL_LIMITS.maxAgentsInTeamCall),
    topic: z.string().max(TEAM_CALL_LIMITS.maxTopicChars).nullable().default(null),
  }),
  {
    doc: "A founder started a team call with their agents (`team`) or a call with one agent (`one_to_one`). The founder did it themselves, so it is never narrated; apps/stream pushes it so Team call's list follows.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const teamCallEnded = declareEvent(
  "team_call.ended",
  z.object({
    callId: Id,
    kind: z.enum(TEAM_CALL_KINDS),
    turnCount: z.number().int().nonnegative(),
    actionCount: z.number().int().nonnegative(),
    /** Action items filed at once (a task in its department, an item on the roadmap). */
    filedCount: z.number().int().nonnegative(),
    /** Action items staged as a plan that waits for the founder's go-ahead. */
    awaitingCount: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
  }),
  {
    doc: "A call ended and its action items were filed: the summary and the actions are on the call, and the Chief of Staff's note in the Inbox says what was agreed. Filing work inside the project is not an outside result, so the north star never counts it. Never narrated (the note is written by the api with the call).",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

const pagePublished = declareEvent("page.published", PageFacts, {
  doc: "A founder published the project's public page, or published changes to a page that is already live: from this moment anyone can open `url` signed out. A real outside result (the north star counts it). The founder did it themselves, so it is never narrated; apps/stream pushes it so Today and the Public page tab follow.",
  consumers: ["stream", "metrics"],
  narratable: false,
});

const pageUnpublished = declareEvent("page.unpublished", PageFacts, {
  doc: "A founder took the project's public page down: `url` answers not found from now on (the draft is kept). Never narrated; apps/stream pushes it so Today and the Public page tab follow.",
  consumers: ["stream", "metrics"],
  narratable: false,
});

const pageFollowed = declareEvent(
  "page.followed",
  z.object({
    /** The page they signed up on; null only when that page row was deleted before they confirmed. */
    pageId: Id.nullable(),
    /** The follower's CRM record (their lawful basis is now `consent` unless it already had one). Never the address itself. */
    entityId: Id,
    /** The consent record (0079 `contact_consents`): what they agreed to, when, and when they confirmed. */
    consentId: Id,
  }),
  {
    // North star (CLAUDE.md, founder 2026-11-11): a stranger who confirmed from their own inbox that they want to hear
    // from the project is a real outside result, so each `page.followed` is a real outcome of its week. Written at the
    // confirmation, never at the signup (double opt-in, SECURITY_REVIEW Nov 11). The measure reads this; it is not built yet.
    doc: "A person confirmed, from the link in the one email the platform sent them, that they want to follow the project they signed up for on its public page: their consent record is confirmed and they count as a follower. Written by ingest's `/mail/confirm`, once per record (a second use of the link, or a second signup, writes nothing); a signup that was never confirmed writes nothing. A real outside result (the north star counts it). Not narrated: one note per follower would be noise, and no digest pattern exists yet; the Public page tab counts them.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// A message sent from the project's Foundmill address (0078, package 1.5)
// ---------------------------------------------------------------------------------------------------

const mailSent = declareEvent(
  "mail.sent",
  z.object({
    /** The gateway's own id for the message, signed into its custom args: delivery events are bound to the project by it. */
    messageRef: Id,
    /** SendGrid's `X-Message-Id` (live), or the mock's id (simulated). */
    messageId: z.string().min(1).max(200),
    /** sha256 hex of the recipient's address, trimmed and lowercased (`suppressionHash`); never the address itself. */
    recipientHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** The local part it was sent from (`<fromLocalPart>@<PLATFORM_MAIL_DOMAIN>`). */
    fromLocalPart: z.string().min(3).max(40),
    channelKey: ChannelKey.nullable().default(null),
    agentId: Id.nullable().default(null),
    sessionId: Id.nullable().default(null),
    /** True when the mock ran (SendGrid not live on the gateway): nothing left Foundmill. */
    simulated: z.boolean(),
  }),
  {
    // North star (CLAUDE.md, founder 2026-11-11): a `mail.sent` with `simulated: false` is a real outcome of its week; a
    // simulated one never counts. The measure reads this flag; it is not built yet.
    doc: "An agent sent one message from the project's Foundmill sending address through the gateway, after the policy for outside contact, the suppression list, the project's daily cap and the platform's ceiling. A real outside action when `simulated` is false (the north star counts only those). Never narrated on its own; a reply, if one comes, is `lead.replied`.",
    consumers: ["stream", "metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Email from Foundmill to a person (packages 1.5 and 5.1)
// ---------------------------------------------------------------------------------------------------

const notifyEmailSent = declareEvent(
  "notify.email_sent",
  z.object({
    /** Which kind of email (`EMAIL_NOTIFICATION_KINDS`): the per-kind switch each person holds in their preferences. */
    kind: z.enum(EMAIL_NOTIFICATION_KINDS),
    /** The person it went to, by account id only: never the address. */
    userId: Id,
    /** The note it was about (`decision_waiting`, `win`, `credits`, a milestone's note); null for the others. */
    inboxItemId: Id.nullable(),
    /** SendGrid's `X-Message-Id` (live), or the mock's id (simulated). */
    messageId: z.string().min(1).max(200),
    /** True when the mock ran (SendGrid not live on the gateway): nothing left Foundmill. */
    simulated: z.boolean(),
    /** The `founder_notifications` row that holds the email (readable only by its person); its id travels in the links. */
    notificationId: Id,
    /** The email offered a one-click answer. */
    offersAnswer: z.boolean().default(false),
  }),
  {
    doc: "Foundmill emailed one of the business's people about their own project (a note waiting for their answer, a win, a milestone, a finished Autopilot run, used-up credits, the morning brief or the weekly review), from its own address through the gateway, after the person's own switch, their section walls and the daily limits. The record of what reached a person's inbox and the per-day key of the api's notify pass; the words stay on the founder_notifications row, readable only by that person; never the address. Not an outcome of the project (the north star never counts it); never narrated.",
    consumers: ["metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Who or what brought a new person (0086 `attributions`; docs/NETWORK.md §5, §11)
// ---------------------------------------------------------------------------------------------------

// NOT WRITTEN YET. This event is about an account, and a person creating their profile has no business: `events` and
// `outbox` carry a NOT NULL `business_id`, the relay publishes on `ev:{businessId}`, and every member of a business
// reads its events, so there is nowhere to write it without putting a new person's account id in front of a project's
// members (the reason 0060 took person facts out of business events). Until an account-level transport is decided,
// the api records the `attributions` row only (apps/api `services/attribution.ts`); the row holds this whole payload,
// so the events can be written from the rows later, one for one. The declaration fixes the contract, and the api
// checks every row it writes against it.
const signupAttributed = declareEvent(
  "signup.attributed",
  z.object({
    /** The new person, by account id. */
    userId: Id,
    /** What the reference named: a project's public page or a person's public profile (`VIA_KINDS`). */
    sourceKind: z.enum(VIA_KINDS),
    /** The slug or handle as it arrived (3 to 40 lowercase letters, digits and hyphens). Public: it was in an address. */
    sourceRef: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
    /** The project whose page it was; null for a person's profile. */
    sourceBusinessId: Id.nullable(),
    /** The person credited: the page's longest-standing owner, or the profile's own person. Null when none could be named. */
    referrerUserId: Id.nullable(),
  }),
  {
    doc: "A new person's profile was created after they arrived through a `?via=` reference that resolved to a public project page or a public person profile: recorded once per account, never for a reference that did not resolve or that named the person themselves. How the growth loops are measured and how credit for bringing someone is later paid. Account-level: not written to any business's events (see the note above the declaration); never narrated.",
    consumers: ["metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Milestones a founder chooses to show (0087; docs/NETWORK.md F2 "the story", F3 "cards")
// ---------------------------------------------------------------------------------------------------

/** What both events carry: the milestone, which one it is, and the addresses it is (or was) shown at. */
const ShownMilestoneFacts = z.object({
  milestoneId: Id,
  /** The milestone's key (`TROPHY_KEYS` in @foundmill/journey): "page_live", "first_follower", "customer_1", ... */
  key: z.string().min(1).max(60),
  /** The project page's address under /p/: the story is `/p/<slug>/story`. */
  slug: z.string().min(3).max(40),
  /** The card's full public URL (`/m/<milestoneId>`). */
  url: z.string().url().max(2048),
});

const milestoneShown = declareEvent("milestone.shown", ShownMilestoneFacts, {
  doc: "An owner or an admin chose to show a reached milestone on the project's page: from this moment it is a line of the project's story and anyone can open its card at `url`, while the page is public. The founder's own press, each time (nothing becomes public on its own). Not an outside result in itself (the north star does not count it: the milestone's own event already was one); never narrated.",
  consumers: ["stream", "metrics"],
  narratable: false,
});

const milestoneHidden = declareEvent("milestone.hidden", ShownMilestoneFacts, {
  doc: "An owner or an admin took a shown milestone off the project's page: it leaves the story and `url` answers not found from now on. The milestone itself stays reached. Never narrated.",
  consumers: ["stream", "metrics"],
  narratable: false,
});

// ---------------------------------------------------------------------------------------------------
// Tap-to-post (docs/NETWORK.md F3; docs/DECISIONS.md 2026-11-12)
// ---------------------------------------------------------------------------------------------------

const shareOpened = declareEvent(
  "share.opened",
  z.object({
    /** Where: a network or a messaging app. Null for the device's own share sheet and for a plain copy of the link or the text. */
    network: z.enum(SHARE_DESTINATIONS).nullable(),
    /** What was shared: a milestone's card, the project's page, or a drafted post. */
    kind: z.enum(SHARE_SUBJECT_KINDS),
    /** The milestone's id or the page's id; null for a drafted post. */
    refId: Id.nullable(),
    /** How: a network's window opened ready to post (`tap`) or with the link only, something copied, a message, or the device's sheet. */
    target: z.enum(SHARE_OPEN_TARGETS),
  }),
  {
    // North star (CLAUDE.md, founder 2026-11-11; DECISIONS 2026-11-12 "Honesty, unchanged"): pressing a share control
    // opens a window in someone else's product. Whether the founder then pressed Post there is not known here, so this
    // is not an outside result and the north star does not count it. A visit that comes back through the shared link
    // (its `via` reference) is what would count, and that is a different event.
    doc: "A member pressed a share control in the console: a network's own share window opened with the text and the link filled in, or with the link only, or the text or the link was copied, or a message app or the device's own share sheet opened. Recorded as a share that was opened and nothing more: whether anything was then posted is not known, so nothing calls this posted or published, it is not an outside result and the north star does not count it. Ids and names of controls only, never the words of the post. Metrics only; never narrated.",
    consumers: ["metrics"],
    narratable: false,
  },
);

// ---------------------------------------------------------------------------------------------------
// Account events: a person's own public profile (0080; account-scoped, docs/ARCHITECTURE.md §5 "Account events")
// ---------------------------------------------------------------------------------------------------

/** The address of the person's own public profile (`/u/<handle>`), and nothing private. */
const ProfileFacts = z.strictObject({
  /** The person's own handle as it was when this happened (a later change of address is not written back). */
  handle: PersonHandle,
});

const profilePublished = declareAccountEvent("profile.published", ProfileFacts, {
  doc: "The person made their own public profile public: from this moment anyone can open /u/<handle> signed out. Written once per change from private to public, in the same transaction, to the person's own account events; a save while it is already public writes nothing. The payload is the handle and nothing else.",
  consumers: ["stream"],
});

const profileUnpublished = declareAccountEvent("profile.unpublished", ProfileFacts, {
  doc: "The person took their own public profile down: /u/<handle> answers not found from now on (everything they wrote is kept). Written once per change from public to private, in the same transaction, to the person's own account events. The payload is the handle and nothing else.",
  consumers: ["stream"],
});

// ---------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------

/**
 * Every declared event, keyed by type. `satisfies Record<EventType, ...>` makes the compiler fail if a
 * type is added to EVENT_TYPES without a declaration here, or declared twice, or declared with a scope other than
 * the one the shared vocabulary gives it (`ACCOUNT_EVENT_TYPES`).
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
  "cycle.run_started": cycleRunStarted,
  "cycle.run_ended": cycleRunEnded,
  "autopilot.changed": autopilotChanged,
  "autopilot.cycle_started": autopilotCycleStarted,
  "inbox.item_created": inboxItemCreated,
  "inbox.item_updated": inboxItemUpdated,
  "decision.made": decisionMade,
  "foundations.progressed": foundationsProgressed,
  "conversation.message_posted": conversationMessagePosted,
  "membership.changed": membershipChanged,
  "agent.message_sent": agentMessageSent,
  "product.signoff_decided": productSignoffDecided,
  "distribution.started": distributionStarted,
  "product.research_drafted": productResearchDrafted,
  "goal.proposed": goalProposed,
  "goal.approved": goalApproved,
  "goal.change_requested": goalChangeRequested,
  "goal.achieved": goalAchieved,
  "page.published": pagePublished,
  "team_call.started": teamCallStarted,
  "team_call.ended": teamCallEnded,
  "page.unpublished": pageUnpublished,
  "page.followed": pageFollowed,
  "guidance.tour_completed": guidanceTourCompleted,
  "guidance.tour_skipped": guidanceTourSkipped,
  "guidance.explainer_dismissed": guidanceExplainerDismissed,
  "guidance.term_opened": guidanceTermOpened,
  "guidance.turned_off": guidanceTurnedOff,
  "push.sent": pushSent,
  "mail.sent": mailSent,
  "notify.email_sent": notifyEmailSent,
  "founder.session_started": founderSessionStarted,
  "profile.published": profilePublished,
  "profile.unpublished": profileUnpublished,
  "signup.attributed": signupAttributed,
  "milestone.shown": milestoneShown,
  "milestone.hidden": milestoneHidden,
  "share.opened": shareOpened,
} as const satisfies { readonly [K in EventTypeT]: EventDeclaration<K, z.ZodType, EventScopeOf<K>> };

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

/** The scope the catalog declares for a type (`business` or `account`). Throws `ValidationError` for an unknown type. */
export function eventScope(type: EventTypeT): EventScope {
  return getEventDeclaration(type).scope;
}

type TypesOfScope<Sc extends EventScope> = Sc extends "account" ? AccountEventType : BusinessEventType;

/** The declared types of one scope, in catalog order. */
export function eventTypesOfScope<Sc extends EventScope>(scope: Sc): TypesOfScope<Sc>[] {
  return DECLARED_EVENT_TYPES.filter((t) => EVENTS[t].scope === scope) as TypesOfScope<Sc>[];
}

// ---------------------------------------------------------------------------------------------------
// PlatformEvent
// ---------------------------------------------------------------------------------------------------

/**
 * The envelope every business-scoped event shares (BUILD §8.1). `occurredAt` is a `Date` in TypeScript and an ISO
 * string on the wire (docs/ARCHITECTURE.md §2); `JSON.stringify` does the right thing. An account-scoped type is never
 * a `PlatformEvent`: its envelope is `AccountEvent` (./account-event), keyed by a person instead of a business.
 */
export type PlatformEvent<T extends BusinessEventType = BusinessEventType> = {
  [K in BusinessEventType]: {
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
export type PlatformEventWire<T extends BusinessEventType = BusinessEventType> = Omit<
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
  if (decl.scope !== "business") {
    return {
      ok: false,
      error: new ValidationError(`${env.data.type} is account-scoped and is never a business event`, { type: env.data.type }),
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

export function toWire<T extends BusinessEventType>(event: PlatformEvent<T>): PlatformEventWire<T> {
  return { ...event, occurredAt: event.occurredAt.toISOString() } as PlatformEventWire<T>;
}

/** Narrow a PlatformEvent to one type (type guard for consumers with a switch per type). */
export function isEventOfType<T extends BusinessEventType>(
  event: PlatformEvent,
  type: T,
): event is PlatformEvent<T> {
  return event.type === type;
}

// Keep the vocabulary and the catalogue in lock-step at runtime too (the `satisfies` above covers compile time).
for (const t of EVENT_TYPES) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, t))
    throw new Error(`packages/events catalog is missing a declaration for "${t}"`);
  const declared = (EVENTS as Record<string, EventDeclaration>)[t]!.scope;
  if (declared !== (isAccountEventType(t) ? "account" : "business"))
    throw new Error(`packages/events catalog declares "${t}" as ${declared}-scoped, and the shared vocabulary says otherwise (ACCOUNT_EVENT_TYPES)`);
}
