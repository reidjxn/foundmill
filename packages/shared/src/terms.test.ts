/**
 * The definitions source (docs/UX_AUDIT_AND_PLAN.md §6.1): every entry is keyed by its id, written for a student in
 * US English with no sport words and none of the replace-tier jargon, its `learn` slug names a real tab, and the
 * business glossary renames the display words without touching anything else.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "./constants";
import type { Glossary } from "./glossary";
import { isKnownDepartmentLearn, LEARN_SLUG_ALIASES, learnPath, PLAIN_LANGUAGE_TIERS, TERM_IDS, TERMS, termsWithGlossary, type TermDefinition } from "./terms";

/** scripts/us-english.mjs's spelling families, when the script loads under vitest (it needs `typescript` on the path). */
const usEnglish: { findSpellingHits(text: string): { match: string; us: string }[] } | null = await import(
  /* @vite-ignore */ fileURLToPath(new URL("../../../scripts/us-english.mjs", import.meta.url))
).catch(() => null);

const entries = Object.entries(TERMS) as [string, TermDefinition][];
const textOf = (t: TermDefinition) => [t.word, t.short, t.long ?? ""].join(" ");

/** The ids the plan's "define" tier (Appendix E, §4.3) requires at launch. */
const REQUIRED_IDS = [
  "runway", "burn", "gross_burn", "net_burn", "cash_basis", "pnl", "ledger", "mrr", "arr", "churn", "gross_margin", "payback",
  "acquisition_cost", "cap_table", "safe", "vesting", "funnel", "attribution", "conversion", "pipeline", "playbook", "sku",
  "model", "tokens", "credits", "api_key", "pull_request", "branch", "repository", "sandbox", "session", "task_graph",
  "acceptance", "hard_gate", "policy", "autonomy", "business_mode", "autopilot", "vacation", "wage", "wage_cap",
  "line_manager", "chief_of_staff", "cycle", "chapter", "estimate", "forecast", "specification", "roadmap", "proposal",
  "sign_off", "jurisdiction", "lawful_basis", "archetype", "fit", "form", "rating", "potential", "training", "coach",
  "position_map", "health", "hierarchy", "milestone", "leaderboard", "customer_update", "channel_board", "lead", "campaign",
  "creative", "integration", "source_watcher", "planner", "distribution_strategist", "product_lead", "team_health",
  "runway_horizon",
];

// A small list in case the script does not load; the script's families are the full check.
const BRITISH = [
  "colour", "colours", "organisation", "organisations", "organise", "behaviour", "licence", "programme", "judgement", "whilst",
  "practise", "catalogue", "cancelled", "labelled", "centre", "holiday", "per cent", "fortnight", "grey", "analyse", "optimise",
  "prioritise", "recognise", "enquiry", "cheque", "favour", "defence", "fulfil", "learnt", "amongst",
];
const FOOTBALL = ["squad", "club", "crest", "pitch", "match", "season", "kit"];
const wordRe = (phrase: string, flags = "i") => new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?:es|s|ed|ing)?(?![\\p{L}\\p{N}_])`, `${flags}u`);
const SETTINGS_TABS = ["business", "mode", "departments", "glossary", "members", "integrations", "keys", "billing", "preferences", "danger"];
const TOP_LEVEL = ["home", "inbox", "journey", "milestones"];

const sentences = (s: string) => (s.match(/[.?!](?=\s|$)/g) ?? []).length;

describe("TERMS", () => {
  it("covers the launch list and has about 60 or more entries", () => {
    for (const id of REQUIRED_IDS) expect(TERMS, `missing ${id}`).toHaveProperty(id);
    expect(entries.length).toBeGreaterThanOrEqual(60);
    expect(TERM_IDS).toEqual(entries.map(([id]) => id));
  });

  it.each(entries)("%s: id equals its key, word and short are filled, short is one sentence under 140 characters", (key, term) => {
    expect(term.id).toBe(key);
    expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(term.word.trim().length).toBeGreaterThan(0);
    expect(term.short.trim().length).toBeGreaterThan(0);
    expect(term.short.endsWith(".")).toBe(true);
    expect(term.short.length, term.short).toBeLessThan(140);
    expect(sentences(term.short), term.short).toBe(1);
    // Sentence case: the word starts with a capital (acronyms stay capitals) and is never a lowercase id.
    expect(term.word[0]).toMatch(/[A-Z]/);
    expect(term.word).not.toMatch(/_/);
    expect(term.short[0]).toMatch(/[A-Z$0-9]/);
  });

  it.each(entries)("%s: long, when present, is two or three sentences", (_key, term) => {
    if (term.long === undefined) return;
    expect(term.long.endsWith(".")).toBe(true);
    const n = sentences(term.long);
    expect(n, term.long).toBeGreaterThanOrEqual(2);
    expect(n, term.long).toBeLessThanOrEqual(3);
  });

  it("uses no exclamation marks, emoji or developer notes", () => {
    for (const [, term] of entries) {
      const text = textOf(term);
      expect(text, term.id).not.toMatch(/!/);
      expect(text, term.id).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(text, term.id).not.toMatch(/\b(?:TODO|FIXME|mock|placeholder)\b/i);
    }
  });

  it("is written in US English (small list)", () => {
    for (const [, term] of entries) {
      const text = textOf(term);
      for (const word of BRITISH) expect(text, `${term.id} uses "${word}"`).not.toMatch(wordRe(word));
    }
  });

  it.skipIf(!usEnglish)("is written in US English (scripts/us-english.mjs families)", () => {
    const hits = entries.flatMap(([id, term]) => (usEnglish?.findSpellingHits(textOf(term)) ?? []).map((h) => `${id}: "${h.match}" -> "${h.us}"`));
    expect(hits).toEqual([]);
  });

  it("uses no sport vocabulary", () => {
    for (const [, term] of entries) {
      const text = textOf(term);
      for (const word of FOOTBALL) expect(text, `${term.id} uses "${word}"`).not.toMatch(wordRe(word));
    }
  });

  it("never uses a replace-tier term in a definition", () => {
    for (const [, term] of entries) {
      const text = textOf(term);
      for (const phrase of PLAIN_LANGUAGE_TIERS.replace) {
        const flags = /^[A-Z]{2,}$/.test(phrase) ? "" : "i";
        expect(text, `${term.id} uses "${phrase}"`).not.toMatch(wordRe(phrase, flags));
      }
    }
  });

  it("every learn slug names a department tab, a Settings tab or a top-level page", () => {
    for (const [, term] of entries) {
      if (term.learn === undefined) continue;
      expect(term.learn, term.id).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/);
      const [first, second] = term.learn.split("/");
      if (!second) expect(TOP_LEVEL, `${term.id}: ${term.learn}`).toContain(first);
      else if (first === "settings") expect(SETTINGS_TABS, `${term.id}: ${term.learn}`).toContain(second);
      else {
        expect(MODULE_KEYS as readonly string[], `${term.id}: ${term.learn}`).toContain(first);
        expect(isKnownDepartmentLearn(term.learn), `${term.id}: ${term.learn}`).toBe(true);
      }
    }
    // The display-vocabulary slugs, never the old identifiers (CLAUDE.md: new identifiers follow the table).
    for (const old of Object.values(LEARN_SLUG_ALIASES)) for (const [, term] of entries) expect(term.learn, term.id).not.toBe(old);
  });

  it("a short with a number carries its unit or scale", () => {
    for (const [, term] of entries) {
      for (const m of term.short.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
        const after = term.short.slice(m.index + m[0].length, m.index + m[0].length + 12);
        const before = term.short.slice(Math.max(0, m.index - 10), m.index);
        const ok = /^\s*(?:months?|years?|hours?|%|and above|to \d|-year|red)/.test(after) || /(?:to|from|under|times|under \d|above)\s*$/.test(before) || /\$$/.test(before);
        expect(ok, `${term.id}: "${m[0]}" in "${term.short}"`).toBe(true);
      }
    }
  });
});

describe("termsWithGlossary", () => {
  it('renames "customer" to "client" in word, short and long, and leaves other entries untouched', () => {
    const terms = termsWithGlossary({ customer: "client" });
    expect(terms.acquisition_cost?.word).toBe("Cost to win a client");
    expect(terms.acquisition_cost?.short).toBe("What you spend on marketing and sales, divided by the clients it brought in.");
    expect(terms.acquisition_cost?.long).toContain("win 10 clients");
    expect(terms.customer_update?.word).toBe("Client Update");
    expect(terms.churn?.short).toBe("Clients who leave, as a share of the clients you had at the start of the month.");
    expect(terms.runway).toEqual(TERMS.runway);
    expect(terms.cycle).toEqual(TERMS.cycle);
    // Ids and learn targets are never rewritten, even when a glossary names them.
    const renamed = termsWithGlossary({ customer: "client", runway: "cash months", finance: "money" });
    expect(renamed.runway?.id).toBe("runway");
    expect(renamed.runway?.learn).toBe("finance/runway");
    expect(renamed.runway?.word).toBe("Cash months");
    expect(Object.keys(renamed)).toEqual(TERM_IDS);
  });

  it("gives back equal entries for an empty, null or undefined glossary", () => {
    const glossaries: (Glossary | null | undefined)[] = [null, undefined, {}, { currency: "GBP" }];
    for (const glossary of glossaries) {
      const terms = termsWithGlossary(glossary);
      expect(Object.keys(terms)).toEqual(TERM_IDS);
      for (const [id, term] of entries) expect(terms[id]).toEqual(term);
    }
  });
});

describe("PLAIN_LANGUAGE_TIERS", () => {
  it("lists the replace tier of Appendix E and defines every TERMS word", () => {
    expect(PLAIN_LANGUAGE_TIERS.replace).toEqual([
      "ICP", "CPA", "CAC", "COGS", "RLS", "Cedar", "named query", "exhibit", "request_human_action", "concurrency", "time box",
      "counterparty", "webhook", "OAuth", "BYOK", "unit economics", "hunk", "triage",
    ]);
    expect(PLAIN_LANGUAGE_TIERS.define).toEqual(entries.map(([, t]) => t.word));
    const replace = new Set(PLAIN_LANGUAGE_TIERS.replace.map((w) => w.toLowerCase()));
    for (const w of PLAIN_LANGUAGE_TIERS.define) expect(replace.has(w.toLowerCase()), w).toBe(false);
  });
});

describe("learnPath", () => {
  it("resolves department tabs (through the display-vocabulary aliases), Settings tabs, top-level pages and URLs", () => {
    expect(learnPath("finance/runway", "b1")).toBe("/b/b1/d/finance/runway");
    expect(learnPath("team/agents", "b1")).toBe("/b/b1/d/team/squad");
    expect(learnPath("distribution/board", "b1")).toBe("/b/b1/d/distribution/formation");
    expect(learnPath("development/live-sessions", "b1")).toBe("/b/b1/d/development/training-ground");
    expect(learnPath("finance/payroll", "b1")).toBe("/b/b1/d/finance/wage-bill");
    expect(learnPath("settings/mode", "b1")).toBe("/b/b1/settings/mode");
    expect(learnPath("inbox", "b1")).toBe("/b/b1/inbox");
    expect(learnPath("https://example.com/help", "b1")).toBe("https://example.com/help");
    expect(isKnownDepartmentLearn("team/agents")).toBe(true);
    expect(isKnownDepartmentLearn("team/nowhere")).toBe(false);
    expect(isKnownDepartmentLearn("inbox")).toBe(false);
  });
});
