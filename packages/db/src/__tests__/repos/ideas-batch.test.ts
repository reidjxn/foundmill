/** `ideas.createMany`: a drafted set of concepts in one three-statement transaction (the Ideation Studio's writer). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("ideasbatch");
});
afterAll(() => r?.close());

const card = (n: number) => ({
  title: `Concept ${n}`,
  pitch: `Pitch ${n}`,
  archetype: "b2b_saas" as const,
  attributes: { market_pull: { value: 10 + n, evidence: `evidence ${n}` } },
  starsCurrent: 3,
  starsPotential: 4,
  research: { citations: [{ title: `Source ${n}`, url: `https://example.test/${n}` }] },
});

describe("ideas.createMany", () => {
  it("writes every idea with its first version as current, in the order given", async () => {
    const created = await repos.ideas.createMany(r.db, r.A.ownerId, [card(1), card(2), card(3)]);
    expect(created.map((i) => i.title)).toEqual(["Concept 1", "Concept 2", "Concept 3"]);
    for (const idea of created) {
      expect(idea.current?.id).toBe(idea.currentVersionId);
      expect(idea.current?.version).toBe(1);
      expect(idea.current?.ideaId).toBe(idea.id);
      expect(idea.current?.action).toBe("generated");
    }
    expect(created[1]!.current?.attributes).toEqual({ market_pull: { value: 12, evidence: "evidence 2" } });
    expect(created[2]!.current?.starsPotential).toBe("4.0");
    // Read back exactly as `create` would have written it.
    const fetched = await repos.ideas.get(r.db, r.A.ownerId, created[0]!.id);
    expect(fetched.current?.id).toBe(created[0]!.current?.id);
    expect((await repos.ideas.listForUser(r.db, r.A.ownerId)).items.map((i) => i.id)).toEqual(expect.arrayContaining(created.map((i) => i.id)));
  });

  it("is a no-op for an empty list and stays private to its owner", async () => {
    expect(await repos.ideas.createMany(r.db, r.A.ownerId, [])).toEqual([]);
    const [mine] = await repos.ideas.createMany(r.db, r.A.ownerId, [card(9)]);
    await expect(repos.ideas.get(r.db, r.B.ownerId, mine!.id)).rejects.toThrow(/not found/);
    expect((await repos.ideas.listForUser(r.db, r.B.ownerId)).items.map((i) => i.id)).not.toContain(mine!.id);
  });

  it("works as the signed-in user under RLS", async () => {
    const created = await r.as(r.A.ownerId, (tx) => repos.ideas.createMany(tx, r.A.ownerId, [card(4), card(5)]));
    expect(created.every((i) => i.current?.id === i.currentVersionId)).toBe(true);
    // Another user cannot read them through RLS either.
    const seenByB = await r.as(r.B.ownerId, (tx) => repos.ideas.listForUser(tx, r.B.ownerId));
    expect(seenByB.items.map((i) => i.id)).not.toContain(created[0]!.id);
  });

  it("rejects an invalid idea without writing any of the batch", async () => {
    const before = (await repos.ideas.listForUser(r.db, r.A.ownerId, { limit: 500 })).items.length;
    await expect(repos.ideas.createMany(r.db, r.A.ownerId, [card(6), { ...card(7), title: "" }])).rejects.toThrow();
    expect((await repos.ideas.listForUser(r.db, r.A.ownerId, { limit: 500 })).items.length).toBe(before);
  });
});
