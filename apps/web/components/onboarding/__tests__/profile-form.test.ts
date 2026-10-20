import { describe, expect, it } from "vitest";
import { FALLBACK_CURRENCY, PROFILE_LIMITS, addChip, currencyForCountry, currencyForLocale, defaultCurrency, profileSaveMessage, clampSkill, displayNameFromEmail, emptyProfileForm, formFromProfile, isProfileValid, parseBudgetMinor, profilePatch, profileSummary, removeChip, sectionStatus, toggleChip, validateProfileForm, type ProfileForm } from "../profile-form";

function filled(): ProfileForm {
  return { ...emptyProfileForm("reid.jackson@example.com"), experience: "first_time", timeCommitment: "full_time", budget: "25k", currency: "EUR", targetMarkets: ["EU", "UK"], constraints: ["Bootstrapped, no outside funding"], riskAppetite: "medium" };
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

  it("requires name, experience, time, a market and risk; budget is optional", () => {
    const empty = validateProfileForm(emptyProfileForm());
    expect(Object.keys(empty).sort()).toEqual(["displayName", "experience", "targetMarkets", "timeCommitment"]);
    expect(isProfileValid(filled())).toBe(true);
    expect(validateProfileForm({ ...filled(), budget: "abc" }).budget).toMatch(/number/);
    expect(validateProfileForm({ ...filled(), currency: "eur" }).currency).toBeDefined();
  });

  it("clamps skills to 1–20 and maps the form to the founder.profile.update patch", () => {
    expect(clampSkill(0)).toBe(1);
    expect(clampSkill(99)).toBe(20);
    expect(clampSkill(Number.NaN)).toBe(10);
    const patch = profilePatch({ ...filled(), skills: { engineering: 25, sales: 14, design: 0, finance: 9, domain: 16 }, citizenship: " Sweden ", residence: "" });
    expect(patch).toMatchObject({ displayName: "Reid Jackson", experience: "first_time", skills: { engineering: 20, sales: 14, design: 1, finance: 9, domain: 16 }, timeCommitment: "full_time", budgetMinor: 2_500_000, currency: "EUR", citizenship: "Sweden", residence: null, targetMarkets: ["EU", "UK"], riskAppetite: "medium" });
  });

  it("round-trips an existing profile into the form", () => {
    const form = formFromProfile({ displayName: "Sara", experience: "exited", skills: { engineering: 18, sales: 7 }, timeCommitment: "part_time", budgetMinor: 1_000_000, currency: "SEK", citizenship: "Sweden", residence: "Sweden", targetMarkets: ["Nordics"], constraints: [], riskAppetite: "high" }, "x@y.z");
    expect(form.displayName).toBe("Sara");
    expect(form.skills).toEqual({ engineering: 18, sales: 7, design: 10, finance: 10, domain: 10 });
    expect(form.budget).toBe("10000");
    expect(form.noBudget).toBe(false);
    expect(form.currency).toBe("SEK");
    expect(profilePatch(form).budgetMinor).toBe(1_000_000);
    // A saved profile without a budget reads as the explicit choice.
    const saved = formFromProfile({ displayName: "Sara", experience: null, skills: {}, timeCommitment: null, budgetMinor: null, currency: "", citizenship: null, residence: null, targetMarkets: [], constraints: [], riskAppetite: null });
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

  it("chips de-duplicate case-insensitively, trim, cap and toggle", () => {
    expect(addChip(["EU"], " eu ")).toEqual(["EU"]);
    expect(addChip(["EU"], "UK  and   Ireland")).toEqual(["EU", "UK and Ireland"]);
    expect(addChip(Array.from({ length: 20 }, (_, i) => `m${i}`), "one more")).toHaveLength(20);
    expect(toggleChip(["EU", "UK"], "uk")).toEqual(["EU"]);
    expect(toggleChip(["EU"], "US")).toEqual(["EU", "US"]);
    expect(removeChip(["EU", "UK"], "EU")).toEqual(["UK"]);
  });

  it("reports section completion for the rail and a one-line summary", () => {
    const status = sectionStatus(emptyProfileForm());
    expect(status).toEqual({ identity: false, skills: true, time: false, place: false, constraints: true });
    expect(sectionStatus(filled())).toEqual({ identity: true, skills: true, time: true, place: true, constraints: true });
    expect(profileSummary(filled())).toBe("First-time founder · full time · EUR 25,000 · EU, UK");
  });

  it("refuses what the API would reject, before submit and in plain words (audit FR-14)", () => {
    const long = (n: number) => "x".repeat(n);
    expect(validateProfileForm({ ...filled(), budget: "99999999999999m" }).budget).toMatch(/budget below 1,000,000,000,000/);
    expect(validateProfileForm({ ...filled(), budget: "1000000000000" }).budget).toBeUndefined();
    expect(validateProfileForm({ ...filled(), citizenship: long(81) }).citizenship).toMatch(/under 80 characters/);
    expect(validateProfileForm({ ...filled(), residence: long(100) }).residence).toMatch(/under 80 characters/);
    expect(validateProfileForm({ ...filled(), citizenship: long(80), residence: long(80), targetMarkets: [long(80)] })).toEqual({});
    expect(validateProfileForm({ ...filled(), targetMarkets: ["EU", long(150)] }).targetMarkets).toMatch(/each market under 80/);
    expect(validateProfileForm({ ...filled(), constraints: [long(401)] }).constraints).toMatch(/each constraint under 400/);
    // The sections rail does not read "done" for a section that holds a refused answer.
    expect(sectionStatus({ ...filled(), citizenship: long(81) }).place).toBe(false);
    expect(sectionStatus({ ...filled(), constraints: [long(401)] }).constraints).toBe(false);
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
    expect(text).toBe("These answers were not accepted: budget, citizenship, target markets. Shorten or correct them, then save again.");
    expect(text).not.toMatch(/budgetMinor|targetMarkets|Too big|int/);
    expect(profileSaveMessage(null, "Something went wrong")).toBe("Something went wrong");
    expect(profileSaveMessage([{ path: ["unknownField"] }], "Something went wrong")).toBe("Something went wrong");
  });
});
