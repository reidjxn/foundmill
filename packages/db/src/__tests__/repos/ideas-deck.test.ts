/**
 * The Ideation Studio's deck in the repository: restore undoes a discard (AC-11.1.3), getMany / discardedAmong read
 * pinned cards by id, and addVersion numbers concurrent versions one after another, building each from the version that
 * is current when it is written (audit FR-12, FR-22, ARB-13).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("ideasdeck");
});
afterAll(() => r?.close());

const newIdea = (title: string, userId = r.A.ownerId) => repos.ideas.create(r.db, userId, { title, pitch: "A pitch" });

describe("ideas.restore", () => {
  it("puts a discarded idea back for its owner only", async () => {
    const idea = await newIdea("Restore me");
    await repos.ideas.discard(r.db, r.A.ownerId, idea.id);
    await expect(repos.ideas.restore(r.db, r.B.ownerId, idea.id)).rejects.toThrow(/not found/);
    const back = await repos.ideas.restore(r.db, r.A.ownerId, idea.id);
    expect(back.archivedAt).toBeNull();
    expect(back.current?.id).toBe(idea.current?.id);
    expect((await repos.ideas.listForUser(r.db, r.A.ownerId)).items.map((i) => i.id)).toContain(idea.id);
    // Versions can be added again (they were refused while it was discarded).
    expect((await repos.ideas.addVersion(r.db, r.A.ownerId, idea.id, { action: "edited" })).version).toBe(2);
    // Restoring a live idea changes nothing.
    expect((await repos.ideas.restore(r.db, r.A.ownerId, idea.id)).id).toBe(idea.id);
  });
});

describe("ideas.getMany / discardedAmong", () => {
  it("reads only the owner's live, uncommitted ideas; says which of the rest are discarded", async () => {
    const live = await newIdea("Live");
    const gone = await newIdea("Gone");
    const done = await newIdea("Done");
    const theirs = await newIdea("Theirs", r.B.ownerId);
    await repos.ideas.discard(r.db, r.A.ownerId, gone.id);
    await repos.ideas.claimForCommit(r.db, r.A.ownerId, done.id);
    const ids = [live.id, gone.id, done.id, theirs.id];
    expect((await repos.ideas.getMany(r.db, r.A.ownerId, ids)).map((i) => i.title)).toEqual(["Live"]);
    expect(await repos.ideas.discardedAmong(r.db, r.A.ownerId, ids)).toEqual([gone.id]);
    expect(await repos.ideas.getMany(r.db, r.A.ownerId, [])).toEqual([]);
  });
});

describe("ideas.addVersion, several at once", () => {
  it("numbers them one after another and builds each from the version current when it is written", async () => {
    const idea = await newIdea("Busy card");
    const append = (n: number) =>
      repos.ideas.addVersion(r.db, r.A.ownerId, idea.id, (latest) => {
        const prior = ((latest.current?.research as { citations: unknown[] } | undefined)?.citations ?? []) as unknown[];
        return { action: "edited", research: { citations: [...prior, { title: `Answer ${n}` }] } };
      });
    const versions = await Promise.all([append(1), append(2), append(3)]);
    expect(versions.map((v) => v.version).sort()).toEqual([2, 3, 4]);
    const latest = await repos.ideas.get(r.db, r.A.ownerId, idea.id);
    expect(latest.current?.version).toBe(4);
    expect((latest.current?.research as { citations: { title: string }[] }).citations.map((c) => c.title).sort()).toEqual(["Answer 1", "Answer 2", "Answer 3"]);
  });

  it("refuses a discarded idea", async () => {
    const idea = await newIdea("Discarded card");
    await repos.ideas.discard(r.db, r.A.ownerId, idea.id);
    await expect(repos.ideas.addVersion(r.db, r.A.ownerId, idea.id, { action: "edited" })).rejects.toThrow(/not found/);
  });
});
