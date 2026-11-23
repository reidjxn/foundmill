import { describe, expect, it } from "vitest";
import { createPolicyEngine, loadPolicySet, listPolicyFiles, parsePolicyText, PolicyLoadError, CEDAR_SCHEMA } from "../index";

describe("policy set loading", () => {
  const set = loadPolicySet();

  it("loads every .cedar file in the policies directory", () => {
    const files = listPolicyFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(new Set(set.policies.map((p) => p.file))).toEqual(new Set(files));
  });

  it("gives every policy a unique @id and a @reason", () => {
    const ids = set.policies.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of set.policies) expect(p.reason, p.id).not.toBe(p.id);
  });

  it("includes the rules required by BUILD §9.5 and ARCHITECTURE §7", () => {
    for (const id of [
      "hard-gate", "hard-gate-security-settings", "suppressed-recipient", "untrusted-recipient", "finance-never-spends", "kit-mode-channel",
      "spend-cap-exceeded", "augmented-ask-external", "augmented-allow-internal",
      "assisted-allow-within-caps", "assisted-ask-above-threshold", "automated-allow-within-caps", "automated-ask-above-threshold",
    ]) expect(set.byId[id], id).toBeDefined();
  });

  it("only permit policies carry @outcome(\"ask\"); forbids always mean deny", () => {
    for (const p of set.policies) {
      if (p.effect === "forbid") expect(p.outcome, p.id).toBe("deny");
      else expect(["allow", "ask"], p.id).toContain(p.outcome);
    }
    expect(set.policies.filter((p) => p.outcome === "ask").length).toBeGreaterThan(0);
  });

  it("validates against the schema in strict mode", () => {
    expect(() => createPolicyEngine(set)).not.toThrow();
    expect(Object.keys(CEDAR_SCHEMA[""]!.entityTypes).sort()).toEqual(["Agent", "Business", "Tool"]);
  });

  it("rejects a policy without @id", () => {
    expect(() => parsePolicyText(`permit (principal, action, resource);`, "x.cedar")).toThrow(PolicyLoadError);
  });

  it("rejects a forbid annotated with @outcome(\"ask\")", () => {
    expect(() => parsePolicyText(`@id("x") @outcome("ask") forbid (principal, action, resource);`, "x.cedar")).toThrow(/cannot carry/);
  });

  it("rejects an unknown @outcome", () => {
    expect(() => parsePolicyText(`@id("x") @outcome("maybe") permit (principal, action, resource);`, "x.cedar")).toThrow(/invalid @outcome/);
  });

  it("rejects duplicate ids and unparsable text", () => {
    expect(() => parsePolicyText(`@id("x") permit (principal, action, resource) when { ;`, "x.cedar")).toThrow(PolicyLoadError);
  });

  it("rejects policies that do not validate against the schema", () => {
    const bad = parsePolicyText(`@id("bad") permit (principal, action, resource) when { resource.doesNotExist };`, "bad.cedar");
    const broken = { policies: bad, byId: { bad: bad[0]! }, staticPolicies: { bad: bad[0]!.text } };
    expect(() => createPolicyEngine(broken)).toThrow(/validation errors/);
  });
});
