/** The founder-language boundary (founder, 2026-11-01): the vocabulary map, the title rules and the deterministic rewrite. */
import { describe, expect, it } from "vitest";
import { FOUNDER_TITLE_MAX_WORDS, FOUNDER_WORDS, TITLE_BANNED_TERM_IDS, founderJargonHits, founderPhrase, founderTitleFallback, founderTitleProblems, founderWord, isFounderTitle, roundWords, ventureNoun, withoutEngineNumbers } from "./founder-words";
import { PLAIN_LANGUAGE_TIERS, TERMS } from "./terms";

describe("FOUNDER_WORDS", () => {
  it("holds the brief's map, and every founder phrase passes the title rules itself", () => {
    expect(founderWord("merge")).toBe("put live");
    expect(founderWord("pull request")).toBe("a finished change");
    expect(founderWord("CI")).toBe("the quality checks");
    expect(founderWord("rebase")).toBe("bring up to date with the newest version");
    expect(founderWord("branch")).toBe("the agent's working copy");
    expect(founderWord("default branch")).toBe("the live product");
    expect(founderWord("sandbox")).toBe("a practice copy");
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
    expect(founderTitleProblems("Fix pull request #41").map((p) => p.rule)).toEqual(expect.arrayContaining(["technical_word", "identifier"]));
    // "PR" is public relations too (a distribution channel): only the code-hosting phrase is engineering talk (Nov 7, 2026).
    expect(founderTitleProblems("Pause PR until the carton proof is final")).toEqual([]);
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
    expect(founderPhrase("Open a pull request for the usage export")).toBe("Open a finished change for the usage export");
    expect(founderPhrase("Make CI green")).toBe("Make the quality checks green");
    expect(founderPhrase("Investigate flaky e2e in apps/web")).toBe("Investigate unreliable the quality checks");
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
    for (const title of ["Fix hydration mismatch in /dashboard", "Open a pull request for the usage export", "Make CI green on the sitemap branch", "Add rate limiting to the webhook receiver"]) {
      const out = founderTitleFallback(title);
      if (out) {
        expect(isFounderTitle(out), out).toBe(true);
        expect(out.split(/\s+/).length).toBeLessThanOrEqual(FOUNDER_TITLE_MAX_WORDS);
      }
    }
  });
});

describe("the engine's numbers (Builder view, Nov 8, 2026)", () => {
  it("founderJargonHits catches round of work and round numbers, test tallies, tokens, PR numbers and ETA", () => {
    const hits = (text: string) => founderJargonHits(text).map((h) => h.term);
    expect(hits("Cycle 3 completed")).toEqual(["Cycle 3"]);
    expect(hits("Round 2 · waiting for you")).toEqual(["Round 2"]);
    expect(hits("105 tests passed")).toEqual(["105 tests passed"]);
    expect(hits("Still 3 of 10 tests failing")).toEqual(["3 of 10 tests failing"]);
    expect(hits("2 acceptance tests failed")).toEqual(expect.arrayContaining(["2 acceptance tests failed"]));
    expect(hits("Used 12,400 tokens so far")).toEqual(["12,400 tokens"]);
    expect(hits("Merged PR #41")).toEqual(expect.arrayContaining(["Merged", "PR #41"]));
    expect(hits("ETA 3:45 PM")).toEqual(["ETA"]);
    // Plain words stay plain: a round of work, the quality checks, a PR channel, a funding round without a number.
    expect(hits("The team started a round of work. The quality checks passed.")).toEqual([]);
    expect(hits("Pause PR until the carton proof is final; the seed round closes Friday")).toEqual([]);
    expect(hits("Beta testers passed 40 leads on")).toEqual([]);
  });

  it("founderPhrase rewrites them, and the title rules flag them", () => {
    expect(founderPhrase("Cycle 3 completed")).toBe("A round of work completed");
    expect(founderPhrase("Fixed checkout: 105 tests passed")).toBe("Fixed checkout: the quality checks passed");
    expect(founderPhrase("3 of 10 tests failing on the pricing page")).toBe("Some quality checks are failing on the pricing page");
    expect(founderPhrase("Merged PR #41 for the pricing page")).toBe("Put live a finished change for the pricing page");
    expect(founderPhrase("Used 1.2K tokens")).toBe("Used some AI usage");
    expect(founderPhrase("ETA 3:45 PM")).toBe("Expected finish 3:45 PM");
    expect(withoutEngineNumbers("Round 2 of the sign-off")).toBe("a round of work of the sign-off");
    expect(founderTitleProblems("Finish cycle 4 work").map((p) => `${p.rule}:${p.text}`)).toContain("technical_word:cycle 4");
    expect(founderTitleFallback("Ship the export before cycle 4")).toBe("Ship the export before a round of work");
  });
});

describe("roundWords and ventureNoun (WP-02 T8)", () => {
  it("a round of work for the founder, the round of work in Builder view", () => {
    expect(roundWords(false)).toEqual({ one: "round of work", a: "a round of work", idle: "The team is idle" });
    expect(roundWords(true)).toEqual({ one: "round of work", a: "a round of work", idle: "No round of work running" });
  });
  it("project until the first sale", () => {
    expect(ventureNoun()).toBe("project");
    expect(ventureNoun(null)).toBe("project");
    expect(ventureNoun(false)).toBe("project");
    expect(ventureNoun(true)).toBe("business");
  });
});
