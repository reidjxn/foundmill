/** The founder-language boundary (founder, 2026-11-01): the vocabulary map, the title rules and the deterministic rewrite. */
import { describe, expect, it } from "vitest";
import { FOUNDER_TITLE_MAX_WORDS, FOUNDER_WORDS, TITLE_BANNED_TERM_IDS, founderPhrase, founderTitleFallback, founderTitleProblems, founderWord, isFounderTitle } from "./founder-words";
import { PLAIN_LANGUAGE_TIERS, TERMS } from "./terms";

describe("FOUNDER_WORDS", () => {
  it("holds the brief's map, and every founder phrase passes the title rules itself", () => {
    expect(founderWord("merge")).toBe("put live");
    expect(founderWord("pull request")).toBe("a finished change");
    expect(founderWord("CI")).toBe("the automatic tests");
    expect(founderWord("rebase")).toBe("bring up to date with the newest version");
    expect(founderWord("branch")).toBe("the agent's working copy");
    expect(founderWord("default branch")).toBe("the live product");
    expect(founderWord("sandbox")).toBe("a test copy");
    expect(founderWord("hydration mismatch")).toBe("a display bug");
    expect(founderWord("deploy contract")).toBe("the rules for how the team releases");
    expect(founderWord("orchestrator")).toBe("the system that runs the team");
    expect(founderWord("unknown thing")).toBeNull();
    for (const [technical, founder] of FOUNDER_WORDS) {
      const problems = founderTitleProblems(`${founder.charAt(0).toUpperCase()}${founder.slice(1)}`).filter((p) => p.rule !== "case");
      expect(problems, `${technical} → ${founder}`).toEqual([]);
    }
  });

  it("the banned define-tier words are the code-hosting ones, never the business's own vocabulary", () => {
    expect(TITLE_BANNED_TERM_IDS).toContain("pull_request");
    expect(TITLE_BANNED_TERM_IDS).not.toContain("runway");
    expect(TITLE_BANNED_TERM_IDS).not.toContain("roadmap");
    for (const id of TITLE_BANNED_TERM_IDS) expect(PLAIN_LANGUAGE_TIERS.define).toContain(TERMS[id].word);
  });
});

describe("founderTitleProblems", () => {
  it("passes a short plain title and names what is wrong with the rest", () => {
    expect(founderTitleProblems("Fix the sign-up page that showed stale prices")).toEqual([]);
    expect(isFounderTitle("Set up the first runway forecast")).toBe(true);
    expect(founderTitleProblems("Rebase agent/a5444581-1234-4abc-8def-123456789abc onto main").map((p) => p.rule)).toEqual(expect.arrayContaining(["technical_word", "identifier"]));
    expect(founderTitleProblems("Open a pull request for the usage export").map((p) => `${p.rule}:${p.text}`)).toEqual(expect.arrayContaining(["technical_word:pull request", "jargon:pull request"]));
    expect(founderTitleProblems("Tune the CPA model").map((p) => p.rule)).toContain("jargon");
    expect(founderTitleProblems("Fix PR #41").map((p) => p.rule)).toEqual(expect.arrayContaining(["technical_word", "identifier"]));
    expect(founderTitleProblems("Rename `getUser` in users.ts").map((p) => p.rule)).toContain("identifier");
    expect(founderTitleProblems("One two three four five six seven eight nine ten eleven")).toEqual([{ rule: "too_long", text: "11 words" }]);
    expect(founderTitleProblems("Ship the onboarding checklist.")).toEqual([{ rule: "punctuation", text: "." }]);
    expect(founderTitleProblems("ship the onboarding checklist")).toEqual([{ rule: "case", text: "s" }]);
    expect(founderTitleProblems("   ")).toEqual([{ rule: "empty" }]);
  });

  it("reads acronyms as written: a lower-case 'ci' inside a word is not CI", () => {
    expect(founderTitleProblems("Decide the pricing for agencies")).toEqual([]);
    expect(founderTitleProblems("Make CI green").map((p) => p.text)).toContain("CI");
  });
});

describe("founderPhrase and founderTitleFallback", () => {
  it("rewrites the engineering words, drops identifiers and tidies the sentence", () => {
    expect(founderPhrase("Fix hydration mismatch in /dashboard")).toBe("Fix a display bug in the dashboard page");
    expect(founderPhrase("Merge the pricing page fix")).toBe("Put live the pricing page fix");
    expect(founderPhrase("Open a PR for the usage export")).toBe("Open a finished change for the usage export");
    expect(founderPhrase("Make CI green")).toBe("Make the automatic tests green");
    expect(founderPhrase("Investigate flaky e2e in apps/web")).toBe("Investigate unreliable the automatic tests");
    expect(founderPhrase("Rebase agent/a5444581-1234-4abc-8def-123456789abc onto main")).toBe("Bring up to date with the newest version the agent's working copy with the live product");
    expect(founderPhrase("Reconcile September invoices")).toBe("Reconcile September invoices");
    expect(founderPhrase("")).toBe("");
  });

  it("gives a title only when the rewrite passes every rule, never a sentence cut short", () => {
    expect(founderTitleFallback("Fix hydration mismatch in /dashboard")).toBe("Fix a display bug in the dashboard page");
    expect(founderTitleFallback("Ship the onboarding checklist")).toBe("Ship the onboarding checklist");
    // Eleven words after the rewrite: no title rather than a broken one.
    expect(founderTitleFallback("Rebase agent/a5444581-1234-4abc-8def-123456789abc onto main and resolve merge conflicts")).toBeNull();
    expect(founderTitleFallback("Add deploy contract and guards for Railway")).toBeNull();
    for (const title of ["Fix hydration mismatch in /dashboard", "Open a PR for the usage export", "Make CI green on the sitemap branch", "Add rate limiting to the webhook receiver"]) {
      const out = founderTitleFallback(title);
      if (out) {
        expect(isFounderTitle(out), out).toBe(true);
        expect(out.split(/\s+/).length).toBeLessThanOrEqual(FOUNDER_TITLE_MAX_WORDS);
      }
    }
  });
});
