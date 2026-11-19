/**
 * The skills library's source is one Markdown file per skill under packages/agents/skills, and the TypeScript catalog
 * the app reads is generated from it (WP-06 T2; founder, Nov 16, 2026: D6). The catalog carries each skill's full body,
 * so the product can show a person the text of a skill without sending them to the repository.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { usSpelling } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { UTILITY_TEMPLATE_KEYS } from "../archetypes";
import { CONNECTOR_KEYS } from "../connectors";
import { TEMPLATE_KEYS } from "../registry";
import { screenSkill } from "../skill-files";
import { SKILL_LIBRARY, SKILL_LIBRARY_CATEGORIES, SKILL_LIBRARY_CATEGORY_LABELS } from "../skill-library";
import { getSkillDefinition } from "../skills/definitions";
import { ALL_TEMPLATES } from "../templates";
import { UNBUILT_VENDOR } from "./tool-patterns";

const SKILLS_DIR = fileURLToPath(new URL("../../skills", import.meta.url));
const CATALOG = fileURLToPath(new URL("../skill-library/catalog.generated.ts", import.meta.url));

/** scripts/build-skill-library.mjs, the generator (it reads the Markdown files; nothing reads them at run time). */
const generator: { renderCatalog(skillsDir: string): string } = await import(
  /* @vite-ignore */ fileURLToPath(new URL("../../../../scripts/build-skill-library.mjs", import.meta.url))
);

/** The 20 keys the library held before it moved to Markdown; keys never change (agents hold `library_<key>`). */
const KEPT_KEYS = [
  "interview_synthesis", "acceptance_criteria", "release_notes", "pull_request_descriptions", "incident_write_ups",
  "api_reference", "landing_page_copy", "newsletter_writing", "press_releases", "discovery_call_prep",
  "objection_handling", "proposal_writing", "month_end_close", "invoice_follow_up", "pricing_analysis", "nda_review",
  "privacy_requests", "supplier_comparison", "meeting_notes", "weekly_status_report",
];

/** The 64 drafts moved in by WP-06 T3 (docs/holistic-plan/skills on Nov 16, 2026); `pricing_analysis` replaced the old body. */
const DRAFTED_KEYS = [
  "churn_prevention", "support_desk", "interface_design_principles", "ui_quality_checklist", "acting_on_review",
  "coding_discipline", "finishing_a_branch", "implementation_plans", "proof_before_done", "reviewing_code",
  "splitting_work", "systematic_debugging", "test_first", "web_app_testing", "first_budget", "pricing_analysis",
  "unit_economics", "contract_review", "marketing_compliance", "terms_and_privacy_basics", "agent_readiness",
  "ai_answer_visibility", "competitor_profiles", "content_brief", "content_matrix", "content_strategy",
  "conversion_review", "copy_editing", "email_sequences", "influencer_partnerships", "keyword_clusters", "launch_plan",
  "link_building", "marketing_ideas", "marketing_plan", "offers", "plain_human_writing", "positioning_notes",
  "post_hooks", "press_outreach", "project_page_copy", "referral_program", "seo_page_audit", "seo_plan",
  "social_post_writing", "social_strategy", "structured_data", "technical_seo", "voice_guide", "founder_notes",
  "founder_tasks", "inbound_triage", "operating_rhythm", "week_one_plan", "cited_market_research", "customer_research",
  "experiments", "first_ten_conversations", "onboarding_design", "signup_flow", "tracking_plan", "cold_email",
  "first_sale_path", "lead_prospecting",
];
/** The two coding skills added by WP-06 T13 (founder, Nov 18, 2026), defaults from release 2. */
const T13_KEYS = ["smallest_change", "terse_working_notes"];
const ALL_KEYS = [...new Set([...KEPT_KEYS, ...DRAFTED_KEYS, ...T13_KEYS])];

/** Agents a founder hires: every template but the utilities, which take typed input and render no Skills section. */
const HIREABLE = TEMPLATE_KEYS.filter((k) => !UTILITY_TEMPLATE_KEYS.includes(k));
const TEMPLATE_BY_KEY = new Map(ALL_TEMPLATES.map((t) => [t.key, t]));
const CODE_TEMPLATES = ALL_TEMPLATES.filter((t) => t.taskKinds.includes("code")).map((t) => t.key);
const NOTICES = readFileSync(`${SKILLS_DIR}/THIRD_PARTY_NOTICES.md`, "utf8");

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

/**
 * Sentences the pattern catches that were read (WP-06 T3) and do not send the agent to a shell or a test run: a fair
 * test of an offer, crawlers that do not run scripts, an HTML shell, the platform's own checks and their result. Each
 * is matched by its start; a new sentence the pattern catches still fails until someone reads it.
 */
const READ_AND_ALLOWED: Record<string, readonly string[]> = {
  experiments: ["# Running a fair test", "| Enough for the difference you expect | Run a fair test", "**Run a fair test.**"],
  coding_discipline: ["Write the tests, finish, and say in the hand-back that the run has not happened yet"],
  proof_before_done: ["| The tests pass | The finished run on your head commit lists the tests"],
  test_first: ["A test written after the code passes the first time it runs", "If you do not, the platform runs the task's tests after your session ends.", "Passing run: the commit, the state of the run"],
  web_app_testing: ["The project's checks run them in a real headless browser", "Tests run against test data and the test mode", "| It passes on some runs and fails on others |", "A sign-in or payment page run by an outside service"],
  agent_readiness: ["A request that poses as a named crawler", "As of 2026 many agents that fetch pages for assistants do not run scripts"],
  post_hooks: ["**Run the promise test.**"],
  technical_seo: ["When the raw HTML is a shell that scripts fill in", "As of 2026 search engines do not run scripts"],
};

function sentencesThatRunSomething(body: string, key = ""): string[] {
  const allowed = READ_AND_ALLOWED[key] ?? [];
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => RUNS_SOMETHING.test(s) && !SAYS_IT_CANNOT.test(s))
    .filter((s) => !allowed.some((a) => s.trim().startsWith(a)));
}

describe("the library is generated from packages/agents/skills", () => {
  it("the checked-in catalog is what the Markdown files generate (run `pnpm --filter @foundmill/agents skills:build`)", () => {
    expect(generator.renderCatalog(SKILLS_DIR)).toBe(readFileSync(CATALOG, "utf8"));
  });

  it("keeps the 20 keys, holds the 64 drafts and T13's two (85 skills), in category order and then by key", () => {
    expect(ALL_KEYS).toHaveLength(85);
    expect([...SKILL_LIBRARY.map((s) => s.key)].sort()).toEqual([...ALL_KEYS].sort());
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
      // pricing_analysis: the drafted body replaced the old one under the same key (WP-06 T3).
      expect(s.version, s.key).toBe(fix || s.key === "pricing_analysis" ? 2 : 1);
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
    for (const s of SKILL_LIBRARY) expect(sentencesThatRunSomething(s.instructionsMd, s.key), s.key).toEqual([]);
    // Every allowance still names a sentence that is there, so none outlives the text it was read for.
    for (const [key, starts] of Object.entries(READ_AND_ALLOWED)) {
      const sentences = SKILL_LIBRARY.find((s) => s.key === key)!.instructionsMd.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim());
      for (const a of starts) expect(sentences.some((x) => x.startsWith(a)), `${key}: ${a}`).toBe(true);
    }
    expect(sentencesThatRunSomething("You have no shell. Write the tests by name.")).toEqual([]);
    expect(sentencesThatRunSomething(FIXED.pull_request_descriptions!.before)).not.toEqual([]);
    expect(sentencesThatRunSomething(FIXED.api_reference!.before)).not.toEqual([]);
  });
});

describe("every library skill (WP-06 T3)", () => {
  it("passes the screening an uploaded file gets, and is US English in everything a person or agent reads", () => {
    for (const s of SKILL_LIBRARY) {
      expect(screenSkill({ name: s.attribute.name, description: s.description, instructionsMd: s.instructionsMd }), s.key).toBeNull();
      for (const text of [s.name, s.description, s.attribute.name, s.whenToUse, s.instructionsMd]) expect(usSpelling(text), s.key).toBe(text);
    }
  });

  it("stays within the sizes: a body of at most 12,000 characters and a when-to-use line of at most 160 that starts with Use when", () => {
    for (const s of SKILL_LIBRARY) {
      expect(s.instructionsMd.length, s.key).toBeLessThanOrEqual(12_000);
      expect(s.whenToUse.length, s.key).toBeLessThanOrEqual(160);
      expect(s.whenToUse.startsWith("Use when"), s.key).toBe(true);
    }
  });

  it("is suggested for hireable roles only, and is a default only for roles it is suggested for", () => {
    for (const s of SKILL_LIBRARY) {
      expect(s.roles.length, s.key).toBeGreaterThan(0);
      for (const r of s.roles) expect(HIREABLE, `${s.key} roles ${r}`).toContain(r);
      for (const r of s.defaultFor) expect(s.roles, `${s.key} default_for ${r}`).toContain(r);
      // Release 1 is T6's; T13's two coding skills arrive in release 2, so the backfill gives existing agents only those.
      expect(s.defaultSince, s.key).toBe(T13_KEYS.includes(s.key) ? 2 : 1);
    }
  });

  it("improves rated skills that exist and that a template in its roles rates", () => {
    for (const s of SKILL_LIBRARY) {
      expect(s.improves.length, s.key).toBeGreaterThan(0);
      for (const k of s.improves) {
        expect(getSkillDefinition(k), `${s.key} improves ${k}`).toBeDefined();
        expect(s.roles.some((r) => TEMPLATE_BY_KEY.get(r)!.skills.includes(k)), `${s.key} improves ${k}: no role rates it`).toBe(true);
      }
    }
  });

  it("shows under its own name: where its attribute reads like a rating one of its roles carries, it improves that rating (TS-12)", () => {
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    for (const s of SKILL_LIBRARY) {
      for (const r of s.roles) {
        for (const k of TEMPLATE_BY_KEY.get(r)!.skills) {
          if (same(getSkillDefinition(k)?.name ?? "", s.attribute.name)) expect(s.improves, `${s.key} on ${r}: "${s.attribute.name}"`).toContain(k);
        }
      }
    }
  });

  it("names only connectors the gateway serves, and all of them as better with, never required", () => {
    for (const s of SKILL_LIBRARY) {
      for (const r of s.requires) {
        expect(CONNECTOR_KEYS as readonly string[], s.key).toContain(r.connectorKey);
        expect(r.mode, s.key).toBe("better_with");
      }
    }
  });

  it("an adapted skill carries an MIT or Apache-2.0 license and each source's collection is in THIRD_PARTY_NOTICES.md", () => {
    for (const s of SKILL_LIBRARY) {
      const p = s.provenance;
      if (p.origin === "foundmill") {
        expect(p.sources, s.key).toEqual([]);
        expect(p.license, s.key).toBeNull();
        continue;
      }
      expect(["MIT", "Apache-2.0"], s.key).toContain(p.license);
      expect(p.sources.length, s.key).toBeGreaterThan(0);
      for (const src of p.sources) expect(NOTICES, `${s.key}: ${src}`).toContain(`\`${src.split(":")[0]}\``);
    }
  });

  it("gives coding_discipline by default to every template that writes code", () => {
    expect(CODE_TEMPLATES).toHaveLength(11);
    expect([...SKILL_LIBRARY.find((s) => s.key === "coding_discipline")!.defaultFor].sort()).toEqual([...CODE_TEMPLATES].sort());
  });

  it("customer replies sit with the Chief of Staff for now (founder, Nov 16, 2026: D4)", () => {
    for (const key of ["support_desk", "churn_prevention"]) expect(SKILL_LIBRARY.find((s) => s.key === key)!.roles, key).toContain("chief_of_staff");
  });

  it("no two skills share an attribute name, and every category has a label and at least two skills", () => {
    const names = SKILL_LIBRARY.map((s) => s.attribute.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const c of SKILL_LIBRARY_CATEGORIES) {
      expect(SKILL_LIBRARY_CATEGORY_LABELS[c], c).toBeTruthy();
      expect(SKILL_LIBRARY.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(2);
    }
  });
});
