import { describe, expect, it } from "vitest";
import { CONCEPT_ATTRIBUTE_KEYS, isHexColour, kitOnPrimaryDetail } from "@foundmill/dugout";
import { COMPARE_MAX, EMPTY_STUDIO_STATE, META_KIND, buildDeck, citationsOf, commitHref, compareHref, costLabel, discardLocally, kitFromSeed, lineageOf, orderDeck, parseCompareIds, parseStudioState, qaOf, readMeta, restoreLocally, toConcept, toggleSelection, versionToConcept, type IdeaLike, type IdeaVersionLike } from "../ideate/concepts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function version(over: Partial<IdeaVersionLike> = {}): IdeaVersionLike {
  return {
    id: "v1",
    version: 1,
    title: "Ledgerly",
    pitch: "Bookkeeping that closes itself for freelancers.",
    attributes: Object.fromEntries(CONCEPT_ATTRIBUTE_KEYS.map((k, i) => [k, { value: ((i * 3) % 20) + 1, evidence: `Evidence for ${k}` }])),
    starsCurrent: "3.0",
    starsPotential: "4.5",
    research: { citations: [{ title: "Freelancer survey 2025", url: "https://example.com/survey" }, { title: "Pricing comparables", url: "https://example.com/pricing", note: "€9–€29 a month" }, { kind: META_KIND, crest_seed: "seed-ledgerly", forked_from: B, qa: [{ question: "Who pays?", answer: "Freelancers." }] }] },
    parentVersionId: null,
    action: "generated",
    createdAt: "2026-10-07T10:00:00Z",
    ...over,
  };
}

function idea(id = A, over: Partial<IdeaLike> = {}): IdeaLike {
  return { id, title: "Ledgerly", pitch: "Bookkeeping", archetype: "b2b_saas", current: version(), createdAt: "2026-10-07T09:00:00Z", ...over };
}

describe("concept mapping (AC-11.1.2)", () => {
  it("reads the tagged meta entry and keeps citations separate", () => {
    const i = idea();
    expect(readMeta(i.current?.research)).toEqual({ crest_seed: "seed-ledgerly", forked_from: B, qa: [{ question: "Who pays?", answer: "Freelancers." }] });
    expect(citationsOf(i.current?.research)).toHaveLength(2);
    expect(qaOf(i)).toHaveLength(1);
    expect(lineageOf(i)).toEqual({ mergedFrom: [], mergedInto: null, forkedFrom: B, forkedTo: null });
  });

  it("maps an idea to a Dugout Concept with ten attributes, stars, a kit and a citation count", () => {
    const c = toConcept(idea());
    expect(c.attributes.map((a) => a.key)).toEqual([...CONCEPT_ATTRIBUTE_KEYS]);
    expect(c.attributes.every((a) => a.value >= 1 && a.value <= 20)).toBe(true);
    expect(c.attributes[0]?.evidence?.[0]).toEqual({ text: "Evidence for market_pull", source: "Research agent" });
    expect(c.attributes[0]?.evidence?.length).toBe(3);
    expect(c.currentStars).toBe(3);
    expect(c.potentialStars).toBe(4.5);
    expect(c.citations).toBe(2);
    // The seed picks the starting brand colours; there is no logo before one is chosen on the Commit screen.
    expect(c.kit).toEqual(kitFromSeed("seed-ledgerly"));
    expect(c.logoSrc).toBeUndefined();
    expect(c.archetypeLabel).toBe("B2B SaaS");
    expect(isHexColour(c.kit.primary) && isHexColour(c.kit.secondary)).toBe(true);
  });

  it("fills missing attributes with 1 so a card always has ten bars", () => {
    const c = toConcept(idea(A, { current: version({ attributes: {} }) }));
    expect(c.attributes).toHaveLength(10);
    expect(c.attributes.every((a) => a.value === 1)).toBe(true);
  });

  it("derives a deterministic kit from the seed whose primary always passes the text contrast check", () => {
    expect(kitFromSeed("x")).toEqual(kitFromSeed("x"));
    expect(kitFromSeed("x")).not.toEqual(kitFromSeed("y"));
    for (let i = 0; i < 60; i++) expect(kitOnPrimaryDetail(kitFromSeed(`seed-${i}`).primary).passes).toBe(true);
  });

  it("snapshots a historical version as a card (AC-11.1.3)", () => {
    const old = version({ id: "v0", version: 1, title: "Ledgerly v1" });
    const c = versionToConcept(idea(A, { current: version({ id: "v2", version: 2, title: "Ledgerly v2" }) }), old);
    expect(c.name).toBe("Ledgerly v1");
    expect(c.version).toBe(1);
  });
});

describe("compare selection and hrefs (AC-11.1.4)", () => {
  it("toggles ids and refuses a fifth", () => {
    let sel: string[] = [];
    for (const id of [A, B, C, "4", "5"]) sel = toggleSelection(sel, id);
    expect(sel).toEqual([A, B, C, "4"]);
    expect(sel).toHaveLength(COMPARE_MAX);
    expect(toggleSelection(sel, B)).toEqual([A, C, "4"]);
  });

  it("builds and parses the compare href", () => {
    const href = compareHref([A, B]);
    expect(href).toBe(`/new/compare?ids=${A},${B}`);
    expect(parseCompareIds(new URL(`http://x${href}`).searchParams.get("ids"))).toEqual([A, B]);
    expect(parseCompareIds(`${A},${A},nope,${B},${C},44444444-4444-4444-8444-444444444444,55555555-5555-4555-8555-555555555555`)).toHaveLength(4);
    expect(parseCompareIds(null)).toEqual([]);
    expect(commitHref(A)).toBe(`/new/commit/${A}`);
  });
});

describe("studio state: discard is reversible (AC-11.1.3)", () => {
  it("moves a card to the tray and back", () => {
    const a = idea(A);
    const b = idea(B, { createdAt: "2026-10-07T12:00:00Z" });
    let state = { ...EMPTY_STUDIO_STATE, shortlist: [A] };
    state = discardLocally(state, a, new Date("2026-10-07T13:00:00Z"));
    expect(state.discarded.map((d) => d.idea.id)).toEqual([A]);
    expect(state.shortlist).toEqual([]);
    expect(buildDeck([a, b], state).map((i) => i.id)).toEqual([B]);
    // The API has no restore: the snapshot returns locally.
    state = restoreLocally(state, A, false);
    expect(state.discarded).toEqual([]);
    expect(buildDeck([b], state).map((i) => i.id)).toEqual([B, A]);
    // A server-side restore does not duplicate the card.
    const s2 = restoreLocally(discardLocally(EMPTY_STUDIO_STATE, a), A, true);
    expect(buildDeck([a], s2)).toHaveLength(1);
  });

  it("orders shortlisted cards first, then newest", () => {
    const a = idea(A);
    const b = idea(B, { current: version({ createdAt: "2026-10-07T12:00:00Z" }) });
    expect(orderDeck([a, b], []).map((i) => i.id)).toEqual([B, A]);
    expect(orderDeck([a, b], [A]).map((i) => i.id)).toEqual([A, B]);
  });

  it("parses stored state defensively", () => {
    expect(parseStudioState(null)).toEqual(EMPTY_STUDIO_STATE);
    expect(parseStudioState("{nope")).toEqual(EMPTY_STUDIO_STATE);
    expect(parseStudioState(JSON.stringify({ shortlist: [A, 3], discarded: [{ idea: { id: B } }, { nope: true }], lastPrompt: 7 }))).toEqual({ shortlist: [A], discarded: [{ idea: { id: B } }], restored: [], lastPrompt: "" });
  });

  it("labels model cost as money", () => {
    expect(costLabel(12)).toBe("€0.12");
  });
});
