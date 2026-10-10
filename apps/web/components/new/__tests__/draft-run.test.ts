import { describe, expect, expectTypeOf, it } from "vitest";
import { applyDraftEvent, deckFromPages, draftItems, draftSteps, draftedCount, draftingNames, failRun, formatElapsed, gridEntries, prependIdea, prependIdeaToPages, progressLine, remainingEstimateMs, runIdeaIds, slateLine, startRun, stopRun, type DraftEvent, type DraftRun, type DraftedIdea } from "../ideate/draft-run";

const idea = (id: string, title = id): DraftedIdea => ({ id, title }) as unknown as DraftedIdea;

function fold(events: DraftEvent[], run: DraftRun = startRun(0)): DraftRun {
  return events.reduce((r, e, i) => applyDraftEvent(r, e, 1000 * (i + 1)), run);
}

const outline = (index: number, name: string): DraftEvent => ({ type: "outline", index, name, archetype: "b2b_saas" });
const writing = (index: number, attempt = 1): DraftEvent => ({ type: "writing", index, attempt });
const saved = (index: number, id: string, title: string): DraftEvent => ({ type: "idea", index, idea: idea(id, title) });

describe("draft run (the Studio's streamed draft)", () => {
  it("is typed from the API's stream (never `never`)", () => {
    expectTypeOf<DraftEvent>().not.toBeNever();
    expectTypeOf<Extract<DraftEvent, { type: "outline" }>["name"]>().toEqualTypeOf<string>();
  });

  it("names concepts as the slate arrives, then fills each one when its card is saved", () => {
    let run = fold([{ type: "started", agent: "Ideation agent", single: false, mode: "mock" }]);
    expect(progressLine(run)).toBe("Ideation agent is reading your brief");
    run = fold([outline(0, "Ledgerly"), outline(1, "Quarloop")], run);
    expect(progressLine(run)).toBe("Ideation agent is outlining the set · 2 concepts named so far");
    run = fold([writing(0), writing(1), outline(2, "Fenwave"), { type: "outlined", total: 3 }, saved(1, "b", "Quarloop")], run);
    expect(run.slots.map((s) => s.status)).toEqual(["writing", "done", "outlined"]);
    expect(draftedCount(run)).toBe(1);
    expect(progressLine(run)).toBe("Ideation agent is drafting concept 2 of 3");
    run = fold([writing(2), writing(0, 2), saved(0, "a", "Ledgerly"), saved(2, "c", "Fenwave")], run);
    expect(run.slots[0]!.status).toBe("done");
    run = applyDraftEvent(run, { type: "done", ideas: [], total: 3, failed: 0, costMinor: 12, costLabel: "Estimate", mode: "mock", elapsedMs: 4000 } as DraftEvent, 9000);
    expect(run).toMatchObject({ status: "done", finishedAt: 9000, costMinor: 12, mock: true });
    expect(progressLine(run)).toBe("3 concepts drafted");
    expect(runIdeaIds(run)).toEqual(["a", "b", "c"]);
  });

  it("shows a retry and a card that could not be finished", () => {
    const run = fold([outline(0, "A"), outline(1, "B"), { type: "outlined", total: 2 }, writing(0), writing(0, 2), { type: "card_failed", index: 1, name: "B", message: "x" }]);
    expect(run.slots.map((s) => s.status)).toEqual(["retrying", "failed"]);
    const done = applyDraftEvent(run, { type: "done", ideas: [], total: 2, failed: 1, costMinor: 0, costLabel: "Estimate", mode: "live", elapsedMs: 1 } as DraftEvent, 5);
    expect(progressLine(done)).toBe("0 concepts drafted · 1 could not be finished");
  });

  it("keeps a saved card saved and stops listening after Stop, except for cards already saved", () => {
    let run = fold([outline(0, "A"), saved(0, "a", "A"), writing(0, 2)]);
    expect(run.slots[0]!.status).toBe("done");
    run = stopRun(fold([outline(1, "B")], run), 50);
    expect(run).toMatchObject({ status: "stopped", finishedAt: 50 });
    expect(progressLine(run)).toBe("Stopped · 1 concept kept");
    run = fold([outline(2, "C"), saved(1, "b", "B")], run);
    expect(run.slots[2]).toBeUndefined();
    expect(runIdeaIds(run)).toEqual(["a", "b"]);
    expect(failRun(run, "x", 60)).toBe(run);
  });

  it("reports a failed draft with the API's message", () => {
    const run = failRun(startRun(0), "The Ideation agent ran out of room before finishing the concepts.", 10);
    expect(progressLine(run)).toBe("The Ideation agent ran out of room before finishing the concepts.");
  });

  it("formats the elapsed timer", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(92_000)).toBe("1:32");
  });

  it("puts a saved idea on top of idea.list's page without refetching it", () => {
    const page = { items: [{ id: "x" }, { id: "y" }], nextCursor: null };
    expect(prependIdea(page, { id: "z" })!.items.map((i) => i.id)).toEqual(["z", "x", "y"]);
    expect(prependIdea(page, { id: "y" })!.items.map((i) => i.id)).toEqual(["y", "x"]);
    expect(prependIdea(undefined, { id: "z" })).toBeUndefined();
  });

  it("pages the deck: a saved idea goes on top of the first page and never shows twice; pages read newest first, once each", () => {
    const data = { pages: [{ items: [{ id: "a" }, { id: "b" }], nextCursor: "c1" }, { items: [{ id: "c" }, { id: "z" }], nextCursor: null }], pageParams: [null, "c1"] };
    const next = prependIdeaToPages(data, { id: "z" })!;
    expect(next.pages.map((p) => p.items.map((i) => i.id))).toEqual([["z", "a", "b"], ["c"]]);
    expect(next.pageParams).toEqual([null, "c1"]);
    expect(prependIdeaToPages(undefined, { id: "z" })).toBeUndefined();
    // A card that moved from page 2 onto page 1 between two fetches is shown once.
    expect(deckFromPages([{ items: [{ id: "n" }, { id: "a" }] }, { items: [{ id: "a" }, { id: "b" }] }]).map((i) => i.id)).toEqual(["n", "a", "b"]);
    expect(deckFromPages(undefined)).toEqual([]);
  });

  it("lays the grid out as the run's slots in slate order, then the rest of the deck", () => {
    const deck = [{ id: "old1" }, { id: "b" }, { id: "old2" }];
    let run = fold([outline(0, "A"), outline(1, "B"), outline(2, "C"), saved(1, "b", "B"), { type: "card_failed", index: 2, name: "C", message: "x" }]);
    const shape = (r: DraftRun | null) => gridEntries(deck, r).map((e) => (e.kind === "idea" ? `${e.idea.id}${e.fresh ? "*" : ""}` : `slot:${e.slot.name}`));
    expect(shape(run)).toEqual(["slot:A", "b*", "old1", "old2"]);
    // Once the run ends, placeholders go and the run's cards stay first.
    run = stopRun(run, 9);
    expect(shape(run)).toEqual(["b*", "old1", "old2"]);
    expect(shape(null)).toEqual(["old1", "b", "old2"]);
  });
});

describe("the live run (SPEC 'Live run panel')", () => {
  const events = (list: DraftEvent[], run = startRun(0), now = 1) => list.reduce((r, e) => applyDraftEvent(r, e, now), run);

  it("steps follow what the stream said: profile, slate, cards; ranking stays with Compare", () => {
    const fresh = startRun(0);
    expect(draftSteps(fresh).map((s) => s.state)).toEqual(["current", "pending", "pending", "pending"]);
    const outlining = events([{ type: "outline", index: 0, name: "Ledgerly", archetype: "b2b_saas" }] as DraftEvent[]);
    expect(draftSteps(outlining).map((s) => s.state)).toEqual(["done", "current", "pending", "pending"]);
    expect(draftSteps(outlining)[1]!.label).toBe("Slate of 1+ angles");
    const drafting = events([{ type: "outlined", total: 2 }, { type: "writing", index: 0, attempt: 1 }] as DraftEvent[], outlining);
    const steps = draftSteps(drafting);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "pending"]);
    expect(steps[1]!.label).toBe("Slate of 2 angles");
    expect(steps[2]!.detail).toBe("0 landed · 1 in progress");
    expect(steps[3]!.label).toBe("Rank in Compare");
    const stopped = stopRun(drafting, 5);
    expect(draftSteps(stopped)[2]!.state).toBe("failed");
  });

  it("one bar segment per concept, the time left from the pace so far, the slate's names and who is being drafted", () => {
    const run = events([
      { type: "outline", index: 0, name: "Ledgerly", archetype: "b2b_saas" },
      { type: "outline", index: 1, name: "Quarloop", archetype: "services" },
      { type: "outline", index: 2, name: "Fenwave", archetype: "marketplace" },
      { type: "outlined", total: 4 },
      { type: "writing", index: 1, attempt: 1 },
      { type: "writing", index: 2, attempt: 2 },
      { type: "idea", index: 0, idea: idea("a", "Ledgerly") },
    ] as DraftEvent[]);
    expect(draftItems(run).map((i) => i.state)).toEqual(["landed", "drafting", "drafting", "empty"]);
    // 10 s for one finished card, three to come.
    expect(remainingEstimateMs(run, 10_000)).toBe(30_000);
    expect(remainingEstimateMs(startRun(0), 10_000)).toBeNull();
    expect(slateLine(run)).toBe("Ledgerly · Quarloop · Fenwave");
    expect(draftingNames(run)).toBe("Quarloop and Fenwave");
    expect(draftingNames(run, 1)).toBe("Quarloop and 1 more");
  });
});
