/**
 * 0062 `product_signoffs`: the founder's sign-offs of the specification and roadmap. Standard tenancy: members of the
 * business read its rounds and owner, admin and member decide them; a viewer reads only; nobody reaches another
 * business's rounds (the cross-tenant suite covers the generic cases; this one exercises the repo as the api does).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, signoffDecisionBlock, type ComposerItem } from "../../repos";
import { productStageOf } from "../../product-stage";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const note = (agentId: string, kind: "spec" | "roadmap" | "ready_to_sell"): ComposerItem => ({
  type: "decision",
  from_agent_id: agentId,
  subject: kind === "spec" ? "Sign off the product specification" : kind === "roadmap" ? "Sign off the product roadmap" : "Ready to start selling?",
  body_md: "Read it on its tab. Approve it, or ask for changes in your own words.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: signoffDecisionBlock(kind),
  blocks_continue: kind !== "ready_to_sell",
  source_event_ids: [],
  entity_ids: [],
});

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "signoff-a");
  B = await createBusinessFixture(h, "signoff-b");
  outsiderId = await h.createUser("signoff-outsider@test.local");
  for (const f of [A, B]) {
    await h.service().run(async (tx) => {
      await repos.productSignoffs.open(tx, f.businessId, { kind: "spec", item: note(f.agentId, "spec") });
      await repos.productSignoffs.open(tx, f.businessId, { kind: "roadmap", item: note(f.agentId, "roadmap") });
    });
  }
}, 120_000);
afterAll(() => h?.close());

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

describe("product_signoffs (0062)", () => {
  it("opens one pending round per kind with its decision note; a second open returns the pending round", async () => {
    const latest = await repos.productSignoffs.latest(h.db as never, A.businessId);
    expect(latest.spec).toMatchObject({ kind: "spec", round: 1, status: "pending" });
    expect(latest.roadmap).toMatchObject({ kind: "roadmap", round: 1, status: "pending" });
    expect(latest.readyToSell).toBeNull();
    const item = await repos.inbox.get(h.db as never, A.businessId, latest.spec!.inboxItemId!);
    expect(item).toMatchObject({ type: "decision", blocksContinue: true, subject: "Sign off the product specification" });
    const again = await h.service().run((tx) => repos.productSignoffs.open(tx, A.businessId, { kind: "spec", item: note(A.agentId, "spec") }));
    expect(again.created).toBe(false);
    expect(again.signoff.id).toBe(latest.spec!.id);
    expect(await repos.productSignoffs.forInboxItem(h.db as never, A.businessId, item.id)).toMatchObject({ id: latest.spec!.id });
  });

  it("members of A read A's rounds and never B's; an outsider and anon read nothing", async () => {
    for (const userId of [A.ownerId, A.memberId, A.viewerId]) {
      const own = await h.asUser(userId).run((tx) => repos.productSignoffs.latest(tx, A.businessId));
      expect(own.spec?.businessId).toBe(A.businessId);
      const other = await h.asUser(userId).run((tx) => repos.productSignoffs.latest(tx, B.businessId));
      expect(other).toEqual({ spec: null, roadmap: null, readyToSell: null });
    }
    expect(await h.asUser(outsiderId).run((tx) => repos.productSignoffs.latest(tx, A.businessId))).toEqual({ spec: null, roadmap: null, readyToSell: null });
    await expectNoEffect(h.anon().run((tx) => repos.productSignoffs.latest(tx, A.businessId)).then((l) => l.spec));
  });

  it("a member decides a round once; a viewer and a member of another business cannot; the stage follows", async () => {
    const latest = await repos.productSignoffs.latest(h.db as never, A.businessId);
    const stageBefore = productStageOf({ foundationsStatus: "ready", signoffs: latest, distributionStartedAt: null });
    expect(stageBefore).toBe("awaiting_signoff");
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => repos.productSignoffs.decide(tx, A.businessId, latest.spec!.id, { status: "approved", decidedBy: A.viewerId })));
    await expectNoEffect(h.asUser(B.ownerId).run((tx) => repos.productSignoffs.decide(tx, A.businessId, latest.spec!.id, { status: "approved", decidedBy: B.ownerId })));
    const approved = await h.asUser(A.memberId).run((tx) => repos.productSignoffs.decide(tx, A.businessId, latest.spec!.id, { status: "approved", decidedBy: A.memberId }));
    expect(approved).toMatchObject({ status: "approved", decidedBy: A.memberId, decidedByKind: "user" });
    // Decided once: a second decision of the same round changes nothing.
    expect(await h.asUser(A.ownerId).run((tx) => repos.productSignoffs.decide(tx, A.businessId, latest.spec!.id, { status: "changes_requested", notes: "shorter", decidedBy: A.ownerId }))).toBeNull();
    const sentBack = await h.asUser(A.ownerId).run((tx) => repos.productSignoffs.decide(tx, A.businessId, latest.roadmap!.id, { status: "changes_requested", notes: "Billing before onboarding.", decidedBy: A.ownerId }));
    expect(sentBack).toMatchObject({ status: "changes_requested", notes: "Billing before onboarding." });
    const after = await repos.productSignoffs.latest(h.db as never, A.businessId);
    expect(productStageOf({ foundationsStatus: "ready", signoffs: after, distributionStartedAt: null })).toBe("awaiting_signoff");
    // The screen's Approve closes a round the founder sent back.
    const reapproved = await h.asUser(A.ownerId).run((tx) => repos.productSignoffs.decide(tx, A.businessId, latest.roadmap!.id, { status: "approved", decidedBy: A.ownerId, from: ["pending", "changes_requested"] }));
    expect(reapproved?.status).toBe("approved");
    const both = await repos.productSignoffs.latest(h.db as never, A.businessId);
    expect(productStageOf({ foundationsStatus: "ready", signoffs: both, distributionStartedAt: null })).toBe("building");
    expect(productStageOf({ foundationsStatus: "ready", signoffs: both, distributionStartedAt: new Date() })).toBe("selling");
  });

  it("the stage of a business from before sign-offs existed is never drafting or awaiting", () => {
    const none = { spec: null, roadmap: null };
    expect(productStageOf({ foundationsStatus: "none", signoffs: none, distributionStartedAt: null })).toBe("building");
    expect(productStageOf({ foundationsStatus: "none", signoffs: none, distributionStartedAt: new Date() })).toBe("selling");
    expect(productStageOf({ foundationsStatus: "drafting", signoffs: none, distributionStartedAt: null })).toBe("drafting");
    expect(productStageOf({ foundationsStatus: "failed", signoffs: none, distributionStartedAt: null })).toBe("drafting");
    expect(productStageOf({ foundationsStatus: "ready", signoffs: none, distributionStartedAt: null })).toBe("awaiting_signoff");
  });

  it("start distribution is idempotent and the reconciler lists only started businesses' engines", async () => {
    const first = await repos.businesses.startDistribution(h.db as never, A.businessId);
    // The fixture's business already sells (an established business): nothing changes.
    expect(first.changed).toBe(false);
    expect(await repos.businesses.distributionStarted(h.db as never, A.businessId)).toBe(true);
  });

  it("offers Ready to start selling once, and never once distribution has started", async () => {
    // A sells already (the fixture): no offer.
    expect(await h.service().run((tx) => repos.productSignoffs.offerReadyToSell(tx, A.businessId, { roadmapItemId: A.roadmapItemId, title: "Ship onboarding", chiefId: A.agentId, item: note(A.agentId, "ready_to_sell") }))).toBeNull();
    // A business that has not started distribution is offered it once.
    const fresh = await repos.businesses.create(h.db as never, { name: "Fresh Co", archetype: "b2b_saas" });
    await repos.businesses.commit(h.db as never, fresh.id, { archetype: "b2b_saas" });
    const chief = await repos.agents.create(h.db as never, fresh.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant" });
    const item = await repos.product.upsertRoadmapItem(h.db as never, fresh.id, { title: "First slice", horizon: "now" });
    const offered = await h.service().run((tx) => repos.productSignoffs.offerReadyToSell(tx, fresh.id, { roadmapItemId: item.id, title: item.title, chiefId: chief.id, item: note(chief.id, "ready_to_sell") }));
    expect(offered?.signoff).toMatchObject({ kind: "ready_to_sell", status: "pending", snapshot: { roadmapItemId: item.id, title: "First slice" } });
    expect(offered?.item).toMatchObject({ subject: "Ready to start selling?", blocksContinue: false });
    expect(await h.service().run((tx) => repos.productSignoffs.offerReadyToSell(tx, fresh.id, { roadmapItemId: item.id, title: item.title, chiefId: chief.id, item: note(chief.id, "ready_to_sell") }))).toBeNull();
    const started = await repos.businesses.startDistribution(h.db as never, fresh.id);
    expect(started.changed).toBe(true);
    expect(started.business.distributionStartedAt).not.toBeNull();
    expect((await repos.businesses.startDistribution(h.db as never, fresh.id)).changed).toBe(false);
  });
});
