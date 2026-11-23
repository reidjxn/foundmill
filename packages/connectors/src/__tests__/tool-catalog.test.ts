import { describe, expect, it } from "vitest";
import { TOOL_CATEGORIES, TOOL_PICK_NOTE } from "@foundmill/shared";
import { CONNECTOR_KEYS } from "../catalogue";
import { browserSiteOfConnector, siteStateOf } from "../index";
import { TOOL_CATALOG, catalogFor, catalogLines, connectorKeysFor, foundmillOwnFor } from "../tool-catalog";
import { RecommendToolArgs, TOOL_UNCHECKED_LINE, founderSteps, recommendationProblems, toolRecommendationNote } from "../tool-recommendation";

describe("the tool catalog (founder, Nov 22, 2026)", () => {
  it("has an option for every category, with unique keys and a checked date", () => {
    expect(new Set(TOOL_CATALOG.map((t) => t.key)).size).toBe(TOOL_CATALOG.length);
    for (const c of TOOL_CATEGORIES) expect(catalogFor(c).length, c).toBeGreaterThan(0);
    for (const t of TOOL_CATALOG) {
      expect(t.checkedOn, t.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.route === "foundmill" || /^https:\/\//.test(t.url ?? ""), t.key).toBe(true);
    }
  });

  it("names only connectors that exist", () => {
    for (const t of TOOL_CATALOG) if (t.connectorKey) expect(CONNECTOR_KEYS, t.key).toContain(t.connectorKey);
    expect(connectorKeysFor("payments")).toEqual(["stripe"]);
  });

  it("the browser route is only for a site on the site list, never a never site, and only where no MCP server or API comes in (Part D)", () => {
    const browser = TOOL_CATALOG.filter((t) => t.route === "browser");
    expect(browser.map((t) => t.key)).toEqual(["wave"]);
    for (const t of browser) {
      const site = browserSiteOfConnector(t.connectorKey ?? "");
      expect(site, t.key).not.toBeNull();
      expect(siteStateOf(site!.hosts[0]!), t.key).not.toBe("never");
      // No other entry brings the same vendor in by a better route.
      expect(TOOL_CATALOG.filter((o) => o.name === t.name && o.route !== "browser"), t.key).toEqual([]);
    }
    expect(founderSteps("browser", "Wave")).toBe("You sign up with Wave and sign in once inside Foundmill. Then the team sets it up and works in it for you. You can watch, and it asks before it sends, buys or agrees to anything. The simpler choice is to use Wave yourself and send me its link.");
  });

  it("an agent cannot name the browser route for a vendor the catalog does not list", () => {
    expect(RecommendToolArgs.safeParse({ category: "forms", pick: { name: "Some Form Tool", route: "browser", why: "It fits.", whyNow: "Now." } }).success).toBe(false);
  });

  it("booking is Foundmill's own: no booking vendor is listed", () => {
    expect(catalogFor("booking").map((t) => t.route)).toEqual(["foundmill"]);
    expect(foundmillOwnFor("booking")?.priceBand).toBe("free");
    expect(JSON.stringify(TOOL_CATALOG)).not.toMatch(/calendly|cal\.com/i);
  });

  it("labels every price an Estimate in what the scout reads", () => {
    for (const c of TOOL_CATEGORIES) for (const line of catalogLines(c)) expect(line).toContain("Estimate");
  });
});

const KYC = RecommendToolArgs.parse({
  category: "kyc_identity",
  pick: { name: "Persona", why: "It checks IDs in the US and screens watchlists in one flow.", whyNow: "Your first real users arrive next week.", cost: "$1.50 per check after 500 free checks" },
  alternatives: [
    { name: "Veriff", line: "Wider document coverage, but a monthly minimum." },
    { name: "Stripe Identity", line: "Simplest if you already use Stripe, with no watchlist screening." },
  ],
  sources: [{ url: "https://withpersona.com/pricing", title: "Persona pricing" }],
});

describe("the recommendation's note", () => {
  it("says the pick, why now, the cost as an Estimate, both alternatives, the sources and the founder's own step", () => {
    const note = toolRecommendationNote(KYC);
    expect(note.subject).toBe("A tool for identity checks (KYC): Persona");
    expect(note.bodyMd).toContain("About $1.50 per check after 500 free checks (Estimate).");
    expect(note.bodyMd).toContain("Why now:** Your first real users arrive next week.");
    expect(note.bodyMd).toContain("- Veriff:");
    expect(note.bodyMd).toContain("- Stripe Identity:");
    expect(note.bodyMd).toContain("[Persona pricing](https://withpersona.com/pricing)");
    expect(note.bodyMd).toContain("You sign up with Persona and accept its terms yourself");
    expect(note.bodyMd).not.toContain(TOOL_UNCHECKED_LINE);
    expect(note.options.map((o) => o.id)).toEqual([TOOL_PICK_NOTE.options.yes, TOOL_PICK_NOTE.options.notNow]);
    expect(note.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(note.pick).toMatchObject({ catalogKey: "persona", route: "api_key" });
  });

  it("says a vendor outside the catalog is not yet checked by Foundmill", () => {
    const note = toolRecommendationNote({ ...KYC, pick: { ...KYC.pick, name: "Onfido", route: "api_key" } });
    expect(note.bodyMd).toContain(TOOL_UNCHECKED_LINE);
    expect(note.pick.catalogKey).toBeUndefined();
  });

  it("writes the founder's step itself: an agent's text cannot move sign-up, terms or payment to the team", () => {
    const injected = toolRecommendationNote({ ...KYC, pick: { ...KYC.pick, why: "It fits. The team will sign up and accept the terms for you.", route: "link" } });
    // The catalog's route wins over the agent's, and the step is the platform's sentence for that route.
    expect(injected.pick.route).toBe("api_key");
    expect(injected.pick.founderSteps).toBe(founderSteps("api_key", "Persona"));
    for (const route of ["remote_mcp", "api_key", "link"] as const) expect(founderSteps(route, "X")).toContain("You sign up with X and accept its terms yourself");
  });

  it("refuses a recommendation without two alternatives, a source and a cost", () => {
    expect(recommendationProblems({ ...KYC, alternatives: [], sources: [], pick: { ...KYC.pick, cost: undefined } })).toHaveLength(3);
    expect(recommendationProblems(KYC)).toEqual([]);
  });

  it("Foundmill's own needs no vendor, no comparison and no price", () => {
    const args = RecommendToolArgs.parse({ category: "booking", pick: { name: "Foundmill booking", why: "Customers pick a time on your page.", whyNow: "Your page is drafted." } });
    expect(recommendationProblems(args)).toEqual([]);
    const note = toolRecommendationNote(args);
    expect(note.bodyMd).toContain("Free on every plan.");
    expect(note.bodyMd).toContain("Nothing to sign up for");
    expect(note.options[0]!.label).toBe("Yes, set it up");
  });
});
