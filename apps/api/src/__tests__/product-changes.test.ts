/**
 * Product › Changes and Sources through the API (BUILD §11.5, AC-11.5.2): deciding the last hunk of a proposal writes
 * the accepted text into the spec, publishes the next version and announces it (`spec.version_published` through the
 * outbox, with the hunk counts); adding a source announces it (`source.added`) and starts the Source Watcher.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const doc = (...paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
const text = (d: unknown) => JSON.stringify(d).match(/"text":"([^"]*)"/g)?.map((m) => m.slice(8, -1)).join("\n") ?? "";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "prodchg", temporalClient: temporal });
}, 120_000);
afterAll(() => hz?.close());

describe("product.proposals", () => {
  it("accepting 2 of 3 hunks changes those blocks and publishes one version with spec.version_published (AC-11.5.2)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const pricing = await repos.product.createBlock(hz.db, businessId, { section: "Pricing", content: doc("Refills cost £38 per quarter.") });
    const features = await repos.product.createBlock(hz.db, businessId, { section: "Features", content: doc("Pause and skip.") });
    const customers = await repos.product.createBlock(hz.db, businessId, { section: "Customers", content: doc("Reactive skin.") });
    await owner.product.spec.publish({ businessId, changelogMd: "v1" });
    const proposal = await repos.product.createProposal(hz.db, businessId, {
      title: "Interview panel",
      proposedByAgentId: agentId,
      hunks: [
        { specBlockId: pricing.id, theirs: doc("Refills cost £34 per quarter.") },
        { specBlockId: features.id, theirs: doc("Pause and skip.", "A reaction diary.") },
        { specBlockId: customers.id, theirs: doc("Reactive skin, referred by clinics.") },
      ],
    });
    const [h1, h2, h3] = proposal.hunks.sort((a, b) => a.position - b.position);

    const afterFirst = await owner.product.proposals.decideHunk({ businessId, hunkId: h1!.id, decision: "accepted" });
    expect(afterFirst).toMatchObject({ status: "open", publishedVersion: null });
    expect(text((await owner.product.spec.get({ businessId, section: "Pricing" })).blocks[0]!.content)).toContain("£34");

    await owner.product.proposals.decideHunk({ businessId, hunkId: h2!.id, decision: "rejected" });
    const settled = await owner.product.proposals.decideHunk({ businessId, hunkId: h3!.id, decision: "edited", edited: doc("Reactive skin; some referred by an online clinic.") });
    expect(settled.status).toBe("partially_accepted");
    expect(settled.publishedVersion).toMatchObject({ version: 2, publishedBy: ownerId });

    const spec = await owner.product.spec.get({ businessId });
    expect(spec.versionCount).toBe(2);
    expect(text(spec.blocks.find((b) => b.id === features.id)!.content)).toBe("Pause and skip.");
    expect(text(spec.blocks.find((b) => b.id === customers.id)!.content)).toBe("Reactive skin; some referred by an online clinic.");

    const events = await repos.events.list(hz.db, businessId, { type: "spec.version_published", limit: 10 });
    const published = events.items.find((e) => (e.payload as { proposalId?: string }).proposalId === proposal.id);
    expect(published?.payload).toMatchObject({ version: 2, previousVersion: 1, hunksAccepted: 1, hunksRejected: 1, hunksEdited: 1 });
    expect(new Set((published!.payload as { changedBlockIds: string[] }).changedBlockIds)).toEqual(new Set([pricing.id, customers.id]));
    const audit = await repos.audit.list(hz.db, businessId, { action: ["product.spec.publish"] });
    expect(audit.items.some((a) => (a.details as { proposalId?: string }).proposalId === proposal.id)).toBe(true);
  });

  it("accept all publishes; a decided hunk cannot be decided differently; viewers cannot decide", async () => {
    const { businessId, ownerId, viewerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const block = await repos.product.createBlock(hz.db, businessId, { section: "Risks", content: doc("Supply.") });
    const p = await repos.product.createProposal(hz.db, businessId, { title: "Risks", hunks: [{ specBlockId: block.id, theirs: doc("Supply.", "Regulation.") }] });
    await expect(hz.caller({ userId: viewerId }).product.proposals.acceptAll({ businessId, proposalId: p.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await owner.product.proposals.acceptAll({ businessId, proposalId: p.id });
    expect(res.status).toBe("accepted");
    expect(res.publishedVersion).not.toBeNull();
    await expect(owner.product.proposals.decideHunk({ businessId, hunkId: p.hunks[0]!.id, decision: "rejected" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("product.spec.publish", () => {
  it("numbers simultaneous publishes consecutively and publishes a repeated press once (TPD-18, ARB-22)", async () => {
    const { businessId, ownerId, adminId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    const admin = hz.caller({ userId: adminId });
    await repos.product.createBlock(hz.db, businessId, { section: "Problem", content: doc("Invoices go unpaid.") });
    const before = (await owner.product.spec.versions({ businessId })).length;

    // Two members publish different changelogs at the same moment: both land, one number each.
    const [a, b] = await Promise.all([owner.product.spec.publish({ businessId, changelogMd: "Owner's pass" }), admin.product.spec.publish({ businessId, changelogMd: "Admin's pass" })]);
    expect(new Set([a.version, b.version])).toEqual(new Set([before + 1, before + 2]));

    // The same press twice (two tabs): one new version, announced once; the second answer is that version.
    const [c, d] = await Promise.all([owner.product.spec.publish({ businessId, changelogMd: "Pricing final" }), owner.product.spec.publish({ businessId, changelogMd: "Pricing final" })]);
    expect(c.id).toBe(d.id);
    expect(c.version).toBe(before + 3);
    const versions = await owner.product.spec.versions({ businessId });
    expect(versions.map((v) => v.version)).toEqual([before + 3, before + 2, before + 1, ...Array.from({ length: before }, (_, i) => before - i)]);
    const events = await repos.events.list(hz.db, businessId, { type: "spec.version_published", limit: 50 });
    expect(events.items.filter((e) => (e.payload as { specVersionId: string }).specVersionId === c.id)).toHaveLength(1);
    expect(events.items.find((e) => (e.payload as { specVersionId: string }).specVersionId === c.id)?.payload).toMatchObject({ version: before + 3, previousVersion: before + 2 });

    // A changed spec, or a new changelog on the same spec, is a new version.
    expect((await owner.product.spec.publish({ businessId, changelogMd: "Same blocks, new note" })).version).toBe(before + 4);
  });
});

describe("product.roadmap", () => {
  it("link adds spec blocks and keeps the item's dates, confidence, owner and horizon (ARB-16)", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const block = await repos.product.createBlock(hz.db, businessId, { section: "Features", content: doc("Reminders.") });
    const item = await owner.product.roadmap.upsert({ businessId, title: "Annual billing", horizon: "later", targetStart: "2026-11-02", targetEnd: "2026-12-20", confidence: 5, ownerRef: { kind: "user", id: ownerId } });
    const linked = await owner.product.roadmap.link({ businessId, itemId: item.id, specBlockIds: [block.id] });
    expect(linked).toMatchObject({ horizon: "later", targetStart: "2026-11-02", targetEnd: "2026-12-20", confidence: 5, ownerRef: { kind: "user", id: ownerId }, specBlockIds: [block.id] });
    // Linking the same block again changes nothing; a block of another business is refused and nothing is stored.
    expect((await owner.product.roadmap.link({ businessId, itemId: item.id, specBlockIds: [block.id] })).specBlockIds).toEqual([block.id]);
    await expect(owner.product.roadmap.link({ businessId, itemId: item.id, specBlockIds: [hz.B.specBlockId] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.product.getRoadmapItem(hz.db, businessId, item.id)).specBlockIds).toEqual([block.id]);
  });

  it("move puts a card where it was dropped, a move and its reverse bring it back, and a column can be reordered (TPD-34)", async () => {
    const { businessId, ownerId, viewerId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    // A board with only this test's cards (the fixture seeds one item of its own).
    for (const i of await repos.product.listRoadmap(hz.db, businessId)) await repos.product.archiveRoadmapItem(hz.db, businessId, i.id);
    const make = (title: string, horizon: "now" | "next" | "later", position: number) => owner.product.roadmap.upsert({ businessId, title, horizon, position, targetEnd: "2027-01-24", confidence: 4 });
    const next = [await make("Bank feeds", "next", 2), await make("Multi-currency matching", "next", 3), await make("Receipts", "next", 4)];
    const later = [await make("Accountant portal", "later", 5), await make("Tax packs", "later", 6), await make("Partner program", "later", 7)];
    const ours = new Set([...next, ...later].map((i) => i.id));
    const column = async (h: "now" | "next" | "later") =>
      (await owner.product.roadmap.list({ businessId, horizon: h })).items
        .filter((i) => ours.has(i.id))
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
        .map((i) => i.title);
    const partner = later[2]!;

    // Alt+← sends it to the end of Next; Alt+→ brings it back to the end of Later, where it started.
    await owner.product.roadmap.move({ businessId, itemId: partner.id, horizon: "next", index: 3 });
    expect(await column("next")).toEqual(["Bank feeds", "Multi-currency matching", "Receipts", "Partner program"]);
    await owner.product.roadmap.move({ businessId, itemId: partner.id, horizon: "later", index: 2 });
    expect(await column("later")).toEqual(["Accountant portal", "Tax packs", "Partner program"]);
    expect(await column("next")).toEqual(["Bank feeds", "Multi-currency matching", "Receipts"]);

    // Dropped above "Multi-currency matching" in Next: lands exactly there.
    await owner.product.roadmap.move({ businessId, itemId: partner.id, horizon: "next", index: 1 });
    expect(await column("next")).toEqual(["Bank feeds", "Partner program", "Multi-currency matching", "Receipts"]);
    // Reordered inside a column, and an index past the end is the bottom.
    await owner.product.roadmap.move({ businessId, itemId: next[0]!.id, horizon: "next", index: 99 });
    expect(await column("next")).toEqual(["Partner program", "Multi-currency matching", "Receipts", "Bank feeds"]);

    // Nothing but the horizon and the order changed.
    expect(await repos.product.getRoadmapItem(hz.db, businessId, partner.id)).toMatchObject({ title: "Partner program", targetEnd: "2027-01-24", confidence: 4, horizon: "next" });
    await expect(hz.caller({ userId: viewerId }).product.roadmap.move({ businessId, itemId: partner.id, horizon: "now", index: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Another business's item is not found from here.
    await expect(hz.caller({ userId: hz.A.ownerId }).product.roadmap.move({ businessId: hz.A.businessId, itemId: partner.id, horizon: "now", index: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("product.sources.add", () => {
  it("announces the source, keeps the founder's notes and starts the Source Watcher", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const added = await owner.product.sources.add({ businessId, kind: "competitor", uri: "https://competitor.example/pricing", title: "", relevance: { summary: "Their pricing page" } });
    expect(added.relevance).toEqual({ notes: "Their pricing page", summary: "Their pricing page", addedBy: "user" });
    expect(added.watch).toEqual({ queued: true });
    const start = temporal.starts.find((s) => s.type === "sourceWatch");
    expect(start).toEqual({ type: "sourceWatch", workflowId: `source-watch:${added.id}:added`, args: [{ businessId, sourceIds: [added.id], reason: "added" }] });
    const events = await repos.events.list(hz.db, businessId, { type: "source.added", limit: 5 });
    expect(events.items[0]?.payload).toMatchObject({ sourceId: added.id, kind: "competitor", uri: "https://competitor.example/pricing", addedBy: "user" });
  });

  it("never takes relevance, fetch times or non-web links from the client", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const forged = await owner.product.sources.add({ businessId, kind: "doc", uri: null, title: "Note", relevance: { notes: "Pasted text", ...({ imported: true, score: 1, untrusted: false } as object) }, ...({ fetchedAt: new Date(), embedding: Array.from({ length: 1024 }, () => 0.5), contentRef: "s3://anything" } as object) } as never);
    expect(forged.fetchedAt).toBeNull();
    expect(forged.contentRef).toBeNull();
    expect(forged.relevance).toEqual({ notes: "Pasted text", summary: "Pasted text", addedBy: "user" });
    expect((await repos.product.getSource(hz.db, businessId, forged.id)).embedding ?? null).toBeNull();
    await expect(owner.product.sources.add({ businessId, kind: "doc", uri: "file:///etc/passwd", title: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
