import { describe, expect, it } from "vitest";
import { CONCEPT_ATTRIBUTE_KEYS, isHexColour, kitOnPrimaryDetail } from "@foundmill/dugout";
import { STEERING_CHIPS, steerBrief } from "../ideate/IdeationStudio";
import { COMPARE_MAX, EMPTY_STUDIO_STATE, META_KIND, attributeChanges, attributeTerm, attributeTermId, buildDeck, citationsOf, commitHref, compareHref, costLabel, discardLocally, kitFromSeed, lineageOf, orderDeck, parseCompareIds, parseStudioState, pinnedIdsToLoad, qaBubbles, qaOf, readMeta, restoreLocally, settlePinned, toConcept, toggleSelection, versionToConcept, withPinned, type IdeaLike, type IdeaVersionLike } from "../ideate/concepts";

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
    // idea.restore answered: the card it returned stays in view even when the loaded pages do not carry it.
    const live = idea(A, { title: "Ledgerly (live)" });
    state = restoreLocally(state, A, live);
    expect(state.discarded).toEqual([]);
    expect(buildDeck([b], state).map((i) => i.title)).toEqual(["Ledgerly", "Ledgerly (live)"]);
    // Once the pages carry it, it is there once.
    expect(buildDeck([a, b], state)).toHaveLength(2);
    // A discard the API refused only leaves the tray: the card never left the API's deck.
    const s2 = restoreLocally(discardLocally(EMPTY_STUDIO_STATE, a), A);
    expect(s2.restored).toEqual([]);
    expect(buildDeck([a], s2)).toHaveLength(1);
  });

  it("asks the API for shortlisted and restored cards older than the loaded pages, never for the tray's", () => {
    const state = { ...EMPTY_STUDIO_STATE, shortlist: [A, B], restored: [idea(C)], discarded: [{ idea: idea(B), discardedAt: "2026-10-07T13:00:00Z" }] };
    expect(pinnedIdsToLoad(state, new Set([A]))).toEqual([C]);
    expect(pinnedIdsToLoad({ ...state, discarded: [] }, new Set())).toEqual([A, B, C]);
    expect(pinnedIdsToLoad(state, new Set([A, C]))).toEqual([]);
    // The pinned cards join the pages once; the pages' copy wins.
    expect(withPinned([idea(A)], [idea(A, { title: "Old copy" }), idea(C)]).map((i) => `${i.id}:${i.title}`)).toEqual([`${A}:Ledgerly`, `${C}:Ledgerly`]);
  });

  it("keeps a shortlisted card older than every loaded page pinned and counted (audit FR-22)", () => {
    const old = idea(C, { createdAt: "2026-09-01T09:00:00Z", current: version({ createdAt: "2026-09-01T09:00:00Z" }) });
    const page = [idea(A, { current: version({ createdAt: "2026-10-07T12:00:00Z" }) }), idea(B, { current: version({ createdAt: "2026-10-07T11:00:00Z" }) })];
    const state = { ...EMPTY_STUDIO_STATE, shortlist: [C] };
    const deck = orderDeck(buildDeck(withPinned(page, [old]), state), state.shortlist);
    expect(deck.map((i) => i.id)).toEqual([C, A, B]);
    expect(state.shortlist.filter((id) => deck.some((d) => d.id === id))).toHaveLength(1);
  });

  it("settles the studio against the API: gone cards leave the shortlist, a card only restored locally goes back to the tray", () => {
    const now = new Date("2026-10-08T09:00:00Z");
    const state = { ...EMPTY_STUDIO_STATE, shortlist: [A, B], restored: [idea(C), idea("44444444-4444-4444-8444-444444444444")] };
    // No answer yet: only restored cards the pages now carry are dropped.
    const loaded = settlePinned(state, new Set([C]), null, now);
    expect(loaded.restored.map((i) => i.id)).toEqual(["44444444-4444-4444-8444-444444444444"]);
    expect(loaded.shortlist).toEqual([A, B]);
    // The API answered: A is live, B became a business, C is still discarded on the API (restored only in this browser).
    const settled = settlePinned(state, new Set(), { asked: [A, B, C, "44444444-4444-4444-8444-444444444444"], found: [A, "44444444-4444-4444-8444-444444444444"], discarded: [C] }, now);
    expect(settled.shortlist).toEqual([A]);
    expect(settled.restored.map((i) => i.id)).toEqual(["44444444-4444-4444-8444-444444444444"]);
    expect(settled.discarded).toEqual([{ idea: idea(C), discardedAt: "2026-10-08T09:00:00.000Z" }]);
    // Nothing to change: the same object, so the studio does not write again.
    expect(settlePinned(settled, new Set(), { asked: [A], found: [A], discarded: [] }, now)).toBe(settled);
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

  it("labels model cost as money in US dollars, the currency model prices are metered in (never a silent euro)", () => {
    expect(costLabel(12)).toBe("$0.12");
    expect(costLabel(12, "GBP")).toBe("£0.12");
  });
});

describe("Ask history and version changes", () => {
  it("shows a stored answer's conversation bubbles, else its single answer", () => {
    expect(qaBubbles({ question: "Who pays?", answer: "Freelancers." })).toEqual(["Freelancers."]);
    expect(qaBubbles({ question: "Who pays?", answer: "A\n\nB", bubbles: ["A", "B", " "] })).toEqual(["A", "B"]);
  });

  it("lists the attributes a version moved, labelled", () => {
    const before = { market_size: { value: 12 }, competition: { value: 9 } };
    expect(attributeChanges(before, { market_size: { value: 14 }, competition: { value: 9 } })).toEqual([{ key: "market_size", label: "Market size", from: 12, to: 14 }]);
    expect(attributeChanges(before, before)).toEqual([]);
    expect(attributeChanges(null, before)).toEqual([]);
    // Every attribute is a defined word with its direction (A6): the Term id is attr_<key>, the sentence its hint.
    expect(attributeTermId("market_pull")).toBe("attr_market_pull");
    expect(attributeTerm("competition")).toEqual({ id: "attr_competition", word: "Competition", short: "How crowded the market is. Higher means less crowded." });
    expect(attributeTerm("distribution_clarity")?.id).toBe("attr_distribution_clarity");
    expect(attributeTerm("not_an_attribute")).toBeUndefined();
  });
});

describe("steering the next set", () => {
  it("adds a steering sentence to the brief once", () => {
    expect(steerBrief("", "Sell to businesses rather than consumers.")).toBe("Sell to businesses rather than consumers.");
    expect(steerBrief("Pet care", "Sell to businesses rather than consumers.")).toBe("Pet care Sell to businesses rather than consumers.");
    expect(steerBrief("Pet care Sell to businesses rather than consumers.", "Sell to businesses rather than consumers.")).toBe("Pet care Sell to businesses rather than consumers.");
    expect(STEERING_CHIPS.map((c) => c.label)).toEqual(["Cheaper to start", "B2B instead", "More defensible"]);
  });
});
