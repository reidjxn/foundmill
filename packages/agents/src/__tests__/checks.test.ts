import { describe, expect, it } from "vitest";
import { CHECK } from "../skills/blueprints/_types";
import { allChecksPassed, countWords, lengthRetryMessage, runDeterministicCheck, runDeterministicChecks, statedWordLimit } from "../skills/checks";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("deterministic checks (BUILD §11.10, §12.5)", () => {
  it("statedWordLimit reads the smallest length a task gives, and null when it gives none", () => {
    expect(statedWordLimit("Plain text, under 300 words.")).toBe(300);
    expect(statedWordLimit("Answer the founder in under 150 words: what you will do.")).toBe(150);
    // A limit on one part is not the reply's.
    expect(statedWordLimit("Write the pitch under 150 words that discloses who you are.")).toBeNull();
    expect(statedWordLimit("Ending with their answer as a quote under 25 words), and the rule.")).toBeNull();
    expect(statedWordLimit("A body of 80-140 words.")).toBeNull();
    expect(statedWordLimit("Under 300 words. The offer section at most 120 words.")).toBe(120);
    expect(statedWordLimit("Return JSON with the steps.")).toBeNull();
    expect(lengthRetryMessage(340, 300)).toMatch(/^Your reply has 340 words; the task allows at most 300\./);
  });

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

  it("contains checks with `in` read only the JSON values under that key", () => {
    const json = { departments: [{ tasks_to_start: [{ task_id: "tsk_1" }], deferred: [{ task_id: "tsk_4", reason: "blocked" }] }] };
    const output = JSON.stringify(json);
    expect(runDeterministicCheck({ kind: "contains_none", params: { terms: ["tsk_4"], in: "tasks_to_start" } }, { output, json }).passed).toBe(true);
    expect(runDeterministicCheck({ kind: "contains_none", params: { terms: ["tsk_1"], in: "tasks_to_start" } }, { output, json }).passed).toBe(false);
    expect(runDeterministicCheck({ kind: "contains_all", params: { terms: ["tsk_4"], in: "deferred" } }, { output, json }).passed).toBe(true);
    // Without parsed JSON the whole output is read, so the check never gets weaker.
    expect(runDeterministicCheck({ kind: "contains_none", params: { terms: ["tsk_4"], in: "tasks_to_start" } }, { output }).passed).toBe(false);
  });

  it("contains_all with `any` passes on one of the terms and fails on none", () => {
    const any = { kind: "contains_all" as const, params: { terms: ["approval", "decision"], any: true } };
    expect(runDeterministicCheck(any, { output: "Queued a founder decision." }).passed).toBe(true);
    expect(runDeterministicCheck(any, { output: "Merged it." })).toMatchObject({ passed: false, detail: "missing all of: approval, decision" });
  });

  it("contains_none with `claims` ignores a term that is denied, and still fails on a claim", () => {
    const none = { kind: "contains_none" as const, params: { terms: ["is published", "merged to main"], claims: true } };
    expect(runDeterministicCheck(none, { output: "Nothing is published yet. The branch is not merged to main." }).passed).toBe(true);
    expect(runDeterministicCheck(none, { output: "It isn't merged to main; the post is published." })).toMatchObject({ passed: false, detail: expect.stringMatching(/^forbidden: is published \(at "…It isn't merged to main; the post is published\.…"\)$/) });
    expect(runDeterministicCheck(none, { output: "Done: the branch was merged to main." }).passed).toBe(false);
    // Live run 45385411524: a denial with record ids between the negation and the phrase.
    expect(runDeterministicCheck(none, { output: "Nothing from pr_buf_4 (milestone mil_12) is published yet." }).passed).toBe(true);
    expect(runDeterministicCheck(none, { output: "No problem, the post is published." }).passed).toBe(false);
    // A denial whose list runs over commas; a claim after "No problem," is still a claim.
    const emailed = { kind: "contains_none" as const, params: { terms: ["emailed"], claims: true } };
    expect(runDeterministicCheck(emailed, { output: "Nothing was looked up, emailed or added to a sequence." }).passed).toBe(true);
    expect(runDeterministicCheck(emailed, { output: "No problem, the lead was emailed today." }).passed).toBe(false);
    // Live run 45422945799: naming the phrase to avoid, in quotes, is a mention; a quote that holds a claim is not.
    const soon = { kind: "contains_none" as const, params: { terms: ["coming soon"], claims: true } };
    expect(runDeterministicCheck(soon, { output: 'Write the question down for the founder, without a date, a price or "coming soon".' }).passed).toBe(true);
    expect(runDeterministicCheck(soon, { output: "Say: “SSO is coming soon.”" }).passed).toBe(false);
    // Live run 45408633306: a parenthetical with a comma between the negation and the phrase.
    const pub = { kind: "contains_none" as const, params: { terms: ["has been published"], claims: true } };
    expect(runDeterministicCheck(pub, { output: "Nothing from pr_buf_4 (milestone mil_12, the approval workflow launch) has been published yet." }).passed).toBe(true);
    expect(runDeterministicCheck(pub, { output: "Good news (milestone mil_12, not late) has been published." }).passed).toBe(false);
    expect(runDeterministicCheck(CHECK.none("is published"), { output: "Nothing is published yet." }).passed).toBe(false);
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
