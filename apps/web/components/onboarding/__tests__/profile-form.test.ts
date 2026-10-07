import { describe, expect, it } from "vitest";
import { addChip, clampSkill, displayNameFromEmail, emptyProfileForm, formFromProfile, isProfileValid, parseBudgetMinor, profilePatch, profileSummary, removeChip, sectionStatus, toggleChip, validateProfileForm, type ProfileForm } from "../profile-form";

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
    expect(form.currency).toBe("SEK");
    expect(profilePatch(form).budgetMinor).toBe(1_000_000);
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
});
