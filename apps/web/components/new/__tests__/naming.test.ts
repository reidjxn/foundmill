import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { ARCHETYPE_CARDS, BUSINESS_MODE_CARDS, DEFAULT_KIT, DEFAULT_SPEND_CAP_MINOR, DOMAIN_NOTE, DOMAIN_STATUS_WORDS, commitInput, couldNotCheck, KNOWN_MARKS, TRADEMARK_REGISTRY_WORDS, TRADEMARK_STATUS_WORDS, domainCandidates, domainProvenanceWord, extractPalette, initialCommitForm, isValidKit, keywordsOf, kitContrast, nameSuggestions, normaliseHex, parseSpendCapMinor, trademarkScreen, validateCommitForm } from "../commit/naming";

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
    expect(nameSuggestions("Ledgerly (variant)", "", null)[0]).toBe("Ledgerly");
    expect(nameSuggestions("A × B", "", null)[0]).toBe("A");
    expect(keywordsOf("The quick brown foxes jump over lazy dogs")).toEqual(["quick", "brown", "foxes", "jump", "over", "lazy"]);
  });

  it("makes domain candidates from the name and invents no status for a domain nobody answered (audit #458)", () => {
    expect(domainCandidates("Ledgerly HQ")).toEqual(["ledgerlyhq.com", "ledgerlyhq.io", "ledgerlyhq.co", "ledgerlyhq.app", "ledgerlyhq.ai"]);
    expect(domainCandidates("   ")).toEqual([]);
    // A name with no Latin letters or digits is not turned into "untitled.com".
    expect(domainCandidates("日本")).toEqual([]);
    const rows = couldNotCheck(["ledgerlyhq.com", "app.com"]);
    expect(rows.map((r) => r.status)).toEqual(["unknown", "unknown"]);
    expect(rows.every((r) => r.provenance === null && r.checkedAt === null && !r.estimate && r.reason)).toBe(true);
    expect(DOMAIN_STATUS_WORDS).toEqual({ available: "Available", taken: "Taken", unknown: "Couldn't check" });
    // Acronyms carry their word (A12); the mock stays "Mock".
    expect(domainProvenanceWord("Registry")).toBe("Domain registry");
    expect(domainProvenanceWord("DNS")).toBe("DNS lookup (Estimate)");
    expect(domainProvenanceWord("Mock")).toBe("Mock");
    expect(DOMAIN_NOTE).toBe("Availability is a snapshot; registering the domain happens at a registrar. We never buy domains for you.");
  });

  it("flags known marks and always carries the caveat", () => {
    const hits = trademarkScreen("Stripe Ledger");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.registry)).toEqual(["USPTO", "EUIPO"]);
    // Each acronym is expanded where it is first read (A12).
    expect(TRADEMARK_REGISTRY_WORDS.USPTO).toBe("USPTO, the US trademark office");
    expect(TRADEMARK_REGISTRY_WORDS.EUIPO).toBe("EUIPO, the EU trademark office");
    expect(hits.every((h) => h.status === "conflict" && h.caveat === "Screen, not legal clearance" && h.provenance === "Estimate")).toBe(true);
    expect(hits[0]?.similar).toContain("STRIPE");
    const clear = trademarkScreen("Quartzwind Forge");
    expect(clear.every((h) => h.caveat === "Screen, not legal clearance")).toBe(true);
  });

  it("invents nothing: the same name always gives the same answer, and every mark it names is on the known list (audit WEB-11)", () => {
    const names = ["Ledgerly", "Pelgrove for Bookkeepers", "Quartzwind Forge", "Mintwell", "Atlas Labs", "Waveform", "Stripey", "Nameify", "Sagebrush Square", "Oaklane", "Xify"];
    for (const name of names) {
      const first = trademarkScreen(name);
      expect(trademarkScreen(name)).toEqual(first);
      for (const hit of first) {
        expect(hit.provenance).toBe("Estimate");
        for (const mark of hit.similar) expect(KNOWN_MARKS, `${name}: ${mark}`).toContain(mark.toLowerCase());
        if (hit.status === "clear") expect(hit.similar).toEqual([]);
        else expect(hit.similar.length).toBeGreaterThan(0);
      }
    }
    // A name no known mark resembles is clear for every attempt, never "similar" by chance.
    for (let i = 0; i < 40; i++) expect(trademarkScreen(`Quartzwind${i} Forge`).every((h) => h.status === "clear")).toBe(true);
    expect(trademarkScreen("Atlas Labs")[0]).toMatchObject({ status: "conflict", similar: ["ATLAS"] });
    expect(trademarkScreen("Mintwell")[0]!.status).not.toBe("conflict");
  });

  it("words the result about the list it was checked against, never about a registry", () => {
    expect(Object.values(TRADEMARK_STATUS_WORDS).join(" ")).not.toMatch(/\bNo hit\b|Conflict\b|Similar marks/);
    expect(TRADEMARK_STATUS_WORDS.clear).toBe("No known conflict");
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
    // Every mode card carries one concrete example and says "your limits", never "caps" (§7.6).
    for (const m of BUSINESS_MODE_CARDS) {
      expect(m.example).toMatch(/^Example: /);
      expect([m.tagline, ...m.details, m.example].join(" ")).not.toMatch(/\bcaps?\b/);
    }
    expect(BUSINESS_MODE_CARDS[1]!.example).toBe("Example: drafts the pricing page and publishes it; asks before paying for a domain.");
    expect(ARCHETYPE_CARDS).toHaveLength(7);
  });

  it("validates name, kit, archetype and spend cap", () => {
    const form = initialCommitForm({ title: "", archetype: null }, { primary: "red", secondary: "#000" }, "EUR");
    const errors = validateCommitForm({ ...form, spendCap: "lots" });
    expect(Object.keys(errors).sort()).toEqual(["archetype", "kit", "name", "spendCap"]);
    expect(validateCommitForm({ ...form, name: "Ledgerly", archetype: "services", kit: DEFAULT_KIT, spendCap: "" })).toEqual({});
  });

  it("asks a LIVE start for the founder's 18+ confirmation unless it is on record, and sends it only for LIVE", () => {
    const form = { ...initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, DEFAULT_KIT, "EUR"), gameMode: "live" as const };
    expect(form.adult).toBe(false);
    expect(Object.keys(validateCommitForm(form))).toEqual(["adult"]);
    expect(validateCommitForm(form, { adultOnRecord: true })).toEqual({});
    expect(validateCommitForm({ ...form, adult: true })).toEqual({});
    expect(validateCommitForm({ ...form, gameMode: "personal" })).toEqual({});
    expect(commitInput(IDEA, { ...form, adult: true }).confirmAdult).toBe(true);
    expect(commitInput(IDEA, form)).not.toHaveProperty("confirmAdult");
    expect(commitInput(IDEA, { ...form, gameMode: "personal", adult: true })).not.toHaveProperty("confirmAdult");
  });

  it("builds the idea.commit input", () => {
    const form = initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, { primary: "1B4FD8", secondary: "#f5c400" }, "SEK");
    expect(form.logo).toBeNull();
    expect(commitInput(IDEA, { ...form, spendCap: "1 250" })).toEqual({ ideaId: IDEA, name: "Ledgerly", gameMode: "personal", archetype: "b2b_saas", businessMode: "assisted", kit: { primary: "#1b4fd8", secondary: "#f5c400" }, logo: null, currency: "SEK", spendCapMinor: 125_000, autopilot: false, anthropomorphicAgents: false, agentStyle: "humans" });
    expect(commitInput(IDEA, { ...form, spendCap: "" }).spendCapMinor).toBeNull();
    // The Launch step's Anthropomorphic agents choice starts as the account preference and travels with idea.commit.
    const on = initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, DEFAULT_KIT, "SEK", true);
    expect(on.anthropomorphicAgents).toBe(true);
    expect(commitInput(IDEA, on).anthropomorphicAgents).toBe(true);
    // The style starts as the account preference (Humans without one) and travels with idea.commit.
    expect(on.agentStyle).toBe("humans");
    const fantasy = initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, DEFAULT_KIT, "SEK", true, "fantasy");
    expect(fantasy.agentStyle).toBe("fantasy");
    expect(commitInput(IDEA, fantasy).agentStyle).toBe("fantasy");
    // Autopilot is off unless the founder chose it.
    expect(initialCommitForm({ title: "Ledgerly", archetype: "b2b_saas" }, DEFAULT_KIT, "EUR").autopilot).toBe(false);
    expect(commitInput(IDEA, { ...form, autopilot: true }).autopilot).toBe(true);
    expect(parseSpendCapMinor("abc")).toBeNaN();
    // The chosen logo travels as its source and data URL only (the server checks it again).
    const logo = { source: "generated" as const, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+", colours: ["#1b4fd8"], label: "Orbit" };
    expect(commitInput(IDEA, { ...form, logo }).logo).toEqual({ source: "generated", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" });
  });
});
