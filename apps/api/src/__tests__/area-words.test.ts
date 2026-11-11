/**
 * business.areas.words (mobile, Nov 11, 2026): every founder area's opening sentence as one read, built by the same
 * shared builders the web's AreaOpening uses, as the reader may see it (a walled section answers null).
 */
import { repos } from "@foundmill/db";
import { ENTITY_MARKUP_RE, areaWordsText, founderJargonHits } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "areas" });
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
async function business() {
  n += 1;
  const [ownerId, walledId] = await Promise.all(["owner", "walled"].map((r) => hz.h.createUser(`areas-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `Areas ${n}`, archetype: "b2b_saas", currency: "GBP" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  // A member who may read only the Inbox: every area but Plan's goal part is walled for them.
  await repos.memberships.add(hz.db, b.id, { userId: walledId!, role: "member", sectionPermissions: { product: "none", development: "none", distribution: "none", finance: "none", legal: "none", team: "none", inbox: "read" } });
  const chief = await repos.agents.create(hz.db, b.id, { name: "Ines Park", agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  return { id: b.id, chief, owner: hz.caller({ userId: ownerId! }), walled: hz.caller({ userId: walledId! }) };
}

describe("business.areas.words", () => {
  it("answers every area for a fresh business in plain words, with the Chief of Staff as entity markup", async () => {
    const b = await business();
    const w = await b.owner.business.areas.words({ businessId: b.id });
    expect(w.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.money).toEqual({ text: "Connect your bank and this line shows your cash and how long it lasts.", provenance: null });
    expect(w.company).toEqual({ text: "Your company is not incorporated yet.", provenance: null });
    expect(w.plan?.text).toBe("No goal is set yet. Nothing is in Now on the roadmap yet.");
    expect(w.customers).toEqual({ text: "Selling has not started yet.", provenance: null });
    // No sign-off round was ever requested, so the stage is "building" and the line counts what went live.
    expect(w.product).toEqual({ text: "Nothing went live in the last 7 days and nothing waits for your go-ahead.", provenance: null });
    expect(w.team).toEqual({ text: `[[ent:${b.chief.id}|Ines Park]], your Chief of Staff, runs the team on its own so far.`, provenance: null });
    for (const words of [w.plan, w.customers, w.money, w.company, w.product, w.team]) {
      expect(words).not.toBeNull();
      expect(founderJargonHits(areaWordsText(words!).replace(ENTITY_MARKUP_RE, "$2")), words!.text).toEqual([]);
    }
  });

  it("counts the roadmap and the live changes the way the tabs do, with the Estimate label on the chip", async () => {
    const b = await business();
    const item = await repos.product.upsertRoadmapItem(hz.db, b.id, { title: "Booking flow", horizon: "now", targetEnd: "2099-12-04" });
    expect(item.horizon).toBe("now");
    const done = await repos.tasks.create(hz.db, b.id, { kind: "code", title: "tech", founderTitle: "Booking step", status: "ready" });
    await repos.tasks.setStatus(hz.db, b.id, done.id, "done", { force: true });
    const w = await b.owner.business.areas.words({ businessId: b.id });
    expect(w.plan).toEqual({ text: "No goal is set yet. 1 thing is in Now, due Dec 4, 2099.", provenance: "estimate" });
    // The done code task landed through the merge queue (no GitHub event), which counts as a change gone live, as dev.prs.list counts it.
    expect(w.product).toEqual({ text: "1 change went live in the last 7 days and nothing waits for your go-ahead.", provenance: null });
    const waiting = await repos.tasks.create(hz.db, b.id, { kind: "code", title: "ui", founderTitle: "Refill page", status: "ready" });
    await repos.tasks.setStatus(hz.db, b.id, waiting.id, "review", { force: true });
    expect((await b.owner.business.areas.words({ businessId: b.id })).product?.text).toBe("1 change went live in the last 7 days and 1 waits for your go-ahead.");
  });

  it("answers null for every area the reader is walled from, and never a made-up sentence", async () => {
    const b = await business();
    const w = await b.walled.business.areas.words({ businessId: b.id });
    expect(w.money).toBeNull();
    expect(w.company).toBeNull();
    expect(w.customers).toBeNull();
    expect(w.product).toBeNull();
    expect(w.team).toBeNull();
    // Plan keeps the goal part (goalView masks what it must) and leaves the roadmap out.
    expect(w.plan?.text).toBe("No goal is set yet.");
  });

  it("refuses a user of another business", async () => {
    const a = await business();
    const other = await business();
    await expect(other.owner.business.areas.words({ businessId: a.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
