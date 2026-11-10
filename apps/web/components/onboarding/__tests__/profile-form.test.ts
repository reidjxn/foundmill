import { describe, expect, it } from "vitest";
import {
  DETAIL_SECTION_TITLE,
  EXAMPLE_PROFILE,
  FALLBACK_CURRENCY,
  PROFILE_LIMITS,
  PROFILE_SECTIONS,
  addChip,
  clearExampleProfile,
  fillExampleProfile,
  currencyForCountry,
  currencyForLocale,
  defaultCurrency,
  defaultMarket,
  detailAnswered,
  detailOpenByDefault,
  detailStorageKey,
  effectiveTargetMarkets,
  firstInvalidSection,
  profileSaveMessage,
  clampSkill,
  displayNameFromEmail,
  emptyProfileForm,
  formFromProfile,
  isProfileValid,
  parseBudgetMinor,
  profilePatch,
  profileSummary,
  partialCountry,
  partialCountryMessage,
  budgetWords,
  removeChip,
  sectionStatus,
  toggleChip,
  validateProfileForm,
  type ProfileForm,
} from "../profile-form";

function filled(): ProfileForm {
  return {
    ...emptyProfileForm("reid.jackson@example.com"),
    experience: "first_time",
    timeCommitment: "full_time",
    budget: "25k",
    currency: "EUR",
    targetMarkets: ["EU", "UK"],
    constraints: ["Bootstrapped, no outside funding"],
    riskAppetite: "medium",
  };
}

/** The first pass alone: the four answers, nothing under "Add detail". */
function firstPass(): ProfileForm {
  return {
    ...emptyProfileForm("reid.jackson@example.com"),
    experience: "first_time",
    timeCommitment: "evenings_weekends",
    residence: "United Kingdom",
  };
}

describe("founder profile form (BUILD §11.1, AC-11.1.1)", () => {
  it("derives a display name from the email", () => {
    expect(displayNameFromEmail("reid.jackson@example.com")).toBe("Reid Jackson");
    expect(displayNameFromEmail("a_b-c+d@x.io")).toBe("A B C D");
    expect(emptyProfileForm("founder@x.io").displayName).toBe("Founder");
  });

  it("parses budgets in major units with k/m suffixes into minor units", () => {
    expect(parseBudgetMinor("25000")).toBe(2_500_000);
    expect(parseBudgetMinor("25k")).toBe(2_500_000);
    expect(parseBudgetMinor("1.5m")).toBe(150_000_000);
    expect(parseBudgetMinor("25 000.50")).toBe(2_500_050);
    expect(parseBudgetMinor("")).toBeNull();
    expect(parseBudgetMinor("twenty")).toBeNaN();
  });

  it("requires name, experience and time; markets, budget and where you live are optional (UX plan §7.3, two passes)", () => {
    const empty = validateProfileForm(emptyProfileForm());
    expect(Object.keys(empty).sort()).toEqual(["displayName", "experience", "timeCommitment"]);
    expect(isProfileValid(filled())).toBe(true);
    expect(isProfileValid(firstPass())).toBe(true);
    expect(validateProfileForm({ ...filled(), budget: "abc" }).budget).toMatch(/number/);
    expect(validateProfileForm({ ...filled(), currency: "eur" }).currency).toBeDefined();
  });

  it("clamps skills to 1–20 and maps the form to the founder.profile.update patch", () => {
    expect(clampSkill(0)).toBe(1);
    expect(clampSkill(99)).toBe(20);
    expect(clampSkill(Number.NaN)).toBe(10);
    const patch = profilePatch({
      ...filled(),
      skills: { engineering: 25, sales: 14, design: 0, finance: 9, domain: 16 },
      citizenship: " Sweden ",
      residence: "",
    });
    expect(patch).toMatchObject({
      displayName: "Reid Jackson",
      experience: "first_time",
      skills: { engineering: 20, sales: 14, design: 1, finance: 9, domain: 16 },
      timeCommitment: "full_time",
      budgetMinor: 2_500_000,
      currency: "EUR",
      citizenship: "Sweden",
      residence: null,
      targetMarkets: ["EU", "UK"],
      riskAppetite: "medium",
    });
  });

  it("round-trips an existing profile into the form", () => {
    const form = formFromProfile(
      {
        displayName: "Sara",
        experience: "exited",
        skills: { engineering: 18, sales: 7 },
        timeCommitment: "part_time",
        budgetMinor: 1_000_000,
        currency: "SEK",
        citizenship: "Sweden",
        residence: "Sweden",
        targetMarkets: ["Nordics"],
        constraints: [],
        riskAppetite: "high",
      },
      "x@y.z",
    );
    expect(form.displayName).toBe("Sara");
    expect(form.skills).toEqual({ engineering: 18, sales: 7, design: 10, finance: 10, domain: 10 });
    expect(form.budget).toBe("10000");
    expect(form.noBudget).toBe(false);
    expect(form.currency).toBe("SEK");
    expect(profilePatch(form).budgetMinor).toBe(1_000_000);
    // A saved profile without a budget made that choice: it reads as "I have no budget yet".
    const saved = formFromProfile({
      displayName: "Sara",
      experience: null,
      skills: {},
      timeCommitment: null,
      budgetMinor: null,
      currency: "",
      citizenship: null,
      residence: null,
      targetMarkets: [],
      constraints: [],
      riskAppetite: null,
    });
    expect(saved.noBudget).toBe(true);
    expect(saved.currency).toBe(FALLBACK_CURRENCY);
  });

  it("'I have no budget yet' sends no budget, whatever was typed, and never fails validation (A11)", () => {
    const form: ProfileForm = { ...filled(), budget: "abc", noBudget: true };
    expect(validateProfileForm(form).budget).toBeUndefined();
    expect(profilePatch(form).budgetMinor).toBeNull();
    expect(profileSummary(form)).toBe("First-time founder · full time · EU, UK");
    expect(emptyProfileForm().noBudget).toBe(false);
  });

  it("derives the currency from where the founder lives, then the browser, then US dollars (A11)", () => {
    expect(currencyForCountry("United Kingdom")).toBe("GBP");
    expect(currencyForCountry(" uk ")).toBe("GBP");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("United States")).toBe("USD");
    expect(currencyForCountry("Germany")).toBe("EUR");
    expect(currencyForCountry("Ireland")).toBe("EUR");
    expect(currencyForCountry("Poland")).toBe("EUR");
    expect(currencyForCountry("Sweden")).toBe("SEK");
    expect(currencyForCountry("Switzerland")).toBe("CHF");
    // A country whose currency the list does not offer says nothing, so the next source decides.
    expect(currencyForCountry("Japan")).toBeNull();
    expect(currencyForCountry("Atlantis")).toBeNull();
    expect(currencyForCountry("")).toBeNull();
    expect(currencyForLocale("en-GB")).toBe("GBP");
    expect(currencyForLocale("sv-SE")).toBe("SEK");
    expect(currencyForLocale("de")).toBe("EUR");
    expect(currencyForLocale("en-US")).toBe("USD");
    expect(currencyForLocale("ja-JP")).toBeNull();
    expect(currencyForLocale("not a locale !!")).toBeNull();
    expect(currencyForLocale(null)).toBeNull();
    expect(defaultCurrency("United Kingdom", "en-US")).toBe("GBP");
    expect(defaultCurrency("", "fr-FR")).toBe("EUR");
    expect(defaultCurrency("Japan", "ja-JP")).toBe(FALLBACK_CURRENCY);
    expect(defaultCurrency("", null)).toBe("USD");
    expect(emptyProfileForm().currency).toBe("USD");
  });

  it("derives the first market from where the founder lives, in the suggestion list's words, and never from a typo (UX plan §7.3)", () => {
    expect(defaultMarket("United Kingdom")).toBe("UK");
    expect(defaultMarket("uk")).toBe("UK");
    expect(defaultMarket("GB")).toBe("UK");
    expect(defaultMarket("United States")).toBe("US");
    expect(defaultMarket("Canada")).toBe("Canada");
    expect(defaultMarket("Australia")).toBe("Australia");
    expect(defaultMarket("Sweden")).toBe("Nordics");
    expect(defaultMarket("Finland")).toBe("Nordics");
    expect(defaultMarket("Germany")).toBe("DACH");
    expect(defaultMarket("Switzerland")).toBe("DACH");
    expect(defaultMarket("Netherlands")).toBe("Benelux");
    expect(defaultMarket("France")).toBe("France");
    expect(defaultMarket("Spain")).toBe("EU");
    expect(defaultMarket("Poland")).toBe("EU");
    expect(defaultMarket("Japan")).toBe("Japan");
    expect(defaultMarket("Brazil")).toBe("Brazil");
    expect(defaultMarket("Atlantis")).toBeNull();
    expect(defaultMarket("")).toBeNull();
    expect(defaultMarket(null)).toBeNull();
    // The founder's own markets always win; an empty list falls back to the residence; no residence, no market.
    expect(
      effectiveTargetMarkets({ targetMarkets: ["Nordics"], residence: "United Kingdom" }),
    ).toEqual(["Nordics"]);
    expect(effectiveTargetMarkets({ targetMarkets: [], residence: "United Kingdom" })).toEqual([
      "UK",
    ]);
    expect(effectiveTargetMarkets({ targetMarkets: [], residence: "" })).toEqual([]);
    expect(profilePatch(firstPass()).targetMarkets).toEqual(["UK"]);
    expect(profilePatch({ ...firstPass(), residence: "" }).targetMarkets).toEqual([]);
    expect(profileSummary(firstPass())).toBe("First-time founder · evenings and weekends · UK");
  });

  it("chips de-duplicate case-insensitively, trim, cap and toggle", () => {
    expect(addChip(["EU"], " eu ")).toEqual(["EU"]);
    expect(addChip(["EU"], "UK  and   Ireland")).toEqual(["EU", "UK and Ireland"]);
    expect(
      addChip(
        Array.from({ length: 20 }, (_, i) => `m${i}`),
        "one more",
      ),
    ).toHaveLength(20);
    expect(toggleChip(["EU", "UK"], "uk")).toEqual(["EU"]);
    expect(toggleChip(["EU"], "US")).toEqual(["EU", "US"]);
    expect(removeChip(["EU", "UK"], "EU")).toEqual(["UK"]);
  });

  it("lists the four questions and the optional section as one, and ticks each by its answer (UX plan §7.3)", () => {
    expect(PROFILE_SECTIONS.map((s) => s.id)).toEqual([
      "name",
      "experience",
      "time",
      "place",
      "detail",
    ]);
    expect(PROFILE_SECTIONS.map((s) => s.label)).toEqual([
      "Your name",
      "Experience",
      "Time you can give",
      "Where you live",
      "Add detail (optional)",
    ]);
    expect(DETAIL_SECTION_TITLE).toBe("Add detail (optional, improves the ideas)");
    expect(sectionStatus(emptyProfileForm())).toEqual({
      name: false,
      experience: false,
      time: false,
      place: false,
      detail: false,
    });
    expect(sectionStatus(emptyProfileForm("reid@example.com"))).toMatchObject({ name: true });
    // The four answered: 4 of 5, nothing under Add detail yet.
    expect(sectionStatus(firstPass())).toEqual({
      name: true,
      experience: true,
      time: true,
      place: true,
      detail: false,
    });
    expect(sectionStatus(filled())).toMatchObject({ detail: true });
    // "Add detail" counts once anything in it is answered: a budget (or none), a market, a constraint, a skill moved.
    expect(detailAnswered(firstPass())).toBe(false);
    expect(detailAnswered({ ...firstPass(), noBudget: true })).toBe(true);
    expect(detailAnswered({ ...firstPass(), budget: "10k" })).toBe(true);
    expect(detailAnswered({ ...firstPass(), targetMarkets: ["EU"] })).toBe(true);
    expect(detailAnswered({ ...firstPass(), constraints: ["Remote only"] })).toBe(true);
    expect(detailAnswered({ ...firstPass(), skills: { ...firstPass().skills, sales: 13 } })).toBe(
      true,
    );
    // A refused answer in the section unticks it.
    expect(sectionStatus({ ...filled(), budget: "abc" }).detail).toBe(false);
    expect(profileSummary(filled())).toBe("First-time founder · full time · €25,000 · EU, UK");
  });

  it("opens Add detail by default for an Exited founder or an Operator, under one browser key per account", () => {
    expect(detailOpenByDefault("exited")).toBe(true);
    expect(detailOpenByDefault("operator")).toBe(true);
    expect(detailOpenByDefault("first_time")).toBe(false);
    expect(detailOpenByDefault("domain_expert")).toBe(false);
    expect(detailOpenByDefault("")).toBe(false);
    expect(detailOpenByDefault(null)).toBe(false);
    expect(detailStorageKey("11111111-1111-4111-8111-111111111111")).toBe(
      "foundmill.profile.detail.11111111-1111-4111-8111-111111111111",
    );
    expect(detailStorageKey(null)).toBe("foundmill.profile.detail.account");
  });

  it("names the first section, in page order, with an answer that refuses to save", () => {
    expect(firstInvalidSection({})).toBeNull();
    expect(firstInvalidSection({ budget: "x", experience: "x" })).toBe("experience");
    expect(firstInvalidSection({ riskAppetite: "x", residence: "x" })).toBe("place");
    expect(firstInvalidSection({ constraints: "x" })).toBe("detail");
    expect(firstInvalidSection(validateProfileForm(emptyProfileForm()))).toBe("name");
  });

  it("refuses what the API would reject, before submit and in plain words (audit FR-14)", () => {
    const long = (n: number) => "x".repeat(n);
    expect(validateProfileForm({ ...filled(), budget: "99999999999999m" }).budget).toMatch(
      /budget below 1,000,000,000,000/,
    );
    expect(validateProfileForm({ ...filled(), budget: "1000000000000" }).budget).toBeUndefined();
    expect(validateProfileForm({ ...filled(), citizenship: long(81) }).citizenship).toMatch(
      /under 80 characters/,
    );
    expect(validateProfileForm({ ...filled(), residence: long(100) }).residence).toMatch(
      /under 80 characters/,
    );
    expect(
      validateProfileForm({
        ...filled(),
        citizenship: long(80),
        residence: long(80),
        targetMarkets: [long(80)],
      }),
    ).toEqual({});
    expect(
      validateProfileForm({ ...filled(), targetMarkets: ["EU", long(150)] }).targetMarkets,
    ).toMatch(/each market under 80/);
    expect(validateProfileForm({ ...filled(), constraints: [long(401)] }).constraints).toMatch(
      /each constraint under 400/,
    );
    // The sections rail does not read "done" for a section that holds a refused answer.
    expect(sectionStatus({ ...filled(), citizenship: long(81) }).place).toBe(false);
    expect(sectionStatus({ ...filled(), constraints: [long(401)] }).detail).toBe(false);
  });

  it("a chip longer than its field's limit is not added", () => {
    expect(addChip([], "x".repeat(81), 20, PROFILE_LIMITS.place)).toEqual([]);
    expect(addChip([], "x".repeat(80), 20, PROFILE_LIMITS.place)).toHaveLength(1);
    expect(addChip([], "x".repeat(150))).toHaveLength(1);
    expect(toggleChip([], "x".repeat(81), 20, PROFILE_LIMITS.place)).toEqual([]);
  });

  it("a refused save names the answers, once each, never the API's field names or Zod text", () => {
    const issues = [
      { path: ["budgetMinor"], message: "Too big: expected int to be <=9007199254740991" },
      { path: ["budgetMinor"], message: "Too big: expected int to be <=9007199254740991" },
      { path: ["citizenship"], message: "Too big: expected string to have <=80 characters" },
      { path: ["targetMarkets", 3], message: "Too big: expected string to have <=80 characters" },
    ];
    const text = profileSaveMessage(issues, "fallback");
    expect(text).toBe(
      "These answers were not accepted: budget, citizenship, target markets. Shorten or correct them, then save again.",
    );
    expect(text).not.toMatch(/budgetMinor|targetMarkets|Too big|int/);
    expect(profileSaveMessage(null, "Something went wrong")).toBe("Something went wrong");
    expect(profileSaveMessage([{ path: ["unknownField"] }], "Something went wrong")).toBe(
      "Something went wrong",
    );
  });
});

describe("the example founder (UX plan §6.2 ExampleToggle, Phase 3)", () => {
  it("fills every answer but the name: a first-time founder on evenings and weekends, £5,000, living in the UK, aiming at the UK and Ireland, low risk", () => {
    const form: ProfileForm = { ...emptyProfileForm("reid.jackson@example.com") };
    const filled = fillExampleProfile(form);
    expect(filled.displayName).toBe("Reid Jackson");
    expect(filled).toMatchObject({
      experience: "first_time",
      timeCommitment: "evenings_weekends",
      residence: "United Kingdom",
      citizenship: "United Kingdom",
      currency: "GBP",
      budget: "5000",
      noBudget: false,
      targetMarkets: ["UK", "Ireland"],
      constraints: ["Keep my day job for now", "No physical inventory"],
      riskAppetite: "low",
    });
    // The constraints are the suggestion chips' own words, so they read the same as the ones a founder can pick.
    expect(filled.constraints.every((c) => (["Bootstrapped, no outside funding", "Remote only", "No physical inventory", "B2B only", "Must be profitable within a year", "Keep my day job for now", "No regulated industries", "English-speaking markets only"] as string[]).includes(c))).toBe(true);
    expect(isProfileValid(filled)).toBe(true);
    expect(profileSummary(filled)).toBe("First-time founder · evenings and weekends · £5,000 · UK, Ireland");
    expect(profilePatch(filled).budgetMinor).toBe(500_000);
    // Its own copies: changing the filled form never changes the example.
    filled.constraints.push("x");
    filled.skills.sales = 1;
    expect(EXAMPLE_PROFILE.constraints).toHaveLength(2);
    expect(EXAMPLE_PROFILE.skills.sales).toBe(12);
  });

  it("clears only what it filled: untouched example answers go back, answers typed over the example stay", () => {
    const before: ProfileForm = { ...emptyProfileForm(), budget: "25k", constraints: ["Remote only"], skills: { ...emptyProfileForm().skills, sales: 15 } };
    const filled = fillExampleProfile(before);
    expect(filled.skills.sales).toBe(12);
    // The founder types over three answers while the example is in.
    const edited: ProfileForm = { ...filled, budget: "12k", skills: { ...filled.skills, engineering: 3 }, targetMarkets: ["US"] };
    const cleared = clearExampleProfile(edited, before);
    expect(cleared.budget).toBe("12k");
    expect(cleared.skills.engineering).toBe(3);
    expect(cleared.targetMarkets).toEqual(["US"]);
    // Everything else is as it was before the example.
    expect(cleared.skills.sales).toBe(15);
    expect(cleared.skills.domain).toBe(10);
    expect(cleared.constraints).toEqual(["Remote only"]);
    expect(cleared).toMatchObject({ experience: "", timeCommitment: "", residence: "", citizenship: "", currency: FALLBACK_CURRENCY, noBudget: false, riskAppetite: "medium" });
    // Untouched, the round trip is the identity.
    expect(clearExampleProfile(fillExampleProfile(before), before)).toEqual(before);
    // The budget and "I have no budget yet" are one answer: picking "no budget" over the example keeps that choice.
    const noBudget = clearExampleProfile({ ...filled, budget: "", noBudget: true }, before);
    expect(noBudget).toMatchObject({ budget: "", noBudget: true });
  });
});

describe("a country picked only part of the way (first-time founder report, Nov 8, 2026)", () => {
  it("'United' is the start of several countries, not one: the section asks the founder to finish picking and stays unticked", () => {
    expect(partialCountry("United")).toEqual(expect.arrayContaining(["United Kingdom", "United States"]));
    expect(partialCountryMessage(partialCountry("United"))).toMatch(/^Finish picking the country: (United [A-Za-z ]+, )*United Kingdom or United States\.$/);
    const form = { ...firstPass(), residence: "United" };
    expect(validateProfileForm(form).residence).toMatch(/Finish picking the country/);
    expect(sectionStatus(form).place).toBe(false);
  });
  it("a full country, a short form and a name the list does not hold all pass", () => {
    for (const value of ["United Kingdom", "UK", "united states", "Nigeria", ""]) expect(partialCountry(value), value).toEqual([]);
    expect(validateProfileForm({ ...firstPass(), residence: "Nigeria", citizenship: "UK" })).not.toHaveProperty("residence");
  });
  it("money in the profile line reads with its symbol, never its code", () => {
    expect(budgetWords(150_000, "GBP")).toBe("£1,500");
    expect(budgetWords(2_500_000, "EUR")).toBe("€25,000");
    expect(budgetWords(500_000, "USD")).toBe("$5,000");
  });
});
