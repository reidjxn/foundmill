import { describe, expect, it } from "vitest";
import { CONTRACT_NEXT, DATA_FLOWS, calendarMonths, calendarRows, dataFlows, daysToNextDeadline, detectSectors, founderCanTakeOver, gateState, generatePolicies, midSentence, officerRows, readObligations, routeForJurisdiction, screenTrademark, stepRows } from "../legal-data";
import { NOW } from "./fake-source";
import { compliance, contractMsa, incorporationAbandoned, incorporationAwaiting, integrations, legalEntity, officers } from "./fixtures";

describe("routes and steps", () => {
  it("maps Delaware to Atlas, the UK to Companies House and everything else to the kit", () => {
    expect(routeForJurisdiction("Delaware")).toBe("stripe_atlas");
    expect(routeForJurisdiction("england-wales")).toBe("companies_house_web");
    expect(routeForJurisdiction("United Kingdom")).toBe("companies_house_web");
    expect(routeForJurisdiction("Sweden")).toBe("kit");
  });

  it("folds recorded steps and the status into step states; the founder's steps are marked", () => {
    const rows = stepRows(incorporationAwaiting);
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ["prepare_documents", "done"],
      ["founder_review", "done"],
      ["founder_submits", "current"],
      ["record_filing", "todo"],
      ["complete", "todo"],
    ]);
    expect(rows.filter((r) => r.owner === "founder").map((r) => r.key)).toEqual(["founder_review", "founder_submits"]);
    expect(stepRows(incorporationAbandoned).map((r) => r.state)).toEqual(["done", "abandoned", "abandoned", "abandoned", "abandoned"]);
    expect(stepRows(null).every((r) => r.state === "todo")).toBe(true);
    expect(founderCanTakeOver(incorporationAwaiting)).toBe(true);
    expect(founderCanTakeOver(incorporationAbandoned)).toBe(false);
    expect(founderCanTakeOver(null)).toBe(false);
  });
});

describe("officers", () => {
  it("joins entity officers with CRM people by normalised name and keeps unmatched ones", () => {
    const rows = officerRows(legalEntity, officers.items);
    expect(rows.map((r) => [r.name, r.entityId !== null])).toEqual([
      ["Mara Lindqvist", true],
      ["Tomas Berg", true],
      ["Priya Shah", false],
    ]);
    const extra = officerRows({ ...legalEntity, officers: [] }, officers.items);
    expect(extra.map((r) => r.name)).toEqual(["Mara Lindqvist", "Tomas Berg"]);
    expect(extra[0]?.role).toBe("director");
  });
});

describe("compliance calendar", () => {
  it("merges events and filings without duplicates, computes status against now and sorts by due date", () => {
    const rows = calendarRows(compliance, NOW);
    expect(rows.map((r) => [r.title, r.status])).toEqual([
      ["Incorporation via companies_house_web", "done"],
      ["Paye submission", "overdue"],
      ["Annual accounts", "due"],
      ["VAT return Q3", "upcoming"],
      ["Confirmation statement", "upcoming"],
    ]);
    expect(rows.filter((r) => r.id === compliance.events[0]!.id)).toHaveLength(1);
    expect(daysToNextDeadline(rows)).toBe(-6);
    const months = calendarMonths(rows, NOW, 12);
    expect(months[0]?.key).toBe("2026-10");
    expect(months[0]?.rows.map((r) => r.title)).toEqual(["Paye submission", "Annual accounts"]);
    expect(months[1]?.rows.map((r) => r.title)).toEqual(["VAT return Q3"]);
    expect(months[5]?.rows.map((r) => r.title)).toEqual(["Confirmation statement"]);
    expect(calendarRows(undefined, NOW)).toEqual([]);
  });
});

describe("obligations", () => {
  it("reads strings and objects, marks overdue against now and keeps the lifecycle without a signing shortcut", () => {
    const o = readObligations(contractMsa.obligations, NOW);
    expect(o.map((x) => [x.title, x.party, x.status])).toEqual([
      ["Deliver onboarding within 30 days", "us", "open"],
      ["Pay quarterly in advance", "them", "open"],
      ["Provide product samples", "us", "overdue"],
      ["Keep pricing confidential", "us", "open"],
    ]);
    expect(CONTRACT_NEXT.draft).not.toContain("signed");
    expect(CONTRACT_NEXT.awaiting_signature).toContain("signed");
  });
});

describe("policies", () => {
  it("builds data flows from active integrations only and names every processor in the privacy policy", () => {
    const flows = dataFlows(integrations.integrations, integrations.catalogue);
    expect(flows.map((f) => f.connectorKey)).toEqual(["github", "mystery_tool", "stripe", "sendgrid"]);
    expect(flows.find((f) => f.connectorKey === "mystery_tool")?.processor).toBe("Mystery Tool");
    const p = generatePolicies({ businessName: "Northwind Skincare", legalName: "Northwind Skincare Ltd", jurisdiction: "england-wales", entityType: "ltd", regNo: "12345678", address: "1 Market Street, Manchester", region: "eu", archetype: "dtc_physical", flows, today: "2026-10-07" });
    expect(p.privacy).toContain("**Stripe**");
    expect(p.privacy).toContain("**Twilio SendGrid**");
    expect(p.privacy).toContain("GDPR");
    expect(p.privacy).toContain("registration number 12345678");
    expect(p.terms).toContain("## Delivery and returns");
    expect(p.terms).toContain("processed by Stripe");
    expect(p.cookies).toContain("| __stripe_mid | Stripe |");
    expect(DATA_FLOWS.stripe?.cookies.length).toBe(2);
    const none = generatePolicies({ businessName: "Blank", legalName: null, jurisdiction: null, entityType: null, regNo: null, address: "", region: "us", archetype: null, flows: [], today: "2026-10-07" });
    expect(none.privacy).toContain("We do not share personal data with third-party processors.");
    expect(none.privacy).toContain("opt out of the sale");
  });

  it("keeps acronyms and names in processor purposes ('AI agents', 'DNS', 'the CRM', a connector's name)", () => {
    const flow = (connectorKey: string) => ({ connectorKey, ...DATA_FLOWS[connectorKey]! });
    const mystery = { connectorKey: "mystery_tool", processor: "Mystery Tool", purpose: "Connected service (Mystery Tool)", data: [], cookies: [] };
    const p = generatePolicies({ businessName: "Ledgerly", legalName: "Ledgerly AB", jurisdiction: "se", entityType: "ab", regNo: null, address: "", region: "eu", archetype: "b2b_saas", flows: [flow("anthropic"), flow("cloudflare_dns"), flow("gmail"), flow("sendgrid"), mystery], today: "2026-10-09" });
    expect(p.privacy).toContain("- **Anthropic**: AI agents that draft, research and classify");
    expect(p.privacy).toContain("- **Cloudflare**: DNS and edge delivery for the website");
    expect(p.privacy).toContain("- **Google (Gmail)**: email correspondence synced into the CRM");
    expect(p.privacy).toContain("- **Twilio SendGrid**: transactional and marketing email");
    expect(p.privacy).toContain("- **Mystery Tool**: connected service (Mystery Tool).");
    expect(p.privacy).not.toMatch(/\bai agents\b|\bdns\b|\bthe crm\b/);
    expect(midSentence("OpenCorporates lookups")).toBe("OpenCorporates lookups");
  });
});

describe("trademark screen", () => {
  it("places marks on the distinctiveness spectrum and flags clashes with listed marks", () => {
    expect(screenTrademark("Zyphlor", { archetype: "b2b_saas" }).distinctiveness).toBe("fanciful");
    expect(screenTrademark("Northwind", { archetype: "dtc_physical" }).distinctiveness).toBe("arbitrary");
    const descriptive = screenTrademark("Fresh Skincare", { archetype: "dtc_physical" });
    expect(descriptive.distinctiveness).toBe("descriptive");
    expect(descriptive.issues.some((i) => i.id === "descriptive")).toBe(true);
    const generic = screenTrademark("Skincare Shop", { archetype: "dtc_physical" });
    expect(generic.distinctiveness).toBe("descriptive");
    expect(screenTrademark("The App Store", { archetype: "consumer_app" }).distinctiveness).toBe("generic");
    const clash = screenTrademark("Northwind", { archetype: "dtc_physical", knownMarks: ["Northwind Skincare"] });
    expect(clash.issues.some((i) => i.id.startsWith("near-"))).toBe(true);
    expect(clash.classes.map((c) => c.number)).toEqual([3, 25, 35]);
    expect(clash.lookups.map((l) => l.office)).toEqual(["USPTO", "EUIPO", "UKIPO", "WIPO"]);
    expect(screenTrademark("  ", { archetype: null }).strength).toBe(0);
  });
});

describe("sector gates", () => {
  it("suggests sectors from the name, glossary and archetype and clears a gate only when every item is done", () => {
    const hits = detectSectors({ name: "Northwind Skincare", archetype: "dtc_physical", glossary: { customers: "patients" } });
    expect(hits.map((h) => h.key)).toEqual(["health", "food", "cosmetics"]);
    expect(hits.find((h) => h.key === "cosmetics")?.reasons.join(" ")).toContain('"skincare"');
    expect(hits.find((h) => h.key === "food")?.reasons.join(" ")).toContain("common for DTC physical product businesses");
    const selected = new Set(["cosmetics"] as const);
    expect(gateState("cosmetics", selected, new Set())).toBe("open");
    expect(gateState("health", selected, new Set())).toBe("not_applicable");
    expect(gateState("cosmetics", selected, new Set(["cosmetics:safety", "cosmetics:pif", "cosmetics:notification", "cosmetics:claims"]))).toBe("clear");
  });
});

describe("plain words for registry keys", () => {
  it("never shows an enum, a code or a raw archetype", async () => {
    const { archetypeLabel, entityTypeLabel, formatAddress, jurisdictionName } = await import("../legal-data");
    expect(entityTypeLabel("private_limited_company")).toBe("Private limited company");
    expect(entityTypeLabel("C-corp")).toBe("C-corp");
    expect(entityTypeLabel("Ltd")).toBe("Private limited company (Ltd)");
    expect(jurisdictionName("GB")).toBe("United Kingdom");
    expect(jurisdictionName("se")).toBe("Sweden");
    expect(jurisdictionName("us-de")).toBe("Delaware");
    expect(jurisdictionName("Delaware")).toBe("Delaware");
    expect(archetypeLabel("dtc_physical")).toBe("DTC physical product");
    expect(formatAddress({ line1: "14 Quill Street", city: "Manchester", postal_code: "M4 5JW", country: "GB" })).toBe("14 Quill Street, Manchester, M4 5JW, United Kingdom");
  });

  it("writes the privacy policy's controller line in words", () => {
    const text = generatePolicies({ businessName: "Northwind Skincare", legalName: "Northwind Skincare Ltd", jurisdiction: "GB", entityType: "private_limited_company", regNo: "15432198", address: "14 Quill Street, Manchester", region: "eu", archetype: "dtc_physical", flows: [], today: "2026-10-09" }).privacy;
    expect(text).toContain("Northwind Skincare Ltd, private limited company, registration number 15432198 (United Kingdom)");
    expect(text).not.toMatch(/private_limited_company|\(GB\)|dtc_physical/);
  });

  it("dates the policies in words, names the governing law's place and cites the UK GDPR for a UK company", () => {
    const uk = generatePolicies({ businessName: "Northwind Skincare", legalName: "Northwind Skincare Ltd", jurisdiction: "GB", entityType: "private_limited_company", regNo: "15432198", address: "", region: "eu", archetype: "dtc_physical", flows: [], today: "2026-10-09" });
    expect(uk.privacy).toContain("Last updated October 9, 2026");
    expect(uk.privacy).not.toContain("2026-10-09");
    expect(uk.privacy).toContain("UK General Data Protection Regulation (UK GDPR)");
    expect(uk.terms).toContain("The law of the United Kingdom applies");
    expect(uk.terms).not.toMatch(/law of GB\b/);
    const se = generatePolicies({ businessName: "Ledgerly", legalName: "Ledgerly AB", jurisdiction: "se", entityType: "ab", regNo: null, address: "", region: "eu", archetype: "b2b_saas", flows: [], today: "2026-10-09" });
    expect(se.privacy).toContain("the EU General Data Protection Regulation (GDPR)");
    expect(se.terms).toContain("The law of Sweden applies");
  });
});
