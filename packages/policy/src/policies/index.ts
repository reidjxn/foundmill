/**
 * Loads `src/policies/*.cedar` and splits them into individually identified policies.
 *
 * cedar-wasm 4.13 does not honour `@id` when a policy set is parsed from text (ids come back as policy0, policy1, ...),
 * so we split the text with `policySetTextToParts`, read each policy's annotations with `policyToJson`, and feed the
 * authorizer a `Record<id, policyText>` so that `diagnostics.reason` reports our ids.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { PolicyOutcome } from "@founder-manager/shared";

export interface PolicyMeta {
  /** From `@id`. Unique across the policy set. */
  id: string;
  effect: "permit" | "forbid";
  /** From `@outcome`; only `ask` is meaningful (permit policies that grant the call subject to founder approval). */
  outcome: PolicyOutcome;
  /** From `@reason`: the human-readable sentence the evaluator returns. */
  reason: string;
  /** Source file name, for diagnostics. */
  file: string;
  text: string;
}

export interface LoadedPolicySet {
  /** All policies in file order. */
  policies: PolicyMeta[];
  byId: Record<string, PolicyMeta>;
  /** What the authorizer receives: our ids mapped to policy text. */
  staticPolicies: Record<string, string>;
}

const POLICIES_DIR = fileURLToPath(new URL(".", import.meta.url));

export class PolicyLoadError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "PolicyLoadError";
  }
}

export function listPolicyFiles(dir: string = POLICIES_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".cedar"))
    .sort();
}

/** Parse one `.cedar` file's text into identified policies. Exported for tests. */
export function parsePolicyText(text: string, file: string): PolicyMeta[] {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type === "failure") {
    throw new PolicyLoadError(`${file}: cannot parse policy set: ${describe(parts.errors)}`, parts.errors);
  }
  if (parts.policy_templates.length > 0) {
    throw new PolicyLoadError(`${file}: templates are not supported in the tool-call policy set`);
  }
  return parts.policies.map((policyText) => {
    const json = cedar.policyToJson(policyText);
    if (json.type === "failure") {
      throw new PolicyLoadError(`${file}: cannot parse policy: ${describe(json.errors)}`, json.errors);
    }
    const annotations = json.json.annotations ?? {};
    const id = annotations["id"];
    if (!id) throw new PolicyLoadError(`${file}: every policy needs an @id annotation:\n${policyText}`);
    const outcomeRaw = annotations["outcome"];
    const outcome = outcomeRaw === undefined ? defaultOutcome(json.json.effect) : PolicyOutcome.safeParse(outcomeRaw);
    if (typeof outcome !== "string") {
      if (!outcome.success) throw new PolicyLoadError(`${file}: policy ${id} has an invalid @outcome("${outcomeRaw}")`);
    }
    const resolved = typeof outcome === "string" ? outcome : outcome.data;
    if (json.json.effect === "forbid" && resolved !== "deny") {
      throw new PolicyLoadError(`${file}: forbid policy ${id} cannot carry @outcome("${resolved}")`);
    }
    if (json.json.effect === "permit" && resolved === "deny") {
      throw new PolicyLoadError(`${file}: permit policy ${id} cannot carry @outcome("deny"); use forbid`);
    }
    const reason = annotations["reason"] ?? id;
    return { id, effect: json.json.effect, outcome: resolved, reason, file, text: policyText };
  });
}

function defaultOutcome(effect: "permit" | "forbid"): PolicyOutcome {
  return effect === "forbid" ? "deny" : "allow";
}

function describe(errors: { message: string }[]): string {
  return errors.map((e) => e.message).join("; ");
}

/** Read every `*.cedar` file in the policies directory (sorted by file name) and build the policy set. */
export function loadPolicySet(dir: string = POLICIES_DIR): LoadedPolicySet {
  const policies: PolicyMeta[] = [];
  for (const file of listPolicyFiles(dir)) {
    policies.push(...parsePolicyText(readFileSync(join(dir, file), "utf8"), file));
  }
  const byId: Record<string, PolicyMeta> = {};
  const staticPolicies: Record<string, string> = {};
  for (const p of policies) {
    if (byId[p.id]) throw new PolicyLoadError(`duplicate policy id "${p.id}" in ${byId[p.id]!.file} and ${p.file}`);
    byId[p.id] = p;
    staticPolicies[p.id] = p.text;
  }
  if (policies.length === 0) throw new PolicyLoadError(`no .cedar files found in ${dir}`);
  return { policies, byId, staticPolicies };
}
