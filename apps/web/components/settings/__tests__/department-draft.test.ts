/** "Add department › From a sentence": a local reading of the sentence into an editable draft (BUILD §11.13). */
import { describe, expect, it } from "vitest";
import { draftDepartment, modulesInSentence, nameFromSentence } from "../department-draft";

describe("department drafts from a sentence", () => {
  it("names the department from the opening noun phrase and picks the modules the sentence names", () => {
    const draft = draftDepartment("A customer support team that handles refunds, contracts and the privacy policy");
    expect(draft.name).toBe("Customer Support");
    expect(draft.moduleKeys).toEqual(["legal"]);
    expect(draft).toMatchObject({ icon: "scale", colourToken: "dept-6" });
  });

  it("prefers the name after 'called', and reads several modules in the platform's order", () => {
    const draft = draftDepartment("Create a department called Formulation Lab for product research and lab testing.");
    expect(draft.name).toBe("Formulation Lab");
    expect(draft.moduleKeys).toEqual(["product", "development"]);
  });

  it("keeps short acronyms, lowers small words, and never mistakes 'team' or 'product' for another module", () => {
    expect(nameFromSentence("We need a PR and partnerships desk", [])).toBe("PR and Partnerships");
    expect(modulesInSentence("PR and partnerships")).toEqual(["distribution"]);
    expect(modulesInSentence("a product team")).toEqual(["product"]);
    expect(modulesInSentence("hiring and onboarding new agents")).toEqual(["team"]);
    expect(modulesInSentence("bookkeeping, invoices and payroll")).toEqual(["finance"]);
  });

  it("falls back to the modules for a long sentence, and to a neutral draft when nothing matches", () => {
    expect(nameFromSentence("Someone should look after all the marketing and the sales pipeline for us please", ["distribution"])).toBe("Distribution");
    const blank = draftDepartment("Things that do not fit anywhere else at all");
    expect(blank.moduleKeys).toEqual([]);
    expect(blank).toMatchObject({ icon: "folder", colourToken: "dept-7" });
  });

  it("skips a color another department already wears when a free one exists", () => {
    expect(draftDepartment("Growth marketing", ["dept-3"]).colourToken).not.toBe("dept-3");
    expect(draftDepartment("Growth marketing", []).colourToken).toBe("dept-3");
  });
});
