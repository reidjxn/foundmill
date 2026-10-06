/**
 * The policy engine: the Cedar schema + the loaded policy set, validated once (strict mode) at first use.
 * Exposes a single `authorize` call that returns Cedar's raw answer; outcome derivation lives in evaluate.ts.
 */
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import type { AuthorizationAnswer, Context, Entities, EntityUid } from "@cedar-policy/cedar-wasm/nodejs";
import { CEDAR_SCHEMA } from "./schema";
import { loadPolicySet, PolicyLoadError, type LoadedPolicySet } from "./policies/index";

export interface PolicyEngine {
  policySet: LoadedPolicySet;
  authorize(request: { principal: EntityUid; action: EntityUid; resource: EntityUid; context: Context; entities: Entities }): AuthorizationAnswer;
}

/** Build an engine from the schema and a policy set, validating the policies against the schema (strict). */
export function createPolicyEngine(policySet: LoadedPolicySet = loadPolicySet()): PolicyEngine {
  const schemaCheck = cedar.checkParseSchema(CEDAR_SCHEMA);
  if (schemaCheck.type === "failure") {
    throw new PolicyLoadError(`Cedar schema does not parse: ${schemaCheck.errors.map((e) => e.message).join("; ")}`, schemaCheck.errors);
  }
  const validation = cedar.validate({
    schema: CEDAR_SCHEMA,
    policies: { staticPolicies: policySet.staticPolicies },
    validationSettings: { mode: "strict" },
  });
  if (validation.type === "failure") {
    throw new PolicyLoadError(`policy set failed to validate: ${validation.errors.map((e) => e.message).join("; ")}`, validation.errors);
  }
  if (validation.validationErrors.length > 0) {
    const msgs = validation.validationErrors.map((e) => `${e.policyId}: ${e.error.message}`).join("; ");
    throw new PolicyLoadError(`policy set has validation errors: ${msgs}`, validation.validationErrors);
  }
  return {
    policySet,
    authorize(request) {
      return cedar.isAuthorized({
        ...request,
        schema: CEDAR_SCHEMA,
        validateRequest: true,
        policies: { staticPolicies: policySet.staticPolicies },
      });
    },
  };
}

let defaultEngine: PolicyEngine | undefined;

/** The process-wide engine over `src/policies/*.cedar`, created on first use. */
export function getPolicyEngine(): PolicyEngine {
  defaultEngine ??= createPolicyEngine();
  return defaultEngine;
}

export const cedarVersion = (): string => cedar.getCedarVersion();
