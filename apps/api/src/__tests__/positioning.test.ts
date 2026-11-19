/**
 * positioning.* — the project's positioning notes on Product › Vision (services/positioning.ts, 0117; WP-08 T1), on the
 * mock model. The team's draft is never what prompts read; a member edits the waiting copy; only an owner or an admin
 * approves; approval bumps the version and writes `positioning.approved` through the outbox; a collaborator cannot
 * approve.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "positioning" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

let n = 0;
async function project() {
  n += 1;
  const [ownerId, memberId, collaboratorId] = await Promise.all(["owner", "member", "collab"].map((r) => hz.h.createUser(`pos-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `Saturday Loaf ${n}`, archetype: "services" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "services" });
  await repos.foundations.create(hz.db, b.id, { door: "ideation" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  await repos.memberships.add(hz.db, b.id, { userId: collaboratorId!, role: "collaborator" });
  return { id: b.id, owner: hz.caller({ userId: ownerId! }), member: hz.caller({ userId: memberId! }), collaborator: hz.caller({ userId: collaboratorId! }) };
}

const events = async (businessId: string, type: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === type).map((o) => o.event);
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "error");

const notes = {
  oneLine: "A fresh sourdough loaf on your porch every Saturday.",
  step: "follow" as const,
  forWhom: [{ text: "People within two miles who buy good bread most weeks.", label: "assumption" as const, source: "ask six neighbors" }],
  problem: [],
  today: [],
  different: [],
  proof: [{ text: "I bake every weekend.", label: "founder" as const, source: "your words" }],
};

describe("positioning", () => {
  it("requestDraft writes a waiting copy once; prompts read nothing until a founder approves", async () => {
    const b = await project();
    const view = await b.member.positioning.requestDraft({ businessId: b.id });
    expect(view.draft?.oneLine).toBeTruthy();
    expect(view.approved).toBeNull();
    expect(view.text).toBe("");
    expect(await repos.positioning.approvedText(hz.db, b.id)).toBeNull();
    expect(await code(b.member.positioning.requestDraft({ businessId: b.id }))).toBe("BAD_REQUEST");
  });

  it("a member saves an edit; a member and a collaborator cannot approve; the owner approves and the version goes up", async () => {
    const b = await project();
    await b.member.positioning.requestDraft({ businessId: b.id });
    const saved = await b.member.positioning.save({ businessId: b.id, notes });
    expect(saved.draft?.oneLine).toBe(notes.oneLine);
    expect(await code(b.member.positioning.approve({ businessId: b.id, notes }))).toBe("FORBIDDEN");
    expect(await code(b.collaborator.positioning.approve({ businessId: b.id, notes }))).toBe("FORBIDDEN");

    const first = await b.owner.positioning.approve({ businessId: b.id, notes });
    expect(first.approved?.version).toBe(1);
    expect(first.draft).toBeNull();
    expect(first.text).toContain("One line: A fresh sourdough loaf");
    const second = await b.owner.positioning.approve({ businessId: b.id, notes: { ...notes, oneLine: "Sourdough on your porch, Saturdays." } });
    expect(second.approved?.version).toBe(2);
    const emitted = await events(b.id, "positioning.approved");
    expect(emitted.map((e) => e.payload)).toEqual([
      { version: 1, sectionsChanged: expect.arrayContaining(["oneLine", "forWhom"]) },
      { version: 2, sectionsChanged: ["oneLine"] },
    ]);
    expect(await repos.positioning.approvedText(hz.db, b.id)).toContain("Version: v2");
  });

  it("refuses to approve a line that claims a source it does not name", async () => {
    const b = await project();
    await b.member.positioning.requestDraft({ businessId: b.id });
    const bad = { ...notes, proof: [{ text: "Neighbors love it.", label: "customer" as const, source: null }] };
    expect(await code(b.owner.positioning.approve({ businessId: b.id, notes: bad }))).toBe("BAD_REQUEST");
  });

  it("another business's member reads nothing of it", async () => {
    const a = await project();
    const other = await project();
    await a.owner.positioning.save({ businessId: a.id, notes });
    expect(await code(other.owner.positioning.get({ businessId: a.id }))).toBe("FORBIDDEN");
  });
});
