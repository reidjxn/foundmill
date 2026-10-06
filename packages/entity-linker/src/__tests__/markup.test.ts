import { describe, expect, it } from "vitest";
import { buildManifest, extractEntityIds, findMalformedMarkup, formatEntityMarkup, parseEntityMarkup, renderPlain, serializeSegments, stripMarkup, validateMarkup } from "../index";
import { FIXTURE_IDS, fixtureManifest, uuidFor } from "../testing";

const m = fixtureManifest();
const MER = FIXTURE_IDS.meridian;
const SARA = FIXTURE_IDS.saraLindqvist;

describe("parseEntityMarkup", () => {
  it("splits text and mentions in order", () => {
    const text = `Hello [[ent:${MER}|Meridian Labs]], meet [[ent:${SARA}|Sara]].`;
    expect(parseEntityMarkup(text)).toEqual([
      { kind: "text", text: "Hello " },
      { kind: "entity", id: MER, display: "Meridian Labs", source: "markup", confidence: 1 },
      { kind: "text", text: ", meet " },
      { kind: "entity", id: SARA, display: "Sara", source: "markup", confidence: 1 },
      { kind: "text", text: "." },
    ]);
  });

  it("returns a single text segment when there is no markup, and nothing for an empty string", () => {
    expect(parseEntityMarkup("plain text")).toEqual([{ kind: "text", text: "plain text" }]);
    expect(parseEntityMarkup("")).toEqual([]);
  });

  it("handles adjacent mentions and mentions at both ends", () => {
    const text = `[[ent:${MER}|A]][[ent:${SARA}|B]]`;
    const segs = parseEntityMarkup(text);
    expect(segs.map((s) => s.kind)).toEqual(["entity", "entity"]);
  });

  it("leaves malformed markup as text (uppercase uuid, missing display, bad id)", () => {
    const upper = MER.toUpperCase();
    expect(parseEntityMarkup(`[[ent:${upper}|X]]`)).toEqual([{ kind: "text", text: `[[ent:${upper}|X]]` }]);
    expect(parseEntityMarkup(`[[ent:${MER}]]`)).toEqual([{ kind: "text", text: `[[ent:${MER}]]` }]);
    expect(parseEntityMarkup("[[ent:nope|X]]")).toEqual([{ kind: "text", text: "[[ent:nope|X]]" }]);
  });

  it("does not leak regex state between calls (shared global regex)", () => {
    const text = `[[ent:${MER}|A]] and [[ent:${SARA}|B]]`;
    expect(parseEntityMarkup(text).filter((s) => s.kind === "entity")).toHaveLength(2);
    expect(parseEntityMarkup(text).filter((s) => s.kind === "entity")).toHaveLength(2);
    expect(extractEntityIds(text)).toEqual([MER, SARA]);
    expect(extractEntityIds(text)).toEqual([MER, SARA]);
  });
});

describe("round trip", () => {
  it("serializeSegments(parseEntityMarkup(text)) === text", () => {
    const texts = [
      `Hello [[ent:${MER}|Meridian Labs]], meet [[ent:${SARA}|Sara]].`,
      `[[ent:${MER}|A]][[ent:${SARA}|B]]`,
      "no markup at all\n\nwith paragraphs",
      `trailing [[ent:${MER}|Meridian]]`,
      `[[ent:${MER}|Meridian]] leading`,
    ];
    for (const t of texts) expect(serializeSegments(parseEntityMarkup(t))).toBe(t);
  });

  it("formatEntityMarkup escapes characters that would break the markup", () => {
    const md = formatEntityMarkup(MER, "Acme ] Co | Ltd");
    expect(parseEntityMarkup(md)).toEqual([{ kind: "entity", id: MER, display: "Acme ) Co / Ltd", source: "markup", confidence: 1 }]);
  });
});

describe("validateMarkup", () => {
  it("accepts text whose ids are all visible manifest ids", () => {
    const v = validateMarkup(`[[ent:${MER}|Meridian Labs]] and [[ent:${SARA}|Sara]] and [[ent:${MER}|Meridian]].`, m);
    expect(v.valid).toBe(true);
    expect(v.unknownIds).toEqual([]);
    expect(v.invisibleIds).toEqual([]);
    expect(v.entityIds).toEqual([MER, SARA]);
    expect(v.mentionCount).toBe(3);
    expect(v.displayMismatches).toEqual([]);
  });

  it("rejects an unknown id", () => {
    const ghost = uuidFor("ghost");
    const v = validateMarkup(`[[ent:${ghost}|Ghost Co]] sent a quote.`, m);
    expect(v.valid).toBe(false);
    expect(v.unknownIds).toEqual([ghost]);
    expect(v.problems).toEqual([{ id: ghost, display: "Ghost Co" }]);
    expect(v.entityIds).toEqual([]);
  });

  it("rejects an invisible entity id even though it is in the manifest", () => {
    const v = validateMarkup(`[[ent:${FIXTURE_IDS.hiddenInvestor}|Hidden Investor]] is interested.`, m);
    expect(v.valid).toBe(false);
    expect(v.invisibleIds).toEqual([FIXTURE_IDS.hiddenInvestor]);
    expect(v.unknownIds).toEqual([]);
    expect(m.has(FIXTURE_IDS.hiddenInvestor)).toBe(true);
    expect(m.isVisible(FIXTURE_IDS.hiddenInvestor)).toBe(false);
  });

  it("rejects malformed markup so a broken link never reaches render", () => {
    const v = validateMarkup(`[[ent:${MER.toUpperCase()}|Meridian]] and [[ent:${SARA}|Sara]]`, m);
    expect(v.valid).toBe(false);
    expect(v.malformed).toHaveLength(1);
    expect(v.malformed[0]?.raw).toBe(`[[ent:${MER.toUpperCase()}|Meridian]]`);
    expect(findMalformedMarkup("[[ent:oops no close")).toEqual([{ raw: "[[ent:oops no close", index: 0 }]);
  });

  it("reports display mismatches as advisory without failing validation", () => {
    const v = validateMarkup(`[[ent:${MER}|the supplier]] and [[ent:${SARA}|Lindqvist]] and [[ent:${SARA}|Sara's]]`, m);
    expect(v.valid).toBe(true);
    expect(v.displayMismatches).toEqual([{ id: MER, display: "the supplier", name: "Meridian Labs" }]);
  });

  it("validates text without mentions", () => {
    const v = validateMarkup("Nothing to see here.", m);
    expect(v.valid).toBe(true);
    expect(v.mentionCount).toBe(0);
  });

  it("works with an empty manifest: every mention is unknown", () => {
    const empty = buildManifest([]);
    expect(empty.text).toBe("");
    const v = validateMarkup(`[[ent:${MER}|Meridian]]`, empty);
    expect(v.valid).toBe(false);
    expect(v.unknownIds).toEqual([MER]);
  });
});

describe("stripMarkup and renderPlain", () => {
  it("stripMarkup replaces mentions with their display", () => {
    expect(stripMarkup(`Hi [[ent:${MER}|Meridian Labs]] and [[ent:${SARA}|Sara]].`)).toBe("Hi Meridian Labs and Sara.");
  });

  it("renderPlain also cleans malformed openings and accepts segments", () => {
    expect(renderPlain(`Hi [[ent:${MER}|Meridian Labs]] and [[ent:BAD|Broken]].`)).toBe("Hi Meridian Labs and Broken.");
    expect(renderPlain([{ kind: "text", text: "Hi " }, { kind: "entity", id: MER, display: "Meridian" }, { kind: "ambiguous", text: "Sara", candidates: [] }, { kind: "draft", name: "Acme", kindGuess: "organisation" }])).toBe("Hi MeridianSaraAcme");
  });
});
