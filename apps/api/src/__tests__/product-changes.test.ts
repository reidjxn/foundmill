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
    const forged = await owner.product.sources.add({ businessId, kind: "doc", uri: null, title: "Note", relevance: { notes: "Pasted text" }, ...({ fetchedAt: new Date(), embedding: null } as object) } as never);
    expect(forged.fetchedAt).toBeNull();
    expect(forged.relevance).toEqual({ notes: "Pasted text", summary: "Pasted text", addedBy: "user" });
    await expect(owner.product.sources.add({ businessId, kind: "doc", uri: "file:///etc/passwd", title: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
