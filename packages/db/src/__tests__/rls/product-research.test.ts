/**
 * 0063 `product_research` and `research_artifacts` (BUILD §11.5 Research tab; the Product Researcher): the plan row is
 * service-written and read by members; the artifacts are the team's (members read and write their own business's, a
 * viewer reads only). Nobody reads or writes another business's rows, and the repo's lifecycle holds: one row per
 * business, a claim exactly once, `ready` and `fail` only for the current attempt, `inputs` built from the business's
 * own specification.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { repos } from "../../repos";
import { productResearch, researchArtifacts } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "alpha");
  B = await createBusinessFixture(h, "bravo");
  outsiderId = await h.createUser("research-outsider@test.local");
  for (const f of [A, B]) {
    await h.service().run(async (tx) => {
      await repos.research.ensureRow(tx, f.businessId);
      await repos.research.claim(tx, f.businessId);
      await repos.research.ready(tx, f.businessId, 1, {
        icp: `${f.slug} buyers`,
        specVersion: null,
        agentId: f.agentId,
        summary: { icp: `${f.slug} buyers` },
        artifacts: [
          { kind: "interview_plan", title: `${f.slug} interview plan`, summary: "Six conversations.", bodyMd: "## Who\n6 buyers (Estimate)." },
          { kind: "smoke_test", title: `${f.slug} smoke test`, summary: "One page.", bodyMd: "## Threshold\n5% (Estimate)." },
        ],
      });
    });
  }
}, 120_000);
afterAll(() => h?.close());

const readRow = (businessId: string) => (tx: DbTx) => tx.select({ id: productResearch.id, icp: productResearch.icp }).from(productResearch).where(eq(productResearch.businessId, businessId));
const readArtifacts = (businessId: string) => (tx: DbTx) => tx.select({ id: researchArtifacts.id, title: researchArtifacts.title }).from(researchArtifacts).where(eq(researchArtifacts.businessId, businessId));

async function expectNoEffect(p: Promise<unknown[] | unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

describe("product_research (0063, service-written)", () => {
  it("members and viewers of A read A's plan; nobody reads B's from A; an outsider or anon reads nothing", async () => {
    for (const userId of [A.ownerId, A.memberId, A.viewerId]) {
      expect(await h.asUser(userId).run(readRow(A.businessId))).toEqual([{ id: expect.any(String), icp: "alpha buyers" }]);
      expect(await h.asUser(userId).run(readRow(B.businessId))).toEqual([]);
    }
    expect(await h.asUser(outsiderId).run(readRow(A.businessId))).toEqual([]);
    await expectNoEffect(h.anon().run(readRow(A.businessId)));
  });

  it("no app role writes the plan row, not even the owner; the service role does", async () => {
    const tamper = (businessId: string) => (tx: DbTx) => tx.update(productResearch).set({ icp: "everyone" }).where(eq(productResearch.businessId, businessId)).returning({ id: productResearch.id });
    await expectNoEffect(h.asUser(A.ownerId).run(tamper(A.businessId)));
    await expectNoEffect(h.asUser(A.ownerId).run(tamper(B.businessId)));
    await expectNoEffect(h.asUser(A.adminId).run((tx) => repos.research.claim(tx, A.businessId, ["ready"])));
    expect((await h.service().run(readRow(A.businessId)))[0]!.icp).toBe("alpha buyers");
  });
});

describe("research_artifacts (0063, the team's)", () => {
  it("members of A read and change A's artifacts, never B's; a viewer reads only", async () => {
    const [mine] = await h.asUser(A.memberId).run(readArtifacts(A.businessId));
    expect(mine!.title).toBe("alpha interview plan");
    expect(await h.asUser(A.memberId).run(readArtifacts(B.businessId))).toEqual([]);
    const updated = await h.asUser(A.memberId).run((tx) => repos.research.updateArtifact(tx, A.businessId, mine!.id, { status: "ready" }));
    expect(updated.status).toBe("ready");
    const [theirs] = await h.service().run(readArtifacts(B.businessId));
    await expectNoEffect(h.asUser(A.memberId).run((tx) => tx.update(researchArtifacts).set({ status: "shared" }).where(eq(researchArtifacts.id, theirs!.id)).returning({ id: researchArtifacts.id })));
    await expect(h.asUser(A.memberId).run((tx) => repos.research.updateArtifact(tx, A.businessId, theirs!.id, { status: "shared" }))).rejects.toThrow();
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => tx.update(researchArtifacts).set({ status: "shared" }).where(eq(researchArtifacts.id, mine!.id)).returning({ id: researchArtifacts.id })));
    await expectNoEffect(h.asUser(A.memberId).run((tx) => tx.insert(researchArtifacts).values({ businessId: B.businessId, kind: "survey", title: "smuggled" }).returning({ id: researchArtifacts.id })));
    expect(await h.asUser(outsiderId).run(readArtifacts(A.businessId))).toEqual([]);
    await expectNoEffect(h.anon().run(readArtifacts(A.businessId)));
  });

  it("archiving hides an artifact from the list and the latest-by-kind view", async () => {
    const created = await h.asUser(A.ownerId).run((tx) => repos.research.createArtifact(tx, A.businessId, { kind: "findings", title: "alpha findings", bodyMd: "- Claim (src_1)." }));
    expect((await h.asUser(A.memberId).run((tx) => repos.research.listArtifacts(tx, A.businessId))).map((a) => a.kind)).toContain("findings");
    await h.asUser(A.ownerId).run((tx) => repos.research.archiveArtifact(tx, A.businessId, created.id));
    expect((await h.asUser(A.memberId).run((tx) => repos.research.listArtifacts(tx, A.businessId))).map((a) => a.id)).not.toContain(created.id);
    expect((await h.service().run((tx) => repos.research.latestByKind(tx, A.businessId))).findings).toBeUndefined();
  });
});

describe("the plan's lifecycle (repo)", () => {
  it("one row per business, claimed once; ready and fail act only for the current attempt", async () => {
    const C = await createBusinessFixture(h, "charlie");
    const svc = h.service();
    const first = await svc.run((tx) => repos.research.ensureRow(tx, C.businessId));
    const again = await svc.run((tx) => repos.research.ensureRow(tx, C.businessId));
    expect(again.id).toBe(first.id);
    expect(first.status).toBe("pending");
    const [one, two] = await Promise.all([svc.run((tx) => repos.research.claim(tx, C.businessId)), svc.run((tx) => repos.research.claim(tx, C.businessId))]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    expect((one ?? two)!.attempt).toBe(1);
    // A stale attempt writes nothing.
    const stale = await svc.run((tx) => repos.research.ready(tx, C.businessId, 7, { icp: "x", specVersion: null, agentId: null, summary: {}, artifacts: [{ kind: "survey", title: "stale" }] }));
    expect(stale.applied).toBe(false);
    expect(await svc.run((tx) => repos.research.listArtifacts(tx, C.businessId))).toEqual([]);
    const failed = await svc.run((tx) => repos.research.fail(tx, C.businessId, 1, "The research plan did not finish. Try again."));
    expect(failed?.status).toBe("failed");
    expect(await svc.run((tx) => repos.research.claim(tx, C.businessId, ["pending"]))).toBeNull();
    const retried = await svc.run((tx) => repos.research.claim(tx, C.businessId, ["failed"]));
    expect(retried?.attempt).toBe(2);
    let seen: string[] = [];
    const ready = await svc.run((tx) =>
      repos.research.ready(tx, C.businessId, 2, {
        icp: "charlie buyers",
        specVersion: 3,
        agentId: C.agentId,
        summary: { icp: "charlie buyers" },
        artifacts: [{ kind: "interview_plan", title: "Plan" }],
        onWritten: async (_tx, written) => {
          seen = written.artifacts.map((a) => a.id);
          return { inboxItemId: "note" };
        },
      }),
    );
    expect(ready.applied).toBe(true);
    expect(ready.row).toMatchObject({ status: "ready", attempt: 2, icp: "charlie buyers", specVersion: 3, agentId: C.agentId, summary: { icp: "charlie buyers", inboxItemId: "note", artifactIds: seen } });
    expect(ready.artifacts.map((a) => a.createdByAgentId)).toEqual([C.agentId]);
    const audit = await repos.audit.list(h.db as never, C.businessId, { limit: 20 });
    expect(audit.items.map((e) => e.action)).toEqual(expect.arrayContaining(["product.research.failed", "product.research.ready"]));
  });

  it("inputs read the ICP from the Customers block, the Now roadmap, the founder's markets and the researcher by agent type", async () => {
    const D = await createBusinessFixture(h, "delta");
    await h.service().run(async (tx) => {
      await repos.product.createBlock(tx, D.businessId, { section: "Customers", position: 1, content: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Who buys first" }] }, { type: "paragraph", content: [{ type: "text", text: "Primary segment: independent pharmacists in Ireland who order online. They reorder monthly." }] }] } });
      await repos.product.createBlock(tx, D.businessId, { section: "Pricing", position: 2, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "€49 per month (Estimate)." }] }] } });
      await repos.agents.create(tx, D.businessId, { name: "Noor", role: "Product research analyst", agentType: "product_researcher", layer: "worker", modelKey: "sonnet" });
    });
    const inputs = await h.service().run((tx) => repos.research.inputs(tx, D.businessId));
    // The heading never reads as the ICP, a leading label is dropped and the line carries no final period (it is a title).
    expect(inputs.icp).toBe("independent pharmacists in Ireland who order online");
    expect(inputs.roadmapNow).toEqual(["Ship onboarding"]);
    expect(inputs.sections.map((s) => s.section)).toEqual(["Customers", "Pricing"]);
    // Headings and paragraphs stay on their own lines for the model.
    expect(inputs.sections[0]!.text).toBe("Who buys first\nPrimary segment: independent pharmacists in Ireland who order online. They reorder monthly.");
    expect(inputs.researcherName).toBe("Noor");
    expect(inputs.businessName).toBe("DELTA");
  });
});
