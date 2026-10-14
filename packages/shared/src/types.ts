/**
 * Shared vocabulary for the whole platform (docs/ARCHITECTURE.md §2).
 * Every enum used by more than one package is defined once: the const tuple, its TS type and plain records in
 * ./constants (no Zod, safe for browser bundles), and the Zod enum of the same name here. Never redeclare these elsewhere.
 */
import { z } from "zod";
import { CurrencyCode } from "./currency";
import {
  GAME_MODES,
  BUSINESS_MODES,
  PLAN_TIERS,
  MODEL_BILLING,
  DATA_REGIONS,
  ARCHETYPES,
  MODULE_KEYS,
  MEMBERSHIP_ROLES,
  DEPT_COLOUR_TOKENS,
  INBOX_ITEM_TYPES,
  INBOX_STATES,
  EXHIBIT_KINDS,
  AGENT_STATUSES,
  AGENT_STOP_REASONS,
  AGENT_PAUSE_REASONS,
  AGENT_LAYERS,
  MODEL_KEYS,
  SKILL_GROUPS,
  AGENT_VERSION_STATES,
  TASK_KINDS,
  TASK_STATUSES,
  TASK_PHASES,
  PLAN_ACTION_TYPES,
  PLAN_ORIGINS,
  PLAN_STATUSES,
  POLICY_OUTCOMES,
  CHANNEL_KEYS,
  CHANNEL_LINES,
  CAMPAIGN_STATUSES,
  ASSET_KINDS,
  APPROVAL_STATES,
  CONVERSION_KINDS,
  MATCHDAY_LEVELS,
  MILESTONE_KINDS,
  ENTITY_KINDS,
  VISIBILITY,
  INTERACTION_KINDS,
  SOURCE_KINDS,
  PROPOSAL_STATUSES,
  HUNK_DECISIONS,
  SEVERITIES,
  ROADMAP_HORIZONS,
  FOUNDATIONS_STATUSES,
  FOUNDATIONS_DOORS,
  FOUNDATIONS_RUNNERS,
  INTEGRATION_STATUSES,
  CONNECTOR_AUTH_KINDS,
  INCORPORATION_ROUTES,
  SECURITY_KINDS,
  USAGE_KINDS,
  ACTOR_KINDS,
  DECISION_TYPES,
  EVENT_TYPES,
  CONVERSATION_SUBJECT_KINDS,
  CONVERSATION_AUTHOR_KINDS,
  QUICK_REPLY_KINDS,
  AGENT_REACTIONS,
  AGENT_PRESENCES,
  DATE_FORMAT_PREFERENCES,
  TIME_FORMAT_PREFERENCES,
} from "./constants";
import type * as C from "./constants";

// The zod-free half (tuples, unions, records): "@foundmill/shared/constants".
export * from "./constants";

export const GameMode = z.enum(GAME_MODES);
export type GameMode = C.GameMode;
export const BusinessMode = z.enum(BUSINESS_MODES);
export type BusinessMode = C.BusinessMode;
export const PlanTier = z.enum(PLAN_TIERS);
export type PlanTier = C.PlanTier;
export const ModelBilling = z.enum(MODEL_BILLING);
export type ModelBilling = C.ModelBilling;
export const DataRegion = z.enum(DATA_REGIONS);
export type DataRegion = C.DataRegion;
export const Archetype = z.enum(ARCHETYPES);
export type Archetype = C.Archetype;
export const ModuleKey = z.enum(MODULE_KEYS);
export type ModuleKey = C.ModuleKey;
export const MembershipRole = z.enum(MEMBERSHIP_ROLES);
export type MembershipRole = C.MembershipRole;
export const DeptColourToken = z.enum(DEPT_COLOUR_TOKENS);
export type DeptColourToken = C.DeptColourToken;
export const InboxItemType = z.enum(INBOX_ITEM_TYPES);
export type InboxItemType = C.InboxItemType;
export const InboxState = z.enum(INBOX_STATES);
export type InboxState = C.InboxState;
export const ExhibitKind = z.enum(EXHIBIT_KINDS);
export type ExhibitKind = C.ExhibitKind;
export const AgentStatus = z.enum(AGENT_STATUSES);
export type AgentStatus = C.AgentStatus;
export const AgentStopReason = z.enum(AGENT_STOP_REASONS);
export type AgentStopReason = C.AgentStopReason;
export const AgentPauseReason = z.enum(AGENT_PAUSE_REASONS);
export type AgentPauseReason = C.AgentPauseReason;
export const AgentLayer = z.enum(AGENT_LAYERS);
export type AgentLayer = C.AgentLayer;
export const ModelKey = z.enum(MODEL_KEYS);
export type ModelKey = C.ModelKey;
export const SkillGroup = z.enum(SKILL_GROUPS);
export type SkillGroup = C.SkillGroup;
export const AgentVersionState = z.enum(AGENT_VERSION_STATES);
export type AgentVersionState = C.AgentVersionState;
export const TaskKind = z.enum(TASK_KINDS);
export type TaskKind = C.TaskKind;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = C.TaskStatus;
export const TaskPhase = z.enum(TASK_PHASES);
export type TaskPhase = C.TaskPhase;
export const PlanActionType = z.enum(PLAN_ACTION_TYPES);
export type PlanActionType = C.PlanActionType;
export const PlanOrigin = z.enum(PLAN_ORIGINS);
export type PlanOrigin = C.PlanOrigin;
export const PlanStatus = z.enum(PLAN_STATUSES);
export type PlanStatus = C.PlanStatus;
export const PolicyOutcome = z.enum(POLICY_OUTCOMES);
export type PolicyOutcome = C.PolicyOutcome;
/**
 * What choosing a pre-written Inbox option runs (BUILD §11.3; audit IAE-20, AC-01, FR-10): typed plan actions written
 * with the option (the Board's first decision, the Import report's first decisions), so an option click never parses
 * the option's prose. `assignee` names who does it by agent template key ("product_lead", "channel_lead_generation");
 * without one a channel's action goes to the agent that runs the channel, anything else to the agent who asked.
 * Amounts are minor units of the business's currency, which the plan fills in.
 */
export const OptionAction = z.object({
  type: z.enum(PLAN_ACTION_TYPES),
  params: z.record(z.string(), z.unknown()),
  assignee: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/)
    .optional(),
});
export type OptionAction = z.infer<typeof OptionAction>;
export const ChannelKey = z.enum(CHANNEL_KEYS);
export type ChannelKey = C.ChannelKey;
export const ChannelLine = z.enum(CHANNEL_LINES);
export type ChannelLine = C.ChannelLine;
export const CampaignStatus = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = C.CampaignStatus;
export const AssetKind = z.enum(ASSET_KINDS);
export type AssetKind = C.AssetKind;
export const ApprovalState = z.enum(APPROVAL_STATES);
export type ApprovalState = C.ApprovalState;
export const ConversionKind = z.enum(CONVERSION_KINDS);
export type ConversionKind = C.ConversionKind;
export const MatchdayLevel = z.enum(MATCHDAY_LEVELS);
export type MatchdayLevel = C.MatchdayLevel;
export const MilestoneKind = z.enum(MILESTONE_KINDS);
export type MilestoneKind = C.MilestoneKind;
export const EntityKind = z.enum(ENTITY_KINDS);
export type EntityKind = C.EntityKind;
export const Visibility = z.enum(VISIBILITY);
export type Visibility = C.Visibility;
export const InteractionKind = z.enum(INTERACTION_KINDS);
export type InteractionKind = C.InteractionKind;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = C.SourceKind;
export const ProposalStatus = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = C.ProposalStatus;
export const HunkDecision = z.enum(HUNK_DECISIONS);
export type HunkDecision = C.HunkDecision;
export const Severity = z.enum(SEVERITIES);
export type Severity = C.Severity;
export const RoadmapHorizon = z.enum(ROADMAP_HORIZONS);
export type RoadmapHorizon = C.RoadmapHorizon;
export const FoundationsStatus = z.enum(FOUNDATIONS_STATUSES);
export type FoundationsStatus = C.FoundationsStatus;
export const FoundationsDoor = z.enum(FOUNDATIONS_DOORS);
export type FoundationsDoor = C.FoundationsDoor;
export const FoundationsRunner = z.enum(FOUNDATIONS_RUNNERS);
export type FoundationsRunner = C.FoundationsRunner;
export const IntegrationStatus = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = C.IntegrationStatus;
export const ConnectorAuthKind = z.enum(CONNECTOR_AUTH_KINDS);
export type ConnectorAuthKind = C.ConnectorAuthKind;
export const IncorporationRoute = z.enum(INCORPORATION_ROUTES);
export type IncorporationRoute = C.IncorporationRoute;
export const SecurityKind = z.enum(SECURITY_KINDS);
export type SecurityKind = C.SecurityKind;
export const UsageKind = z.enum(USAGE_KINDS);
export type UsageKind = C.UsageKind;
export const ActorKind = z.enum(ACTOR_KINDS);
export type ActorKind = C.ActorKind;
export const DecisionType = z.enum(DECISION_TYPES);
export type DecisionType = C.DecisionType;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = C.EventType;
/** Money in minor units. */
export const Money = z.object({ amountMinor: z.number().int(), currency: CurrencyCode });
export type Money = z.infer<typeof Money>;
export const Actor = z.object({ kind: ActorKind, id: z.string() });
export type Actor = z.infer<typeof Actor>;
export const ConversationSubjectKind = z.enum(CONVERSATION_SUBJECT_KINDS);
export type ConversationSubjectKind = C.ConversationSubjectKind;
export const ConversationAuthorKind = z.enum(CONVERSATION_AUTHOR_KINDS);
export type ConversationAuthorKind = C.ConversationAuthorKind;
export const QuickReplyKind = z.enum(QUICK_REPLY_KINDS);
export type QuickReplyKind = C.QuickReplyKind;
export const AgentReaction = z.enum(AGENT_REACTIONS);
export type AgentReaction = C.AgentReaction;
export const AgentPresence = z.enum(AGENT_PRESENCES);
export type AgentPresence = C.AgentPresence;
export const DateFormatPreference = z.enum(DATE_FORMAT_PREFERENCES);
export type DateFormatPreference = C.DateFormatPreference;
export const TimeFormatPreference = z.enum(TIME_FORMAT_PREFERENCES);
export type TimeFormatPreference = C.TimeFormatPreference;
/** A signed-in person's date and time format (both fields required). */
export const DateFormatPrefs = z.object({ date: DateFormatPreference, time: TimeFormatPreference });
export type DateFormatPrefs = C.DateFormatPrefs;
