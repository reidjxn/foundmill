import { describe, expect, it } from "vitest";
import { CHECK } from "../skills/blueprints/_types";
import { allChecksPassed, countWords, runDeterministicCheck, runDeterministicChecks } from "../skills/checks";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("deterministic checks (BUILD §11.10, §12.5)", () => {
  it("word_count counts words within bounds", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one two\nthree ")).toBe(3);
    expect(runDeterministicCheck(CHECK.words(2, 3), { output: "one two three" }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.words(4, 9), { output: "one two three" }).passed).toBe(false);
  });

  it("contains_all / contains_none are case-insensitive", () => {
    expect(runDeterministicCheck(CHECK.all("Estimate", "runway"), { output: "Runway: 9 months (estimate)" }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.all("Estimate", "runway"), { output: "Runway: 9 months" })).toMatchObject({ passed: false, detail: "missing: Estimate" });
    expect(runDeterministicCheck(CHECK.none("sales@"), { output: "Emailed SALES@acme.com" })).toMatchObject({ passed: false });
    expect(runDeterministicCheck(CHECK.none("sales@"), { output: "Flagged the embedded address" }).passed).toBe(true);
  });

  it("json_schema_valid passes when the model layer validated the output, or when plain JSON parses without a schemaRef", () => {
    expect(runDeterministicCheck(CHECK.json("Composer"), { output: "{}", json: { ok: true } }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.json("Composer"), { output: "{}" }).passed).toBe(false);
    expect(runDeterministicCheck({ kind: "json_schema_valid", params: {} }, { output: '{"a":1}' }).passed).toBe(true);
    expect(runDeterministicCheck({ kind: "json_schema_valid", params: {} }, { output: "not json" }).passed).toBe(false);
  });

  it("tests_pass, policy_respected and no_tool_calls read the sandbox record", () => {
    expect(runDeterministicCheck(CHECK.testsPass(), { output: "", testsPassed: true }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.testsPass(), { output: "" })).toMatchObject({ passed: false, detail: "no test run recorded" });
    expect(runDeterministicCheck(CHECK.policy(), { output: "" }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.policy(), { output: "", policyViolations: ["deny: payouts.create"] }).passed).toBe(false);
    expect(runDeterministicCheck(CHECK.noTools(), { output: "", toolCalls: [] }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.noTools(), { output: "", toolCalls: ["web.fetch"] }).passed).toBe(false);
  });

  it("entity_links_valid accepts manifest ids only and rejects malformed markup", () => {
    const ok = `[[ent:${ID_A}|Meridian Labs]] confirmed.`;
    expect(runDeterministicCheck(CHECK.links(), { output: ok, manifestIds: [ID_A] }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.links(), { output: `[[ent:${ID_B}|Nobody]]`, manifestIds: new Set([ID_A]) })).toMatchObject({ passed: false });
    expect(runDeterministicCheck(CHECK.links(), { output: "[[ent:broken" }).passed).toBe(false);
    expect(runDeterministicCheck(CHECK.links(), { output: "no links at all" }).passed).toBe(true);
  });

  it("cites_source_ids needs a provided id when given, else any record-id shape", () => {
    expect(runDeterministicCheck(CHECK.cites(), { output: "Attribution att_77 shows 14 leads." }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.cites(), { output: "Fourteen leads this week." }).passed).toBe(false);
    expect(runDeterministicCheck(CHECK.cites(), { output: "see inc_9", sourceIds: ["att_77", "inc_9"] }).passed).toBe(true);
    expect(runDeterministicCheck(CHECK.cites(), { output: "see qte_1", sourceIds: ["att_77"] }).passed).toBe(false);
  });

  it("runDeterministicChecks keeps order and allChecksPassed is authoritative", () => {
    const results = runDeterministicChecks([CHECK.words(1, 5), CHECK.all("x")], { output: "y" });
    expect(results.map((r) => r.kind)).toEqual(["word_count", "contains_all"]);
    expect(allChecksPassed(results)).toBe(false);
    expect(allChecksPassed([])).toBe(true);
  });
});
