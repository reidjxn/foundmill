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

  it("prices in the business's own currency (a dollar business never reads '€49')", async () => {
    const draft = async (currency?: string) =>
      (
        await client.complete({
          route: "foundations",
          schema: FoundationsOutput,
          messages: promptWith({ business: { name: "Ledgerly", archetype: "b2b_saas", ...(currency ? { currency } : {}) }, door: "ideation", outline: [{ section: "Pricing", pinned: false }], idea: { title: "Ledgerly", pitch: "Ledgerly helps accountants close the month." } }),
        })
      ).json;
    const usd = await draft("USD");
    expect(JSON.stringify(usd.sections.find((s) => s.section === "Pricing"))).toContain("$49 per team per month (Estimate)");
    expect(usd.roadmap.find((i) => i.title === "Pricing experiment")?.description).toContain("Test $49 per team per month (Estimate)");
    expect(JSON.stringify(usd)).not.toContain("€");
    expect(JSON.stringify((await draft("GBP")).sections)).toContain("£49 per team per month");
    expect(JSON.stringify((await draft()).sections)).toContain("$49 per team per month");
  });

  it("writes prices in the business's own currency, never euros (audit CML-14)", async () => {
    const draft = async (currency: string | undefined, archetype: string) =>
      client.complete({
        route: "foundations",
        schema: FoundationsOutput,
        messages: promptWith({ business: { name: "Pricewise", archetype, ...(currency ? { currency } : {}) }, door: "ideation", outline: OUTLINE.map((section) => ({ section, pinned: false })), idea: { title: "Pricewise", pitch: "Pricewise helps teams plan." } }),
      });
    const text = (r: Awaited<ReturnType<typeof draft>>) => JSON.stringify([r.json.sections.find((s) => s.section === "Pricing"), r.json.roadmap.find((i) => i.title === "Pricing experiment")]);
    const gbp = text(await draft("GBP", "b2b_saas"));
    expect(gbp).toContain("£49 per team per month");
    expect(gbp).not.toContain("€");
    expect(text(await draft("USD", "b2b_saas"))).toContain("$49 per team per month");
    expect(text(await draft("USD", "services"))).toContain("a fixed $1,200 monthly retainer");
    expect(text(await draft("JPY", "consumer_app"))).toContain("¥6 per month or ¥48 a year");
    // No currency (or a malformed one) reads as US dollars: never euros.
    expect(text(await draft(undefined, "hardware"))).toContain("$249 per unit plus $9 per month");
    expect(text(await draft("1$X", "b2b_saas"))).toContain("$49 per team per month");
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

  it("a staged section call writes only the sections it names in write_sections (audit P3)", async () => {
    const SectionsOnly = FoundationsOutput.pick({ sections: true });
    const content = [
      "Write these sections.",
      "```json\n" + JSON.stringify({ business: { name: "Stallwise", archetype: "marketplace" }, door: "ideation", outline: OUTLINE.map((section) => ({ section, pinned: false })) }) + "\n```",
      "```json\n" + JSON.stringify({ write_sections: ["Pricing", "Risks"] }) + "\n```",
    ].join("\n\n");
    const r = await client.complete({ route: "foundations", schema: SectionsOnly, messages: [{ role: "user", content }] });
    expect(r.repaired).toBe(false);
    expect(r.json.sections.map((s) => s.section)).toEqual(["Pricing", "Risks"]);
    expect(JSON.stringify(r.json.sections[0])).toMatch(/\(Estimate\)/);
  });

  it("is deterministic and copes with a prose-only prompt", async () => {
    const req = { route: "foundations" as const, schema: FoundationsOutput, messages: promptWith({ business: { name: "Ledgerly" }, outline: ["Problem"] }) };
    expect((await client.complete(req)).text).toBe((await client.complete(req)).text);
    const prose = await client.complete({ route: "foundations", schema: FoundationsOutput, messages: [{ role: "user", content: "Draft the foundations of a bookkeeping business." }] });
    expect(FoundationsOutput.safeParse(prose.json).success).toBe(true);
    expect(prose.json.sections.length).toBeGreaterThanOrEqual(5);
  });
});

describe("foundations mock keeps the founder's words (first-time founder report, Nov 8, 2026)", () => {
  const WORDS = "Students at my university struggle to find short-notice part-time shifts, and local cafes and bars near campus struggle to fill last-minute gaps. A simple app that matches verified students to same-day shifts at independent venues around Manchester.";
  const draft = (idea: Record<string, unknown>, ideaText: Record<string, unknown>) =>
    client.complete({
      route: "foundations",
      schema: FoundationsOutput,
      messages: [...promptWith({ business: { name: "ShiftMate", archetype: "marketplace", currency: "GBP" }, door: "ideation", outline: OUTLINE.map((section) => ({ section, pinned: false })), idea, founder: { target_markets: ["UK"] } }), { role: "user", content: `<untrusted_content kind="idea">\n${JSON.stringify({ idea_text: ideaText })}\n</untrusted_content>` }],
    });

  it("builds the vision, Problem, Customers and Value proposition from founder_words, never from a template audience", async () => {
    const r = await draft({ archetype: "marketplace", founder_words: WORDS }, { title: "ShiftMate", pitch: WORDS });
    expect(r.repaired).toBe(false);
    expect(r.json.vision.statement).toMatch(/^ShiftMate exists so that students at my university can find short-notice part-time shifts\./);
    expect(r.json.vision.for_whom).toMatch(/Students at my university in UK/);
    const text = (section: string) => JSON.stringify(r.json.sections.find((s) => s.section === section));
    expect(text("Problem")).toMatch(/In the founder's words:/);
    expect(text("Problem")).toMatch(/same-day shifts at independent venues around Manchester/);
    expect(text("Customers")).toMatch(/students at my university/);
    expect(text("Value proposition")).toMatch(/ShiftMate helps students at my university find short-notice part-time shifts/);
    expect(JSON.stringify(r.json)).not.toMatch(/boutique fitness|renters in big cities|independent providers/);
    expect(r.json.open_questions[0]).toMatch(/students at my university/);
  });

  it("uses the business's name where the card still carries its studio working name", async () => {
    const r = await draft({ archetype: "marketplace" }, { title: "Shiftnest", pitch: "Shiftnest helps boutique fitness instructors turn a recurring panic into a routine through a done-for-you service with a transparent fixed fee." });
    expect(JSON.stringify(r.json)).not.toMatch(/Shiftnest/);
    expect(JSON.stringify(r.json.sections.find((s) => s.section === "Problem"))).toMatch(/ShiftMate helps boutique fitness instructors/);
  });
});
