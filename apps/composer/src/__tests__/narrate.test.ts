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
import { ComposeTimeoutError, ComposerRejectedError, founderJargonOf, jargonReask } from "../compose";
import { isNamedQueryId } from "../exhibits";
import { isDraftWorthy } from "../persist";
import { createComposerService, narrationKey } from "../service";
import { countInbox, createComposerHarness, silentLog, type ComposerHarness } from "./harness";

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

/** Every note of business A, archived ones included: a newer update archives its agent's older open one (Nov 7, 2026). */
async function noteCount(): Promise<number> {
  const open = await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 });
  const archived = await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500, tab: "archive" });
  return open.items.length + archived.items.length;
}

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

  it("re-asks once when a note carries engineering words, and keeps the plain rewrite (Nov 7, 2026)", async () => {
    expect(founderJargonOf("Pull request merged", "The [[ent:00000000-0000-4000-8000-000000000001|Deploy pipeline]] ran.")).toEqual(expect.arrayContaining(["pull request", "pipeline"]));
    expect(founderJargonOf("Pricing page is live", "Customers can now see the new prices.")).toEqual([]);
    // The engine's numbers re-ask too (Builder view, Nov 8, 2026): a cycle number, a test tally, tokens, a PR number, an ETA.
    expect(founderJargonOf("Cycle 3 completed", "105 tests passed on PR #41; ETA 3:45 PM after 12,400 tokens.")).toEqual(["cycle 3", "105 tests passed", "pr #41", "eta", "12,400 tokens"]);
    expect(jargonReask(["pull request"])).toContain('"pull request"');
    const base = MOCK_ROUTES.inboxComposer.generate;
    const prompts: string[] = [];
    const techy: MockGenerator = (ctx) => {
      const out = base(ctx) as { subject: string; body_md: string };
      prompts.push(String(ctx.messages[ctx.messages.length - 1]?.content ?? ""));
      return ctx.messages.length === 1 ? { ...out, subject: "Pull request merged", body_md: "The pull request passed CI and was merged." } : { ...out, subject: "Pricing page is live", body_md: "Customers can now see the new prices." };
    };
    const service = hz.service({}, { inboxComposer: techy });
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Jargon test" });
    const r = await service.narrate(hz.A.businessId, [event.id]);
    expect(r.reasked).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("The founder is not technical");
    expect(r.item.subject).toBe("Pricing page is live");
    expect(founderJargonOf(r.item.subject, r.item.bodyMd)).toEqual([]);
  });

  it("rejects with 422 after the single re-ask when ids are still invalid, writing nothing (never render unknown ids)", async () => {
    const ghost = crypto.randomUUID();
    const base = MOCK_ROUTES.inboxComposer.generate;
    const stubborn: MockGenerator = (ctx) => ({ ...(base(ctx) as object), body_md: `Still pointing at [[ent:${ghost}|Ghost Corp]] after the re-ask, every single time.` });
    const service = hz.service({}, { inboxComposer: stubborn });
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Reject test" });
    const itemsBefore = (await noteCount());
    const err = await service.narrate(hz.A.businessId, [event.id]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposerRejectedError);
    expect((err as ComposerRejectedError).status).toBe(422);
    expect((err as ComposerRejectedError).details).toMatchObject({ unknownIds: [ghost] });
    expect((await noteCount())).toBe(itemsBefore);
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
    const inboxBefore = (await noteCount());
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
    expect((await noteCount())).toBe(inboxBefore + 1);
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
    const inboxBefore = (await noteCount());
    const results = await Promise.all([service.narrate(hz.A.businessId, [event.id]), service.narrate(hz.A.businessId, [event.id]), service.narrate(hz.A.businessId, [event.id])]);
    expect(new Set(results.map((r) => r.item.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await noteCount())).toBe(inboxBefore + 1);
    expect(composerCalls(usageBefore)).toBe(1);
  });

  it("two composer instances racing on the same events write one note (the event's idempotency key decides)", async () => {
    const event = await hz.writeEvent(hz.A.businessId, "pr.merged", { title: "Two instances" });
    const inboxBefore = (await noteCount());
    const [x, y] = await Promise.all([hz.service().narrate(hz.A.businessId, [event.id]), hz.service().narrate(hz.A.businessId, [event.id])]);
    expect(x.item.id).toBe(y.item.id);
    expect([x.replayed, y.replayed].filter(Boolean)).toHaveLength(1);
    expect((await noteCount())).toBe(inboxBefore + 1);
    expect(await repos.events.byIdempotencyKey(hz.db, hz.A.businessId, narrationKey([event.id]))).toMatchObject({ type: "inbox.item_created" });
  });

  it("a narration past the compose deadline is abandoned unwritten (504), and the retry writes it once", async () => {
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Deadline" });
    const slow = createModelClient({ mode: "mock", logger: silentLog, mock: { latencyMs: 300 } });
    const late = createComposerService({ db: hz.db, models: slow, log: silentLog }, { debounceMs: 0, persistDrafts: false, composeDeadlineMs: 50 });
    const inboxBefore = (await noteCount());
    const err = await late.narrate(hz.A.businessId, [event.id]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposeTimeoutError);
    expect((err as ComposeTimeoutError).status).toBe(504);
    expect((await noteCount())).toBe(inboxBefore);
    expect((await repos.events.get(hz.db, hz.A.businessId, event.id)).narrated).toBe(false);
    const retry = await hz.service().narrate(hz.A.businessId, [event.id]);
    expect(retry.replayed).toBe(false);
    expect((await noteCount())).toBe(inboxBefore + 1);
  });
});

describe("one living warning per problem (Nov 1, 2026)", () => {
  it("a second warning about the same task revises the open one in place; once answered, the problem coming back is a new item", async () => {
    const service = hz.service();
    const taskId = crypto.randomUUID();
    const blocked = (occurrence: number, detail: string) => hz.writeEvent(hz.A.businessId, "task.blocked", { taskId, kind: "code", title: "Deploy contract", assigneeAgentId: hz.A.agentId, reason: "dependency", detail, occurrence });
    const first = await service.narrate(hz.A.businessId, [(await blocked(1, "Waits on one change going live.")).id]);
    expect(first.item.type).toBe("warning");
    const before = await countInbox(hz.db, hz.A.businessId);

    const second = await service.narrate(hz.A.businessId, [(await blocked(2, "Still waits on that change.")).id]);
    expect(second.item.id).toBe(first.item.id);
    expect(second.replayed).toBe(false);
    expect(await countInbox(hz.db, hz.A.businessId)).toBe(before);
    expect(second.item.state).toBe("unread");
    expect(second.item.bodyMd).toMatch(/^\*\*Updated [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM) UTC\*\*/);
    expect(second.item.bodyMd).toContain("_Earlier (");
    expect(second.item.sourceEventIds).toHaveLength(2);
    const updated = await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_updated", limit: 50 });
    expect(updated.items.some((e) => (e.payload as { inboxItemId: string; change: string }).inboxItemId === first.item.id && (e.payload as { change: string }).change === "revised")).toBe(true);
    // A third time: still the one item, and the earlier text is kept once, not nested.
    const third = await service.narrate(hz.A.businessId, [(await blocked(3, "Third day waiting.")).id]);
    expect(third.item.id).toBe(first.item.id);
    expect(third.item.bodyMd.match(/_Earlier \(/g)).toHaveLength(1);

    // Answered: what the founder decided stays on record; the problem coming back is a new item.
    const options = (third.item.decision as { options?: { id: string }[] } | null)?.options ?? [];
    await repos.inbox.decide(hz.db, hz.A.businessId, first.item.id, options[0] ? { chosenOption: options[0].id } : { freeText: "Noted" });
    const fourth = await service.narrate(hz.A.businessId, [(await blocked(4, "Back again.")).id]);
    expect(fourth.item.id).not.toBe(first.item.id);
    expect(await countInbox(hz.db, hz.A.businessId)).toBe(before + 1);
  });

  it("a warning about a different task is its own item", async () => {
    const service = hz.service();
    const event = (taskId: string) => hz.writeEvent(hz.A.businessId, "task.blocked", { taskId, kind: "code", title: "Another task", assigneeAgentId: hz.A.agentId, reason: "credential", detail: "Needs a key.", occurrence: 1 });
    const a = await service.narrate(hz.A.businessId, [(await event(crypto.randomUUID())).id]);
    const b = await service.narrate(hz.A.businessId, [(await event(crypto.randomUUID())).id]);
    expect(b.item.id).not.toBe(a.item.id);
  });
});

describe("blocks_continue: a Composer note never holds Continue (Nov 7, 2026; 0071)", () => {
  it("a win, a decision and an update never hold Continue, whatever flag the model claims", async () => {
    const base = MOCK_ROUTES.inboxComposer.generate;
    const liar: MockGenerator = (ctx) => ({ ...(base(ctx) as Record<string, unknown>), blocks_continue: true });
    const service = hz.service({}, { inboxComposer: liar });
    const won = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "payment.received", { amount: { amountMinor: 100, currency: "EUR" } }, [hz.A.entityId])).id]);
    expect(won.item.type).toBe("customer_won");
    expect(won.item.blocksContinue).toBe(false);
    expect((won.item.decision as { options: unknown[] }).options.length).toBeGreaterThanOrEqual(2);
    const decision = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "approval.requested", { title: "Spend" })).id]);
    expect(decision.item.type).toBe("decision");
    expect(decision.item.blocksContinue).toBe(false);
    const update = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "pr.merged", { title: "Docs" })).id]);
    expect(update.item.type).toBe("update");
    expect(update.item.blocksContinue).toBe(false);
  });

  it("a runway warning below three months says so without freezing the team", async () => {
    const service = hz.service();
    const red = await service.narrate(hz.A.businessId, [(await hz.writeEvent(hz.A.businessId, "runway.threshold_crossed", { runwayMonths: 2.4, thresholdMonths: 3, direction: "below" })).id]);
    expect(red.item.type).toBe("warning");
    expect(red.item.blocksContinue).toBe(false);
  });
});
