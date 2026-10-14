import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClassifierOutput, DepartmentLeadOutput } from "../schemas";
import { MockModelClient } from "./index";

const RelevanceSchema = z.object({ relevant: z.array(z.object({ block_id: z.string(), relevance: z.number(), reason: z.string() })), severity: z.enum(["low", "normal", "critical"]), summary: z.string(), topics: z.array(z.string()), pricing: z.string().nullable(), strengths: z.array(z.string()), weaknesses: z.array(z.string()) });
const ProposalSchema = z.object({ title: z.string(), rationale_md: z.string(), hunks: z.array(z.object({ block_id: z.string(), proposed_text: z.string(), evidence: z.array(z.string()) })), impact: z.object({ dates: z.string().nullable(), tasks: z.array(z.string()), cost_text: z.string().nullable() }), notify: z.array(z.string()) });

const json = (v: unknown) => "```json\n" + JSON.stringify(v) + "\n```";
const SOURCE = { source_content: { id: "s1", title: "Pricing page", text: "Starter is $29 per month. Growth is $79 per month with approval workflows. A data breach last year exposed invoices." } };
const BLOCKS = [
  { id: "b-pricing", section: "Pricing", excerpt: "Starter at $39 per month. Growth at $89 per month." },
  { id: "b-team", section: "Team", excerpt: "Two founders and a contractor." },
];

describe("mock Source Watcher routes", () => {
  it("the classifier scores candidate blocks by overlap when asked for relevance, and stays a label picker otherwise", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ route: "classifier", messages: [{ role: "user", content: `${json({ source: { id: "s1", kind: "competitor" }, candidate_blocks: BLOCKS })}\n${JSON.stringify(SOURCE)}` }], schema: RelevanceSchema });
    expect(r.repaired).toBe(false);
    expect(r.json.relevant.map((x) => x.block_id)).toEqual(["b-pricing"]);
    expect(r.json.relevant[0]!.relevance).toBeGreaterThanOrEqual(0.6);
    expect(r.json.severity).toBe("critical"); // "breach"
    expect(r.json.pricing).toMatch(/\$29/);
    const labels = await client.complete({ route: "classifier", messages: [{ role: "user", content: json({ text: "refund for order 12", labels: ["refund", "question"] }) }], schema: ClassifierOutput });
    expect(labels.json.label).toBe("refund");
  });

  it("the department lead drafts a change that keeps the block and adds what the source says", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ route: "departmentLead", messages: [{ role: "user", content: `${json({ blocks: [{ id: "b-pricing", section: "Pricing", text: "Starter at $39 per month." }] })}\n${JSON.stringify(SOURCE)}` }], schema: ProposalSchema });
    expect(r.repaired).toBe(false);
    expect(r.json.hunks).toHaveLength(1);
    expect(r.json.hunks[0]!.proposed_text.startsWith("Starter at $39 per month.")).toBe(true);
    expect(r.json.hunks[0]!.proposed_text).toMatch(/From the source: /);
    expect(r.json.hunks[0]!.evidence).toEqual(["s1"]);
    const plan = await client.complete({ route: "departmentLead", messages: [{ role: "user", content: json({ department: { id: "d", name: "Engineering" }, tasks: [] }) }], schema: DepartmentLeadOutput });
    expect(plan.json.department_id).toBe("d");
  });
});
