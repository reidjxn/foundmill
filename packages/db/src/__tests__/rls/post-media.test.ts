/**
 * 0103 `post_media` (a post draft's media: a short video and a voiceover on the founder's own accounts).
 *
 * One row per draft and kind, so it is not in the generated cross-tenant suite; this file covers tenancy by hand and
 * what only this table has:
 *   - members of the business read its rows (file included, as they read the draft); nobody reads another business's;
 *     a non-member and anon read nothing;
 *   - no app role writes, not even the project's own owner: only the service makes a row ready;
 *   - a row's draft must be the same business's;
 *   - a simulated row never has a file and is never ready, whoever writes it;
 *   - `store` holds the size per file and the project's total, and a stored file round-trips byte for byte.
 */
import { POST_MEDIA_LIMITS } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;
let draftA: string;
let draftB: string;

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

const draft = async (businessId: string) =>
  (await h.service().run((tx) => tx.insert(s.assets).values({ businessId, kind: "post", title: "A post about your page going live", body: "Our page is live.", approvalState: "draft", contentRef: `post-draft:page_published:page_live:${crypto.randomUUID()}` }).returning({ id: s.assets.id })))[0]!.id;

const clip = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "media-a");
  B = await createBusinessFixture(h, "media-b");
  outsiderId = await h.createUser("media-outsider@test.local");
  draftA = await draft(A.businessId);
  draftB = await draft(B.businessId);
}, 120_000);
afterAll(() => h?.close());

describe("post_media: tenancy", () => {
  it("every member reads their own business's media and never another's; outsiders and anon read nothing", async () => {
    const a = await h.service().run((tx) => repos.postMedia.open(tx, A.businessId, { assetId: draftA, kind: "video", connectorKey: "runway" }));
    await h.service().run((tx) => repos.postMedia.open(tx, B.businessId, { assetId: draftB, kind: "video", connectorKey: "runway" }));
    await h.service().run((tx) => repos.postMedia.store(tx, A.businessId, a.row.id, { content: clip(64), mime: "video/mp4", durationSeconds: 5 }));
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      const rows = await h.asUser(userId).run((tx) => tx.select({ id: s.postMedia.id, businessId: s.postMedia.businessId }).from(s.postMedia));
      expect(rows.map((r) => r.businessId)).toEqual([A.businessId]);
      expect(await h.asUser(userId).run((tx) => repos.postMedia.forAssets(tx, B.businessId, [draftB]))).toHaveLength(0);
      expect((await h.asUser(userId).run((tx) => repos.postMedia.content(tx, A.businessId, a.row.id)))?.content.byteLength).toBe(64);
    }
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.postMedia))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.postMedia)));
  });

  it("no app role writes: not the owner, not another business's member", async () => {
    const [row] = await h.service().run((tx) => tx.select({ id: s.postMedia.id }).from(s.postMedia).where(eq(s.postMedia.businessId, A.businessId)));
    for (const userId of [A.ownerId, A.adminId, A.memberId, B.ownerId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.postMedia).set({ state: "declined" }).where(eq(s.postMedia.id, row!.id)).returning({ id: s.postMedia.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.postMedia).where(eq(s.postMedia.id, row!.id)).returning({ id: s.postMedia.id })));
    }
    const fresh = await draft(A.businessId);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.postMedia).values({ businessId: A.businessId, assetId: fresh, kind: "video", state: "asking", connectorKey: "runway" }))).rejects.toThrow(RLS_DENIED);
    expect((await repos.postMedia.get(h.db as never, A.businessId, row!.id))?.state).toBe("ready");
  });

  it("a row's draft must be its own business's", async () => {
    await expect(h.service().run((tx) => tx.insert(s.postMedia).values({ businessId: A.businessId, assetId: draftB, kind: "voiceover", state: "asking", connectorKey: "elevenlabs_voice" }))).rejects.toThrow(/another business/);
    await expect(h.service().run((tx) => repos.postMedia.open(tx, A.businessId, { assetId: draftB, kind: "voiceover", connectorKey: "elevenlabs_voice" }))).rejects.toThrow(/another business/);
  });
});

describe("post_media: what only this table has", () => {
  it("opens once per draft and kind", async () => {
    const d = await draft(A.businessId);
    const first = await h.service().run((tx) => repos.postMedia.open(tx, A.businessId, { assetId: d, kind: "voiceover", connectorKey: "elevenlabs_voice" }));
    const again = await h.service().run((tx) => repos.postMedia.open(tx, A.businessId, { assetId: d, kind: "voiceover", connectorKey: "elevenlabs_voice" }));
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, row: { id: first.row.id, state: "asking" } });
  });

  it("a simulated row keeps no file, is never ready and is final", async () => {
    const d = await draft(A.businessId);
    const { row } = await h.service().run((tx) => repos.postMedia.open(tx, A.businessId, { assetId: d, kind: "video", connectorKey: "runway" }));
    const sim = await h.service().run((tx) => repos.postMedia.markSimulated(tx, A.businessId, row.id, { durationSeconds: 5 }));
    expect(sim).toMatchObject({ state: "simulated", simulated: true, sizeBytes: null, sha256: null });
    expect(await h.service().run((tx) => repos.postMedia.store(tx, A.businessId, row.id, { content: clip(10), mime: "video/mp4" }))).toEqual({ stored: false, reason: "simulated" });
    expect(await h.service().run((tx) => repos.postMedia.update(tx, A.businessId, row.id, { state: "making" }))).toBeNull();
    expect(await h.service().run((tx) => repos.postMedia.content(tx, A.businessId, row.id))).toBeNull();
    // The table says the same to anyone who writes around the repository.
    await expect(h.service().run((tx) => tx.update(s.postMedia).set({ content: clip(4) }).where(eq(s.postMedia.id, row.id)))).rejects.toThrow(/post_media_simulated_has_no_file/);
    await expect(h.service().run((tx) => tx.update(s.postMedia).set({ state: "ready" }).where(eq(s.postMedia.id, row.id)))).rejects.toThrow(/post_media_simulated_is_never_ready|post_media_ready_has_file/);
  });

  it("stores a real file byte for byte, and refuses one too large for its kind or past the project's total", async () => {
    const d = await draft(B.businessId);
    const voice = await h.service().run((tx) => repos.postMedia.open(tx, B.businessId, { assetId: d, kind: "voiceover", connectorKey: "elevenlabs_voice" }));
    const audio = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2, 3]);
    const stored = await h.service().run((tx) => repos.postMedia.store(tx, B.businessId, voice.row.id, { content: audio, mime: "audio/mpeg", durationSeconds: 3 }));
    expect(stored).toMatchObject({ stored: true, row: { state: "ready", mime: "audio/mpeg", sizeBytes: audio.byteLength, simulated: false } });
    const read = await repos.postMedia.content(h.db as never, B.businessId, voice.row.id);
    expect(new Uint8Array(read!.content)).toEqual(audio);

    const tooBig = await h.service().run((tx) => repos.postMedia.open(tx, B.businessId, { assetId: d, kind: "video", connectorKey: "runway" }));
    const over = await h.service().run((tx) => repos.postMedia.store(tx, B.businessId, tooBig.row.id, { content: new Uint8Array(POST_MEDIA_LIMITS.voiceoverMaxBytes + 1), mime: "video/mp4" }, { perProjectBytes: 64 }));
    expect(over).toEqual({ stored: false, reason: "storage_full" });
    expect((await repos.postMedia.get(h.db as never, B.businessId, tooBig.row.id))).toMatchObject({ state: "failed", errorCode: "storage_full" });

    const d2 = await draft(B.businessId);
    const voice2 = await h.service().run((tx) => repos.postMedia.open(tx, B.businessId, { assetId: d2, kind: "voiceover", connectorKey: "elevenlabs_voice" }));
    expect(await h.service().run((tx) => repos.postMedia.store(tx, B.businessId, voice2.row.id, { content: new Uint8Array(POST_MEDIA_LIMITS.voiceoverMaxBytes + 1), mime: "audio/mpeg" }))).toEqual({ stored: false, reason: "too_large" });
  });

  it("goes with its draft", async () => {
    const d = await draft(A.businessId);
    const { row } = await h.service().run((tx) => repos.postMedia.open(tx, A.businessId, { assetId: d, kind: "video", connectorKey: "runway" }));
    await h.service().run((tx) => tx.delete(s.assets).where(eq(s.assets.id, d)));
    expect(await repos.postMedia.get(h.db as never, A.businessId, row.id)).toBeNull();
  });
});
