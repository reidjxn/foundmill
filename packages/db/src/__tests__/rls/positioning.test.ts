/**
 * 0117 `business_foundations.positioning` and `positioning_draft` (WP-08 T1): columns on the foundations row, so they
 * carry its 0018 policies. Members of A read A's notes and nobody reads them from B; no app role writes them (the api
 * writes on the service connection after its own checks). The repo raises the team's note once while it is open, and an
 * approval bumps the version and clears the waiting copy.
 */
import { emptyPositioning, POSITIONING_NOTE, type PositioningNotes } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { repos } from "../../repos";
import { agents, businessFoundations } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

const notesOf = (slug: string): PositioningNotes => ({ ...emptyPositioning(`${slug}: bread on your porch`, "2026-11-15"), forWhom: [{ text: `${slug} neighbors`, label: "assumption", source: "ask six of them" }] });

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "alpha");
  B = await createBusinessFixture(h, "bravo");
  for (const f of [A, B]) {
    await h.service().run(async (tx) => {
      await repos.foundations.create(tx, f.businessId, { door: "ideation" });
    });
  }
}, 120_000);
afterAll(() => h?.close());

const readNotes = (businessId: string) => (tx: DbTx) => tx.select({ positioning: businessFoundations.positioning, draft: businessFoundations.positioningDraft }).from(businessFoundations).where(eq(businessFoundations.businessId, businessId));

describe("positioning notes (0117)", () => {
  it("writes a draft once with one note, and a first-draft run on a project that has one writes nothing", async () => {
    const agentId = await h.service().run(async (tx) => (await tx.select({ id: agents.id }).from(agents).where(eq(agents.businessId, A.businessId)).limit(1))[0]?.id ?? null);
    const first = await h.service().run((tx) => repos.positioning.writeDraft(tx, A.businessId, { notes: notesOf("alpha"), agentId, note: true, onlyIfEmpty: true }));
    expect(first.written).toBe(true);
    if (agentId) expect(first.item?.subject).toBe(POSITIONING_NOTE.subject);
    const again = await h.service().run((tx) => repos.positioning.writeDraft(tx, A.businessId, { notes: notesOf("alpha"), agentId, note: true, onlyIfEmpty: true }));
    expect(again).toEqual({ written: false, item: null });
    const proposed = await h.service().run((tx) => repos.positioning.writeDraft(tx, A.businessId, { notes: notesOf("alpha"), agentId, note: true }));
    expect(proposed.written).toBe(true);
    expect(proposed.item).toBeNull();
  });

  it("approve bumps the version, records the change, clears the draft; only the approved copy reaches a prompt", async () => {
    expect(await h.service().run((tx) => repos.positioning.approvedText(tx, A.businessId))).toBeNull();
    const out = await h.service().run((tx) => repos.positioning.approve(tx, A.businessId, { notes: notesOf("alpha"), userId: A.ownerId, at: new Date("2026-11-16T10:00:00Z") }));
    expect(out?.notes.version).toBe(1);
    expect(out?.notes.changes[0]).toEqual({ version: 1, on: "2026-11-16", note: "First version approved." });
    const copies = await h.service().run((tx) => repos.positioning.get(tx, A.businessId));
    expect(copies.draft).toBeNull();
    expect(copies.approved?.oneLine).toBe("alpha: bread on your porch");
    const text = await h.service().run((tx) => repos.positioning.approvedText(tx, A.businessId));
    expect(text).toContain("Version: v1, Nov 16, 2026");
    const second = await h.service().run((tx) => repos.positioning.approve(tx, A.businessId, { notes: { ...notesOf("alpha"), oneLine: "alpha: bread every Saturday" }, userId: A.ownerId }));
    expect(second?.notes.version).toBe(2);
    expect(second?.sectionsChanged).toEqual(["oneLine"]);
  });

  it("members of A read A's notes; nobody reads them from B", async () => {
    for (const userId of [A.ownerId, A.memberId]) {
      const own = await h.asUser(userId).run(readNotes(A.businessId));
      expect(own[0]?.positioning).toMatchObject({ oneLine: "alpha: bread every Saturday" });
    }
    for (const userId of [B.ownerId, B.memberId]) expect(await h.asUser(userId).run(readNotes(A.businessId))).toEqual([]);
  });

  it("no app role writes it, not even A's owner", async () => {
    try {
      const rows = await h.asUser(A.ownerId).run((tx) => tx.update(businessFoundations).set({ positioning: { oneLine: "tampered" } }).where(eq(businessFoundations.businessId, A.businessId)).returning({ id: businessFoundations.id }));
      expect(rows).toHaveLength(0);
    } catch (err) {
      expect((err as Error).message).toMatch(RLS_DENIED);
    }
    const after = await h.service().run((tx) => repos.positioning.get(tx, A.businessId));
    expect(after.approved?.oneLine).toBe("alpha: bread every Saturday");
  });
});
