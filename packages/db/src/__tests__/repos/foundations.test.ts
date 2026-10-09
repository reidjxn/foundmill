/** Business foundations (0016): pending at commit, claimed once, applied for the current attempt only, never over a pinned block. */
import type { FoundationsDraft } from "@foundmill/agents";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("found");
});
afterAll(() => r?.close());

const doc = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] });

function draftFor(blocks: Record<string, string>): FoundationsDraft {
  return {
    vision: { statement: "Ledgerly exists so accountants close the month in a day.", forWhom: "Independent accountants.", problem: "Reconciliation takes days.", whyNow: "Bank feeds are open.", principles: [{ title: "First customer first", detail: "Everything moves a customer closer to paying." }], northStar: { metric: "Paying practices", definition: "Practices on a paid plan.", target: "40 paying practices in six months (Forecast)", label: "Forecast" } },
    sections: Object.entries(blocks).map(([section, blockId]) => ({ section, blockId, content: doc(`Drafted ${section}.`), sourceRefs: [], drafted: true })),
    roadmap: [
      { title: "Bank feed import", descriptionMd: "Read transactions.", horizon: "now", position: 0, specBlockIds: [blocks.Features!], acceptanceCriteria: ["Imports a month"], sourceRef: null, confidence: 4, imported: false },
      { title: "Export to CSV", descriptionMd: "Imported issue.\n\nSource: acme/ledgerly issue #42", horizon: "next", position: 0, specBlockIds: [], acceptanceCriteria: [], sourceRef: "acme/ledgerly issue #42", confidence: 3, imported: true },
    ],
    openQuestions: ["Who signs?"],
    notes: { missingSections: [], ignoredSections: [], addedSeeds: [], labelledFigures: 0 },
  };
}

describe("foundations", () => {
  it("create is pending and idempotent; claim happens exactly once", async () => {
    const { businessId } = r.A;
    expect(await repos.foundations.get(r.db, businessId)).toBeNull();
    const created = await r.svc((tx) => repos.foundations.create(tx, businessId, { door: "import", importJobId: "job-token-123", importReport: { title: "Import report: A", roadmapSeeds: [{ title: "Export to CSV", source: "acme/ledgerly issue #42" }] } }));
    expect(created).toMatchObject({ status: "pending", door: "import", attempt: 0, importJobId: "job-token-123" });
    const again = await r.svc((tx) => repos.foundations.create(tx, businessId, { door: "ideation" }));
    expect(again.id).toBe(created.id);
    expect(again.door).toBe("import");

    const claims = await Promise.all([r.svc((tx) => repos.foundations.claim(tx, businessId)), r.svc((tx) => repos.foundations.claim(tx, businessId))]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const row = await repos.foundations.get(r.db, businessId);
    expect(row).toMatchObject({ status: "drafting", attempt: 1 });
    expect(row!.startedAt).not.toBeNull();
    // Nothing to claim once drafting.
    expect(await r.svc((tx) => repos.foundations.claim(tx, businessId))).toBeNull();
    expect(await r.svc((tx) => repos.foundations.setRunner(tx, businessId, 1, { runner: "local", workflowId: null }))).toMatchObject({ runner: "local" });
  });

  it("inputs read the business, the founder, the committed idea, the outline and the imported sources", async () => {
    const { businessId, ownerId } = r.A;
    await repos.founders.upsert(r.db, ownerId, { displayName: "Reid", experience: "first-time", targetMarkets: ["Nordics"], constraints: ["bootstrapped"], budgetMinor: 2_500_000 });
    const idea = await repos.ideas.create(r.db, ownerId, { title: "Ledgerly", pitch: "Ledgerly helps accountants.", archetype: "b2b_saas", attributes: { market_pull: { value: 15, evidence: "Strong demand" } }, research: { citations: [{ title: "Comparables", url: "https://x.test", note: "39-79 a month" }, { kind: "foundmill:meta", qa: [{ question: "Who pays?", answer: "Owners." }] }] } });
    await repos.ideas.commit(r.db, ownerId, idea.id, businessId);
    await repos.product.createBlock(r.db, businessId, { section: "Problem", position: 1, authoredByKind: "system" });
    await repos.product.createBlock(r.db, businessId, { section: "Features", position: 2, authoredByKind: "system" });
    await repos.product.createBlock(r.db, businessId, { section: "Pricing", position: 3, authoredByKind: "user", pinned: true, content: doc("€39 per practice, set by the founder.") });
    await repos.product.createSource(r.db, businessId, { kind: "doc", title: "GitHub import: acme/ledgerly", uri: "https://github.com/acme/ledgerly", relevance: { import: { key: "github", summary: "212 files read" } } });
    await repos.product.createSource(r.db, businessId, { kind: "doc", title: "Not imported", relevance: {} });

    const inputs = await repos.foundations.inputs(r.db, businessId);
    expect(inputs).toMatchObject({ businessName: "FOUND-A", archetype: "b2b_saas", door: "import", currency: "EUR" });
    expect(inputs.founder).toMatchObject({ targetMarkets: ["Nordics"], constraints: ["bootstrapped"], budget: { amountMinor: 2_500_000, currency: "EUR" } });
    expect(inputs.idea).toMatchObject({ title: "Ledgerly", attributes: [{ key: "market_pull", value: 15, evidence: "Strong demand" }], citations: [{ title: "Comparables" }], qa: [{ question: "Who pays?", answer: "Owners." }] });
    expect(inputs.outline.map((o) => o.section)).toEqual(["vision", "Problem", "Features", "Pricing"]);
    expect(inputs.outline.find((o) => o.section === "Pricing")).toMatchObject({ pinned: true, currentText: "€39 per practice, set by the founder." });
    expect(inputs.importedSources).toEqual([expect.objectContaining({ title: "GitHub import: acme/ledgerly", summary: "212 files read" })]);
    expect(inputs.importReport).toMatchObject({ roadmapSeeds: [{ title: "Export to CSV" }] });
    expect(inputs.authorAgentId).toBeTruthy();
  });

  it("apply writes empty blocks and the roadmap, never a pinned block, and only for the current attempt", async () => {
    const { businessId } = r.A;
    const inputs = await repos.foundations.inputs(r.db, businessId);
    const ids = Object.fromEntries(inputs.outline.map((o) => [o.section, o.blockId!]));
    const before = await repos.product.listRoadmap(r.db, businessId);

    const stale = await r.svc((tx) => repos.foundations.apply(tx, businessId, 99, draftFor(ids), { note: null }));
    expect(stale.applied).toBe(false);

    const res = await r.svc((tx) => repos.foundations.apply(tx, businessId, 1, draftFor(ids), { note: (s) => ({ subject: "Vision, specification and roadmap drafted", bodyMd: `Wrote ${s.sectionsWritten} of ${s.sectionsTotal}.` }), model: { route: "foundations" } }));
    expect(res.applied).toBe(true);
    expect(res.row).toMatchObject({ status: "ready" });
    expect(res.row!.vision).toMatchObject({ statement: expect.stringContaining("Ledgerly"), northStar: { label: "Forecast" } });
    expect(res.stats).toMatchObject({ sectionsWritten: 3, sectionsKept: 1, sectionsTotal: 4, roadmap: { now: 1, next: 1, later: 0 }, importedIssues: 1 });
    expect(res.row!.summary).toMatchObject({ sectionsKept: [{ section: "Pricing", reason: "pinned" }], model: { route: "foundations" } });

    const pricing = await repos.product.getBlock(r.db, businessId, ids.Pricing!);
    expect(pricing.content).toEqual(doc("€39 per practice, set by the founder."));
    expect(pricing.authoredByKind).toBe("user");
    const features = await repos.product.getBlock(r.db, businessId, ids.Features!);
    expect(features).toMatchObject({ authoredByKind: "agent", pinned: false, content: doc("Drafted Features.") });

    const roadmap = await repos.product.listRoadmap(r.db, businessId);
    expect(roadmap.length).toBe(before.length + 2);
    const feed = roadmap.find((i) => i.title === "Bank feed import")!;
    expect(feed.specBlockIds).toEqual([ids.Features]);
    expect(feed.position).toBeGreaterThanOrEqual(0);
    expect(res.inboxItem).toMatchObject({ type: "update", subject: "Vision, specification and roadmap drafted", bodyMd: "Wrote 3 of 4.", blocksContinue: false });

    // A second apply for the same attempt (a retried activity) writes nothing more.
    const twice = await r.svc((tx) => repos.foundations.apply(tx, businessId, 1, draftFor(ids), { note: null }));
    expect(twice.applied).toBe(false);
    expect((await repos.product.listRoadmap(r.db, businessId)).length).toBe(before.length + 2);
  });

  it("an agent draft is written in the same statement that checks the block is live, not pinned and unchanged", async () => {
    const { businessId } = r.B;
    const open = await repos.product.createBlock(r.db, businessId, { section: "Risks", authoredByKind: "system" });
    const mine = await repos.product.createBlock(r.db, businessId, { section: "Data", authoredByKind: "user", pinned: true, content: doc("Ours.") });
    const gone = await repos.product.createBlock(r.db, businessId, { section: "Integrations", authoredByKind: "system" });
    await repos.product.archiveBlock(r.db, businessId, gone.id);
    const written = await repos.product.writeAgentDraft(r.db, businessId, open.id, { content: doc("Drafted."), expectedVersion: open.version });
    expect(written).toMatchObject({ authoredByKind: "agent", version: open.version + 1, content: doc("Drafted.") });
    expect(await repos.product.writeAgentDraft(r.db, businessId, mine.id, { content: doc("Drafted."), expectedVersion: mine.version })).toBeNull();
    expect(await repos.product.writeAgentDraft(r.db, businessId, gone.id, { content: doc("Drafted."), expectedVersion: gone.version })).toBeNull();
    expect((await repos.product.getBlock(r.db, businessId, mine.id)).content).toEqual(doc("Ours."));
    expect(await repos.product.writeAgentDraft(r.db, r.A.businessId, open.id, { content: doc("Other business."), expectedVersion: written!.version })).toBeNull();
  });

  it("an agent draft never lands on a block written after it was read as empty (L5)", async () => {
    const { businessId } = r.B;
    const empty = await repos.product.createBlock(r.db, businessId, { section: "Metrics", authoredByKind: "system" });
    // Someone writes the block (without pinning it) between the drafting's read and its write.
    const edited = await repos.product.writeAgentDraft(r.db, businessId, empty.id, { content: doc("Written meanwhile."), expectedVersion: empty.version });
    expect(edited!.version).toBe(empty.version + 1);
    expect(await repos.product.writeAgentDraft(r.db, businessId, empty.id, { content: doc("Stale draft."), expectedVersion: empty.version })).toBeNull();
    expect((await repos.product.getBlock(r.db, businessId, empty.id)).content).toEqual(doc("Written meanwhile."));
  });

  it("fail only touches the current drafting attempt; a failed row is claimed again by a retry", async () => {
    const { businessId } = r.B;
    await r.svc((tx) => repos.foundations.create(tx, businessId, { door: "ideation" }));
    const claimed = await r.svc((tx) => repos.foundations.claim(tx, businessId));
    expect(await r.svc((tx) => repos.foundations.fail(tx, businessId, claimed!.attempt + 1, "wrong attempt"))).toBeNull();
    const failed = await r.svc((tx) => repos.foundations.fail(tx, businessId, claimed!.attempt, "model timed out"));
    expect(failed).toMatchObject({ status: "failed", error: "model timed out" });
    expect(await r.svc((tx) => repos.foundations.claim(tx, businessId))).toBeNull();
    const retried = await r.svc((tx) => repos.foundations.claim(tx, businessId, ["failed"]));
    expect(retried).toMatchObject({ status: "drafting", attempt: 2, error: null, finishedAt: null });
  });

  it("the Inbox note's event is written inside the apply transaction: if it fails, nothing is applied", async () => {
    const { businessId } = r.B;
    const inputs = await repos.foundations.inputs(r.db, businessId);
    const ids = Object.fromEntries(inputs.outline.map((o) => [o.section, o.blockId!]));
    const roadmapBefore = (await repos.product.listRoadmap(r.db, businessId)).length;
    const note = () => ({ subject: "Vision, specification and roadmap drafted", bodyMd: "Drafted." });
    await expect(
      r.svc((tx) =>
        repos.foundations.apply(tx, businessId, 2, draftFor(ids), {
          note,
          onInboxItem: async () => {
            throw new Error("outbox unavailable");
          },
        }),
      ),
    ).rejects.toThrow("outbox unavailable");
    expect(await repos.foundations.get(r.db, businessId)).toMatchObject({ status: "drafting", attempt: 2 });
    expect((await repos.product.listRoadmap(r.db, businessId)).length).toBe(roadmapBefore);

    const seen: string[] = [];
    const res = await r.svc((tx) => repos.foundations.apply(tx, businessId, 2, draftFor(ids), { note, onInboxItem: async (_tx, item) => void seen.push(item.id) }));
    expect(res.applied).toBe(true);
    expect(seen).toEqual([res.inboxItem!.id]);
  });
});
