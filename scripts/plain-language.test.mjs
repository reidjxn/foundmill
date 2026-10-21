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
  DEVELOPER_DOC,
  LEAK_TERMS,
  PLAIN_CODE_ROOTS,
  buildTerms,
  isAcronym,
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

function scan(name, source, scanner = scanCode) {
  const hits = [];
  const silenced = [];
  scanner(write(name, source), TERMS, hits, silenced);
  return { hits, silenced };
}

const words = ({ hits }) => hits.map((h) => h.term).sort();
const hitsOf = (name, source, scanner) => words(scan(name, source, scanner));

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
    assert.deepEqual(
      [...tiers.define],
      Object.values(terms).map((t) => t.word),
    );
    assert.ok(tiers.define.includes("Runway"));
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

describe("report", () => {
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
