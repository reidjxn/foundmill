/**
 * Shared vocabulary values without Zod (docs/ARCHITECTURE.md §2): every const tuple, its TS type and the plain records
 * built from them. Browser code imports these from "@foundmill/shared/constants" so that a page needing `MODULE_TABS`
 * or `CHANNEL_META` does not download Zod. The Zod enums of the same names live in ./types and are built from these
 * tuples; "@foundmill/shared" exports both. Never redeclare these elsewhere.
 */
import { IMPORT_TOOLS } from "./import-routes";

export const GAME_MODES = ["live", "personal"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const BUSINESS_MODES = ["augmented", "assisted", "automated"] as const;
export type BusinessMode = (typeof BUSINESS_MODES)[number];
export const DEFAULT_BUSINESS_MODE: BusinessMode = "assisted";

export const PLAN_TIERS = ["free", "pro", "scale"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const MODEL_BILLING = ["byok", "credits"] as const;
export type ModelBilling = (typeof MODEL_BILLING)[number];

export const DATA_REGIONS = ["eu", "us"] as const;
export type DataRegion = (typeof DATA_REGIONS)[number];

/**
 * The currencies a founder picks from (ISO 4217): their profile's, and the one a business keeps its money in (chosen at
 * commit, changed in Settings › Business; `businesses.currency`, 0025). Model and credit costs are always in USD.
 */
export const CURRENCIES = ["EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF", "CAD", "AUD"] as const;
/** A business created without a currency (no founder profile to take it from) keeps its money in US dollars (0025). */
export const DEFAULT_BUSINESS_CURRENCY = "USD";
/**
 * Model costs (a session, a training run, an Inbox note) are not business money: they are metered in the model price
 * list's currency (packages/models `PRICING_CURRENCY`), whatever currency the business keeps its money in.
 */
export const MODEL_COST_CURRENCY = "USD";

export const ARCHETYPES = ["b2b_saas", "consumer_app", "marketplace", "dtc_physical", "hardware", "services", "content_media"] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  b2b_saas: "B2B SaaS", consumer_app: "Consumer app", marketplace: "Marketplace", dtc_physical: "DTC physical product",
  hardware: "Hardware", services: "Services", content_media: "Content / media",
};

export const MODULE_KEYS = ["product", "development", "distribution", "finance", "team", "legal"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Default tabs per module (BUILD §6.3). Slugs are stable ids; titles are display text. */
export const MODULE_TABS: Record<ModuleKey, readonly { slug: string; title: string }[]> = {
  product: [{ slug: "vision", title: "Vision" }, { slug: "specification", title: "Specification" }, { slug: "roadmap", title: "Roadmap" }, { slug: "changes", title: "Changes" }, { slug: "sources", title: "Sources" }, { slug: "research", title: "Research" }],
  development: [{ slug: "training-ground", title: "Live sessions" }, { slug: "plan", title: "Plan" }, { slug: "pull-requests", title: "Pull requests" }, { slug: "code", title: "Code" }, { slug: "environments", title: "Environments" }, { slug: "specialists", title: "Specialists" }],
  distribution: [{ slug: "formation", title: "Board" }, { slug: "channels", title: "Channels" }, { slug: "leads", title: "Leads" }, { slug: "campaigns", title: "Campaigns" }, { slug: "creative", title: "Creative" }, { slug: "attribution", title: "Attribution" }],
  finance: [{ slug: "overview", title: "Overview" }, { slug: "pnl", title: "Profit and loss" }, { slug: "cash", title: "Cash" }, { slug: "runway", title: "Runway" }, { slug: "wage-bill", title: "Payroll" }, { slug: "cap-table", title: "Cap table" }],
  team: [{ slug: "squad", title: "Agents" }, { slug: "staff", title: "Staff" }, { slug: "responsibilities", title: "Responsibilities" }, { slug: "health", title: "Health" }, { slug: "hierarchy", title: "Hierarchy" }, { slug: "recruitment", title: "Recruitment" }],
  legal: [{ slug: "entity", title: "Entity" }, { slug: "incorporate", title: "Incorporate" }, { slug: "compliance", title: "Compliance" }, { slug: "contracts", title: "Contracts" }, { slug: "ip", title: "IP" }, { slug: "policies", title: "Policies" }, { slug: "regulatory", title: "Regulatory" }],
};

export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "viewer", "advisor"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
/**
 * How a membership came to be (migration 0065): `invite` (team.humans.invite, the seeds' owners, every row before
 * 0065), `founder` (the owner seat Commit writes), `example` (business.example.open: a read-only walk around a seeded
 * demo business, always a viewer, never a seat, never staff). The db schema re-exports these.
 */
export const MEMBERSHIP_SOURCES = ["invite", "founder", "example"] as const;
export type MembershipSource = (typeof MEMBERSHIP_SOURCES)[number];
export const WRITE_ROLES: readonly MembershipRole[] = ["owner", "admin", "member"];

export const DEPT_COLOUR_TOKENS = ["dept-1", "dept-2", "dept-3", "dept-4", "dept-5", "dept-6", "dept-7", "dept-8"] as const;
export type DeptColourToken = (typeof DEPT_COLOUR_TOKENS)[number];

export const INBOX_ITEM_TYPES = ["decision", "customer_won", "warning", "update", "milestone", "report", "human_message"] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

export const INBOX_STATES = ["unread", "read", "answered", "archived"] as const;
export type InboxState = (typeof INBOX_STATES)[number];

export const EXHIBIT_KINDS = ["chart", "diagram", "entity_card", "table", "diff", "agent_tile", "none"] as const;
export type ExhibitKind = (typeof EXHIBIT_KINDS)[number];

export const AGENT_STATUSES = ["healthy", "degraded", "failing", "injured", "paused", "idle"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Why a whole team was stopped (`businesses.agents_stopped_reason`, 0023): Stop all agents, a revoked Anthropic key or
 * used-up credits. Only an owner or admin clears it (`business.resumeAgents`); a new key or a top-up clears its own.
 */
export const AGENT_STOP_REASONS = ["kill_switch", "key_revoked", "credits_exhausted"] as const;
export type AgentStopReason = (typeof AGENT_STOP_REASONS)[number];

/** Why one agent is paused (`agents.paused_reason`, 0023): a team-wide stop, or its own wage cap for the period. */
export const AGENT_PAUSE_REASONS = [...AGENT_STOP_REASONS, "wage_cap"] as const;
export type AgentPauseReason = (typeof AGENT_PAUSE_REASONS)[number];

export const AGENT_LAYERS = ["assistant", "lead", "worker", "utility"] as const;
export type AgentLayer = (typeof AGENT_LAYERS)[number];

export const MODEL_KEYS = ["opus", "sonnet", "haiku"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

export const SKILL_GROUPS = ["craft", "judgement", "execution"] as const;
export type SkillGroup = (typeof SKILL_GROUPS)[number];

/** Where a skill the founder added to an agent came from (`skill_definitions.source`, 0061): the skills library or a skill file. */
export const ADDED_SKILL_SOURCES = ["library", "upload"] as const;
export type AddedSkillSource = (typeof ADDED_SKILL_SOURCES)[number];

export const AGENT_VERSION_STATES = ["draft", "live", "retired"] as const;
export type AgentVersionState = (typeof AGENT_VERSION_STATES)[number];

export const TASK_KINDS = ["code", "research", "channel", "specialist", "legal", "finance", "ops"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ["planned", "ready", "running", "paused", "blocked", "review", "merging", "done", "failed", "stopped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/**
 * Statuses a cycle may start a task from. A failed or blocked task comes back with a backoff and a limit; `stopped` is the
 * founder's "Stop and discard", which only Start undoes. One list for the planner, the brief and the mock planner.
 */
export const PLANNABLE_TASK_STATUSES = ["planned", "ready", "paused", "blocked", "failed"] as const satisfies readonly TaskStatus[];

export const TASK_PHASES = ["planning", "implementing", "testing", "review", "merge", "done"] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

export const PLAN_ACTION_TYPES = [
  "create_task", "enable_channel", "disable_channel", "set_budget", "approve_spend", "update_spec", "update_roadmap",
  "send_message", "schedule_meeting", "hire_agent", "train_agent", "set_agent_model", "create_playbook", "request_human_action", "reply_only",
] as const;
export type PlanActionType = (typeof PLAN_ACTION_TYPES)[number];

export const PLAN_ORIGINS = ["option", "free_text", "playbook", "holiday"] as const;
export type PlanOrigin = (typeof PLAN_ORIGINS)[number];

export const PLAN_STATUSES = ["pending_confirmation", "executing", "done", "failed"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const POLICY_OUTCOMES = ["allow", "ask", "deny"] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export const CHANNEL_KEYS = [
  "lead_generation", "email_automation", "seo", "geo", "content", "social", "paid_ads", "influencer", "affiliate",
  "direct_mail", "print", "broadcast", "outdoor", "pr", "events",
] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHANNEL_LINES = ["attack", "midfield", "defence", "wings"] as const;
export type ChannelLine = (typeof CHANNEL_LINES)[number];

/**
 * The window every channel figure covers ("last 35 days"): the API's channel summary (today and the 34 days before it,
 * both ends included), the Channel Board, Attribution, the funnel and Finance's acquisition cost all read and label
 * this one window.
 */
export const CHANNEL_WINDOW_DAYS = 35;

export const CHANNEL_META: Record<ChannelKey, { label: string; line: ChannelLine; coreMetric: string; kitModeByDefault: boolean }> = {
  lead_generation: { label: "Lead generation", line: "attack", coreMetric: "Qualified leads/week", kitModeByDefault: false },
  paid_ads: { label: "Paid advertising", line: "attack", coreMetric: "CPA", kitModeByDefault: false },
  affiliate: { label: "Affiliate", line: "attack", coreMetric: "Affiliate revenue", kitModeByDefault: false },
  email_automation: { label: "Email automation", line: "midfield", coreMetric: "Reply/conversion rate", kitModeByDefault: false },
  social: { label: "Social media", line: "midfield", coreMetric: "Engaged followers, clicks", kitModeByDefault: false },
  influencer: { label: "Influencer", line: "midfield", coreMetric: "Customers/creator", kitModeByDefault: false },
  pr: { label: "PR", line: "midfield", coreMetric: "Coverage, referral visits", kitModeByDefault: false },
  events: { label: "Event marketing", line: "midfield", coreMetric: "Pipeline from events", kitModeByDefault: false },
  seo: { label: "SEO", line: "defence", coreMetric: "Organic signups", kitModeByDefault: false },
  geo: { label: "GEO", line: "defence", coreMetric: "AI answer share", kitModeByDefault: false },
  content: { label: "Content marketing", line: "defence", coreMetric: "Leads from content", kitModeByDefault: false },
  direct_mail: { label: "Direct mail", line: "wings", coreMetric: "Response rate", kitModeByDefault: false },
  print: { label: "Print", line: "wings", coreMetric: "Code redemptions", kitModeByDefault: true },
  broadcast: { label: "Broadcast", line: "wings", coreMetric: "Vanity URL visits, lift", kitModeByDefault: true },
  outdoor: { label: "Outdoor", line: "wings", coreMetric: "QR scans, geo-lift", kitModeByDefault: false },
};

export const CAMPAIGN_STATUSES = ["draft", "pending_approval", "scheduled", "live", "paused", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const ASSET_KINDS = ["email", "post", "ad", "video", "article", "mailer", "print", "script"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const APPROVAL_STATES = ["draft", "pending", "approved", "rejected"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const CONVERSION_KINDS = ["signup", "activation", "payment"] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

export const MATCHDAY_LEVELS = ["friendly", "league", "cup"] as const;
export type MatchdayLevel = (typeof MATCHDAY_LEVELS)[number];
export const MATCHDAY_LEVEL_FOR_KIND: Record<ConversionKind, MatchdayLevel> = { signup: "friendly", activation: "league", payment: "cup" };

export const MILESTONE_KINDS = ["customer", "revenue", "release", "decision", "incorporation", "funding", "launch", "trophy"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const ENTITY_KINDS = ["person", "organisation", "agent", "team_member", "platform_member", "community", "venue"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const VISIBILITY = ["public", "connections", "community", "private"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const INTERACTION_KINDS = ["email", "meeting", "call", "message", "note"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const SOURCE_KINDS = ["doc", "issue", "feedback", "transcript", "competitor", "legal", "finance"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Door B (BUILD §11.1): the one read-only gateway call that reads each import source, keyed by the import source key
 * (apps/api `IMPORT_SOURCE_KEYS`). apps/api words the Import report from it and the orchestrator's `importSource` makes
 * the call; a source without a reader (null) is reported as not read, never as imported.
 */
export const IMPORT_READERS: Readonly<Record<string, { connector: string; tool: string } | null>> = IMPORT_TOOLS;

export const PROPOSAL_STATUSES = ["open", "accepted", "partially_accepted", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const HUNK_DECISIONS = ["pending", "accepted", "rejected", "edited"] as const;
export type HunkDecision = (typeof HUNK_DECISIONS)[number];

export const SEVERITIES = ["low", "normal", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ROADMAP_HORIZONS = ["now", "next", "later"] as const;
export type RoadmapHorizon = (typeof ROADMAP_HORIZONS)[number];

/**
 * A business's foundations (vision, specification, roadmap; BUILD §11.1, §11.5): pending at commit, drafting from the
 * first open, then ready or failed (a failed draft can be retried).
 */
export const FOUNDATIONS_STATUSES = ["pending", "drafting", "ready", "failed"] as const;
export type FoundationsStatus = (typeof FOUNDATIONS_STATUSES)[number];

/** Which door the business came through: the Ideation Studio (Door A) or Import (Door B). */
export const FOUNDATIONS_DOORS = ["ideation", "import"] as const;
export type FoundationsDoor = (typeof FOUNDATIONS_DOORS)[number];

/**
 * Where a business stands in its first days (founder, 2026-10-18: the product comes first). Derived, never stored:
 * `drafting` while the foundations are pending, drafting or failed; `awaiting_signoff` until the founder has approved
 * both the specification and the roadmap; `building` once both are approved and before distribution has started;
 * `selling` once `businesses.distribution_started_at` is set (every business committed before sign-offs existed).
 */
export const PRODUCT_STAGES = ["drafting", "awaiting_signoff", "building", "selling"] as const;
export type ProductStage = (typeof PRODUCT_STAGES)[number];

/** What the founder signs off (`product_signoffs.kind`): the specification, the roadmap, and the step that starts distribution. */
export const SIGNOFF_KINDS = ["spec", "roadmap", "ready_to_sell"] as const;
export type SignoffKind = (typeof SIGNOFF_KINDS)[number];

/** A sign-off round's state: asked, approved, sent back with the founder's notes, or declined (a "Not yet" on Ready to sell). */
export const SIGNOFF_STATUSES = ["pending", "approved", "changes_requested", "declined"] as const;
export type SignoffStatus = (typeof SIGNOFF_STATUSES)[number];

/** Where the drafting runs: the orchestrator's `businessFoundations` workflow, or in the api when Temporal is unreachable. */
export const FOUNDATIONS_RUNNERS = ["temporal", "local"] as const;
export type FoundationsRunner = (typeof FOUNDATIONS_RUNNERS)[number];

/**
 * Product research (BUILD §11.5 Research tab; the Product Researcher agent): the research plan a new business gets as
 * soon as its foundations are ready, drafted once by the api (`product_research`, one row per business): pending until
 * the foundations are ready, drafting while the plan is written, then ready or failed (a failed draft can be retried).
 */
export const RESEARCH_STATUSES = ["pending", "drafting", "ready", "failed"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/** What the Product Researcher produces (`research_artifacts.kind`): the plan's parts first, then what the tests yield. */
export const RESEARCH_ARTIFACT_KINDS = ["interview_plan", "interview_script", "smoke_test", "survey", "demo_script", "demo", "findings"] as const;
export type ResearchArtifactKind = (typeof RESEARCH_ARTIFACT_KINDS)[number];

/** An artifact's state: drafted by the agent, marked ready by the team, shared with participants (by the founder, never by an agent). */
export const RESEARCH_ARTIFACT_STATUSES = ["draft", "ready", "shared"] as const;
export type ResearchArtifactStatus = (typeof RESEARCH_ARTIFACT_STATUSES)[number];

export const INTEGRATION_STATUSES = ["connected", "degraded", "expired", "disconnected", "mock"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const CONNECTOR_AUTH_KINDS = ["oauth", "api_key", "app", "none"] as const;
export type ConnectorAuthKind = (typeof CONNECTOR_AUTH_KINDS)[number];

export const INCORPORATION_ROUTES = ["stripe_atlas", "companies_house_web", "kit"] as const;
export type IncorporationRoute = (typeof INCORPORATION_ROUTES)[number];
/** Each route by the name a founder knows it ("companies_house_web" is "Companies House"), never the stored key. */
export const INCORPORATION_ROUTE_LABELS: Record<IncorporationRoute, string> = { stripe_atlas: "Stripe Atlas", companies_house_web: "Companies House", kit: "Document pack" };

export const SECURITY_KINDS = ["common", "preferred", "option", "warrant", "safe", "note"] as const;
export type SecurityKind = (typeof SECURITY_KINDS)[number];

/**
 * Bank transaction category keys that are not operating cash flow (BUILD §11.8: net burn is "operating outflows −
 * operating inflows, financing excluded"), normalized (lower case, `_` and `-` read as spaces). One list for both
 * readers: packages/db `netBurn` leaves these out of burn, and the finance module's chart of accounts files exactly
 * these under Financing and Transfers, so the burn tiles and the P&L agree on what a raise is.
 */
export const NON_OPERATING_CATEGORY_KEYS = {
  financing: ["financing", "funding", "investment", "equity", "safe", "loan", "loan repayment", "grant", "founder loan", "director loan", "share capital"],
  transfers: ["transfer", "transfers", "internal transfer", "between accounts"],
} as const satisfies Record<string, readonly string[]>;

export const USAGE_KINDS = ["tokens", "sandbox", "tool", "training"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const ACTOR_KINDS = ["user", "agent", "system", "webhook"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const DECISION_TYPES = [
  "spend_above_threshold", "publish_content", "merge_to_main", "sign_contracts", "message_customers", "hire_agents", "change_models",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Event types (BUILD §8.1 plus platform-internal ones). Payload schemas live in packages/events. */
export const EVENT_TYPES = [
  "idea.committed", "spec.proposal_created", "spec.version_published",
  "source.added", "source.scored",
  "task.started", "task.progressed", "task.completed", "task.blocked",
  "pr.merged", "deploy.succeeded",
  "lead.created", "lead.replied", "campaign.launched", "channel.threshold_breached",
  "signup.created", "activation.reached", "payment.received", "customer.converted",
  "bank.balance_updated", "runway.threshold_crossed",
  "agent.health_changed", "credential.expiring", "training.completed", "agent.promoted",
  "approval.requested", "approval.resolved",
  "mode.changed", "holiday.started", "holiday.ended", "business.updated",
  "filing.due", "contract.signed",
  "connection.requested", "message.received", "negotiation.message",
  "cycle.started", "cycle.completed", "cycle.run_started", "cycle.run_ended", "inbox.item_created", "inbox.item_updated", "decision.made",
  "autopilot.changed", "autopilot.cycle_started",
  "foundations.progressed",
  "conversation.message_posted",
  "membership.changed",
  "agent.message_sent",
  "product.signoff_decided",
  "distribution.started",
  "product.research_drafted",
  "goal.proposed", "goal.approved", "goal.change_requested", "goal.achieved",
  "guidance.tour_completed", "guidance.tour_skipped", "guidance.explainer_dismissed", "guidance.term_opened", "guidance.turned_off",
  "push.sent",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The guided layer's product signals (docs/UX_AUDIT_AND_PLAN.md §11): how founders use the tours, the explainers, the
 * definitions and the switch. Written by `founder.preferences.signal` into the business the founder was in, for the
 * metrics consumer; never narrated, and walled to the readers of Settings on the business stream.
 */
export const GUIDANCE_EVENT_TYPES = ["guidance.tour_completed", "guidance.tour_skipped", "guidance.explainer_dismissed", "guidance.term_opened", "guidance.turned_off"] as const satisfies readonly EventType[];
export type GuidanceEventType = (typeof GUIDANCE_EVENT_TYPES)[number];
/** Where a founder turned guidance off: Settings › Preferences, a tour's card, or the first-week checklist. */
export const GUIDANCE_OFF_SOURCES = ["settings", "tour", "checklist"] as const;
export type GuidanceOffSource = (typeof GUIDANCE_OFF_SOURCES)[number];

/**
 * Events addressed to one person, never to a business (audit FU-S-2). A connection request or a message from another
 * founder is about its RECIPIENT, and a business's event log, its Inbox and its `ev:` stream are read by every member and
 * advisor with access to the sections they feed, so writing the sender's words there made a founder's private network
 * messages readable by their staff. These types stay in the vocabulary (the playbook words, the stream's walls table),
 * but they are never written to `events` (`repos.events.write` refuses them and a check constraint, 0060, holds the table
 * to it) and never delivered on a business stream (apps/stream drops them). The recipient gets a content-free signal on
 * their own `u:{userId}` channel and reads the rest through `live.*`, which only the people in the thread can call.
 */
export const PERSON_ADDRESSED_EVENT_TYPES = ["connection.requested", "message.received"] as const satisfies readonly EventType[];
export const isPersonAddressedEvent = (type: string | null | undefined): boolean => (PERSON_ADDRESSED_EVENT_TYPES as readonly string[]).includes(type ?? "");

/** Entity mention markup written by agents: [[ent:<uuid>|Display]] */
export const ENTITY_MARKUP_RE = /\[\[ent:([0-9a-f-]{36})\|([^\]]+)\]\]/g;

export type Uuid = string;
export type IsoDate = string;

/**
 * Founder ↔ agent conversations (the agent's "desk"; audit-conversation §4). A thread is about one subject: an Inbox
 * item, the agent itself, or one task. Messages are written by the founder or by the agent; quick replies are the 2–4
 * buttons under an agent message so the founder never has to type.
 */
export const CONVERSATION_SUBJECT_KINDS = ["inbox_item", "agent", "task"] as const;
export type ConversationSubjectKind = (typeof CONVERSATION_SUBJECT_KINDS)[number];

export const CONVERSATION_AUTHOR_KINDS = ["founder", "agent"] as const;
export type ConversationAuthorKind = (typeof CONVERSATION_AUTHOR_KINDS)[number];

/** What pressing a quick reply means: ask a question, acknowledge, hand work off, pick a decision option, decline, or open the text field. */
export const QUICK_REPLY_KINDS = ["ask", "acknowledge", "hand_off", "choose_option", "decline", "write"] as const;
export type QuickReplyKind = (typeof QUICK_REPLY_KINDS)[number];

/** How an agent reacts to the founder's message (an icon disc in the UI, never an emoji). */
export const AGENT_REACTIONS = ["none", "noted", "thinking", "concerned", "pleased"] as const;
export type AgentReaction = (typeof AGENT_REACTIONS)[number];

/** Where an agent is, for the conversation header: in a session, free, paused, or down. */
export const AGENT_PRESENCES = ["working", "available", "away", "down"] as const;
export type AgentPresence = (typeof AGENT_PRESENCES)[number];

/**
 * How a signed-in person reads dates and times (founder, 2026-10-11): a personal preference of the account, applied in
 * every business. The date format is US (the default, "Oct 7, 2026"), day first or ISO; the time is 12-hour (the
 * default, "3:45 PM") or 24-hour. The patterns behind each live in @foundmill/dugout (lib/date-preferences.ts).
 */
export const DATE_FORMAT_PREFERENCES = ["us", "day_first", "iso"] as const;
export type DateFormatPreference = (typeof DATE_FORMAT_PREFERENCES)[number];

export const TIME_FORMAT_PREFERENCES = ["12h", "24h"] as const;
export type TimeFormatPreference = (typeof TIME_FORMAT_PREFERENCES)[number];

/** One person's choice of date and time format. */
export interface DateFormatPrefs {
  date: DateFormatPreference;
  time: TimeFormatPreference;
}

/** What everyone reads until they choose: US dates, 12-hour times (also the signed-out pages). */
export const DEFAULT_DATE_FORMAT_PREFS: Readonly<DateFormatPrefs> = Object.freeze({ date: "us", time: "12h" });

/**
 * The guided layer's one switch (docs/UX_AUDIT_AND_PLAN.md §6.3; `account_preferences.guidance`, 0064): "on" shows
 * tutoring (explainers, the first-week checklist, coach marks, term underlines), "off" hides it and never hides
 * information (consequences, provenance, Estimate). Keyboard caps on buttons go the other way: they show only when it is
 * off. A personal preference of the account, applied in every business, like the date format.
 */
export const GUIDANCE_MODES = ["on", "off"] as const;
export type GuidanceMode = (typeof GUIDANCE_MODES)[number];

/**
 * The mobile companion app (docs/mobile, founder 2026-11-08). A signed-in person's phones register for push
 * (`founder_devices`, 0073): the platform, the push provider the app ships with and the provider's subscription id.
 */
export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];
export const PUSH_PROVIDERS = ["onesignal"] as const;
export type PushProvider = (typeof PUSH_PROVIDERS)[number];
/**
 * What a phone may be told about (Settings › Preferences › Notifications in the app; `account_preferences.notifications`,
 * 0073): a note that needs an answer, a go-ahead request, a customer won, an agent down, a runway threshold, a run of
 * cycles finished, the goal reached. Every kind is on until the person turns it off.
 */
export const NOTIFICATION_KINDS = ["decision", "approval", "customer", "agent_down", "runway", "run_finished", "goal"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationPrefs = Record<NotificationKind, boolean>;
export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPrefs> = Object.freeze({ decision: true, approval: true, customer: true, agent_down: true, runway: true, run_finished: true, goal: true });

/** The account's type size (`account_preferences.text_size`, 0064): comfortable grows body and small text; the structure keeps its sizes. */
export const TEXT_SIZES = ["standard", "comfortable"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
