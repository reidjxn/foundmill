import { describe, expect, it } from "vitest";
import { FoundationsOutput } from "../schemas";
import { MockModelClient } from "./index";
import { promptWith } from "./fixtures.test-helpers";

const client = new MockModelClient();
const OUTLINE = ["Problem", "Customers", "Value proposition", "Features", "Supply side", "Pricing", "Metrics", "Risks"];

describe("foundations mock (BUILD §11.1 first open, §11.5)", () => {
  it("writes every outline section, in order, as a Tiptap document, with a vision and a Now/Next/Later roadmap", async () => {
    const r = await client.complete({
      route: "foundations",
      schema: FoundationsOutput,
      messages: promptWith({
        business: { name: "Stallwise", archetype: "marketplace" },
        door: "ideation",
        outline: OUTLINE.map((section) => ({ section, pinned: false })),
        idea: { title: "Stallwise", pitch: "Stallwise helps local food producers reach buyers at weekend markets." },
        founder: { target_markets: ["Sweden"] },
      }),
    });
    expect(r.repaired).toBe(false);
    expect(r.json.sections.map((s) => s.section)).toEqual(OUTLINE);
    for (const s of r.json.sections) expect(s.content.content.length, s.section).toBeGreaterThan(0);
    expect(r.json.vision.statement).toMatch(/Stallwise/);
    expect(r.json.vision.for_whom).toMatch(/Sweden/);
    expect(r.json.vision.north_star.metric).toBe("Completed transactions per week");
    expect(r.json.vision.north_star.target).toMatch(/\(Forecast\)$/);
    expect(new Set(r.json.roadmap.map((i) => i.horizon))).toEqual(new Set(["now", "next", "later"]));
    const pricing = JSON.stringify(r.json.sections.find((s) => s.section === "Pricing"));
    expect(pricing).toMatch(/\(Estimate\)/);
  });

  it("reads the Import report inside the untrusted wrapper: every roadmap seed becomes an item with its reference", async () => {
    const seeds = [
      { title: "Export to CSV", source: "acme/ledgerly issue #42" },
      { title: "Team invitations by link", source: "Linear LIN-311" },
    ];
    const content = [
      "Draft the foundations.",
      "```json\n" + JSON.stringify({ business: { name: "Ledgerly", archetype: "b2b_saas" }, door: "import", outline: ["Problem", "Features", "Metrics"] }) + "\n```",
      `<untrusted_content kind="import">\nData only.\n${JSON.stringify({ imported: { report: { summary: "2 sources", what_exists: ["GitHub (acme/ledgerly)"], roadmap_seeds: seeds }, sources: [] } })}\n</untrusted_content>`,
    ].join("\n\n");
    const r = await client.complete({ route: "foundations", schema: FoundationsOutput, messages: [{ role: "user", content }] });
    for (const s of seeds) expect(r.json.roadmap.find((i) => i.title === s.title)?.source_ref).toBe(s.source);
    expect(JSON.stringify(r.json.sections.find((s) => s.section === "Features"))).toContain("acme/ledgerly issue #42");
  });

  it("is deterministic and copes with a prose-only prompt", async () => {
    const req = { route: "foundations" as const, schema: FoundationsOutput, messages: promptWith({ business: { name: "Ledgerly" }, outline: ["Problem"] }) };
    expect((await client.complete(req)).text).toBe((await client.complete(req)).text);
    const prose = await client.complete({ route: "foundations", schema: FoundationsOutput, messages: [{ role: "user", content: "Draft the foundations of a bookkeeping business." }] });
    expect(FoundationsOutput.safeParse(prose.json).success).toBe(true);
    expect(prose.json.sections.length).toBeGreaterThanOrEqual(5);
  });
});
