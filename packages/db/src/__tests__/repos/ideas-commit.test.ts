/**
 * "Take charge" commits an idea exactly once (audit FR-02 / IAE-01 / DB-04: a double click built two businesses). The
 * claim is one conditional statement, so under READ COMMITTED a second commit that waited on the winner's row lock
 * re-checks `committed_at is null`, gets no row and creates nothing; the business stamp never re-points an idea.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("ideascommit");
});
afterAll(() => r?.close());

const newIdea = (title: string) => repos.ideas.create(r.db, r.A.ownerId, { title, pitch: "A pitch" });

describe("ideas.claimForCommit", () => {
  it("claims an uncommitted idea once; the second claim gets nothing", async () => {
    const idea = await newIdea("Claim once");
    expect(await repos.ideas.claimForCommit(r.db, r.A.ownerId, idea.id)).toBe(true);
    const claimed = await repos.ideas.get(r.db, r.A.ownerId, idea.id);
    expect(claimed.committedAt).toBeInstanceOf(Date);
    expect(claimed.businessId).toBeNull();
    expect(await repos.ideas.claimForCommit(r.db, r.A.ownerId, idea.id)).toBe(false);
    // A committed idea leaves the studio's list.
    expect((await repos.ideas.listForUser(r.db, r.A.ownerId)).items.map((i) => i.id)).not.toContain(idea.id);
  });

  it("only the owner can claim, and a discarded idea cannot be claimed", async () => {
    const idea = await newIdea("Not yours");
    await expect(repos.ideas.claimForCommit(r.db, r.B.ownerId, idea.id)).rejects.toThrow(/not found/);
    await repos.ideas.discard(r.db, r.A.ownerId, idea.id);
    await expect(repos.ideas.claimForCommit(r.db, r.A.ownerId, idea.id)).rejects.toThrow(/not found/);
  });

  it("a commit that fails releases its claim (the claim lives in the commit's transaction)", async () => {
    const idea = await newIdea("Failed commit");
    await expect(
      r.db.transaction(async (tx) => {
        expect(await repos.ideas.claimForCommit(tx, r.A.ownerId, idea.id)).toBe(true);
        throw new Error("seeding the departments failed");
      }),
    ).rejects.toThrow(/seeding the departments failed/);
    expect((await repos.ideas.get(r.db, r.A.ownerId, idea.id)).committedAt).toBeNull();
    expect(await repos.ideas.claimForCommit(r.db, r.A.ownerId, idea.id)).toBe(true);
  });

  it("of two concurrent commit transactions exactly one claims the idea and stamps its business", async () => {
    const idea = await newIdea("Double click");
    const attempt = (businessId: string) =>
      r.db.transaction(async (tx) => {
        if (!(await repos.ideas.claimForCommit(tx, r.A.ownerId, idea.id))) return null;
        return repos.ideas.commit(tx, r.A.ownerId, idea.id, businessId);
      });
    const results = await Promise.all([attempt(r.A.businessId), attempt(r.B.businessId)]);
    const winners = results.filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    const stored = await repos.ideas.get(r.db, r.A.ownerId, idea.id);
    expect(stored.businessId).toBe(winners[0]!.businessId);
    expect(stored.committedAt).toBeInstanceOf(Date);
  });
});

describe("ideas.commit", () => {
  it("keeps the claim's commit time and stamps the business on the idea and its versions", async () => {
    const idea = await newIdea("Claimed then stamped");
    const committed = await r.db.transaction(async (tx) => {
      await repos.ideas.claimForCommit(tx, r.A.ownerId, idea.id);
      const claimedAt = (await repos.ideas.get(tx, r.A.ownerId, idea.id)).committedAt;
      const stamped = await repos.ideas.commit(tx, r.A.ownerId, idea.id, r.A.businessId);
      expect(stamped.committedAt?.getTime()).toBe(claimedAt?.getTime());
      return stamped;
    });
    expect(committed.businessId).toBe(r.A.businessId);
    expect((await repos.ideas.versions(r.db, r.A.ownerId, idea.id)).every((v) => v.businessId === r.A.businessId)).toBe(true);
  });

  it("never re-points an idea that already has a business", async () => {
    const idea = await newIdea("Committed once");
    await repos.ideas.commit(r.db, r.A.ownerId, idea.id, r.A.businessId);
    await expect(repos.ideas.commit(r.db, r.A.ownerId, idea.id, r.B.businessId)).rejects.toThrow(/already committed/);
    // Even inside a transaction that skipped the claim (the old check-then-update raced here), the stamp is refused.
    await expect(r.db.transaction((tx) => repos.ideas.commit(tx, r.A.ownerId, idea.id, r.B.businessId))).rejects.toThrow(/already committed/);
    expect((await repos.ideas.get(r.db, r.A.ownerId, idea.id)).businessId).toBe(r.A.businessId);
    await expect(repos.ideas.commit(r.db, r.B.ownerId, idea.id, r.B.businessId)).rejects.toThrow(/not found/);
  });

  it("does not trust an earlier read: a commit that saw the idea uncommitted (READ COMMITTED) neither claims nor re-points it", async () => {
    // PGlite runs one transaction at a time, so the interleaving is replayed: every read of the idea returns the
    // snapshot from before the first commit landed, as the losing transaction saw it on Postgres.
    const idea = await newIdea("Stale read");
    const before = await repos.ideas.get(r.db, r.A.ownerId, idea.id);
    await r.db.transaction(async (tx) => {
      await repos.ideas.claimForCommit(tx, r.A.ownerId, idea.id);
      await repos.ideas.commit(tx, r.A.ownerId, idea.id, r.A.businessId);
    });
    const stale = vi.spyOn(repos.ideas, "get").mockResolvedValue(before);
    try {
      expect(await repos.ideas.claimForCommit(r.db, r.A.ownerId, idea.id)).toBe(false);
      await expect(repos.ideas.commit(r.db, r.A.ownerId, idea.id, r.B.businessId)).rejects.toThrow(/already committed/);
    } finally {
      stale.mockRestore();
    }
    expect((await repos.ideas.get(r.db, r.A.ownerId, idea.id)).businessId).toBe(r.A.businessId);
  });
});
