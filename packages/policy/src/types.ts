/**
 * Zod shapes for the Cedar request: who is calling (Agent), what they call (Tool), on whose behalf (Business),
 * and the per-call context. These are the only inputs the evaluator accepts; every attribute the Cedar schema
 * (src/schema.ts) marks as required is given a default here so a policy can never hit a missing-attribute error.
 */
import { z } from "zod";
import { BUSINESS_MODES, BusinessMode, ModelKey, PolicyOutcome } from "@founder-manager/shared";
import { LIMITS } from "@founder-manager/config";

/**
 * Per-agent autonomy override (BUILD §9.6 "Per-agent overrides"). `inherit` uses the business mode;
 * any other value replaces it for this agent only. Hard gates are never affected.
 */
export const AGENT_AUTONOMY = ["inherit", ...BUSINESS_MODES] as const;
export const AgentAutonomy = z.enum(AGENT_AUTONOMY);
export type AgentAutonomy = (typeof AGENT_AUTONOMY)[number];

const uuidOrSlug = z.string().min(1).max(200);
const minorUnits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** The principal: an agent instance of a business. Caps are in minor units of the business currency. */
export const AgentCtx = z.object({
  id: uuidOrSlug,
  /** Department id (never a department name — BUILD §2.1 rule 5). */
  department: z.string().min(1),
  /** Agent template type, e.g. "chief_of_staff", "developer", "channel_lead". Free text by design. */
  type: z.string().min(1),
  modelKey: ModelKey,
  autonomy: AgentAutonomy.default("inherit"),
  /** Hard ceiling for a single spend. Above this the call is denied, whatever the mode. */
  spendCapMinor: minorUnits.optional(),
  /** Above this a spend needs founder approval ("ask"). Defaults to LIMITS.approvalThresholdMinorDefault. */
  approvalThresholdMinor: minorUnits.default(LIMITS.approvalThresholdMinorDefault),
});
export type AgentCtx = z.infer<typeof AgentCtx>;
export type AgentCtxInput = z.input<typeof AgentCtx>;

/** The resource: one tool of one connector, with its policy hints (BUILD §13.1 `policyHints`). */
export const ToolCtx = z.object({
  connector: z.string().min(1),
  name: z.string().min(1),
  spendsMoney: z.boolean().default(false),
  contactsThirdParty: z.boolean().default(false),
  requiresKitMode: z.boolean().default(false),
  irreversible: z.boolean().default(false),
  hardGate: z.boolean().default(false),
  /** True for tools exposed by the Finance module (read-only in v1, BUILD §11.8). */
  finance: z.boolean().default(false),
  /** True for tools that create or amend a contract (assisted mode asks; signing is hard-gated anyway). */
  contract: z.boolean().default(false),
});
export type ToolCtx = z.infer<typeof ToolCtx>;
export type ToolCtxInput = z.input<typeof ToolCtx>;

export const BusinessCtx = z.object({
  id: uuidOrSlug,
  businessMode: BusinessMode,
  holidayActive: z.boolean().default(false),
});
export type BusinessCtx = z.infer<typeof BusinessCtx>;
export type BusinessCtxInput = z.input<typeof BusinessCtx>;

/** Per-call context (BUILD §9.5). Everything is optional on input; booleans default to false, amounts to 0. */
export const CallContext = z.object({
  amountMinor: minorUnits.default(0),
  recipient: z.string().min(1).optional(),
  recipientFirstSeenInUntrusted: z.boolean().default(false),
  recipientCountry: z.string().length(2).optional(),
  /** ISO 8601 local time at the recipient, when known. Informational for now; reserved for quiet-hours rules. */
  localTimeAtRecipient: z.string().min(1).optional(),
  suppressed: z.boolean().default(false),
  /** Defaults to `business.holidayActive` when omitted. */
  holidayActive: z.boolean().optional(),
  /** True when the calling session runs a channel in kit mode (agent prepares, founder submits). */
  kitMode: z.boolean().default(false),
});
export type CallContext = z.infer<typeof CallContext>;
export type CallContextInput = z.input<typeof CallContext>;

export const EvaluateInput = z.object({
  principal: AgentCtx,
  tool: ToolCtx,
  business: BusinessCtx,
  context: CallContext.prefault({}),
});
export type EvaluateInput = z.infer<typeof EvaluateInput>;
export type EvaluateInputInput = z.input<typeof EvaluateInput>;

export const EvaluateResult = z.object({
  outcome: PolicyOutcome,
  /** Human-readable reasons, one per determining policy (from each policy's @reason annotation). */
  reasons: z.array(z.string()),
  /** Ids of the determining policies (from each policy's @id annotation). */
  policyIds: z.array(z.string()),
});
export type EvaluateResult = z.infer<typeof EvaluateResult>;

/** Entity ids as they appear in Cedar. Kept here so the gateway's audit rows and the policies agree. */
export const cedarIds = {
  agent: (agentId: string) => agentId,
  tool: (connector: string, name: string) => `${connector}:${name}`,
  business: (businessId: string) => businessId,
} as const;
