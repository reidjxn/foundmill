/**
 * Shared vocabulary for the whole platform (docs/ARCHITECTURE.md §2).
 * Every enum used by more than one package is defined once here: a const tuple, a Zod enum and a TS type.
 * Never redeclare these elsewhere.
 */
import { z } from "zod";

export const GAME_MODES = ["live", "personal"] as const;
export const GameMode = z.enum(GAME_MODES);
export type GameMode = (typeof GAME_MODES)[number];

export const BUSINESS_MODES = ["augmented", "assisted", "automated"] as const;
export const BusinessMode = z.enum(BUSINESS_MODES);
export type BusinessMode = (typeof BUSINESS_MODES)[number];
export const DEFAULT_BUSINESS_MODE: BusinessMode = "assisted";

export const PLAN_TIERS = ["free", "pro", "scale"] as const;
export const PlanTier = z.enum(PLAN_TIERS);
export type PlanTier = (typeof PLAN_TIERS)[number];

export const MODEL_BILLING = ["byok", "credits"] as const;
export const ModelBilling = z.enum(MODEL_BILLING);
export type ModelBilling = (typeof MODEL_BILLING)[number];

export const DATA_REGIONS = ["eu", "us"] as const;
export const DataRegion = z.enum(DATA_REGIONS);
export type DataRegion = (typeof DATA_REGIONS)[number];

export const ARCHETYPES = ["b2b_saas", "consumer_app", "marketplace", "dtc_physical", "hardware", "services", "content_media"] as const;
export const Archetype = z.enum(ARCHETYPES);
export type Archetype = (typeof ARCHETYPES)[number];
export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  b2b_saas: "B2B SaaS", consumer_app: "Consumer app", marketplace: "Marketplace", dtc_physical: "DTC physical product",
  hardware: "Hardware", services: "Services", content_media: "Content / media",
};

export const MODULE_KEYS = ["product", "development", "distribution", "finance", "team", "legal"] as const;
export const ModuleKey = z.enum(MODULE_KEYS);
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Default tabs per module (BUILD §6.3). Slugs are stable ids; titles are display text. */
export const MODULE_TABS: Record<ModuleKey, readonly { slug: string; title: string }[]> = {
  product: [{ slug: "vision", title: "Vision" }, { slug: "specification", title: "Specification" }, { slug: "roadmap", title: "Roadmap" }, { slug: "changes", title: "Changes" }, { slug: "sources", title: "Sources" }, { slug: "research", title: "Research" }],
  development: [{ slug: "training-ground", title: "Live sessions" }, { slug: "plan", title: "Plan" }, { slug: "pull-requests", title: "Pull requests" }, { slug: "code", title: "Code" }, { slug: "environments", title: "Environments" }, { slug: "specialists", title: "Specialists" }],
  distribution: [{ slug: "formation", title: "Board" }, { slug: "channels", title: "Channels" }, { slug: "leads", title: "Leads" }, { slug: "campaigns", title: "Campaigns" }, { slug: "creative", title: "Creative" }, { slug: "attribution", title: "Attribution" }],
  finance: [{ slug: "overview", title: "Overview" }, { slug: "pnl", title: "Profit and loss" }, { slug: "cash", title: "Cash" }, { slug: "runway", title: "Runway" }, { slug: "wage-bill", title: "Wage bill" }, { slug: "cap-table", title: "Cap table" }],
  team: [{ slug: "squad", title: "Agents" }, { slug: "staff", title: "Staff" }, { slug: "responsibilities", title: "Responsibilities" }, { slug: "health", title: "Health" }, { slug: "hierarchy", title: "Hierarchy" }, { slug: "recruitment", title: "Recruitment" }],
  legal: [{ slug: "entity", title: "Entity" }, { slug: "incorporate", title: "Incorporate" }, { slug: "compliance", title: "Compliance" }, { slug: "contracts", title: "Contracts" }, { slug: "ip", title: "IP" }, { slug: "policies", title: "Policies" }, { slug: "regulatory", title: "Regulatory" }],
};

export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "viewer", "advisor"] as const;
export const MembershipRole = z.enum(MEMBERSHIP_ROLES);
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const WRITE_ROLES: readonly MembershipRole[] = ["owner", "admin", "member"];

export const DEPT_COLOUR_TOKENS = ["dept-1", "dept-2", "dept-3", "dept-4", "dept-5", "dept-6", "dept-7", "dept-8"] as const;
export const DeptColourToken = z.enum(DEPT_COLOUR_TOKENS);
export type DeptColourToken = (typeof DEPT_COLOUR_TOKENS)[number];

export const INBOX_ITEM_TYPES = ["decision", "customer_won", "warning", "update", "milestone", "report", "human_message"] as const;
export const InboxItemType = z.enum(INBOX_ITEM_TYPES);
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

export const INBOX_STATES = ["unread", "read", "answered", "archived"] as const;
export const InboxState = z.enum(INBOX_STATES);
export type InboxState = (typeof INBOX_STATES)[number];

export const EXHIBIT_KINDS = ["chart", "diagram", "entity_card", "table", "diff", "agent_tile", "none"] as const;
export const ExhibitKind = z.enum(EXHIBIT_KINDS);
export type ExhibitKind = (typeof EXHIBIT_KINDS)[number];

export const AGENT_STATUSES = ["healthy", "degraded", "failing", "injured", "paused", "idle"] as const;
export const AgentStatus = z.enum(AGENT_STATUSES);
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_LAYERS = ["assistant", "lead", "worker", "utility"] as const;
export const AgentLayer = z.enum(AGENT_LAYERS);
export type AgentLayer = (typeof AGENT_LAYERS)[number];

export const MODEL_KEYS = ["opus", "sonnet", "haiku"] as const;
export const ModelKey = z.enum(MODEL_KEYS);
export type ModelKey = (typeof MODEL_KEYS)[number];

export const SKILL_GROUPS = ["craft", "judgement", "execution"] as const;
export const SkillGroup = z.enum(SKILL_GROUPS);
export type SkillGroup = (typeof SKILL_GROUPS)[number];

export const AGENT_VERSION_STATES = ["draft", "live", "retired"] as const;
export const AgentVersionState = z.enum(AGENT_VERSION_STATES);
export type AgentVersionState = (typeof AGENT_VERSION_STATES)[number];

export const TASK_KINDS = ["code", "research", "channel", "specialist", "legal", "finance", "ops"] as const;
export const TaskKind = z.enum(TASK_KINDS);
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ["planned", "ready", "running", "paused", "blocked", "review", "merging", "done", "failed", "stopped"] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PHASES = ["planning", "implementing", "testing", "review", "merge", "done"] as const;
export const TaskPhase = z.enum(TASK_PHASES);
export type TaskPhase = (typeof TASK_PHASES)[number];

export const PLAN_ACTION_TYPES = [
  "create_task", "enable_channel", "disable_channel", "set_budget", "approve_spend", "update_spec", "update_roadmap",
  "send_message", "schedule_meeting", "hire_agent", "train_agent", "set_agent_model", "create_playbook", "request_human_action", "reply_only",
] as const;
export const PlanActionType = z.enum(PLAN_ACTION_TYPES);
export type PlanActionType = (typeof PLAN_ACTION_TYPES)[number];

export const PLAN_ORIGINS = ["option", "free_text", "playbook", "holiday"] as const;
export const PlanOrigin = z.enum(PLAN_ORIGINS);
export type PlanOrigin = (typeof PLAN_ORIGINS)[number];

export const PLAN_STATUSES = ["pending_confirmation", "executing", "done", "failed"] as const;
export const PlanStatus = z.enum(PLAN_STATUSES);
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const POLICY_OUTCOMES = ["allow", "ask", "deny"] as const;
export const PolicyOutcome = z.enum(POLICY_OUTCOMES);
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export const CHANNEL_KEYS = [
  "lead_generation", "email_automation", "seo", "geo", "content", "social", "paid_ads", "influencer", "affiliate",
  "direct_mail", "print", "broadcast", "outdoor", "pr", "events",
] as const;
export const ChannelKey = z.enum(CHANNEL_KEYS);
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHANNEL_LINES = ["attack", "midfield", "defence", "wings"] as const;
export const ChannelLine = z.enum(CHANNEL_LINES);
export type ChannelLine = (typeof CHANNEL_LINES)[number];

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
export const CampaignStatus = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const ASSET_KINDS = ["email", "post", "ad", "video", "article", "mailer", "print", "script"] as const;
export const AssetKind = z.enum(ASSET_KINDS);
export type AssetKind = (typeof ASSET_KINDS)[number];

export const APPROVAL_STATES = ["draft", "pending", "approved", "rejected"] as const;
export const ApprovalState = z.enum(APPROVAL_STATES);
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const CONVERSION_KINDS = ["signup", "activation", "payment"] as const;
export const ConversionKind = z.enum(CONVERSION_KINDS);
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

export const MATCHDAY_LEVELS = ["friendly", "league", "cup"] as const;
export const MatchdayLevel = z.enum(MATCHDAY_LEVELS);
export type MatchdayLevel = (typeof MATCHDAY_LEVELS)[number];
export const MATCHDAY_LEVEL_FOR_KIND: Record<ConversionKind, MatchdayLevel> = { signup: "friendly", activation: "league", payment: "cup" };

export const MILESTONE_KINDS = ["customer", "revenue", "release", "decision", "incorporation", "funding", "launch", "trophy"] as const;
export const MilestoneKind = z.enum(MILESTONE_KINDS);
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const ENTITY_KINDS = ["person", "organisation", "agent", "team_member", "platform_member", "community", "venue"] as const;
export const EntityKind = z.enum(ENTITY_KINDS);
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const VISIBILITY = ["public", "connections", "community", "private"] as const;
export const Visibility = z.enum(VISIBILITY);
export type Visibility = (typeof VISIBILITY)[number];

export const INTERACTION_KINDS = ["email", "meeting", "call", "message", "note"] as const;
export const InteractionKind = z.enum(INTERACTION_KINDS);
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const SOURCE_KINDS = ["doc", "issue", "feedback", "transcript", "competitor", "legal", "finance"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const PROPOSAL_STATUSES = ["open", "accepted", "partially_accepted", "rejected"] as const;
export const ProposalStatus = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const HUNK_DECISIONS = ["pending", "accepted", "rejected", "edited"] as const;
export const HunkDecision = z.enum(HUNK_DECISIONS);
export type HunkDecision = (typeof HUNK_DECISIONS)[number];

export const SEVERITIES = ["low", "normal", "critical"] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = (typeof SEVERITIES)[number];

export const ROADMAP_HORIZONS = ["now", "next", "later"] as const;
export const RoadmapHorizon = z.enum(ROADMAP_HORIZONS);
export type RoadmapHorizon = (typeof ROADMAP_HORIZONS)[number];

/**
 * A business's foundations (vision, specification, roadmap; BUILD §11.1, §11.5): pending at commit, drafting from the
 * first open, then ready or failed (a failed draft can be retried).
 */
export const FOUNDATIONS_STATUSES = ["pending", "drafting", "ready", "failed"] as const;
export const FoundationsStatus = z.enum(FOUNDATIONS_STATUSES);
export type FoundationsStatus = (typeof FOUNDATIONS_STATUSES)[number];

/** Which door the business came through: the Ideation Studio (Door A) or Import (Door B). */
export const FOUNDATIONS_DOORS = ["ideation", "import"] as const;
export const FoundationsDoor = z.enum(FOUNDATIONS_DOORS);
export type FoundationsDoor = (typeof FOUNDATIONS_DOORS)[number];

/** Where the drafting runs: the orchestrator's `businessFoundations` workflow, or in the api when Temporal is unreachable. */
export const FOUNDATIONS_RUNNERS = ["temporal", "local"] as const;
export const FoundationsRunner = z.enum(FOUNDATIONS_RUNNERS);
export type FoundationsRunner = (typeof FOUNDATIONS_RUNNERS)[number];

export const INTEGRATION_STATUSES = ["connected", "degraded", "expired", "disconnected", "mock"] as const;
export const IntegrationStatus = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const CONNECTOR_AUTH_KINDS = ["oauth", "api_key", "app", "none"] as const;
export const ConnectorAuthKind = z.enum(CONNECTOR_AUTH_KINDS);
export type ConnectorAuthKind = (typeof CONNECTOR_AUTH_KINDS)[number];

export const INCORPORATION_ROUTES = ["stripe_atlas", "companies_house_web", "kit"] as const;
export const IncorporationRoute = z.enum(INCORPORATION_ROUTES);
export type IncorporationRoute = (typeof INCORPORATION_ROUTES)[number];

export const SECURITY_KINDS = ["common", "preferred", "option", "warrant", "safe", "note"] as const;
export const SecurityKind = z.enum(SECURITY_KINDS);
export type SecurityKind = (typeof SECURITY_KINDS)[number];

export const USAGE_KINDS = ["tokens", "sandbox", "tool", "training"] as const;
export const UsageKind = z.enum(USAGE_KINDS);
export type UsageKind = (typeof USAGE_KINDS)[number];

export const ACTOR_KINDS = ["user", "agent", "system", "webhook"] as const;
export const ActorKind = z.enum(ACTOR_KINDS);
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const DECISION_TYPES = [
  "spend_above_threshold", "publish_content", "merge_to_main", "sign_contracts", "message_customers", "hire_agents", "change_models",
] as const;
export const DecisionType = z.enum(DECISION_TYPES);
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Event types (BUILD §8.1 plus platform-internal ones). Payload schemas live in packages/events. */
export const EVENT_TYPES = [
  "idea.committed", "spec.proposal_created", "spec.version_published",
  "task.started", "task.progressed", "task.completed", "task.blocked",
  "pr.merged", "deploy.succeeded",
  "lead.created", "lead.replied", "campaign.launched", "channel.threshold_breached",
  "signup.created", "activation.reached", "payment.received", "customer.converted",
  "bank.balance_updated", "runway.threshold_crossed",
  "agent.health_changed", "credential.expiring", "training.completed", "agent.promoted",
  "approval.requested", "approval.resolved",
  "mode.changed", "holiday.started", "holiday.ended",
  "filing.due", "contract.signed",
  "connection.requested", "message.received", "negotiation.message",
  "cycle.started", "cycle.completed", "inbox.item_created", "decision.made",
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = (typeof EVENT_TYPES)[number];

/** Money in minor units. */
export const Money = z.object({ amountMinor: z.number().int(), currency: z.string().length(3) });
export type Money = z.infer<typeof Money>;

export const Actor = z.object({ kind: ActorKind, id: z.string() });
export type Actor = z.infer<typeof Actor>;

/** Entity mention markup written by agents: [[ent:<uuid>|Display]] */
export const ENTITY_MARKUP_RE = /\[\[ent:([0-9a-f-]{36})\|([^\]]+)\]\]/g;

export type Uuid = string;
export type IsoDate = string;
