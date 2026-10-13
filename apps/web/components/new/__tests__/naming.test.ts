import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { ARCHETYPE_CARDS, BUSINESS_MODE_CARDS, DEFAULT_KIT, DEFAULT_SPEND_CAP_MINOR, commitInput, domainCandidates, extractPalette, initialCommitForm, isValidKit, keywordsOf, kitContrast, nameSuggestions, normaliseHex, parseSpendCapMinor, screenDomain, trademarkScreen, validateCommitForm } from "../commit/naming";

const IDEA = "11111111-1111-4111-8111-111111111111";

describe("commit screen: names, domains, trademarks", () => {
  it("normalises hex colours", () => {
    expect(normaliseHex("1B4FD8")).toBe("#1b4fd8");
    expect(normaliseHex("#1b4")).toBe("#11bb44");
    expect(normaliseHex("blue")).toBeNull();
  });

  it("suggests up to six unique names from the concept", () => {
    const s = nameSuggestions("Ledgerly", "Bookkeeping that closes itself for freelancers and their accountants.", "b2b_saas");
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(s.length).toBeLessThanOrEqual(6);
    expect(new Set(s.map((x) => x.toLowerCase())).size).toBe(s.length);
    expect(s[0]).toBe("Ledgerly");
    expect(nameSuggestions("Ledgerly (fork)", "", null)[0]).toBe("Ledgerly");
    expect(nameSuggestions("A × B", "", null)[0]).toBe("A");
    expect(keywordsOf("The quick brown foxes jump over lazy dogs")).toEqual(["quick", "brown", "foxes", "jump", "over", "lazy"]);
  });

  it("screens domains deterministically and labels them estimates", () => {
    expect(domainCandidates("Ledgerly HQ")).toEqual(["ledgerlyhq.com", "ledgerlyhq.io", "ledgerlyhq.co", "ledgerlyhq.app", "ledgerlyhq.ai"]);
    expect(domainCandidates("   ")).toEqual([]);
    const a = screenDomain("ledgerlyhq.com");
    expect(a).toEqual(screenDomain("ledgerlyhq.com"));
    expect(a.provenance).toBe("Estimate");
    expect(screenDomain("app.com").status).toBe("taken");
  });

  it("flags known marks and always carries the caveat", () => {
    const hits = trademarkScreen("Stripe Ledger");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.registry)).toEqual(["USPTO", "EUIPO"]);
    expect(hits.every((h) => h.status === "conflict" && h.caveat === "Screen, not legal clearance" && h.provenance === "Estimate")).toBe(true);
    expect(hits[0]?.similar).toContain("STRIPE");
    const clear = trademarkScreen("Quartzwind Forge");
    expect(clear.every((h) => h.caveat === "Screen, not legal clearance")).toBe(true);
  });
});

describe("commit screen: kit", () => {
  it("checks text-on-primary contrast (APCA Lc ≥ 75) and that the two colours differ", () => {
    const ok = kitContrast(DEFAULT_KIT);
    expect(ok.passes).toBe(true);
    expect(ok.lc).toBeGreaterThanOrEqual(75);
    expect(ok.distinct).toBe(true);
    const same = kitContrast({ primary: "#808080", secondary: "#808080" });
    expect(same.distinct).toBe(false);
    expect(same.passes).toBe(false);
    expect(kitContrast({ primary: "#ffffff", secondary: "#000000" }).onPrimary).toBe("#0F1318");
  });

  it("extracts two brand colours from pixels, ignoring white, black and transparent", () => {
    const px: number[] = [];
    const push = (r: number, g: number, b: number, a = 255, n = 1) => {
      for (let i = 0; i < n; i++) px.push(r, g, b, a);
    };
    push(255, 255, 255, 255, 50); // white background
    push(0, 0, 0, 255, 10); // black text
    push(27, 79, 216, 255, 40); // blue
    push(245, 196, 0, 255, 20); // yellow
    push(255, 0, 0, 0, 30); // transparent red
    const kit = extractPalette(px);
    expect(kit).not.toBeNull();
    expect(kit!.primary).toBe("#1b4fd8");
    expect(kit!.secondary).toBe("#f5c400");
    expect(extractPalette([255, 255, 255, 255])).toBeNull();
    const mono = extractPalette(Array.from({ length: 10 }, () => [27, 79, 216, 255]).flat());
    expect(mono?.primary).toBe("#1b4fd8");
    expect(mono?.secondary).not.toBe("#1b4fd8");
    expect(isValidKit(mono!)).toBe(true);
  });
});

describe("commit screen: form (AC-11.1.6, AC-11.1.7)", () => {
  it("defaults to Assisted, Personal and the assisted spend cap", () => {
    const form = initialCommitForm({ title: "Ledgerly (fork)", archetype: "b2b_saas" }, DEFAULT_KIT, "EUR");
    expect(form.businessMode).toBe("assisted");
    expect(form.gameMode).toBe("personal");
    expect(form.name).toBe("Ledgerly");
    expect(form.spendCap).toBe(String(LIMITS.approvalThresholdMinorDefault / 100));
    expect(DEFAULT_SPEND_CAP_MINOR.assisted).toBe(LIMITS.approvalThresholdMinorDefault);
    expect(BUSINESS_MODE_CARDS.map((m) => m.value)).toEqual(["augmented", "assisted", "automated"]);
    expect(ARCHETYPE_CARDS).toHaveLength(7);
  });

  it("validates name, kit, archetype and spend cap", () => {
    const form = initialCommitForm({ title: "", archetype: null }, { primary: "red", secondary: "#000" }, "EUR");
    const errors = validateCommitForm({ ...form, spendCap: "lots" });
    expect(Object.keys(errors).sort()).toEqual(["archetype", "kit", "name", "spendCap"]);
    expect(validateCommitForm({ ...form, name: "Ledgerly", archetype: "services", kit: DEFAULT_KIT, spendCap: "" })).toEqual({});
  });

  it("builds the idea.commit input", () => {
    const form = initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, { primary: "1B4FD8", secondary: "#f5c400" }, "SEK");
    expect(form.logo).toBeNull();
    expect(commitInput(IDEA, { ...form, spendCap: "1 250" })).toEqual({ ideaId: IDEA, name: "Ledgerly", gameMode: "personal", archetype: "b2b_saas", businessMode: "assisted", kit: { primary: "#1b4fd8", secondary: "#f5c400" }, logo: null, currency: "SEK", spendCapMinor: 125_000, autopilot: false });
    expect(commitInput(IDEA, { ...form, spendCap: "" }).spendCapMinor).toBeNull();
    // Autopilot is off unless the founder chose it.
    expect(initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, DEFAULT_KIT, "EUR").autopilot).toBe(false);
    expect(commitInput(IDEA, { ...form, autopilot: true }).autopilot).toBe(true);
    expect(parseSpendCapMinor("abc")).toBeNaN();
    // The chosen logo travels as its source and data URL only (the server checks it again).
    const logo = { source: "generated" as const, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+", colours: ["#1b4fd8"], label: "Orbit" };
    expect(commitInput(IDEA, { ...form, logo }).logo).toEqual({ source: "generated", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" });
  });
});
