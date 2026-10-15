// Run: node --test scripts/banned-terms.test.mjs
// Fixtures are written to a temp directory (never into the repo) and scanned through the exported functions.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  findTermHits,
  looksLikeClassList,
  looksLikeIdentifier,
  scanCedarFile,
  scanCodeFile,
  scanProseFile,
  scanSvgFile,
} from "./banned-terms.mjs";

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "banned-terms-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function scanCode(name, source) {
  const p = join(dir, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, source);
  const hits = [];
  scanCodeFile(p, hits);
  return hits;
}

function scanProse(name, source) {
  const p = join(dir, name);
  writeFileSync(p, source);
  const hits = [];
  scanProseFile(p, hits);
  return hits;
}

const terms = (hits) => hits.map((h) => h.term).sort();

describe("term list", () => {
  it("matches every spelling in the CLAUDE.md table", () => {
    const text =
      "Match Day, matchday, match-day; kick-off and kickoff; the team sheet; full time at last; player of the match; " +
      "goal moment; half-time; on the pitch; a trophy, two trophies; the league table; an injured agent, injury; " +
      "kit colours, kit mode, the kit bar; this season.";
    const found = new Set(findTermHits(text).map((h) => h.term));
    assert.deepEqual([...found].sort(), [
      "Match Day",
      "full time",
      "goal moment",
      "half-time",
      "injured / injury",
      "kick-off",
      "kit colours / kit mode / kit bar",
      "league table",
      "pitch (the board)",
      "player of the match",
      "season",
      "team sheet",
      "trophy",
    ]);
    assert.equal(findTermHits("Match Day, matchday, match-day").length, 3);
  });

  it("allows the employment sense of full-time", () => {
    for (const ok of [
      "a full-time employee",
      "two full time hires",
      "part-time or full-time",
      "she went full-time on it",
      "working full time",
    ]) {
      assert.deepEqual(findTermHits(ok), [], ok);
    }
    assert.equal(findTermHits("The replay ends at full time.").length, 1);
  });

  it("allows business pitches but not the board", () => {
    for (const ok of [
      "an elevator pitch",
      "the pitch deck",
      "the pitch to investors",
      "a sales pitch that lands",
      "The pitch holds.",
    ]) {
      assert.deepEqual(findTermHits(ok), [], ok);
    }
    for (const bad of [
      "agents on the pitch",
      "drag a token across the pitch",
      "the pitch markings",
    ]) {
      assert.equal(findTermHits(bad).length, 1, bad);
    }
  });

  it("allows seasonality and business seasons, bans the football season", () => {
    for (const ok of [
      "seasonality in demand",
      "seasonal stock",
      "the holiday season",
      "tax season",
      "peak-season pricing",
    ]) {
      assert.deepEqual(findTermHits(ok), [], ok);
    }
    assert.equal(findTermHits("Season 2 starts").length, 1);
    assert.equal(findTermHits("A quiet pre-season").length, 1);
  });

  it("allows personal injury (legal) and flags injured agents", () => {
    assert.deepEqual(findTermHits("personal injury claims"), []);
    assert.equal(findTermHits("The agent is injured").length, 1);
  });
});

describe("identifier heuristics", () => {
  it("treats tokens as identifiers and labels as copy", () => {
    for (const id of [
      "matchday_level",
      "match-day",
      "matchDay",
      "MatchdayStage",
      "/b/x/trophies",
      "--kit-primary",
      "injured",
      "TROPHIES",
      "[data-stage-panel=goal]",
    ]) {
      assert.equal(looksLikeIdentifier(id), true, id);
    }
    for (const copy of ["Injured", "Trophies", "Match day", "On the pitch"]) {
      assert.equal(looksLikeIdentifier(copy), false, copy);
    }
  });

  it("recognises utility class lists", () => {
    assert.equal(looksLikeClassList("flex items-center gap-2 kit-bar"), true);
    assert.equal(looksLikeClassList("kit-bar height is fixed"), false);
    assert.equal(looksLikeClassList("Season one"), false);
  });
});

describe("code files", () => {
  it("reports JSX text, user-facing attributes, labels and template phrases with the right line", () => {
    const hits = scanCode(
      "a/Widget.tsx",
      [
        'import { x } from "./match-day";',
        "export function W({ n }: { n: number }) {",
        "  return (",
        '    <div className="kit-bar flex" data-testid="matchday-stage" id="trophies">',
        "      <span>Injured</span>",
        '      <input placeholder="injured" aria-label="Kit bar preview" />',
        "      {`${n} trophies won`}",
        "      {`/b/${n}/trophies`}",
        "    </div>",
        "  );",
        "}",
        'export const LABELS = { matchday: "Match day", status: "injured", label: "Season", className: "kit-bar" } as const;',
        'export type Level = "friendly" | "league" | "cup";',
        'export const p = { title: "Full time", description: "40 hours a week or more." };',
        'export function f(s: string) { return s === "injured" ? "ok" : cn("trophy-cabinet", s); }',
      ].join("\n"),
    );
    assert.deepEqual(hits.map((h) => `${h.line}:${h.term}`).sort(), [
      "12:Match Day",
      "12:season",
      "5:injured / injury",
      "6:injured / injury",
      "6:kit colours / kit mode / kit bar",
      "7:trophy",
    ]);
  });

  it("reads Storybook titles as words and honours vocab-allow", () => {
    const hits = scanCode(
      "b/Thing.stories.tsx",
      [
        'const meta = { title: "Shell/KitBar", component: null };',
        "export default meta;",
        "// vocab-allow: the glossary entry names the old word on purpose",
        'export const Glossary = { args: { text: "Match Day is now called Customer Update" } };',
        'export const Plain = { args: { text: "Match Day replay" } };',
      ].join("\n"),
    );
    assert.deepEqual(
      hits.map((h) => `${h.line}:${h.term}`),
      ["1:kit colours / kit mode / kit bar", "5:Match Day"],
    );
  });

  it("skips logger arguments, enum members, object keys and element access", () => {
    const hits = scanCode(
      "c/internal.ts",
      [
        'console.warn("Match Day fixture missing");',
        'log.info({ id }, "injured agent seen");',
        'enum Stage { KickOff = "kick off" }',
        'const m = { "match day": 1 }; const v = m["match day"];',
        'const label = "Kick-off";',
      ].join("\n"),
    );
    assert.deepEqual(
      hits.map((h) => `${h.line}:${h.term}`),
      ["5:kick-off"],
    );
  });
});

describe("prose files", () => {
  it("skips fenced code, inline code and link targets, keeps sentences", () => {
    const hits = scanProse(
      "DOC.md",
      [
        "# Design",
        "Gold is reserved for Match Day and trophies.",
        "Tokens: `--kit-primary`, `matchday_level` and `/trophies`.",
        "```ts",
        "const x = 'Match Day';",
        "```",
        "See [milestones](/trophies).",
        "<!-- vocab-allow --> Season was the old name for a chapter.",
        "The holiday season spikes demand; seasonality matters.",
      ].join("\n"),
    );
    assert.deepEqual(terms(hits), ["Match Day", "trophy"]);
    assert.equal(hits[0].line, 2);
  });
});

describe("formation (the Channel Board and the Task graph, not the football word)", () => {
  const formation = "formation (use Channel Board / Task graph)";
  it("catches the bare word in a first-cycle task goal, a Board decision and a button label", () => {
    assert.deepEqual(terms(findTermHits("propose the starting formation with cost-per-customer ranges")), [formation]);
    assert.deepEqual(terms(findTermHits("Distribution has a formation ready; Development is planning.")), [formation]);
    assert.deepEqual(terms(findTermHits("Open Formation")), [formation]);
    assert.deepEqual(terms(findTermHits("the Formation Board")), [formation]);
  });

  it("leaves company formation alone", () => {
    for (const ok of [
      "Company formation costs",
      "formation and annual costs for a Ltd",
      "limited-company formation",
      "the formation cost is paid once",
      "LLC formation in Delaware",
      "FORMATIONS LTD",
    ]) {
      assert.deepEqual(findTermHits(ok), [], ok);
    }
  });

  it("is found in an archetype-style task literal", () => {
    const hits = scanCode("archetype.ts", 'export const goal = "Score every channel and propose the starting formation.";');
    assert.deepEqual(terms(hits), [formation]);
  });
});

describe("product name", () => {
  it("flags a literal product name in user-facing copy; APP_NAME interpolation passes", () => {
    const bad = scanCode("copy.tsx", 'export const A = () => <p>Public profiles appear here labeled "On Foundmill".</p>;');
    assert.deepEqual(terms(bad), ["product name (use APP_NAME from @foundmill/config)"]);
    const ok = scanCode("copy-ok.tsx", 'import { APP_NAME } from "@foundmill/config";\nexport const A = () => <p>Labeled "On {APP_NAME}".</p>;');
    assert.deepEqual(ok, []);
  });
});

describe("svg and cedar files", () => {
  it("reads the text of an SVG (the Open Graph card), not its markup", () => {
    const p = join(dir, "card.svg");
    writeFileSync(p, '<svg aria-label="Foundmill"><title>Foundmill</title><text x="1">Build a real business with a squad of AI agents.</text><path d="M0 0 squad"/></svg>');
    const hits = [];
    scanSvgFile(p, hits);
    assert.deepEqual(terms(hits), ["squad (use team)"]);
    writeFileSync(p, "<svg><text>Build a real business with a team of AI agents.</text></svg>");
    const clean = [];
    scanSvgFile(p, clean);
    assert.deepEqual(clean, []);
  });

  it("reads a Cedar @reason (it is the deny reason an agent and the founder see)", () => {
    const p = join(dir, "30-offline.cedar");
    writeFileSync(p, '@id("offline")\n@reason("This channel runs in kit mode: the founder books and signs.")\nforbid (principal, action, resource);\n');
    const hits = [];
    scanCedarFile(p, hits);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
    writeFileSync(p, '@id("offline")\n@reason("This channel runs in offline tracking: the founder books and signs.")\nforbid (principal, action, resource);\n');
    const clean = [];
    scanCedarFile(p, clean);
    assert.deepEqual(clean, []);
  });
});
