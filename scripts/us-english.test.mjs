// Run: node --test scripts/us-english.test.mjs
// Fixtures are written to a temp directory (never into the repo) and scanned through the exported functions.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { findDateHits, findLocaleHits, findSpellingHits, fix, scanCodeFile, scanProseFile } from "./us-english.mjs";

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "us-english-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name, source) {
  const p = join(dir, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, source);
  return p;
}

const pairs = (hits) => hits.map((h) => `${h.match}->${h.us}`);

describe("spelling list", () => {
  it("finds each British family and gives the US form in the same case", () => {
    const text =
      "Colour, COLOURS, behaviour, favourite, honourable, neighbourhood; organise, Organisation, realised, recognising, " +
      "summarisation, prioritise, analyse, analysed; centre, centred, metres, theatre, fibre; catalogue, Catalogued, analogue; " +
      "labelled, Cancelled, travelling, modelling, counsellor, jewellery, enrol, enrolment, fulfil, fulfilment, skilful, instalment; " +
      "licence, defence, offence, programme, practised, grey, judgement, acknowledgement, ageing, artefact, maths, focussed; " +
      "whilst, amongst, learnt, per cent, fortnightly.";
    assert.deepEqual(pairs(findSpellingHits(text)), [
      "Colour->Color", "COLOURS->COLORS", "behaviour->behavior", "favourite->favorite", "honourable->honorable",
      "neighbourhood->neighborhood", "organise->organize", "Organisation->Organization", "realised->realized",
      "recognising->recognizing", "summarisation->summarization", "prioritise->prioritize", "analyse->analyze",
      "analysed->analyzed", "centre->center", "centred->centered", "metres->meters", "theatre->theater", "fibre->fiber",
      "catalogue->catalog", "Catalogued->Cataloged", "analogue->analog", "labelled->labeled", "Cancelled->Canceled",
      "travelling->traveling", "modelling->modeling", "counsellor->counselor", "jewellery->jewelry", "enrol->enroll",
      "enrolment->enrollment", "fulfil->fulfill", "fulfilment->fulfillment", "skilful->skillful", "instalment->installment",
      "licence->license", "defence->defense", "offence->offense", "programme->program", "practised->practiced", "grey->gray",
      "judgement->judgment", "acknowledgement->acknowledgment", "ageing->aging", "artefact->artifact", "maths->math",
      "focussed->focused", "whilst->while", "amongst->among", "learnt->learned", "per cent->percent",
      "fortnightly->every two weeks",
    ]);
  });

  it("writes the founder's product words: Vacation, Payroll, Brand colors", () => {
    assert.deepEqual(pairs(findSpellingHits("On holiday until Oct 21. Holiday mode. The Wage bill tab. Brand colours.")), [
      "On holiday->On vacation",
      "Holiday mode->Vacation mode",
      "Wage bill->Payroll",
      "colours->colors",
    ]);
    assert.deepEqual(pairs(findSpellingHits("Holiday")), ["Holiday->Vacation"]);
    assert.deepEqual(pairs(findSpellingHits("Could not end the holiday")), ["holiday->vacation"]);
    assert.deepEqual(pairs(findSpellingHits("bank holidays")), ["bank holidays->public holidays"]);
  });

  it("leaves US words, words that end in -ise in US English too, and nouns alone", () => {
    for (const ok of [
      "color organize judgment center behavior favorite labeled canceled catalog program gray enroll fulfill",
      "promise exercise enterprise advertise expertise otherwise likewise surprise compromise supervise",
      "emphasis hypothesis synthesis analyses analysis criticism realism",
      "cancellation controlled compelled patrolled excelled",
      "acre genre mediocre massacre ogre",
      "the holiday season, a public holiday, holiday sales",
      "minimum maximum customer",
    ]) {
      assert.deepEqual(pairs(findSpellingHits(ok)), [], ok);
    }
  });

  it("keeps proper nouns and tokens written inside copy", () => {
    assert.deepEqual(pairs(findSpellingHits("the National Cyber Security Centre and Harbour Payments")), []);
    assert.deepEqual(pairs(findSpellingHits("see catalogue.ts, /b/x/colours and --colour-x")), []);
  });
});

describe("dates and times in text", () => {
  it("flags day-first dates, numeric day-first dates and 24-hour times", () => {
    const text = "Due 7 Oct. Wed 7 Oct 2026. The 21st of October. On 3 October. 13/10/2026. Read 14:30, back at 09:00.";
    assert.deepEqual(
      findDateHits(text).map((h) => h.match),
      ["7 Oct", "7 Oct", "21st of October", "3 October", "13/10/2026", "14:30", "09:00"],
    );
  });

  it("accepts US dates, 12-hour times, ISO stamps, ratios and month-first runs", () => {
    for (const ok of ["Oct 7, 2026", "Wed, Oct 7", "Oct 7 – 21", "Aug 13  Aug 27  Sep 10", "3:45 PM", "10:00", "2026-10-07T14:05:00Z", "a 16:10 aspect ratio", "10/21/2026"]) {
      assert.deepEqual(findDateHits(ok), [], ok);
    }
  });
});

describe("locales and date patterns in code strings", () => {
  it("flags en-GB and day-first or 24-hour date-fns patterns", () => {
    assert.equal(findLocaleHits("en-GB").length, 1);
    assert.equal(findLocaleHits("en_GB.UTF-8").length, 1);
    assert.equal(findLocaleHits("d MMM yyyy").length, 1);
    assert.equal(findLocaleHits("EEE d MMM").length, 1);
    assert.equal(findLocaleHits("dd/MM/yyyy").length, 1);
    assert.equal(findLocaleHits("HH:mm").length, 1);
  });
  it("accepts US patterns and machine formats", () => {
    for (const ok of ["en-US", "MMM d, yyyy", "EEE, MMM d", "h:mm a", "yyyy-MM-dd HH:mm", "yyyy-MM-dd'T'HH:mm:ss"]) {
      assert.deepEqual(findLocaleHits(ok), [], ok);
    }
  });
});

describe("code files", () => {
  const source = [
    'import { colourToken } from "./colours";',
    "export function W({ n }: { n: number }) {",
    "  return (",
    '    <div className="colour-dot centre" data-testid="brand-colours" id="colour">',
    "      <span>Brand colours</span>",
    '      <input placeholder="Primary colour" aria-label="Pick a colour" />',
    "      {`${n} colours labelled`}",
    "    </div>",
    "  );",
    "}",
    'export const LABELS = { cancelled: "Cancelled", status: "cancelled", label: "Colour", className: "grey" } as const;',
    'export type S = "cancelled" | "organisation";',
    'export function f(s: string) { return s === "cancelled" ? stop({ reason: "cancelled" }) : cn("colour-x", s); }',
    'export const tile = { caption: "annualised" };',
    'console.warn("colour fixture missing");',
    "const q = sql`select * from entities where kind = 'organisation' and note = 'a colour'`;",
    "// us-english-allow: the manifest prints the enum key",
    'const manifest = "ent_1 | organisation | Meridian Labs";',
    'const when = new Intl.DateTimeFormat("en-GB", { hour12: false }).format(d);',
    'const label = formatDate(d, "d MMM");',
  ].join("\n");

  it("reports user-facing text and locales with the right line, never identifiers", () => {
    const p = write("a/Widget.tsx", source);
    const hits = [];
    scanCodeFile(p, hits);
    assert.deepEqual(
      hits.map((h) => `${h.line}:${h.kind}:${h.match}`).sort(),
      [
        "11:spelling:Cancelled",
        "11:spelling:Colour",
        "14:spelling:annualised",
        "19:locale:en-GB",
        "19:locale:hour12: false",
        "20:locale:d MMM",
        "5:spelling:colours",
        "6:spelling:colour",
        "6:spelling:colour",
        "7:spelling:colours",
        "7:spelling:labelled",
      ].sort(),
    );
  });

  it("--fix rewrites only the user-facing words, in their own case", () => {
    const p = write("b/Widget.tsx", source);
    const hits = [];
    scanCodeFile(p, hits);
    fix(hits);
    const out = readFileSync(p, "utf8").split("\n");
    assert.equal(out[0], 'import { colourToken } from "./colours";');
    assert.equal(out[3], '    <div className="colour-dot centre" data-testid="brand-colours" id="colour">');
    assert.equal(out[4], "      <span>Brand colors</span>");
    assert.equal(out[5], '      <input placeholder="Primary color" aria-label="Pick a color" />');
    assert.equal(out[6], "      {`${n} colors labeled`}");
    assert.equal(out[10], 'export const LABELS = { cancelled: "Canceled", status: "cancelled", label: "Color", className: "grey" } as const;');
    assert.equal(out[12], 'export function f(s: string) { return s === "cancelled" ? stop({ reason: "cancelled" }) : cn("colour-x", s); }');
    assert.equal(out[13], 'export const tile = { caption: "annualized" };');
    assert.equal(out[15], "const q = sql`select * from entities where kind = 'organisation' and note = 'a colour'`;");
    assert.equal(out[17], 'const manifest = "ent_1 | organisation | Meridian Labs";');
    const again = [];
    scanCodeFile(p, again);
    assert.deepEqual(again.filter((h) => h.kind === "spelling"), []);
  });

  it("reads copy assigned to a field and an agent template's name, role and tone", () => {
    const form = write("c/naming.ts", ['errors.kit = "Both brand colours need a hex value.";', 'if (status === "cancelled") stop();'].join("\n"));
    const formHits = [];
    scanCodeFile(form, formHits);
    assert.deepEqual(formHits.map((h) => `${h.line}:${h.match}`), ["1:colours"]);

    const template = ['export const t = { key: "categoriser", name: "Categoriser", role: "Affiliate programme manager", tone: "Never apologise twice." };'].join("\n");
    const agentHits = [];
    scanCodeFile(write("packages/agents/src/templates/x.ts", template), agentHits);
    assert.deepEqual(agentHits.map((h) => h.match), ["Categoriser", "programme", "apologise"]);
    // Elsewhere `name` and `role` stay structural (an input's name, an ARIA role).
    const otherHits = [];
    scanCodeFile(write("packages/other/x.ts", template), otherHits);
    assert.deepEqual(otherHits, []);
  });
});

describe("prose files", () => {
  it("reads prose, not code fences, inline code or link targets", () => {
    const p = write("c/DOC.md", [
      "# Colour",
      "The brand colour sits in `--kit-colour` and [the colours page](./colours.md).",
      "```ts",
      'const c = "colour";',
      "```",
      "Due 7 Oct at 14:30.",
      "<!-- us-english-allow: names the British form on purpose -->",
      "Never write colour.",
    ].join("\n"));
    const hits = [];
    scanProseFile(p, hits);
    assert.deepEqual(hits.map((h) => `${h.line}:${h.match}`), ["1:Colour", "2:colour", "2:colours", "6:7 Oct", "6:14:30"]);
  });
});
