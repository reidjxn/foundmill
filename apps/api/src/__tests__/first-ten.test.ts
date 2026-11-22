/**
 * The first ten conversations (WP-08 T5; services/first-ten.ts): add a person, move them, record what they said. A
 * person of another business is not found; a reader without CRM write is refused; no event is written (a founder's own
 * note is never an outcome); `repos.positioning.heard` hands agents the "Said:" notes.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "firstten" });
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
async function project(name: string) {
  n += 1;
  const [ownerId, viewerId] = await Promise.all(["owner", "viewer"].map((r) => hz.h.createUser(`firstten-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: viewerId!, role: "viewer" });
  return { id: b.id, owner: hz.caller({ userId: ownerId! }), viewer: hz.caller({ userId: viewerId! }) };
}
const eventTypes = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).map((o) => o.event.type);

describe("crm.firstTen", () => {
  it("adds a person to \"To ask\", moves them, and records what they said (which moves them to \"Talked\")", async () => {
    const a = await project("Ten");
    const { entityId } = await a.owner.crm.firstTen.add({ businessId: a.id, name: "Sam Lee" });
    expect(await a.owner.crm.firstTen.list({ businessId: a.id })).toMatchObject({ people: [{ entityId, name: "Sam Lee", stage: "to_ask", words: null }], counts: { to_ask: 1, talked: 0 } });
    await a.owner.crm.firstTen.move({ businessId: a.id, entityId, stage: "asked" });
    await a.owner.crm.firstTen.heard({ businessId: a.id, entityId, words: "I fix my own bike, and it takes a whole Saturday." });
    const list = await a.owner.crm.firstTen.list({ businessId: a.id });
    expect(list.people[0]).toMatchObject({ stage: "talked", words: "I fix my own bike, and it takes a whole Saturday." });
    expect(list.counts).toMatchObject({ to_ask: 0, talked: 1 });
    expect((await repos.positioning.heard(hz.db, a.id)).map((h) => h.words)).toEqual(["I fix my own bike, and it takes a whole Saturday."]);
    // The person is a lead from the founder's own knowledge, never an outcome: no event of any kind.
    expect(await eventTypes(a.id)).toEqual([]);
    const entity = await repos.entities.get(hz.db, a.id, entityId);
    expect(entity).toMatchObject({ source: "first_ten", lawfulBasis: "The founder knows this person" });
  });

  it("a wins-it answer stays where the founder put it: only early stages move on", async () => {
    const a = await project("Stay");
    const { entityId } = await a.owner.crm.firstTen.add({ businessId: a.id, name: "Ana" });
    await a.owner.crm.firstTen.move({ businessId: a.id, entityId, stage: "wants_it" });
    await a.owner.crm.firstTen.heard({ businessId: a.id, entityId, words: "Yes, I would pay for that." });
    expect((await a.owner.crm.firstTen.list({ businessId: a.id })).people[0]!.stage).toBe("wants_it");
  });

  it("does not find another business's person, and a reader without write cannot add", async () => {
    const a = await project("Mine");
    const b = await project("Theirs");
    const { entityId } = await b.owner.crm.firstTen.add({ businessId: b.id, name: "Their person" });
    await expect(a.owner.crm.firstTen.move({ businessId: a.id, entityId, stage: "asked" })).rejects.toThrow();
    await expect(a.owner.crm.firstTen.heard({ businessId: a.id, entityId, words: "hello" })).rejects.toThrow();
    expect((await a.owner.crm.firstTen.list({ businessId: a.id })).people).toEqual([]);
    await expect(a.viewer.crm.firstTen.add({ businessId: a.id, name: "Nope" })).rejects.toThrow();
  });

  it("a CRM person who is not one of the first ten is not found here", async () => {
    const a = await project("Other");
    const entity = await repos.entities.create(hz.db, a.id, { kind: "person", displayName: "Someone", source: "user" });
    await repos.entities.addRole(hz.db, a.id, entity.id, { role: "lead", stage: "new" });
    await expect(a.owner.crm.firstTen.move({ businessId: a.id, entityId: entity.id, stage: "asked" })).rejects.toThrow();
    expect((await a.owner.crm.firstTen.list({ businessId: a.id })).people).toEqual([]);
  });
});
