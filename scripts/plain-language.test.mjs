// Run: node --test scripts/plain-language.test.mjs
// Fixtures are written to a temp directory (never into the repo) and scanned through the exported functions. Most tests
// use a fixed tier list so a later edit of packages/shared/src/terms.ts cannot break them; the first suite checks that
// the real list is read from that file.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import {
  ARIA_KEYS,
  DEVELOPER_DOC,
  LABEL_WORDS,
  LEAK_TERMS,
  PLAIN_CODE_ROOTS,
  TECHNICAL_KEY,
  addressSpans,
  buildTerms,
  definitionSlotTexts,
  isAcronym,
  isCaseSensitive,
  loadTiers,
  longestOnly,
  plainScan,
  scanCedar,
  scanCode,
  scanProse,
  scanSvg,
  termRegex,
  tierCounts,
  writeSweep,
} from "./plain-language.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "plain-language.mjs");

const FIXTURE = {
  tiers: {
    replace: [
      "ICP",
      "CAC",
      "named query",
      "request_human_action",
      "exhibit",
      "triage",
      "unit economics",
    ],
    define: [
      "Runway",
      "Runway horizon",
      "Model",
      "Session",
      "Branch",
      "Policy",
      "Form",
      "Lead",
      "Health",
      "Pull request",
      "SAFE",
      "Merge",
    ],
  },
  terms: {
    runway: { id: "runway", word: "Runway", short: "Months of cash left at today's spending." },
    runway_horizon: {
      id: "runway_horizon",
      word: "Runway horizon",
      short: "How far ahead runway is projected.",
    },
    model: { id: "model", word: "Model", short: "The AI an agent runs on." },
    pull_request: {
      id: "pull_request",
      word: "Pull request",
      short: "A finished change waiting for a check.",
    },
    safe: { id: "safe", word: "SAFE", short: "An agreement that turns into shares later." },
  },
};
const TERMS = buildTerms(FIXTURE);

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "plain-language-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name, source) {
  const p = join(dir, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, source);
  return p;
}

function scan(name, source, scanner = scanCode, terms = TERMS) {
  const hits = [];
  const silenced = [];
  scanner(write(name, source), terms, hits, silenced);
  return { hits, silenced };
}

const words = ({ hits }) => hits.map((h) => h.term).sort();
const hitsOf = (name, source, scanner) => words(scan(name, source, scanner));

/** The define words with their own allowances and the two provenance labels; a second list so the first suites keep their counts. */
const MORE = buildTerms({
  tiers: {
    replace: ["webhook", "triage"],
    define: [
      "Runway",
      "Estimate",
      "Forecast",
      "Fit",
      "Potential",
      "Credits",
      "Tokens",
      "Cycle",
      "Proposal",
      "Conversion",
      "Acceptance",
      "Pull request",
    ],
    plain: ["Revenue", "Lead"],
  },
  terms: {
    runway: { id: "runway", word: "Runway", short: "Months of cash left at today's spending." },
    estimate: { id: "estimate", word: "Estimate", short: "Worked out, not measured." },
    cycle: { id: "cycle", word: "Cycle", short: "One round of work." },
    revenue: { id: "revenue", word: "Revenue", short: "Money customers paid you." },
  },
});
const moreHits = (name, source, scanner = scanCode) => words(scan(name, source, scanner, MORE));

describe("tiers come from packages/shared/src/terms.ts", () => {
  it("reads PLAIN_LANGUAGE_TIERS and TERMS by transpiling the source", () => {
    const { tiers, terms } = loadTiers();
    for (const w of [
      "ICP",
      "CPA",
      "CAC",
      "COGS",
      "RLS",
      "Cedar",
      "named query",
      "exhibit",
      "request_human_action",
      "triage",
    ])
      assert.ok(tiers.replace.includes(w), w);
    // Every TERMS word is in exactly one of define (linted) and plain (not linted).
    const words = Object.values(terms).map((t) => t.word);
    assert.deepEqual([...tiers.define, ...tiers.plain].sort(), [...words].sort());
    for (const w of tiers.define) assert.ok(!tiers.plain.includes(w), w);
    for (const w of ["Runway", "MRR", "Pull request", "Cycle", "Estimate", "Chief of Staff"])
      assert.ok(tiers.define.includes(w), w);
    for (const w of ["Revenue", "Lead", "Model", "Session", "Training", "Health", "Form"])
      assert.ok(tiers.plain.includes(w), w);
  });

  it("never matches a plain-tier word", () => {
    const built = buildTerms(loadTiers());
    for (const w of ["Revenue", "Lead", "Model", "Competition"])
      assert.ok(!built.some((t) => t.term === w), w);
  });

  it("builds one entry per tier word plus the leak tier", () => {
    const built = buildTerms(loadTiers());
    assert.ok(built.some((t) => t.term === "ICP" && t.tier === "replace"));
    assert.ok(
      built.some((t) => t.term === "Runway" && t.tier === "define" && t.ids.includes("runway")),
    );
    for (const leak of LEAK_TERMS) assert.ok(built.includes(leak), leak.term);
  });

  it("treats docs, agent instructions and READMEs as developer documents", () => {
    for (const f of [
      "docs/ARCHITECTURE.md",
      "docs/PLAIN_LANGUAGE_SWEEP.md",
      ".claude/agents/x.md",
      "README.md",
      "apps/web/CLAUDE.md",
    ])
      assert.ok(DEVELOPER_DOC.test(f), f);
    for (const f of ["apps/web/help/runway.md", "packages/agents/src/skills/guide.md"])
      assert.ok(!DEVELOPER_DOC.test(f), f);
  });

  it("scans the banned-terms roots plus the archetypes, templates and mock completions", () => {
    for (const r of [
      "apps/web",
      "packages/modules",
      "packages/agents/src/archetypes.ts",
      "packages/agents/src/templates",
      "packages/models/src/mock",
    ])
      assert.ok(PLAIN_CODE_ROOTS.includes(r), r);
  });
});

describe("matching", () => {
  it("matches whole words, plurals and possessives, case-insensitive", () => {
    assert.deepEqual(
      hitsOf(
        "a.tsx",
        `export const A = () => <p>Two runways, the runway's end, named queries and a named-query.</p>;`,
      ),
      ["Runway", "Runway", "named query", "named query"],
    );
    assert.deepEqual(
      hitsOf("b.tsx", `export const B = () => <p>Runwayless forms of a runwaytrack.</p>;`),
      [],
    );
  });

  it("keeps all-caps acronyms case-sensitive", () => {
    assert.equal(isAcronym("SAFE"), true);
    assert.equal(isAcronym("Runway"), false);
    assert.equal(termRegex("SAFE").test("a safe bet"), false);
    assert.equal(termRegex("SAFE").test("sign the SAFE"), true);
    assert.deepEqual(
      hitsOf("c.tsx", `export const C = () => <p>It is safe to pick an icp. Our ICPs differ.</p>;`),
      ["ICP"],
    );
  });

  it("keeps the longest of overlapping matches", () => {
    assert.deepEqual(hitsOf("d.tsx", `export const D = () => <p>Runway horizon moved.</p>;`), [
      "Runway horizon",
    ]);
    const kept = longestOnly([
      { start: 0, end: 6, term: "Runway" },
      { start: 0, end: 14, term: "Runway horizon" },
    ]);
    assert.deepEqual(
      kept.map((k) => k.term),
      ["Runway horizon"],
    );
  });

  it("prints file, line, term and tier", () => {
    const { hits } = scan(
      "e.tsx",
      `export const E = () => (\n  <p>\n    Know your ICP.\n  </p>\n);\n`,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 3);
    assert.equal(hits[0].term, "ICP");
    assert.equal(hits[0].tier, "replace");
    assert.match(hits[0].file, /e\.tsx$/);
  });
});

describe("replace tier", () => {
  it("fails on sight, whatever the file defines", () => {
    const src = `import { Term, Explainer } from "@foundmill/dugout";
export const S = () => (
  <>
    <Explainer screenId="x" purpose="p" action="a" watchFor="w" />
    <Term id="icp">ICP</Term>
    <Field hint="ICP: the one kind of customer we target first" />
    <p>Triage is sorting by urgency. Outbound to a narrow ICP. Unit economics hold.</p>
  </>
);`;
    assert.deepEqual(hitsOf("replace.tsx", src), ["ICP", "ICP", "ICP", "triage", "unit economics"]);
  });

  it("covers task titles, option labels and template descriptions", () => {
    const src = `export const ARCHETYPE = {
  firstBuild: { title: "Build the task graph with acceptance tests" },
  options: [{ id: "outbound", label: "Outbound to a narrow ICP" }],
  description: "Converts a reply into a Plan; hard gates become request_human_action.",
};`;
    assert.deepEqual(hitsOf("archetypes.ts", src), ["ICP", "request_human_action"]);
  });

  it("is silenced by plain-allow but reported apart (Gate 2 wants none)", () => {
    const { hits, silenced } = scan(
      "allowed.tsx",
      `// plain-allow: quoting the vendor\nexport const A = () => <p>The CAC column.</p>;`,
    );
    assert.deepEqual(hits, []);
    assert.deepEqual(
      silenced.map((h) => h.term),
      ["CAC"],
    );
  });
});

describe("define tier", () => {
  it("fails when the file does not define the word", () => {
    assert.deepEqual(
      hitsOf("bare.tsx", `export const B = () => <p>Runway: 7 months left.</p>;`),
      [],
    ); // a definition sentence
    assert.deepEqual(
      hitsOf("bare2.tsx", `export const B = () => <p>Your runway dropped to 7 months.</p>;`),
      ["Runway"],
    );
  });

  describe("(a) Term", () => {
    it("passes when the file wraps the word in <Term id=…>", () => {
      const src = `export const A = () => (
  <>
    <p><Term id="runway" /> is low.</p>
    <p>Your runway dropped.</p>
  </>
);`;
      assert.deepEqual(hitsOf("term-id.tsx", src), []);
    });

    it("passes when the word is the Term's children, whatever the id", () => {
      const src = `export const A = () => <><Term id="cash_left">runway</Term><p>Your runway dropped.</p></>;`;
      assert.deepEqual(hitsOf("term-children.tsx", src), []);
    });

    it("passes for useTerm( and Term( with the id", () => {
      assert.deepEqual(
        hitsOf(
          "use-term.tsx",
          `const d = useTerm("pull_request");\nexport const A = () => <p>Open pull requests</p>;`,
        ),
        [],
      );
      assert.deepEqual(
        hitsOf(
          "term-call.ts",
          `const node = Term("model");\nexport const LABEL = "Pick a model for this agent";`,
        ),
        [],
      );
    });

    it("passes for a dynamic id when the file holds the id as a string", () => {
      const src = `const ROWS = [{ term: "runway", label: "Runway left" }];
export const A = () => <>{ROWS.map((r) => <Term key={r.term} id={r.term}>{r.label}</Term>)}</>;`;
      assert.deepEqual(hitsOf("term-dynamic.tsx", src), []);
    });

    it("does not pass on the id as an unrelated string without a dynamic Term", () => {
      const src = `const KEYS = ["runway"];
export const A = () => <><Term id="model">Model</Term><p>Your runway dropped.</p></>;`;
      assert.deepEqual(hitsOf("term-unrelated.tsx", src), ["Runway"]);
    });

    it("needs the Term in the same file", () => {
      write("other.tsx", `export const O = () => <Term id="runway" />;`);
      assert.deepEqual(
        hitsOf("same-file.tsx", `export const A = () => <p>Your runway dropped.</p>;`),
        ["Runway"],
      );
    });
  });

  describe("(b) a definition prop or a definition string", () => {
    for (const prop of ["hint", "definition", "tooltip", "help", "caption", "footer", "plain"]) {
      it(`passes when the word sits in a ${prop} prop`, () => {
        const src = `export const A = () => <><Stat label="Months" ${prop}="Runway, the months of cash left" /><p>Your runway dropped.</p></>;`;
        assert.deepEqual(hitsOf(`prop-${prop}.tsx`, src), []);
      });
      it(`passes when the word sits under a ${prop} key`, () => {
        const src = `export const TILE = { label: "Months", ${prop}: "Runway, the months of cash left" };\nexport const A = () => <p>Your runway dropped.</p>;`;
        assert.deepEqual(hitsOf(`key-${prop}.tsx`, src), []);
      });
    }

    it("passes inside an InfoTip or a DefinitionCard", () => {
      assert.deepEqual(
        hitsOf(
          "infotip.tsx",
          `export const A = () => <><InfoTip>Runway counts months of cash.</InfoTip><p>Your runway dropped.</p></>;`,
        ),
        [],
      );
      assert.deepEqual(
        hitsOf(
          "defcard.tsx",
          `export const A = () => <><DefinitionCard word="Model" short="The AI an agent runs on" /><p>Pick a model.</p></>;`,
        ),
        [],
      );
    });

    it("passes when any string in the file defines the word with a colon, is, are or means", () => {
      for (const def of [
        "Runway: months of cash left.",
        "Runway is the months of cash left.",
        "Runway means months of cash left.",
      ]) {
        const src = `export const NOTE = ${JSON.stringify(def)};\nexport const A = () => <p>Your runway dropped.</p>;`;
        assert.deepEqual(hitsOf("def-sentence.tsx", src), [], def);
      }
    });

    it("does not read a label or a title as a definition", () => {
      const src = `export const A = () => <Stat label="Runway" title="Runway left" />;`;
      assert.deepEqual(hitsOf("label.tsx", src), ["Runway", "Runway"]);
    });

    it("reads an explainer's purpose / action / watchFor only in a file that names a screenId", () => {
      const content = `export const FINANCE_EXPLAINER = { screenId: "finance", purpose: "Runway is the months of cash left.", action: "Read the chart.", watchFor: "A falling line." };
export const A = () => <p>Your runway dropped.</p>;`;
      assert.deepEqual(hitsOf("explainer-content.ts", content), []);
      const generic = `export const STEP = { purpose: "Merge the pull request when the checks pass" };
export const A = () => <p>Review the pull request.</p>;`;
      assert.deepEqual(hitsOf("generic-action.tsx", generic), [
        "Merge",
        "Pull request",
        "Pull request",
      ]);
    });
  });

  describe("(c) plain-allow", () => {
    it("passes on the same line and on the line above, nowhere else", () => {
      assert.deepEqual(
        hitsOf(
          "allow-same.tsx",
          `export const A = () => <p>Your runway dropped.</p>; // plain-allow`,
        ),
        [],
      );
      assert.deepEqual(
        hitsOf(
          "allow-above.tsx",
          `// plain-allow: the chip names it\nexport const A = () => <p>Your runway dropped.</p>;`,
        ),
        [],
      );
      assert.deepEqual(
        hitsOf(
          "allow-far.tsx",
          `// plain-allow\n\nexport const A = () => <p>Your runway dropped.</p>;`,
        ),
        ["Runway"],
      );
    });
  });

  describe("(d) Explainer", () => {
    it("passes every define-tier word in a file that mounts an Explainer", () => {
      const src = `export const S = () => (
  <>
    <Explainer {...FINANCE_EXPLAINER} />
    <p>Your runway dropped; the model is busy; open the pull request.</p>
  </>
);`;
      assert.deepEqual(hitsOf("explainer.tsx", src), []);
    });
  });
});

describe("allowances for false friends", () => {
  const cases = [
    ["business model", "Model", "Pick a business model that sells."],
    ["revenue model", "Model", "A subscription revenue model."],
    ["Live sessions", "Session", "Open Live sessions to watch."],
    ["sign-in session", "Session", "Your sign-in session expired."],
    ["session expired", "Session", "The session expired; sign in again."],
    ["bank branch", "Branch", "Visit a bank branch with the letter."],
    ["merging CRM records", "Merge", "Merge duplicate contacts into one."],
    ["insurance policy", "Policy", "Upload the insurance policy."],
    ["privacy policy", "Policy", "Link the privacy policy."],
    ["web form", "Form", "The signup form collects emails."],
    ["form field", "Form", "Every form field is required."],
    ["lead as a verb", "Lead", "This leads to fewer refunds."],
    ["lead the team", "Lead", "Who will lead the team?"],
    ["department lead", "Lead", "The product lead reviews it."],
    ["a person's health", "Health", "Look after your health."],
    ["health insurance", "Health", "Add health insurance to payroll."],
    ["model as a verb", "Model", "We model the cash for twelve months."],
  ];
  for (const [name, term, text] of cases) {
    it(`does not read "${name}" as ${term}`, () => {
      const hits = scan(
        `allow-${name.replace(/\W+/g, "-")}.tsx`,
        `export const A = () => <p>${text}</p>;`,
      ).hits;
      assert.deepEqual(
        hits.filter((h) => h.term === term),
        [],
        text,
      );
    });
  }

  it("still reads the product sense", () => {
    const src = `export const A = () => <p>Pick a model. One session ran. Push the branch. Change the policy. Check the agent's health. Add a lead.</p>;`;
    assert.deepEqual(hitsOf("product-sense.tsx", src), [
      "Branch",
      "Health",
      "Lead",
      "Model",
      "Policy",
      "Session",
    ]);
  });

  it("drops a health hit in a string about a person's wellbeing", () => {
    assert.deepEqual(
      hitsOf(
        "skincare.tsx",
        `export const A = () => <p>Skincare that supports skin barrier health and hydration with a serum.</p>;`,
      ),
      [],
    );
  });
});

describe("leak tier", () => {
  it("fails on developer notes inside user-facing strings", () => {
    const src = `export const CITATIONS = [{ title: "Mock citation — replace with Research agent output in live mode." }];
export const NOTE = "See note.";
export const A = () => <p>TODO: real copy</p>;
export const B = () => <p>Pricing FIXME</p>;`;
    const { hits } = scan("leaks.tsx", src);
    assert.deepEqual(hits.map((h) => h.term).sort(), [
      "FIXME",
      "Mock citation",
      "See note.",
      "TODO",
      "replace with",
    ]);
    assert.ok(hits.every((h) => h.tier === "leak"));
  });

  it("ignores comments, logger arguments and code shown as content", () => {
    const src = `// TODO: wire the real copy
/* FIXME later */
logger.warn("TODO: not yet");
export const DIFF = ["-  return <div>TODO</div>;", "a TODO-only stub"];
export const A = () => <p>Ready.</p>;`;
    assert.deepEqual(hitsOf("not-leaks.tsx", src), []);
  });
});

describe("classification reuse (identifiers are never hits)", () => {
  it("skips keys, enum members, literal types, comparisons, class lists, data-* and ids, imports, loggers", () => {
    const src = `import runway from "./runway";
import type { Session } from "./session";
type Kind = "session" | "branch";
enum E { Model = "model" }
const OBJ = { runway: 1, session: 2, ["policy"]: 3 };
const ok = kind === "session";
console.log("runway is low", OBJ);
export const A = () => <div className="runway session" data-term="runway" id="model" aria-controls="branch-panel">{OBJ.runway}</div>;
export const ROUTE = \`/b/\${id}/session\`;`;
    assert.deepEqual(hitsOf("identifiers.tsx", src), []);
  });

  it("reads JSX text, prose attributes and copy-shaped strings", () => {
    const src = `export const A = () => (
  <section aria-label="Session log" title="Branch list">
    Your runway
    {"The model ran"}
    <Button label={\`Open \${n} pull requests\`} />
  </section>
);`;
    assert.deepEqual(hitsOf("copy.tsx", src), [
      "Branch",
      "Model",
      "Pull request",
      "Runway",
      "Session",
    ]);
  });
});

describe("files", () => {
  it("reads SVG text and Cedar reasons", () => {
    assert.deepEqual(
      hitsOf(
        "card.svg",
        `<svg><title>Runway card</title><text x="1">Know your ICP</text></svg>`,
        scanSvg,
      ),
      ["ICP", "Runway"],
    );
    assert.deepEqual(
      hitsOf(
        "p.cedar",
        `@reason("Blocked by the CAC cap")\nforbid (principal, action, resource);\n// runway`,
        scanCedar,
      ),
      ["CAC"],
    );
  });

  it("reads product Markdown as prose without code spans or fences", () => {
    const md = "# Help\n\nYour runway dropped.\n\n`ICP` in code\n\n```\nICP in a fence\n```\n";
    assert.deepEqual(hitsOf("help/runway.md", md, scanProse), ["Runway"]);
  });

  it("skips stories, tests and developer documents, and never stops on a file it cannot parse", () => {
    const root = join(dir, "tree");
    const put = (name, source) => {
      const p = join(root, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, source);
    };
    put("src/Screen.tsx", `export const S = () => <p>Know your ICP.</p>;`);
    put(
      "src/Screen.stories.tsx",
      `export default { title: "ICP" }; export const S = () => <p>ICP</p>;`,
    );
    put("src/Screen.test.tsx", `it("ICP", () => {});`);
    put("src/__tests__/x.tsx", `export const X = () => <p>ICP</p>;`);
    put("docs/ARCHITECTURE.md", "RLS and Cedar guard every ICP.");
    put("README.md", "ICP.");
    put("src/broken.tsx", `export const = <<< "ICP" {{{`);
    put("src/binary.ts", "\u0000\u0001\u0002ICP�");
    const result = plainScan([root], { terms: TERMS });
    assert.deepEqual(result.errors, []);
    assert.equal(result.developerDocs, 2);
    const files = [...new Set(result.hits.map((h) => h.file.split("/").pop()))].sort();
    assert.ok(files.includes("Screen.tsx"));
    for (const f of [
      "Screen.stories.tsx",
      "Screen.test.tsx",
      "x.tsx",
      "ARCHITECTURE.md",
      "README.md",
    ])
      assert.ok(!files.includes(f), f);
  });
});

describe("the plain tier", () => {
  it("is never matched, while the define words still are", () => {
    assert.deepEqual(
      moreHits(
        "plain.tsx",
        `export const A = () => <p>Revenue grew; a new lead came in. Your runway dropped.</p>;`,
      ),
      ["Runway"],
    );
  });
});

describe("provenance labels (Estimate, Forecast)", () => {
  it("matches the capitalized label only", () => {
    assert.equal(isCaseSensitive("Estimate"), true);
    assert.equal(isCaseSensitive("Forecast"), true);
    assert.equal(isCaseSensitive("Runway"), false);
    assert.ok(LABEL_WORDS.has("estimate"));
    assert.deepEqual(
      moreHits(
        "labels.tsx",
        `export const A = () => <><p>$4,700 · Estimate</p><p>Base case (Forecast)</p><p>Cost is an estimate from usage; see the cash forecast.</p></>;`,
      ),
      ["Estimate", "Forecast"],
    );
  });

  it("is defined by its Term like any define word", () => {
    assert.deepEqual(
      moreHits(
        "label-term.tsx",
        `export const A = () => <><Term id="estimate" /><p>$40 (Estimate)</p></>;`,
      ),
      [],
    );
  });
});

describe("definition slots written as JSX and explainer actions", () => {
  it("reads a footer, caption or hint whose value is JSX", () => {
    const src = `export const A = () => (
  <>
    <Panel title="Cash" footer={<span>Runway, the months of cash left at today's spending.</span>} />
    <p>Your runway dropped.</p>
  </>
);`;
    assert.deepEqual(hitsOf("footer-jsx.tsx", src), []);
    assert.deepEqual(
      hitsOf(
        "hint-template.tsx",
        "export const A = () => <><Field hint={`Runway ${n}: months of cash left`} /><p>Your runway dropped.</p></>;",
      ),
      [],
    );
  });

  it("does not read identifiers or other attributes inside the slot as a definition", () => {
    const src = `export const A = () => (
  <>
    <Panel footer={<span className="runway">{formatRunway(runway)}</span>} />
    <p>Your runway dropped.</p>
  </>
);`;
    assert.deepEqual(hitsOf("footer-identifiers.tsx", src), ["Runway"]);
  });

  it("reads an explainer's action, string or JSX, in a file that names a screenId", () => {
    const str = `export const EXPLAINER = { screenId: "finance", purpose: "Where the money goes.", action: "Check the runway, the months of cash left." };
export const A = () => <p>Your runway dropped.</p>;`;
    assert.deepEqual(hitsOf("explainer-action.tsx", str), []);
    const jsx = `export const EXPLAINER = { screenId: "dev", purpose: "The code.", action: (<>Review each pull request before it merges.</>) };
export const A = () => <p>Open pull requests</p>;`;
    assert.deepEqual(hitsOf("explainer-action-jsx.tsx", jsx), []);
    const plain = `export const STEP = { action: "Check the runway, the months of cash left." };
export const A = () => <p>Your runway dropped.</p>;`;
    assert.deepEqual(hitsOf("plain-action.tsx", plain), ["Runway"]);
    assert.ok(definitionSlotTexts !== undefined);
  });
});

describe("accessible names that repeat visible text", () => {
  it("drops an aria-label hit when the file shows the word as visible text", () => {
    const { hits } = scan(
      "aria-dup.tsx",
      `export const A = () => (\n  <section aria-label="Runway chart">\n    <h2>Runway</h2>\n  </section>\n);`,
    );
    // One hit, the visible heading on line 3; the aria-label on line 2 repeats it.
    assert.deepEqual(
      hits.map((h) => h.line),
      [3],
    );
    assert.ok(ARIA_KEYS.has("aria-label"));
  });

  it("keeps an aria-label hit when the word appears nowhere else", () => {
    assert.deepEqual(
      hitsOf(
        "aria-only.tsx",
        `export const A = () => <section aria-label="Runway chart"><Chart /></section>;`,
      ),
      ["Runway"],
    );
  });

  it("keeps a replace-tier word in an aria-label (it fails on sight)", () => {
    assert.deepEqual(
      hitsOf(
        "aria-replace.tsx",
        `export const A = () => <div aria-label="ICP list"><p>ICP</p></div>;`,
      ),
      ["ICP", "ICP"],
    );
  });
});

describe("addresses, test ids and data-* keys", () => {
  it("never reads a word inside a URL, a path, a file name, a query parameter or an anchor", () => {
    const spans = addressSpans(
      "Open /b/x/d/finance/runway or https://example.com/runway, see tokens.css, ?tab=pull-requests, #runway",
    );
    assert.equal(spans.length, 5);
    assert.deepEqual(
      moreHits(
        "addresses.ts",
        `export const LINES = ["$ pnpm vitest run src/triage/unity", "Open /d/finance/runway to see it", "Docs at https://docs.example.com/webhook-setup", "Edit tokens.css first", "Jump to #runway", "Load ?tab=pull-requests now"];`,
      ),
      [],
    );
  });

  it("still reads the word in the sentence beside the address", () => {
    assert.deepEqual(
      hitsOf(
        "slash-prose.ts",
        `export const R = "A GitHub personal/OAuth/user token, an ICP/persona/segment note";`,
      ),
      ["ICP"],
    );
    assert.deepEqual(
      moreHits(
        "address-sentence.ts",
        `export const LINE = "Your runway dropped; see /d/finance/overview, and triage happens later";`,
      ),
      ["Runway", "triage"],
    );
  });

  it("skips the value of a test id or a data-* key written as an object property", () => {
    assert.ok(TECHNICAL_KEY.test("data-testid"));
    assert.ok(TECHNICAL_KEY.test("testID"));
    assert.ok(!TECHNICAL_KEY.test("label"));
    const src = `export const PROPS = { "data-testid": "runway chart", "data-term": "pull request card", testID: "runway panel", label: "Cash" };
export const A = () => <div {...PROPS} data-section="runway panel">Cash</div>;`;
    assert.deepEqual(hitsOf("test-ids.tsx", src), []);
  });
});

describe("allowances for the define words that stay", () => {
  const cases = [
    ["fits as a verb", "Fit", "Which fits you best? The budget fits."],
    ["fit you", "Fit", "We will find a plan to fit you."],
    ["potential before a noun", "Potential", "Talk to potential customers and potential partners."],
    ["partial credit", "Credits", "Steps earn partial credit; the channel gets the credit."],
    ["tax credit", "Credits", "Claim the R&D tax credit and pay by credit card."],
    ["access token", "Tokens", "Paste an access token; use design tokens and tokens only."],
    ["billing cycle", "Cycle", "Your billing cycle and the sales cycle are both monthly."],
    ["sales proposal", "Proposal", "Send the sales proposal and the partnership proposal."],
    ["SAFE conversion", "Conversion", "The SAFE conversion and currency conversion fees."],
    [
      "acceptance of terms",
      "Acceptance",
      "Acceptance of the terms by the buyer, and payment acceptance.",
    ],
  ];
  for (const [name, term, text] of cases) {
    it(`does not read "${name}" as ${term}`, () => {
      const hits = scan(
        `more-${name.replace(/\W+/g, "-")}.tsx`,
        `export const A = () => <p>${text}</p>;`,
        scanCode,
        MORE,
      ).hits;
      assert.deepEqual(
        hits.filter((h) => h.term === term).map((h) => h.match),
        [],
        text,
      );
    });
  }

  it("still reads the product sense", () => {
    const src = `export const A = () => <p>The highest fits win. A fit of 16. Potential 4 of 5. Credits ran out. Tokens used: 12,000. The next cycle starts. Accept the proposal. Conversions this week. Acceptance criteria pass.</p>;`;
    assert.deepEqual(moreHits("more-product-sense.tsx", src), [
      "Acceptance",
      "Conversion",
      "Credits",
      "Cycle",
      "Fit",
      "Fit",
      "Potential",
      "Proposal",
      "Tokens",
    ]);
  });
});

describe("report", () => {
  it("lists the define and plain words in the sweep when the tiers are known", () => {
    const out = join(dir, "TIERS-SWEEP.md");
    writeSweep(
      out,
      {
        hits: [],
        silenced: [],
        errors: [],
        files: 0,
        terms: MORE,
        tiers: { replace: ["ICP"], define: ["Runway", "Cycle"], plain: ["Revenue", "Lead"] },
      },
      ["fixture"],
    );
    const md = readFileSync(out, "utf8");
    assert.match(md, /Define \(2\): Runway, Cycle\./);
    assert.match(md, /Plain \(2\): Revenue, Lead\./);
    assert.match(
      md,
      /Gate 2 counts the UI roots .*\*\*0 undefined define-tier hit\(s\)\*\*, under the 300/,
    );
    assert.match(md, /\*\*plain\*\* is not linted/);
  });

  it("counts by tier and writes the per-package sweep", () => {
    const { hits } = scan(
      "sweep.tsx",
      `export const A = () => <p>Know your ICP. Your runway dropped. TODO: copy</p>;`,
    );
    assert.deepEqual(tierCounts(hits), { replace: 1, define: 1, leak: 1 });
    const out = join(dir, "SWEEP.md");
    writeSweep(out, { hits, silenced: [], errors: [], files: 1, terms: TERMS }, ["fixture"]);
    const md = readFileSync(out, "utf8");
    assert.match(md, /^# Plain-language sweep/);
    assert.match(md, /## By package/);
    assert.match(md, /\| Package +\| Replace \| Define \| Leak \| Total \| Files \|/);
    assert.match(md, /3 hit\(s\) in 1 package\(s\): 1 replace, 1 define, 1 leak/);
  });

  it("exits 1 on hits with file:line:term:tier lines, 0 with --report, and writes --json and --sweep", () => {
    const root = join(dir, "cli");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "A.tsx"), `export const A = () => <p>Know your ICP.</p>;\n`);
    const json = join(dir, "hits.json");
    const sweep = join(dir, "cli-sweep.md");
    const run = spawnSync(process.execPath, [SCRIPT, root, "--json", json, "--sweep", sweep], {
      encoding: "utf8",
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /A\.tsx:1:ICP:replace: /);
    assert.ok(existsSync(sweep));
    const data = JSON.parse(readFileSync(json, "utf8"));
    assert.equal(data.hits[0].term, "ICP");
    const report = spawnSync(process.execPath, [SCRIPT, root, "--report", "--summary"], {
      encoding: "utf8",
    });
    assert.equal(report.status, 0, report.stderr);
    const clean = join(dir, "clean");
    mkdirSync(clean, { recursive: true });
    writeFileSync(
      join(clean, "B.tsx"),
      `export const B = () => <p>Nothing runs until you say go.</p>;\n`,
    );
    const green = spawnSync(process.execPath, [SCRIPT, clean], { encoding: "utf8" });
    assert.equal(green.status, 0, green.stdout + green.stderr);
  });

  it("is green on docs (developer documents are not product copy)", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "docs"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
});

it("model-facing allowances are reported apart and never count against Gate 2", async () => {
  const { gateSilenced } = await import("./plain-language.mjs");
  const silenced = [
    { file: "packages/agents/src/prompts/x.ts", line: 3, term: "hunk", tier: "replace", modelFacing: true },
    { file: "apps/web/components/x.tsx", line: 9, term: "CPA", tier: "replace" },
  ];
  assert.deepEqual(gateSilenced(silenced).map((h) => h.term), ["CPA"]);
});

it("--gate fails on a replace-tier word, a leak or a founder-facing plain-allow, and on too many UI define hits", async () => {
  const { gateVerdict } = await import("./plain-language.mjs");
  const ok = gateVerdict({ hits: [{ file: "packages/agents/src/x.ts", line: 1, term: "Runway", tier: "define" }], silenced: [], errors: [] });
  assert.equal(ok.ok, true);
  assert.equal(gateVerdict({ hits: [{ file: "apps/web/a.tsx", line: 1, term: "CPA", tier: "replace" }], silenced: [], errors: [] }).ok, false);
  assert.equal(gateVerdict({ hits: [{ file: "apps/web/a.tsx", line: 1, term: "TODO", tier: "leak" }], silenced: [], errors: [] }).ok, false);
  assert.equal(gateVerdict({ hits: [], silenced: [{ file: "apps/web/a.tsx", line: 1, term: "hunk" }], errors: [] }).ok, false);
  assert.equal(gateVerdict({ hits: [], silenced: [{ file: "packages/agents/src/prompts/a.ts", line: 1, term: "hunk", modelFacing: true }], errors: [] }).ok, true);
  const many = Array.from({ length: 301 }, (_, i) => ({ file: "apps/web/a.tsx", line: i + 1, term: "Runway", tier: "define" }));
  assert.equal(gateVerdict({ hits: many, silenced: [], errors: [] }).ok, false);
});
