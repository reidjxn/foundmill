/**
 * The skills library's source is one Markdown file per skill under packages/agents/skills, and the TypeScript catalog
 * the app reads is generated from it (WP-06 T2; founder, Nov 16, 2026: D6). The catalog carries each skill's full body,
 * so the product can show a person the text of a skill without sending them to the repository.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILL_LIBRARY, SKILL_LIBRARY_CATEGORIES } from "../skill-library";
import { UNBUILT_VENDOR } from "./tool-patterns";

const SKILLS_DIR = fileURLToPath(new URL("../../skills", import.meta.url));
const CATALOG = fileURLToPath(new URL("../skill-library/catalog.generated.ts", import.meta.url));

/** scripts/build-skill-library.mjs, the generator (it reads the Markdown files; nothing reads them at run time). */
const generator: { renderCatalog(skillsDir: string): string } = await import(
  /* @vite-ignore */ fileURLToPath(new URL("../../../../scripts/build-skill-library.mjs", import.meta.url))
);

/** The 20 keys the library held before it moved to Markdown; keys never change (agents hold `library_<key>`). */
const KEYS = [
  "interview_synthesis", "acceptance_criteria", "release_notes", "pull_request_descriptions", "incident_write_ups",
  "api_reference", "landing_page_copy", "newsletter_writing", "press_releases", "discovery_call_prep",
  "objection_handling", "proposal_writing", "month_end_close", "invoice_follow_up", "pricing_analysis", "nda_review",
  "privacy_requests", "supplier_comparison", "meeting_notes", "weekly_status_report",
];

/** TS-07: the six lines that asked an agent to do what it has no tool for, and what replaced each. */
const FIXED: Record<string, { before: string; after: string }> = {
  pull_request_descriptions: {
    before: "- **How it was tested**: the commands run and their result, plus any manual checks.",
    after:
      "- **How it was tested**: the tests you wrote or changed, by name. You cannot run commands: say that the platform runs the task's tests after your session and that the result is on the task.",
  },
  incident_write_ups: {
    before: "5. Actions: each one small, with a suggested owner and date, filed as a task.",
    after: "5. Actions: each one small, with a suggested owner and date. List them in your report for your lead to turn into tasks.",
  },
  api_reference: {
    before: "Run each example against the test environment before publishing it. Note the version the page describes.",
    after: 'Take each example from a passing test or mark it "not run". Note the version the page describes.',
  },
  month_end_close: {
    before: "1. Reconcile each bank and card account against the ledger. List every difference with its amount.",
    after:
      "1. If a bank connection is connected, reconcile each bank and card account against the ledger and list every difference with its amount. If none is, say the reconciliation was not done and what the founder would need to connect.",
  },
  invoice_follow_up: {
    before: "Check the suppression list and the customer's contact preferences before drafting.",
    after:
      "Read the customer's contact preferences on their record before drafting. You cannot check the suppression list: say so, and leave the send to an agent or person who can.",
  },
  meeting_notes: {
    before: "- Action items next: what, who and by when. File each one as a task.",
    after: "- Action items next: what, who and by when, listed for your lead to turn into tasks.",
  },
};

/**
 * A sentence that tells the agent to run a command, use a shell or run tests. A session agent has no shell; such a
 * sentence passes only when it says so ("You cannot run commands", "You have no shell").
 */
const RUNS_SOMETHING = /\b(run|runs|running|execute|executes)\b[^.]*\b(commands?|shell|scripts?|tests?)\b|\bcommands?\s+run\b|\bshell\b|\bterminal\b/i;
const SAYS_IT_CANNOT = /\b(cannot|can't|have no|has no)\b/i;

function sentencesThatRunSomething(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => RUNS_SOMETHING.test(s) && !SAYS_IT_CANNOT.test(s));
}

describe("the library is generated from packages/agents/skills", () => {
  it("the checked-in catalog is what the Markdown files generate (run `pnpm --filter @foundmill/agents skills:build`)", () => {
    expect(generator.renderCatalog(SKILLS_DIR)).toBe(readFileSync(CATALOG, "utf8"));
  });

  it("keeps the 20 keys, in category order and then by key", () => {
    expect([...SKILL_LIBRARY.map((s) => s.key)].sort()).toEqual([...KEYS].sort());
    const rank = (s: (typeof SKILL_LIBRARY)[number]) => SKILL_LIBRARY_CATEGORIES.indexOf(s.category);
    const ordered = [...SKILL_LIBRARY].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
    expect(SKILL_LIBRARY.map((s) => s.key)).toEqual(ordered.map((s) => s.key));
  });

  it("carries every skill's full body, from its heading to its last line", () => {
    for (const s of SKILL_LIBRARY) {
      expect(s.instructionsMd.startsWith(`# ${s.name}\n`), s.key).toBe(true);
      expect(s.instructionsMd.endsWith("\n"), s.key).toBe(false);
      const file = readFileSync(`${SKILLS_DIR}/${s.category}/${s.key}.md`, "utf8");
      expect(file.endsWith(`\n---\n${s.instructionsMd}\n`), s.key).toBe(true);
    }
  });

  it("fixes the six lines that asked for a tool the agent does not hold, and moves those skills to version 2", () => {
    for (const s of SKILL_LIBRARY) {
      const fix = FIXED[s.key];
      expect(s.version, s.key).toBe(fix ? 2 : 1);
      if (!fix) continue;
      expect(s.instructionsMd.split("\n"), s.key).toContain(fix.after);
      expect(s.instructionsMd, s.key).not.toContain(fix.before);
    }
  });
});

describe("library skills name only tools that exist", () => {
  it("no body sends an agent to a vendor whose connector is not built", () => {
    for (const s of SKILL_LIBRARY) expect(s.instructionsMd, s.key).not.toMatch(UNBUILT_VENDOR);
  });

  it("no body tells an agent to run a command, a shell or a test run, unless it says the agent cannot", () => {
    for (const s of SKILL_LIBRARY) expect(sentencesThatRunSomething(s.instructionsMd), s.key).toEqual([]);
    expect(sentencesThatRunSomething("You have no shell. Write the tests by name.")).toEqual([]);
    expect(sentencesThatRunSomething(FIXED.pull_request_descriptions!.before)).not.toEqual([]);
    expect(sentencesThatRunSomething(FIXED.api_reference!.before)).not.toEqual([]);
  });
});
