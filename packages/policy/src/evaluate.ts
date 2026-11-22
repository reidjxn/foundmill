/**
 * evaluate(input) → { outcome, reasons, policyIds } (ARCHITECTURE §7).
 *
 * Deny beats ask beats allow:
 *  - Cedar `deny` → `deny`, listing the determining forbid policies (or "no policy permits" when none matched).
 *  - Cedar `allow` with any determining permit annotated `@outcome("ask")` → `ask`, listing those policies.
 *  - Cedar `allow` otherwise → `allow`, listing the determining permits.
 *  - Any evaluation error (a policy that could not be evaluated) fails closed to `deny`.
 */
import type { CedarValueJson, Entities, EntityJson } from "@cedar-policy/cedar-wasm/nodejs";
import type { BusinessMode } from "@foundmill/shared";
import { getPolicyEngine, type PolicyEngine } from "./cedar";
import { cedarIds, EvaluateInput, type EvaluateInputInput, type EvaluateResult } from "./types";

/** Used when an agent has no spend cap: large enough to never bind, small enough for a Cedar Long. */
export const NO_SPEND_CAP_MINOR = Number.MAX_SAFE_INTEGER;

export const ACTION_CALL = { type: "Action", id: "call" } as const;

/**
 * The mode the policies see for this agent: its own autonomy override, else the business mode, which is Automated while
 * the founder is on vacation (BUILD §9.6 "Holiday (Automated)": the Chief of Staff decides within its authority and only
 * hard gates queue; the holiday budget ceiling still tightens the cap). An agent the founder gave its own autonomy keeps
 * it.
 */
export function effectiveBusinessMode(input: EvaluateInput): BusinessMode {
  if (input.principal.autonomy !== "inherit") return input.principal.autonomy;
  return input.business.holidayActive ? "automated" : input.business.businessMode;
}

/** Build the Cedar entities for a request. Exported for the gateway's audit rows and for tests. */
export function toEntities(input: EvaluateInput): Entities {
  const { principal, tool, business } = input;
  const agent: EntityJson = {
    uid: { type: "Agent", id: cedarIds.agent(principal.id) },
    attrs: {
      department: principal.department,
      type: principal.type,
      modelKey: principal.modelKey,
      autonomy: principal.autonomy,
      businessMode: effectiveBusinessMode(input),
      spendCapMinor: principal.spendCapMinor ?? NO_SPEND_CAP_MINOR,
      approvalThresholdMinor: principal.approvalThresholdMinor,
      inboundPaymentPower: business.paymentPowers.includes("inbound"),
    },
    parents: [{ type: "Business", id: cedarIds.business(business.id) }],
  };
  const toolEntity: EntityJson = {
    uid: { type: "Tool", id: cedarIds.tool(tool.connector, tool.name) },
    attrs: {
      connector: tool.connector,
      name: tool.name,
      spendsMoney: tool.spendsMoney,
      contactsThirdParty: tool.contactsThirdParty,
      requiresKitMode: tool.requiresKitMode,
      irreversible: tool.irreversible,
      hardGate: tool.hardGate,
      finance: tool.finance,
      contract: tool.contract,
      securitySettings: tool.securitySettings,
      unclassified: tool.unclassified,
      paymentRecord: tool.paymentRecord,
      askAlways: tool.askAlways,
      founderExecuted: tool.founderExecuted,
    },
    parents: [],
  };
  const businessEntity: EntityJson = {
    uid: { type: "Business", id: cedarIds.business(business.id) },
    attrs: { businessMode: business.businessMode, holidayActive: business.holidayActive },
    parents: [],
  };
  return [agent, toolEntity, businessEntity];
}

/** Build the Cedar context record. Optional strings are omitted when absent (the schema marks them optional). */
export function toContext(input: EvaluateInput): Record<string, CedarValueJson> {
  const c = input.context;
  const ctx: Record<string, CedarValueJson> = {
    amountMinor: c.amountMinor,
    recipientFirstSeenInUntrusted: c.recipientFirstSeenInUntrusted,
    suppressed: c.suppressed,
    holidayActive: c.holidayActive ?? input.business.holidayActive,
    kitMode: c.kitMode,
    founderPress: c.founderPress,
  };
  if (c.recipient !== undefined) ctx["recipient"] = c.recipient;
  if (c.recipientCountry !== undefined) ctx["recipientCountry"] = c.recipientCountry;
  if (c.localTimeAtRecipient !== undefined) ctx["localTimeAtRecipient"] = c.localTimeAtRecipient;
  if (c.recipientBasis !== undefined) ctx["recipientBasis"] = c.recipientBasis;
  return ctx;
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * Evaluate one tool call. Input is validated with Zod (defaults applied); invalid input throws a ZodError.
 * Never throws for a policy decision: engine failures are returned as `deny` with the error in `reasons`.
 */
export function evaluate(rawInput: EvaluateInputInput, engine: PolicyEngine = getPolicyEngine()): EvaluateResult {
  const input = EvaluateInput.parse(rawInput);
  const answer = engine.authorize({
    principal: { type: "Agent", id: cedarIds.agent(input.principal.id) },
    action: ACTION_CALL,
    resource: { type: "Tool", id: cedarIds.tool(input.tool.connector, input.tool.name) },
    context: toContext(input),
    entities: toEntities(input),
  });

  if (answer.type === "failure") {
    return {
      outcome: "deny",
      reasons: ["Policy engine could not evaluate the request", ...answer.errors.map((e) => e.message)],
      policyIds: [],
    };
  }

  const { decision, diagnostics } = answer.response;
  const determining = unique(diagnostics.reason);
  const meta = (id: string) => engine.policySet.byId[id];

  if (diagnostics.errors.length > 0) {
    // A policy that errored was skipped by Cedar; a skipped forbid would be unsafe, so fail closed.
    return {
      outcome: "deny",
      reasons: [
        "Policy evaluation error; denied as a precaution",
        ...diagnostics.errors.map((e) => `${e.policyId}: ${e.error.message}`),
      ],
      policyIds: unique([...diagnostics.errors.map((e) => e.policyId), ...determining]),
    };
  }

  if (decision === "deny") {
    const forbids = determining.filter((id) => meta(id)?.effect === "forbid");
    if (forbids.length === 0) {
      return { outcome: "deny", reasons: ["No policy permits this call"], policyIds: [] };
    }
    return { outcome: "deny", reasons: forbids.map((id) => meta(id)!.reason), policyIds: forbids };
  }

  const permits = determining.filter((id) => meta(id)?.effect === "permit");
  const asks = permits.filter((id) => meta(id)!.outcome === "ask");
  if (asks.length > 0) {
    return { outcome: "ask", reasons: asks.map((id) => meta(id)!.reason), policyIds: asks };
  }
  return { outcome: "allow", reasons: permits.map((id) => meta(id)!.reason), policyIds: permits };
}
