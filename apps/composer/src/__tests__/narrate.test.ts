/**
 * POST /v1/narrate pipeline on PGlite with the mock Opus route: AC-11.3.1 (100 consecutive notes, 100 % valid links,
 * no unknown id reaches render), the single re-ask, rejection after it, blocks_continue type rules, persistence
 * (narrated flags, inbox.item_created, mentions, usage ledger) and cross-tenant refusal.
 */
import { repos } from "@foundmill/db";
import { extractEntityIds, validateMarkup } from "@foundmill/entity-linker";
import { MOCK_ROUTES, createModelClient, type MockGenerator } from "@foundmill/models";
import type { EventType } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComposeTimeoutError, ComposerRejectedError } from "../compose";
import { isNamedQueryId } from "../exhibits";
import { isDraftWorthy } from "../persist";
import { createComposerService, narrationKey } from "../service";
import { createComposerHarness, silentLog, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("narrate");
}, 120_000);
afterAll(() => hz?.close());

const EVENT_MIX: { type: EventType; payload: (i: number) => Record<string, unknown> }[] = [
  { type: "payment.received", payload: (i) => ({ amount: { amountMinor: 4900 + i, currency: "EUR" }, customer_name: "Ada" }) },
  { type: "signup.created", payload: () => ({ channel_key: "events" }) },
  { type: "task.completed", payload: (i) => ({ title: `Ship onboarding step ${i}` }) },
  { type: "channel.threshold_breached", payload: () => ({ channelKey: "events", channel_key: "events", metric: "cpa", value: 1200, threshold: 1000 }) },
  { type: "runway.threshold_crossed", payload: () => ({ runwayMonths: 8, thresholdMonths: 9, direction: "below" }) },
  { type: "pr.merged", payload: (i) => ({ title: `PR #${i}` }) },
  { type: "approval.requested", payload: () => ({ title: "Spend on LinkedIn ads", amount: { amountMinor: 50000, currency: "EUR" } }) },
  { type: "spec.proposal_created", payload: () => ({ title: "Tighten scope" }) },
  { type: "activation.reached", payload: () => ({}) },
  { type: "lead.created", payload: () => ({ customer_name: "Analytical Engines" }) },
];

describe("narrate — AC-11.3.1", () => {
  it("100 consecutive generated notes have 100 % valid entity links, registry-only exhibits and real source events", async () => {
    const service = hz.service();
    const manifest = await hz.manifest(hz.A.businessId);
    const agentIds = new Set((await repos.agents.list(hz.db, hz.A.businessId, { limit: 100 })).items.map((a) => a.id));
    const crmIds = new Set((await repos.entities.manifest(hz.db, hz.A.businessId)).map((e) => e.id));
    let linksSeen = 0;
    for (let i = 0; i < 100; i++) {
      const spec = EVENT_MIX[i % EVENT_MIX.length]!;
      const event = await hz.writeEvent(hz.A.businessId, spec.type, spec.payload(i), i % 3 === 0 ? [hz.A.entityId] : i % 3 === 1 ? [hz.A.entity2Id] : []);
      const r = await service.narrate(hz.A.businessId, [event.id]);
      const v = validateMarkup(r.item.bodyMd, manifest);
      expect(v.valid, `run ${i}: ${JSON.stringify(v.problems)}`).toBe(true);
      for (const id of extractEntityIds(r.item.bodyMd)) expect(manifest.isVisible(id)).toBe(true);
      linksSeen += v.mentionCount;
      for (const id of r.item.entityIds) expect(crmIds.has(id)).toBe(true);
      expect(agentIds.has(r.item.fromAgentId as string)).toBe(true);
      expect(r.item.sourceEventIds).toEqual([event.id]);
      const exhibit = r.item.exhibit as { kind: string; spec_ref: string | null };
      if (exhibit.kind !== "none") expect(isNamedQueryId(exhibit.spec_ref)).toBe(true);
      expect(r.item.subject.length).toBeLessThanOrEqual(80);
      expect(r.item.subject).not.toMatch(/\[\[ent:/);
      // Under 180 words and never padded (UX plan §7.19): a short note is a whole note, not an empty one.
      const words = r.item.bodyMd.split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(20);
      expect(words).toBeLessThanOrEqual(180);
    }
    expect(linksSeen).toBeGreaterThan(0);
  }, 240_000);

  it("marks the source events narrated, writes inbox.item_created (already narrated), mentions and usage ledger rows", async () => {
    const service = hz.service();
    const before = hz.usage.length;
    const event = await hz.writeEvent(hz.A.businessId, "payment.received", { amount: { amountMinor: 9900, currency: "EUR" } }, [hz.A.entityId]);
    const r = await service.narrate(hz.A.businessId, [event.id]);
    expect((await repos.events.get(hz.db, hz.A.businessId, event.id)).narrated).toBe(true);
    const created = await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_created", limit: 50 });
    const mine = created.items.find((e) => (e.payload as { inboxItemId?: string }).inboxItemId === r.item.id);
    expect(mine).toBeTruthy();
    expect(mine!.narrated).toBe(true);
    expect(mine!.payload).toMatchObject({ type: r.item.type, blocksContinue: r.item.blocksContinue, sourceEventIds: [event.id] });
    expect(hz.usage.length).toBeGreaterThan(before);
    expect(hz.usage.slice(before).every((u) => u.attribution?.businessId === hz.A.businessId)).toBe(true);
    const ledger = await repos.usage.list(hz.db, hz.A.businessId, { limit: 100 });
    expect(ledger.items.some((row) => (row.details as { service?: string }).service === "composer" && row.kind === "tokens")).toBe(true);
    if (r.item.entityIds.length) {
      const mentioned = await repos.entities.entitiesMentionedIn(hz.db, hz.A.businessId, "inbox_item", r.item.id);
      expect(mentioned.map((e) => e.id).sort()).toEqual([...r.item.entityIds].sort());
    }
    expect(r.item.costMinor).toBe(r.costMinor);
  });

  it("re-asks exactly once when the first output names an id outside the manifest, then writes the note", async () => {
    const ghost = crypto.randomUUID();
    const base = MOCK_ROUTES.inboxComposer.generate;
    let calls = 0;
    const flaky: MockGenerator = (ctx) => {
      calls += 1;
      const out = base(ctx) as { body_md: string };
      return ctx.messages.length === 1 ? { ...out, body_md: `${out.body_md} The lead came through [[ent:${ghost}|Ghost Corp]].` } : out;
    };
    const service = hz.service({}, { inboxComposer: flaky });
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Reask test" });
    const r = await service.narrate(hz.A.businessId, [event.id]);
    expect(calls).toBe(2);
    expect(r.reasked).toBe(true);
    expect(r.item.bodyMd).not.toContain(ghost);
    expect(validateMarkup(r.item.bodyMd, await hz.manifest(hz.A.businessId)).valid).toBe(true);
  });

  it("rejects with 422 after the single re-ask when ids are still invalid, writing nothing (never render unknown ids)", async () => {
    const ghost = crypto.randomUUID();
    const base = MOCK_ROUTES.inboxComposer.generate;
    const stubborn: MockGenerator = (ctx) => ({ ...(base(ctx) as object), body_md: `Still pointing at [[ent:${ghost}|Ghost Corp]] after the re-ask, every single time.` });
    const service = hz.service({}, { inboxComposer: stubborn });
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Reject test" });
    const itemsBefore = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length;
    const err = await service.narrate(hz.A.businessId, [event.id]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposerRejectedError);
    expect((err as ComposerRejectedError).status).toBe(422);
    expect((err as ComposerRejectedError).details).toMatchObject({ unknownIds: [ghost] });
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(itemsBefore);
    expect((await repos.events.get(hz.db, hz.A.businessId, event.id)).narrated).toBe(false);
  });

  it("drafts unknown proper nouns as unverified CRM entities (two-word names only, never a quoted title word) and links them next time", async () => {
    const service = hz.service({ persistDrafts: true });
    const first = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "payment.received", { amount: { amountMinor: 100, currency: "EUR" }, customer_name: "Grace Hopper" })).id]);
    expect(first.draftEntityIds).toHaveLength(1);
    const drafted = await repos.entities.get(hz.db, hz.A.businessId, first.draftEntityIds[0]!);
    expect(drafted.displayName).toBe("Grace Hopper");
    expect(drafted.source).toBe(`composer:unverified:${first.item.id}`);
    const second = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Ship onboarding", customer_name: "Grace Hopper" })).id]);
    expect(second.item.bodyMd).toContain(`[[ent:${drafted.id}|Grace Hopper]]`);
    expect(second.draftEntityIds).toEqual([]);
    expect(isDraftWorthy("Ship", 'shipped "Ship onboarding"')).toBe(false);
    expect(isDraftWorthy("Ship Co", 'shipped "Ship Co onboarding"')).toBe(false);
    expect(isDraftWorthy("Grace Hopper", "Grace Hopper paid.")).toBe(true);
  });

  it("refuses events that belong to another business (404) and empty requests (400)", async () => {
    const service = hz.service();
    const err = await service.narrate(hz.A.businessId, [hz.B.eventIds[0]!]).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);
    const empty = await service.narrate(hz.A.businessId, []).catch((e: unknown) => e);
    expect((empty as { status?: number }).status).toBe(400);
  });
});

describe("narrate is idempotent per event set (audit CML-05)", () => {
  const composerCalls = (from: number) => hz.usage.slice(from).filter((u) => u.route === "inboxComposer").length;

  it("a retried narration returns the note already written: one item, one paid composition", async () => {
    const service = hz.service();
    const a = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Retry me" });
    const b = await hz.writeEvent(hz.A.businessId, "pr.merged", { title: "Retry me too" });
    const inboxBefore = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length;
    const usageBefore = hz.usage.length;
    const first = await service.narrate(hz.A.businessId, [a.id, b.id]);
    expect(first.replayed).toBe(false);
    const calls = composerCalls(usageBefore);
    expect(calls).toBeGreaterThanOrEqual(1);
    // Same set in another order, with a repeat: the same key.
    const again = await service.narrate(hz.A.businessId, [b.id, a.id, b.id]);
    expect(again.replayed).toBe(true);
    expect(again.item.id).toBe(first.item.id);
    expect(again.costMinor).toBe(0);
    expect(again.eventIds.sort()).toEqual([a.id, b.id].sort());
    // A new service (a restarted composer) finds it through the database.
    const restarted = await hz.service().narrate(hz.A.businessId, [a.id, b.id]);
    expect(restarted).toMatchObject({ replayed: true, model: null });
    expect(restarted.item.id).toBe(first.item.id);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(inboxBefore + 1);
    expect(composerCalls(usageBefore)).toBe(calls);
    const created = await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_created", limit: 200 });
    expect(created.items.filter((e) => (e.payload as { inboxItemId?: string }).inboxItemId === first.item.id)).toHaveLength(1);
    // A different set is a different narration.
    const onlyA = await service.narrate(hz.A.businessId, [a.id]);
    expect(onlyA.replayed).toBe(false);
    expect(onlyA.item.id).not.toBe(first.item.id);
  });

  it("concurrent calls for the same events (a retry while the first is still writing) share one note", async () => {
    const service = hz.service();
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Slow narration" });
    const usageBefore = hz.usage.length;
    const inboxBefore = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length;
    const results = await Promise.all([service.narrate(hz.A.businessId, [event.id]), service.narrate(hz.A.businessId, [event.id]), service.narrate(hz.A.businessId, [event.id])]);
    expect(new Set(results.map((r) => r.item.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(inboxBefore + 1);
    expect(composerCalls(usageBefore)).toBe(1);
  });

  it("two composer instances racing on the same events write one note (the event's idempotency key decides)", async () => {
    const event = await hz.writeEvent(hz.A.businessId, "pr.merged", { title: "Two instances" });
    const inboxBefore = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length;
    const [x, y] = await Promise.all([hz.service().narrate(hz.A.businessId, [event.id]), hz.service().narrate(hz.A.businessId, [event.id])]);
    expect(x.item.id).toBe(y.item.id);
    expect([x.replayed, y.replayed].filter(Boolean)).toHaveLength(1);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(inboxBefore + 1);
    expect(await repos.events.byIdempotencyKey(hz.db, hz.A.businessId, narrationKey([event.id]))).toMatchObject({ type: "inbox.item_created" });
  });

  it("a narration past the compose deadline is abandoned unwritten (504), and the retry writes it once", async () => {
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Deadline" });
    const slow = createModelClient({ mode: "mock", logger: silentLog, mock: { latencyMs: 300 } });
    const late = createComposerService({ db: hz.db, models: slow, log: silentLog }, { debounceMs: 0, persistDrafts: false, composeDeadlineMs: 50 });
    const inboxBefore = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length;
    const err = await late.narrate(hz.A.businessId, [event.id]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposeTimeoutError);
    expect((err as ComposeTimeoutError).status).toBe(504);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(inboxBefore);
    expect((await repos.events.get(hz.db, hz.A.businessId, event.id)).narrated).toBe(false);
    const retry = await hz.service().narrate(hz.A.businessId, [event.id]);
    expect(retry.replayed).toBe(false);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(inboxBefore + 1);
  });
});

describe("blocks_continue type rules (BUILD §11.3 Types)", () => {
  it("decision and customer_won block; update does not; the model's own flag is ignored", async () => {
    const base = MOCK_ROUTES.inboxComposer.generate;
    const liar: MockGenerator = (ctx) => {
      const out = base(ctx) as { type: string; blocks_continue: boolean };
      // Claim the opposite of the rule for every type.
      return { ...out, blocks_continue: !(out.type === "decision" || out.type === "customer_won") };
    };
    const service = hz.service({}, { inboxComposer: liar });
    const won = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "payment.received", { amount: { amountMinor: 100, currency: "EUR" } }, [hz.A.entityId])).id]);
    expect(won.item.type).toBe("customer_won");
    expect(won.item.blocksContinue).toBe(true);
    expect((won.item.decision as { options: unknown[] }).options.length).toBeGreaterThanOrEqual(2);
    const decision = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "approval.requested", { title: "Spend" })).id]);
    expect(decision.item.type).toBe("decision");
    expect(decision.item.blocksContinue).toBe(true);
    const update = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "pr.merged", { title: "Docs" })).id]);
    expect(update.item.type).toBe("update");
    expect(update.item.blocksContinue).toBe(false);
  });

  it("a warning blocks only when runway is below three months", async () => {
    const service = hz.service();
    const healthy = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "channel.threshold_breached", { channelKey: "events", metric: "cpa", value: 1200, threshold: 1000 })).id]);
    expect(healthy.item.type).toBe("warning");
    expect(healthy.item.blocksContinue).toBe(false);
    const red = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "runway.threshold_crossed", { runwayMonths: 2.4, thresholdMonths: 3, direction: "below" })).id]);
    expect(red.item.type).toBe("warning");
    expect(red.item.blocksContinue).toBe(true);
    // Business B: cash and burn from the ledger put the runway under three months → every warning blocks (AC-11.8.3).
    const account = await repos.finance.upsertAccount(hz.db, hz.B.businessId, { provider: "mock_bank", externalId: "runway-red", name: "Ops", currency: "EUR", balanceMinor: 200_000 });
    const now = new Date();
    const tx = [];
    for (let m = 1; m <= 3; m++) {
      const bookedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 10));
      tx.push({ accountId: account.id, externalId: `burn-${m}`, bookedAt, amountMinor: -100_000, currency: "EUR", description: "payroll" });
    }
    await repos.finance.upsertTransactions(hz.db, hz.B.businessId, tx);
    const b = await service.narrate(hz.B.businessId, [(await hz.writeEvent(hz.B.businessId, "channel.threshold_breached", { channelKey: "events", metric: "cpa", value: 10, threshold: 5 })).id]);
    expect(b.item.type).toBe("warning");
    expect(b.item.blocksContinue).toBe(true);
  });
});
