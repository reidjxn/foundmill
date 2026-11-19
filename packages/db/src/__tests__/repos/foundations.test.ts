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
    await r.svc((tx) => repos.businesses.update(tx, businessId, { currency: "gbp" }));
    const idea = await repos.ideas.create(r.db, ownerId, { title: "Ledgerly", pitch: "Ledgerly helps accountants.", archetype: "b2b_saas", attributes: { market_pull: { value: 15, evidence: "Strong demand" } }, research: { citations: [{ title: "Comparables", url: "https://x.test", note: "39-79 a month" }, { kind: "foundmill:meta", qa: [{ question: "Who pays?", answer: "Owners." }] }] } });
    await repos.ideas.commit(r.db, ownerId, idea.id, businessId);
    await repos.product.createBlock(r.db, businessId, { section: "Problem", position: 1, authoredByKind: "system" });
    await repos.product.createBlock(r.db, businessId, { section: "Features", position: 2, authoredByKind: "system" });
    await repos.product.createBlock(r.db, businessId, { section: "Pricing", position: 3, authoredByKind: "user", pinned: true, content: doc("€39 per practice, set by the founder.") });
    await repos.product.createSource(r.db, businessId, { kind: "doc", title: "GitHub import: acme/ledgerly", uri: "https://github.com/acme/ledgerly", relevance: { import: { key: "github", summary: "212 files read" } } });
    await repos.product.createSource(r.db, businessId, { kind: "doc", title: "Not imported", relevance: {} });

    const inputs = await repos.foundations.inputs(r.db, businessId);
    // The business's own currency (0025), not the founder's profile currency (EUR here): business money is priced in it.
    expect(inputs).toMatchObject({ businessName: "FOUND-A", archetype: "b2b_saas", door: "import", currency: "GBP" });
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

    const stale = await r.svc((tx) => repos.foundations.apply(tx, businessId, 99, draftFor(ids), { signoffs: null }));
    expect(stale.applied).toBe(false);

    const res = await r.svc((tx) => repos.foundations.apply(tx, businessId, 1, draftFor(ids), { signoffs: { plan: { subject: "Your plan is ready", bodyMd: "**First we build:** Bank feed import." } }, model: { route: "foundations" } }));
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
    // The one plan note (WP-04 T5): a decision from the Product lead that holds nothing, with both rounds tied to it.
    expect(res.inboxItems.map((i) => ({ type: i.type, subject: i.subject, bodyMd: i.bodyMd, blocksContinue: i.blocksContinue, key: (i.decision as { key?: string }).key }))).toEqual([
      { type: "decision", subject: "Your plan is ready", bodyMd: "**First we build:** Bank feed import.", blocksContinue: false, key: "product.plan_ready" },
    ]);
    const rounds = await repos.productSignoffs.latest(r.db, businessId);
    expect(rounds.spec).toMatchObject({ round: 1, status: "pending", inboxItemId: res.inboxItems[0]!.id });
    expect(rounds.roadmap).toMatchObject({ round: 1, status: "pending", inboxItemId: res.inboxItems[0]!.id, snapshot: { items: expect.arrayContaining([expect.objectContaining({ title: "Bank feed import", horizon: "now" })]) } });
    // The note's round: the specification's while both are open.
    expect(await repos.productSignoffs.forInboxItem(r.db, businessId, res.inboxItems[0]!.id)).toMatchObject({ kind: "spec" });
    expect((await repos.productSignoffs.listForInboxItem(r.db, businessId, res.inboxItems[0]!.id)).map((x) => x.kind).sort()).toEqual(["roadmap", "spec"]);
    expect(res.row!.summary).toMatchObject({ inboxItemIds: res.inboxItems.map((i) => i.id) });

    // A second apply for the same attempt (a retried activity) writes nothing more.
    const twice = await r.svc((tx) => repos.foundations.apply(tx, businessId, 1, draftFor(ids), { signoffs: null }));
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
    const signoffs = { plan: { subject: "Your plan is ready", bodyMd: "Drafted." } };
    await expect(
      r.svc((tx) =>
        repos.foundations.apply(tx, businessId, 2, draftFor(ids), {
          signoffs,
          onInboxItem: async () => {
            throw new Error("outbox unavailable");
          },
        }),
      ),
    ).rejects.toThrow("outbox unavailable");
    expect(await repos.foundations.get(r.db, businessId)).toMatchObject({ status: "drafting", attempt: 2 });
    expect((await repos.product.listRoadmap(r.db, businessId)).length).toBe(roadmapBefore);

    const seen: string[] = [];
    const res = await r.svc((tx) => repos.foundations.apply(tx, businessId, 2, draftFor(ids), { signoffs, onInboxItem: async (_tx, item) => void seen.push(item.id) }));
    expect(res.applied).toBe(true);
    expect(seen).toEqual(res.inboxItems.map((i) => i.id));
    expect(seen).toHaveLength(1);
  });

  it("progress (0019): written for the current attempt only, sections merged atomically, the event in the same transaction, kept by a retry, cleared by apply", async () => {
    const businessId = r.B.businessId;
    // B's foundations are ready from the test above: draft them again to have a current drafting attempt.
    const row = await r.svc((tx) => repos.foundations.claim(tx, businessId, ["ready"]));
    const attempt = row!.attempt;
    const section = (name: string) => ({ section: name, content: doc(`Drafted ${name}.`), sourceRefs: [], labelled: 0 });
    const base = { v: 1 as const, outline: ["Problem", "Features", "Pricing", "Risks"], author: null, vision: null, visionLabelled: 0, theses: [], planned: [], planDone: false, sections: {}, roadmap: [], openQuestions: [], roadmapDone: false };
    const started = await r.svc((tx) => repos.foundations.writeProgress(tx, businessId, attempt, { replace: base }));
    expect(started).toMatchObject({ v: 1, outline: base.outline, sections: {} });
    // Another attempt writes nothing.
    expect(await r.svc((tx) => repos.foundations.writeProgress(tx, businessId, attempt + 1, { set: { openQuestions: ["stale"] } }))).toBeNull();

    // Parallel batches: every section lands, none overwrites another; a top-level set leaves the sections alone.
    const events: string[] = [];
    await Promise.all([
      ...["Problem", "Features", "Pricing", "Risks"].map((name) => r.svc((tx) => repos.foundations.writeProgress(tx, businessId, attempt, { section: section(name) }, { onWritten: async (_tx, p) => void events.push(`${name}:${Object.keys(p.sections as object).length}`) }))),
      r.svc((tx) => repos.foundations.writeProgress(tx, businessId, attempt, { set: { roadmap: [], roadmapDone: false, openQuestions: ["Who signs?"] } })),
    ]);
    const stored = (await repos.foundations.get(r.db, businessId))!.progress as { sections: Record<string, unknown>; openQuestions: string[] };
    expect(Object.keys(stored.sections).sort()).toEqual(["Features", "Pricing", "Problem", "Risks"]);
    expect(stored.sections.Pricing).toEqual(section("Pricing"));
    expect(stored.openQuestions).toEqual(["Who signs?"]);
    expect(events).toHaveLength(4);

    // The event hook runs inside the write: when it fails, the progress is not stored.
    await expect(r.svc((tx) => repos.foundations.writeProgress(tx, businessId, attempt, { set: { openQuestions: ["lost"] } }, { onWritten: async () => { throw new Error("outbox unavailable"); } }))).rejects.toThrow("outbox unavailable");
    expect(((await repos.foundations.get(r.db, businessId))!.progress as { openQuestions: string[] }).openQuestions).toEqual(["Who signs?"]);

    // A failed attempt keeps its progress for the retry, which can still write it.
    await r.svc((tx) => repos.foundations.fail(tx, businessId, attempt, "model timed out"));
    const retried = await r.svc((tx) => repos.foundations.claim(tx, businessId, ["failed"]));
    expect(retried!.progress).toMatchObject({ sections: { Problem: section("Problem") } });
    expect(await r.svc((tx) => repos.foundations.writeProgress(tx, businessId, retried!.attempt, { set: { roadmapDone: true } }))).toMatchObject({ roadmapDone: true });

    // Ready: the progress is in the blocks, the roadmap and the vision now; the row no longer carries it.
    const inputs = await repos.foundations.inputs(r.db, businessId);
    const ids = Object.fromEntries(inputs.outline.map((o) => [o.section, o.blockId!]));
    const applied = await r.svc((tx) => repos.foundations.apply(tx, businessId, retried!.attempt, draftFor(ids), { signoffs: null }));
    expect(applied.applied).toBe(true);
    expect(applied.row).toMatchObject({ status: "ready", progress: null });
  });

  it("author: the drafting agent's name and role for the screens; null for no agent or another business's agent", async () => {
    const { businessId } = r.A;
    const inputs = await repos.foundations.inputs(r.db, businessId);
    const author = await repos.foundations.author(r.db, businessId, inputs.authorAgentId);
    expect(author).toMatchObject({ agentId: inputs.authorAgentId, name: expect.any(String) });
    expect(await repos.foundations.author(r.db, businessId, null)).toBeNull();
    expect(await repos.foundations.author(r.db, r.B.businessId, inputs.authorAgentId)).toBeNull();
  });
});
