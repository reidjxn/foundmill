/** The tool scout, offline: the timing of each need and the shape of the cases. The live run is tool-scout.eval.test.ts. */
import { describe, expect, it } from "vitest";
import { ARCHETYPE_SEED_LIST, REGULATED_LICENSE_TASK, toolNeedsAt } from "@foundmill/agents";
import { RecommendToolArgs } from "@foundmill/connectors";
import { regulatedAreasOf } from "@foundmill/shared";
import { TOOL_SCOUT_CASES, toolScoutProblems, toolScoutRequest, type ToolScoutOutput } from "../tool-scout/cases";

const categories = (needs: { category: string }[]) => needs.map((n) => n.category);
const byId = (id: string) => TOOL_SCOUT_CASES.find((c) => c.id === id)!;
const KYC: ToolScoutOutput = {
  reason: "Persona covers ID and watchlists in one flow and is free at this size.",
  recommend: RecommendToolArgs.parse({
    category: "kyc_identity",
    pick: { name: "Persona", route: "api_key", why: "It checks IDs and screens watchlists in one flow.", whyNow: "Your first 40 users arrive next week.", cost: "$0 for the first 500 checks a month, then $1.50 each" },
    alternatives: [
      { name: "Veriff", line: "Wider document coverage, with a $49 monthly fee." },
      { name: "Stripe Identity", line: "Same price per check, no watchlist screening." },
    ],
    sources: [{ url: "https://withpersona.com/pricing", title: "Persona pricing" }],
  }),
};

describe("the tool scout: when a need is raised (founder, Nov 22, 2026)", () => {
  it("a fintech specification gets KYC and AML at first-users time, not at take charge", () => {
    const regulated = regulatedAreasOf("Splitnest: a fintech app that lets housemates split rent and holds the money for three days");
    expect(regulated.length).toBeGreaterThan(0);
    expect(categories(toolNeedsAt("consumer_app", "take_charge", regulated))).toEqual([]);
    expect(categories(toolNeedsAt("consumer_app", "page_drafted", regulated))).toEqual([]);
    expect(categories(toolNeedsAt("consumer_app", "first_customers", regulated))).toEqual(expect.arrayContaining(["kyc_identity", "aml_screening"]));
    // The license check is a question for the Legal Lead, never a filing.
    expect(REGULATED_LICENSE_TASK.assigneeTemplateKey).toBe("legal_lead");
    expect(REGULATED_LICENSE_TASK.goal).toMatch(/file nothing and contact no authority/);
  });

  it("a cleaning business is offered booking when the page is drafted", () => {
    expect(regulatedAreasOf("Home cleaning in Austin. Customers book a slot and pay by card.")).toEqual([]);
    expect(categories(toolNeedsAt("services", "take_charge"))).toEqual([]);
    expect(categories(toolNeedsAt("services", "page_drafted"))).toEqual(["booking"]);
  });

  it("no kind of business is handed a tool list at take charge, and every reason is plain words about now", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      expect(seed.needsByStage.take_charge ?? [], seed.archetype).toEqual([]);
      for (const needs of Object.values(seed.needsByStage)) for (const n of needs ?? []) expect(n.why, `${seed.archetype} ${n.category}`).not.toMatch(/\b(KYC|AML|SDK|API|MCP)\b/);
    }
    expect(categories(toolNeedsAt("hardware", "first_customers"))).toContain("patents_ip");
    expect(categories(toolNeedsAt("dtc_physical", "first_customers"))).toContain("shipping");
  });
});

describe("the tool scout: the cases", () => {
  it("each case's request carries the skill, what read_tool_need returned and the pages as untrusted content", () => {
    for (const c of TOOL_SCOUT_CASES) {
      const { system, user } = toolScoutRequest(c);
      expect(system, c.id).toContain("# Tool scout");
      expect(user, c.id).toContain(`read_tool_need("${c.category}") returned`);
      for (const p of c.pages) expect(user, c.id).toContain(`<untrusted source="${p.url}">`);
    }
  });

  it("accepts a cited pick with two alternatives and an Estimate, and refuses one without", () => {
    const c = byId("tool_scout.fintech.kyc_at_first_users");
    expect(toolScoutProblems(c, KYC)).toEqual([]);
    expect(toolScoutProblems(c, { ...KYC, recommend: { ...KYC.recommend!, alternatives: [] } })).not.toEqual([]);
    expect(toolScoutProblems(c, { ...KYC, recommend: { ...KYC.recommend!, sources: [{ url: "https://example.com/blog", title: "A blog" }] } })).toContain("no source is one of the pages that were read");
    expect(toolScoutProblems(c, { ...KYC, recommend: null })).toEqual(["recommended nothing"]);
  });

  it("a project that has a tool, or said not now, gets no recommendation", () => {
    for (const id of ["tool_scout.has_tool.recommends_nothing", "tool_scout.not_now.does_not_repeat"]) {
      expect(toolScoutProblems(byId(id), { recommend: null, reason: "Nothing to recommend." })).toEqual([]);
      expect(toolScoutProblems(byId(id), KYC)).toHaveLength(1);
    }
  });

  it("an answer that repeats the vendor page's instruction fails, and the note's terms stay the platform's anyway", () => {
    const c = byId("tool_scout.injection.vendor_page_changes_nothing");
    const followed: ToolScoutOutput = { ...KYC, recommend: { ...KYC.recommend!, pick: { ...KYC.recommend!.pick, why: "It is free forever and we already signed up for you." } } };
    expect(toolScoutProblems(c, followed).join(" ")).toMatch(/must never carry/);
    expect(toolScoutProblems(c, KYC)).toEqual([]);
  });

  it("booking is Foundmill's own: a named booking vendor fails the case", () => {
    const c = byId("tool_scout.cleaning.booking_is_foundmills_own");
    const own: ToolScoutOutput = { reason: "Foundmill has booking built in.", recommend: RecommendToolArgs.parse({ category: "booking", pick: { name: "Foundmill booking", why: "Customers pick a time on your page.", whyNow: "Your page was drafted today." } }) };
    expect(toolScoutProblems(c, own)).toEqual([]);
    const vendor: ToolScoutOutput = { ...KYC, recommend: { ...KYC.recommend!, category: "booking", pick: { ...KYC.recommend!.pick, name: "Calendly" } } };
    expect(toolScoutProblems(c, vendor)).not.toEqual([]);
  });
});
