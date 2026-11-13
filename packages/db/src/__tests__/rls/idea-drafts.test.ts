/**
 * idea_drafts and waitlist_entries (0086; docs/IDEA_BOX.md): the landing page's anonymous cards and the waitlist. No
 * client role reads or writes either table; the api's connection does everything through `repos.ideaDrafts` and
 * `repos.waitlist`. Claiming moves the card into the claimer's deck once, and to nobody else.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDEA_DRAFT_HOLD_MS, IDEA_DRAFT_TTL_MS, ideaDraftsRepo, waitlistRepo } from "../../repos/idea-drafts";
import type { CreateIdeaInput } from "../../repos/ideas";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";

let h: TestHarness;
let ada: string;
let bo: string;

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada-drafts@test.local");
  bo = await h.createUser("bo-drafts@test.local");
});
afterAll(() => h?.close());

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const card = { id: "tutor-ai", name: "Tutorlane", pitch: "An AI teaching assistant for independent tutors", archetype: "b2b_saas", stars_current: 3, stars_potential: 4, attributes: [], citations: [], crest_seed: "t" };
const toIdea = (row: s.IdeaDraftRow): CreateIdeaInput => ({ title: (row.card as typeof card).name, pitch: (row.card as typeof card).pitch, archetype: "b2b_saas", attributes: {}, starsCurrent: 3, starsPotential: 4, research: { citations: [] }, action: "generated" });
const draft = (name: string, now = new Date()) => ideaDraftsRepo.create(h.db, { tokenHash: hash(`t-${name}`), claimHash: hash(`c-${name}`), prompt: "tutors", interest: null, card, modelMode: "mock", costMicro: 1200, now });

describe("idea_drafts and waitlist_entries", () => {
  it("no client role reads or writes them", async () => {
    await draft("hidden");
    for (const role of [() => h.anon(), () => h.asUser(ada)]) {
      await expect(role().run((tx) => tx.select().from(s.ideaDrafts))).rejects.toThrow(/permission denied/);
      await expect(role().run((tx) => tx.select().from(s.waitlistEntries))).rejects.toThrow(/permission denied/);
      await expect(role().run((tx) => tx.insert(s.ideaDrafts).values({ tokenHash: hash("x"), card, modelMode: "mock", expiresAt: new Date() }))).rejects.toThrow(/permission denied/);
    }
  });

  it("stores only hashes, and finds a live draft by the browser's token", async () => {
    await expect(ideaDraftsRepo.create(h.db, { tokenHash: "plain-token", claimHash: hash("c"), prompt: "", interest: null, card, modelMode: "mock", costMicro: 0 })).rejects.toThrow(/SHA-256/);
    const now = new Date("2026-11-13T10:00:00Z");
    const row = await draft("find", now);
    expect(row.expiresAt.getTime() - now.getTime()).toBe(IDEA_DRAFT_TTL_MS);
    expect((await ideaDraftsRepo.liveByToken(h.db, hash("t-find"), now))?.id).toBe(row.id);
    expect(await ideaDraftsRepo.liveByToken(h.db, hash("t-find"), new Date(now.getTime() + IDEA_DRAFT_TTL_MS + 1))).toBeNull();
    expect(await ideaDraftsRepo.liveByToken(h.db, "t-find", now)).toBeNull();
  });

  it("claims into the claimer's deck once; the same person gets the same idea again, anyone else nothing", async () => {
    await draft("claim");
    const first = await ideaDraftsRepo.claim(h.db, { userId: ada, hash: hash("t-claim"), by: "token", toIdea });
    expect(first).toMatchObject({ status: "claimed", again: false });
    const ideaId = (first as { ideaId: string }).ideaId;
    const [idea] = await h.db.select().from(s.ideas).where(eq(s.ideas.id, ideaId));
    expect([idea!.ownerUserId, idea!.title]).toEqual([ada, "Tutorlane"]);
    expect(await ideaDraftsRepo.claim(h.db, { userId: ada, hash: hash("t-claim"), by: "token", toIdea })).toEqual({ status: "claimed", ideaId, draftId: (first as { draftId: string }).draftId, again: true });
    expect(await ideaDraftsRepo.claim(h.db, { userId: bo, hash: hash("t-claim"), by: "token", toIdea })).toEqual({ status: "none" });
    // The email's claim token worked once and is gone.
    expect(await ideaDraftsRepo.claim(h.db, { userId: ada, hash: hash("c-claim"), by: "claim", toIdea })).toEqual({ status: "none" });
    expect(await ideaDraftsRepo.liveByToken(h.db, hash("t-claim"))).toBeNull();
    expect((await h.db.select().from(s.ideas).where(eq(s.ideas.ownerUserId, bo))).length).toBe(0);
  });

  it("claims with the email's claim token on another device", async () => {
    await draft("other-device");
    const res = await ideaDraftsRepo.claim(h.db, { userId: bo, hash: hash("c-other-device"), by: "claim", toIdea });
    expect(res.status).toBe("claimed");
  });

  it("an expired draft is not claimed; a held one is, until the hold ends; the sweep deletes what is past its time", async () => {
    const then = new Date("2026-10-01T10:00:00Z");
    await draft("old", then);
    await draft("held", then);
    const holdUntil = new Date(then.getTime() + IDEA_DRAFT_HOLD_MS);
    expect(await ideaDraftsRepo.hold(h.db, hash("t-held"), holdUntil, then)).not.toBeNull();
    const later = new Date(then.getTime() + IDEA_DRAFT_TTL_MS + 60_000);
    expect(await ideaDraftsRepo.claim(h.db, { userId: ada, hash: hash("t-old"), by: "token", toIdea, now: later })).toEqual({ status: "none" });
    expect(await ideaDraftsRepo.sweep(h.db, later)).toBeGreaterThanOrEqual(1);
    expect(await h.db.select().from(s.ideaDrafts).where(eq(s.ideaDrafts.tokenHash, hash("t-old")))).toHaveLength(0);
    expect((await ideaDraftsRepo.claim(h.db, { userId: ada, hash: hash("t-held"), by: "token", toIdea, now: later })).status).toBe("claimed");
    // Released, a held draft falls back to its own expiry.
    await draft("released", then);
    await ideaDraftsRepo.hold(h.db, hash("t-released"), holdUntil, then);
    expect(await ideaDraftsRepo.releaseHold(h.db, hash("t-released"))).toBe(true);
    expect(await ideaDraftsRepo.liveByToken(h.db, hash("t-released"), later)).toBeNull();
  });

  it("adds up what today's drafts cost", async () => {
    const since = new Date(Date.now() - 60_000);
    const before = await ideaDraftsRepo.spentSince(h.db, since);
    await draft("spend-1");
    await draft("spend-2");
    expect((await ideaDraftsRepo.spentSince(h.db, since)) - before).toBe(2400);
    expect(await ideaDraftsRepo.spentSince(h.db, new Date(Date.now() + 2 * 24 * 60 * 60_000))).toBe(0);
  });

  it("the waitlist keeps one entry per person and the draft they want to keep", async () => {
    const row = await draft("wait");
    const a = await waitlistRepo.join(h.db, { userId: bo, email: " Bo-Drafts@Test.local ", ideaDraftId: row.id });
    expect([a.email, a.ideaDraftId]).toEqual(["bo-drafts@test.local", row.id]);
    const b = await waitlistRepo.join(h.db, { userId: bo, email: "bo-drafts@test.local", ideaDraftId: null });
    expect([b.id, b.ideaDraftId]).toEqual([a.id, row.id]);
    expect((await waitlistRepo.get(h.db, bo))?.id).toBe(a.id);
  });
});
