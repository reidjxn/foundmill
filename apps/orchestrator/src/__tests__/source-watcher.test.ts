/**
 * Source Watcher activities on PGlite with the mock model client and a gateway that serves the web connector's mock
 * (BUILD §11.5, AC-11.5.2): a source is read through the gateway, scored against the spec (summary, blocks, topics,
 * fetched_at and `source.scored` written together), a relevant one becomes a change proposal once
 * (`spec.proposal_created`), unchanged content is not scored again, refused pages are recorded as unreachable and
 * the sweep finds what still needs reading.
 */
import { repos } from "@foundmill/db";
import { toAgentEnvelope, webMock, type Untrusted } from "@foundmill/connectors";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSourceWatcherActivities } from "../activities/source-watcher";
import { createOfflineGatewayClient, type GatewayCallRequest, type GatewayClient } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

const doc = (...paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });

/** The gateway's allow path for `web.fetch`, run against the connector's mock (untrusted content comes back as the envelope). */
function webGateway(): GatewayClient & { calls: GatewayCallRequest[]; minted: { allowedTools: string[]; agentId: string }[] } {
  const offline = createOfflineGatewayClient();
  const calls: GatewayCallRequest[] = [];
  return {
    ...offline,
    calls,
    async call(_token, req) {
      calls.push(req);
      const r = await webMock.callTool(req.tool, req.args, makeToolContext(webMock));
      const data = r.untrusted ? toAgentEnvelope(r.data as Untrusted) : r.data;
      return { outcome: "allow", result: { ok: r.ok, ...(data !== undefined ? { data } : {}), ...(r.error ? { error: r.error } : {}), untrusted: Boolean(r.untrusted), costMinor: 0 }, costMinor: 0 };
    },
  };
}

let t: OrchestratorTestHarness;
let gateway: ReturnType<typeof webGateway>;
let acts: ReturnType<typeof createSourceWatcherActivities>;
let pricingId: string;
let featuresId: string;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "srcwatch" });
  gateway = webGateway();
  acts = createSourceWatcherActivities({ ...t.deps, gateway });
  pricingId = (await repos.product.createBlock(t.db, t.businessId, { section: "Pricing", content: doc("Starter at $39 per month.", "Growth at $89 per month with approval workflows.") })).id;
  featuresId = (await repos.product.createBlock(t.db, t.businessId, { section: "Features", content: doc("Bank feed matching and receipt chasing.") })).id;
  await repos.product.createBlock(t.db, t.businessId, { section: "Risks", content: doc("Regulators may change open banking rules.") });
}, 120_000);
afterAll(() => t?.close());

describe("watchSource", () => {
  it("reads a competitor page through the gateway, fills summary, blocks and topics, and proposes a pricing change once", async () => {
    const source = await repos.product.createSource(t.db, t.businessId, { kind: "competitor", uri: "https://example.com/competitor-pricing", title: "https://example.com/competitor-pricing", relevance: { addedBy: "user" } });
    const res = await acts.watchSource({ businessId: t.businessId, sourceId: source.id, reason: "added" });
    expect(res.status).toBe("scored");
    expect(res.relevantBlockIds).toContain(pricingId);
    expect(res.proposalId).not.toBeNull();
    expect(gateway.calls).toEqual([{ connector: "web", tool: "fetch", args: { url: source.uri, maxChars: expect.any(Number) } }]);
    expect(gateway.minted.at(-1)).toMatchObject({ allowedTools: ["web:fetch"], agentId: t.chiefId });

    const read = await repos.product.getSource(t.db, t.businessId, source.id);
    expect(read.fetchedAt).not.toBeNull();
    expect(read.title).toBe("Pricing: Invoicely for small finance teams");
    const rel = read.relevance as Record<string, unknown> & { blocks: { blockId: string; score: number }[]; watch: Record<string, unknown> };
    expect(rel.addedBy).toBe("user");
    expect(rel.summary).toEqual(expect.stringContaining("$29"));
    expect(rel.blocks[0]).toMatchObject({ blockId: pricingId });
    expect(rel.topics).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(rel.pricing).toEqual(expect.stringContaining("$29"));
    expect(rel.watch).toMatchObject({ status: "scored", page: "read", proposalId: res.proposalId, costLabel: "Estimate" });

    const proposal = await repos.product.getProposal(t.db, t.businessId, res.proposalId!);
    expect(proposal).toMatchObject({ status: "open", evidence: [source.id], proposedByAgentId: t.chiefId });
    expect(proposal.hunks.map((h) => h.specBlockId)).toContain(pricingId);
    const hunk = proposal.hunks.find((h) => h.specBlockId === pricingId)!;
    expect(hunk.base).toEqual(doc("Starter at $39 per month.", "Growth at $89 per month with approval workflows."));
    expect(JSON.stringify(hunk.theirs)).toContain("Starter at $39 per month.");

    const scored = await repos.events.list(t.db, t.businessId, { type: "source.scored", limit: 10 });
    expect(scored.items.find((e) => (e.payload as { sourceId: string }).sourceId === source.id)?.payload).toMatchObject({ status: "scored", relevantBlockIds: expect.arrayContaining([pricingId]) });
    const created = await repos.events.list(t.db, t.businessId, { type: "spec.proposal_created", limit: 10 });
    expect(created.items.find((e) => (e.payload as { proposalId: string }).proposalId === res.proposalId)?.payload).toMatchObject({ sourceIds: [source.id], affectedBlockIds: expect.arrayContaining([pricingId]) });

    // The same content again (a retry, or the sweep): nothing is scored or proposed twice.
    const again = await acts.watchSource({ businessId: t.businessId, sourceId: source.id, reason: "schedule" });
    expect(again).toMatchObject({ status: "unchanged", proposalId: res.proposalId, costMinor: 0 });
    expect((await repos.product.listProposals(t.db, t.businessId, { limit: 100 })).items.filter((p) => p.evidence.includes(source.id))).toHaveLength(1);
  });

  it("a page robots.txt refuses is recorded as unreachable with a readable reason; with notes the notes are scored", async () => {
    const blocked = await repos.product.createSource(t.db, t.businessId, { kind: "competitor", uri: "https://blocked.example/pricing", title: "Blocked", relevance: { addedBy: "user" } });
    const res = await acts.watchSource({ businessId: t.businessId, sourceId: blocked.id, reason: "added" });
    expect(res).toMatchObject({ status: "unreachable", reason: "The site's robots.txt does not allow reading this page.", proposalId: null });
    const row = await repos.product.getSource(t.db, t.businessId, blocked.id);
    expect(row.fetchedAt).toBeNull();
    expect((row.relevance as { watch: unknown }).watch).toMatchObject({ status: "unreachable", reason: res.reason });

    const withNotes = await repos.product.createSource(t.db, t.businessId, { kind: "feedback", uri: "https://blocked.example/thread", title: "Support thread", relevance: { addedBy: "user", notes: "Customers want bank feed matching for a second bank and receipt chasing by text." } });
    const scored = await acts.watchSource({ businessId: t.businessId, sourceId: withNotes.id, reason: "added" });
    expect(scored.status).toBe("scored");
    const rel = (await repos.product.getSource(t.db, t.businessId, withNotes.id)).relevance as { blocks: { blockId: string }[]; watch: Record<string, unknown>; notes: string };
    expect(rel.blocks.map((b) => b.blockId)).toContain(featuresId);
    expect(rel.watch).toMatchObject({ status: "scored", page: "unreadable" });
    expect(rel.notes).toMatch(/second bank/);
  });

  it("skips archived sources and paused agents; another business's id finds nothing", async () => {
    const s = await repos.product.createSource(t.db, t.businessId, { kind: "doc", title: "Pricing note" });
    await repos.product.archiveSource(t.db, t.businessId, s.id);
    expect(await acts.watchSource({ businessId: t.businessId, sourceId: s.id, reason: "manual" })).toMatchObject({ status: "skipped", reason: "source archived" });
    const other = await repos.product.createSource(t.db, t.businessId, { kind: "doc", title: "Note" });
    await expect(acts.watchSource({ businessId: "00000000-0000-4000-8000-000000000999", sourceId: other.id, reason: "manual" })).resolves.toMatchObject({ status: "skipped" });
    await repos.agents.setStatus(t.db, t.businessId, t.chiefId, "paused");
    expect(await acts.watchSource({ businessId: t.businessId, sourceId: other.id, reason: "manual" })).toMatchObject({ status: "skipped", reason: "agents stopped" });
    await repos.agents.setStatus(t.db, t.businessId, t.chiefId, "healthy");
  });
});

describe("the sweep and failures", () => {
  it("lists never-checked sources first, leaves fresh and import sources alone, and records a failed read", async () => {
    const fresh = await repos.product.createSource(t.db, t.businessId, { kind: "doc", title: "Never read", relevance: { notes: "Pricing for teams." } });
    const imported = await repos.product.createSource(t.db, t.businessId, { kind: "doc", uri: "https://github.com/acme/app", title: "Import", relevance: { import: { key: "github" } } });
    const { sourceIds } = await acts.listSourcesToWatch({ businessId: t.businessId, limit: 200 });
    expect(sourceIds).toContain(fresh.id);
    expect(sourceIds).not.toContain(imported.id);
    const page = await repos.product.createSource(t.db, t.businessId, { kind: "competitor", uri: "https://competitor.example/pricing", title: "Competitor" });
    await acts.watchSource({ businessId: t.businessId, sourceId: fresh.id, reason: "schedule" });
    await acts.watchSource({ businessId: t.businessId, sourceId: page.id, reason: "schedule" });
    const now = await acts.listSourcesToWatch({ businessId: t.businessId, limit: 200 });
    expect(now.sourceIds).not.toContain(fresh.id);
    expect(now.sourceIds).not.toContain(page.id);
    // A day later the web page is stale again; a note is read once.
    const later = new Date(t.deps.clock.now().getTime() + 25 * 3_600_000).toISOString();
    const due = await acts.listSourcesToWatch({ businessId: t.businessId, limit: 200, at: later });
    expect(due.sourceIds).toContain(page.id);
    expect(due.sourceIds).not.toContain(fresh.id);

    await acts.failSourceWatch({ businessId: t.businessId, sourceId: fresh.id, error: "The Source Watcher could not finish reading this source. It tries again on the next sweep." });
    const row = await repos.product.getSource(t.db, t.businessId, fresh.id);
    expect((row.relevance as { watch: unknown }).watch).toMatchObject({ status: "failed" });
    const events = await repos.events.list(t.db, t.businessId, { type: "source.scored", limit: 50 });
    expect(events.items.some((e) => (e.payload as { sourceId: string; status: string }).sourceId === fresh.id && (e.payload as { status: string }).status === "failed")).toBe(true);
  });
});
