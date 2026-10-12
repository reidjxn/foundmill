/**
 * Change proposals (BUILD §11.5, AC-11.5.2, AC-11.5.3): accepting a hunk writes it into the spec (three-way, keeping
 * edits made since the proposal), deciding the last hunk settles the proposal and publishes the next version with a
 * changelog, rejected hunks change nothing, and a decided hunk cannot be decided differently.
 */
import { ValidationError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { docText, mergeBlockContent, textDoc } from "../../repos/spec-merge";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("prod");
});
afterAll(() => r?.close());

const doc = (...paragraphs: string[]) => textDoc(paragraphs.join("\n\n"));

async function threeBlocks(businessId: string) {
  const pricing = await repos.product.createBlock(r.db, businessId, { section: "Pricing", content: doc("Refills cost £38 per quarter.", "Shipping is free over £40."), authoredByKind: "agent" });
  const features = await repos.product.createBlock(r.db, businessId, { section: "Features", content: doc("Subscriptions with pause and skip.") });
  const customers = await repos.product.createBlock(r.db, businessId, { section: "Customers", content: doc("People with reactive skin.") });
  await repos.product.publishVersion(r.db, businessId, { changelogMd: "v1" });
  return { pricing, features, customers };
}

describe("spec merge", () => {
  it("replaces when the block is unchanged, keeps edits made since elsewhere, and lets the decided side win a conflict", () => {
    const base = doc("A", "B", "C");
    expect(mergeBlockContent(base, base, doc("A", "B2", "C")).content).toEqual(doc("A", "B2", "C"));
    // A human changed C after the proposal; the proposal changed B: both survive.
    const merged = mergeBlockContent(base, doc("A", "B", "C human"), doc("A", "B2", "C"));
    expect(docText(merged.content)).toBe("A\n\nB2\n\nC human");
    expect(merged).toMatchObject({ merged: true, conflicts: 0 });
    // Both changed B: the hunk's side wins and the conflict is counted.
    const conflict = mergeBlockContent(base, doc("A", "B human", "C"), doc("A", "B2", "C"));
    expect(docText(conflict.content)).toBe("A\n\nB2\n\nC");
    expect(conflict.conflicts).toBe(1);
    // Additions on both sides at different places.
    expect(docText(mergeBlockContent(base, doc("Z", "A", "B", "C"), doc("A", "B", "C", "D")).content)).toBe("Z\n\nA\n\nB\n\nC\n\nD");
    // No base recorded: the hunk replaces.
    expect(mergeBlockContent(null, doc("X"), doc("Y")).content).toEqual(doc("Y"));
  });
});

describe("change proposals", () => {
  it("accepting 2 of 3 hunks writes them, leaves the rejected block alone and publishes one version with a changelog (AC-11.5.2)", async () => {
    const { businessId, ownerId, agentId } = r.A;
    const { pricing, features, customers } = await threeBlocks(businessId);
    const proposal = await repos.product.createProposal(r.db, businessId, {
      title: "Interview panel: refill pricing",
      evidence: [],
      proposedByAgentId: agentId,
      hunks: [
        { specBlockId: pricing.id, theirs: doc("Refills cost £34 per quarter.", "Shipping is free over £40.") },
        { specBlockId: features.id, theirs: doc("Subscriptions with pause and skip.", "A private reaction diary.") },
        { specBlockId: customers.id, theirs: doc("People with reactive skin, referred by clinics.") },
      ],
    });
    // base/ours default to the block as proposed against.
    expect(proposal.hunks[0]!.base).toEqual(pricing.content);
    expect(proposal.hunks[0]!.ours).toEqual(pricing.content);
    const [h1, h2, h3] = proposal.hunks.sort((a, b) => a.position - b.position);

    const first = await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, h1!.id, "accepted", undefined, { decidedBy: ownerId }));
    expect(first.status).toBe("open");
    expect(first.published).toBeNull();
    expect(first.applied).toEqual([expect.objectContaining({ hunkId: h1!.id, changed: true, merged: false })]);
    const pricingNow = await repos.product.getBlock(r.db, businessId, pricing.id);
    expect(docText(pricingNow.content)).toContain("£34");
    expect(pricingNow.version).toBe(pricing.version + 1);
    expect(pricingNow).toMatchObject({ authoredByKind: "agent", authoredBy: agentId });
    expect(await repos.product.listVersions(r.db, businessId)).toHaveLength(1);

    await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, h2!.id, "rejected", undefined, { decidedBy: ownerId }));
    const last = await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, h3!.id, "accepted", undefined, { decidedBy: ownerId }));
    expect(last.status).toBe("partially_accepted");
    expect(last.resolvedAt).not.toBeNull();
    expect(last.published).toMatchObject({ previousVersion: 1, counts: { accepted: 2, rejected: 1, edited: 0 } });
    expect(new Set(last.published!.changedBlockIds)).toEqual(new Set([pricing.id, customers.id]));
    expect(last.published!.version).toMatchObject({ version: 2, publishedBy: ownerId });
    expect(last.published!.version.changelogMd).toBe('Change proposal "Interview panel: refill pricing": Pricing accepted; Features rejected; Customers accepted.');

    expect(docText((await repos.product.getBlock(r.db, businessId, features.id)).content)).toBe("Subscriptions with pause and skip.");
    const versions = await repos.product.listVersions(r.db, businessId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const snapshot = versions[0]!.snapshot as { blocks: { id: string; content: unknown }[] };
    expect(docText(snapshot.blocks.find((b) => b.id === pricing.id)!.content)).toContain("£34");
  });

  it("a decided hunk cannot be decided differently; the same decision again is a no-op", async () => {
    const { businessId, ownerId } = r.A;
    const block = await repos.product.createBlock(r.db, businessId, { section: "Risks", content: doc("Supply risk.") });
    const p = await repos.product.createProposal(r.db, businessId, { title: "Risks", hunks: [{ specBlockId: block.id, theirs: doc("Supply risk.", "Regulatory risk.") }, { specBlockId: block.id, theirs: doc("Supply risk.", "Price risk.") }] });
    const [a] = p.hunks.sort((x, y) => x.position - y.position);
    await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, a!.id, "accepted", undefined, { decidedBy: ownerId }));
    const again = await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, a!.id, "accepted", undefined, { decidedBy: ownerId }));
    expect(again.applied).toEqual([]);
    expect((await repos.product.getBlock(r.db, businessId, block.id)).version).toBe(2);
    await expect(r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, a!.id, "rejected"))).rejects.toBeInstanceOf(ValidationError);
    await expect(r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, a!.id, "pending"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("an edit saved by the founder is merged with edits made since, authored by them and pinned", async () => {
    const { businessId, ownerId } = r.A;
    const block = await repos.product.createBlock(r.db, businessId, { section: "Metrics", content: doc("Weekly actives.", "Refill rate.") });
    const p = await repos.product.createProposal(r.db, businessId, { title: "Metrics", hunks: [{ specBlockId: block.id, theirs: doc("Weekly actives.", "Refill rate above 60%.") }] });
    // Someone edits the first paragraph after the proposal was drafted.
    await repos.product.editBlock(r.db, businessId, block.id, { content: doc("Weekly active buyers.", "Refill rate."), authoredByKind: "user", authoredBy: ownerId });
    const res = await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, p.hunks[0]!.id, "edited", doc("Weekly actives.", "Refill rate above 55% (Estimate)."), { decidedBy: ownerId }));
    expect(res.status).toBe("accepted");
    expect(res.applied[0]).toMatchObject({ changed: true, merged: true, conflicts: 0 });
    expect(res.published?.counts).toEqual({ accepted: 0, rejected: 0, edited: 1 });
    const now = await repos.product.getBlock(r.db, businessId, block.id);
    expect(docText(now.content)).toBe("Weekly active buyers.\n\nRefill rate above 55% (Estimate).");
    expect(now).toMatchObject({ authoredByKind: "user", authoredBy: ownerId, pinned: true });
  });

  it("accept all applies every pending hunk (roadmap items too) and publishes; reject publishes nothing when nothing was accepted", async () => {
    const { businessId, ownerId, roadmapItemId } = r.A;
    const block = await repos.product.createBlock(r.db, businessId, { section: "Data", content: doc("We store invoices.") });
    const before = (await repos.product.listVersions(r.db, businessId)).length;
    const p = await repos.product.createProposal(r.db, businessId, { title: "Data and roadmap", hunks: [{ specBlockId: block.id, theirs: doc("We store invoices for seven years.") }, { roadmapItemId, theirs: doc("Retention export for auditors.") }] });
    const res = await r.as(ownerId, (tx) => repos.product.acceptAll(tx, businessId, p.id, { decidedBy: ownerId }));
    expect(res.status).toBe("accepted");
    expect(res.applied.filter((a) => a.changed)).toHaveLength(2);
    expect(res.published?.changedBlockIds).toEqual([block.id]);
    expect(res.published?.version.changelogMd).toMatch(/Data accepted; Roadmap: .+ accepted\.$/);
    expect((await repos.product.getRoadmapItem(r.db, businessId, roadmapItemId)).descriptionMd).toBe("Retention export for auditors.");
    expect(await repos.product.listVersions(r.db, businessId)).toHaveLength(before + 1);
    // Settled proposals are left alone.
    expect((await r.as(ownerId, (tx) => repos.product.acceptAll(tx, businessId, p.id))).published).toBeNull();

    const q = await repos.product.createProposal(r.db, businessId, { title: "Nothing", hunks: [{ specBlockId: block.id, theirs: doc("Delete everything.") }] });
    const rejected = await r.as(ownerId, (tx) => repos.product.rejectProposal(tx, businessId, q.id, { decidedBy: ownerId }));
    expect(rejected.status).toBe("rejected");
    expect(rejected.published).toBeNull();
    expect(await repos.product.listVersions(r.db, businessId)).toHaveLength(before + 1);
  });

  it("rejecting the rest of a partly accepted proposal settles it as partially accepted and publishes what was accepted", async () => {
    const { businessId, ownerId } = r.A;
    const one = await repos.product.createBlock(r.db, businessId, { section: "Integrations", content: doc("Xero.") });
    const two = await repos.product.createBlock(r.db, businessId, { section: "Integrations", content: doc("Stripe.") });
    const p = await repos.product.createProposal(r.db, businessId, { title: "Integrations", hunks: [{ specBlockId: one.id, theirs: doc("Xero and QuickBooks.") }, { specBlockId: two.id, theirs: doc("Stripe and Adyen.") }] });
    await r.as(ownerId, (tx) => repos.product.decideHunk(tx, businessId, p.hunks.find((h) => h.specBlockId === one.id)!.id, "accepted"));
    const res = await r.as(ownerId, (tx) => repos.product.rejectProposal(tx, businessId, p.id, { decidedBy: ownerId }));
    expect(res.status).toBe("partially_accepted");
    expect(res.published?.counts).toEqual({ accepted: 1, rejected: 1, edited: 0 });
    expect(docText((await repos.product.getBlock(r.db, businessId, one.id)).content)).toBe("Xero and QuickBooks.");
    expect(docText((await repos.product.getBlock(r.db, businessId, two.id)).content)).toBe("Stripe.");
  });

  it("a proposal cannot target another business's block, and another business cannot decide its hunks", async () => {
    const { businessId } = r.A;
    const foreign = await repos.product.createBlock(r.db, r.B.businessId, { section: "Pricing", content: doc("B's pricing.") });
    await expect(repos.product.createProposal(r.db, businessId, { title: "x", hunks: [{ specBlockId: foreign.id, theirs: doc("Mine now.") }] })).rejects.toBeInstanceOf(ValidationError);
    const own = await repos.product.createBlock(r.db, businessId, { section: "Problem", content: doc("A's problem.") });
    const p = await repos.product.createProposal(r.db, businessId, { title: "y", hunks: [{ specBlockId: own.id, theirs: doc("Changed.") }] });
    await expect(r.as(r.B.ownerId, (tx) => repos.product.decideHunk(tx, r.B.businessId, p.hunks[0]!.id, "accepted"))).rejects.toThrow(/not found/);
    expect(docText((await repos.product.getBlock(r.db, businessId, own.id)).content)).toBe("A's problem.");
  });
});
