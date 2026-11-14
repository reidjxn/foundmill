/**
 * After commit (audit GTM-21 / WEB-08, JM-01 / O-30 / VGJC-X2): a payment that wins a customer is narrated at once (the
 * composer writes the customer_won item from its customer.converted), journeyBuild is started for the conversion, and
 * every enabled playbook whose trigger matches a written event starts a run; a renewal starts none of it. Also the
 * pieces: the trigger matcher, the Temporal starter and the composer client.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { signedStripeRequest } from "@foundmill/connectors";
import { ST_INVOICES } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { stripeEvent } from "@foundmill/connectors/connectors/stripe/mock";
import { ComposerUnavailableError, createComposerNarrator, type ComposerNarrator } from "../composer-client";
import { createFollowups, type JourneyBuildRequest, type PlaybookRequest } from "../followups";
import { conditionHolds, playbookTriggerMatches } from "../playbooks";
import { silentLogger } from "../types";
import { createTemporalStarter, type TemporalStartClient, type WorkflowStarter } from "../workflows";
import { createIngestHarness, json, simulateToken, type IngestHarness } from "./harness";

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("followups");
}, 120_000);
afterAll(async () => {
  await hz.close();
});

interface Recorder {
  composer: ComposerNarrator & { calls: string[][]; fail: boolean };
  workflows: WorkflowStarter & { calls: { type: string; workflowId: string; args: unknown[] }[] };
}

function recorder(): Recorder {
  const composer = {
    calls: [] as string[][],
    fail: false,
    async narrate(input: { businessId: string; eventIds: string[] }) {
      if (composer.fail) throw new ComposerUnavailableError("down");
      composer.calls.push(input.eventIds);
      return { inboxItemId: "00000000-0000-4000-8000-000000000001" };
    },
  };
  const workflows = {
    calls: [] as { type: string; workflowId: string; args: unknown[] }[],
    async start(type: string, options: { workflowId: string; args: unknown[] }) {
      workflows.calls.push({ type, ...options });
      return { started: true, workflowId: options.workflowId };
    },
    async close() {},
  };
  return { composer, workflows };
}

const buildWith = (r: Recorder) => hz.build({ followups: createFollowups({ db: hz.db, composer: r.composer, workflows: r.workflows, log: silentLogger }) });
const deliverTo = (app: ReturnType<typeof buildWith>["app"], req: Request) => app.fetch(req);

describe("after the first follower confirms", () => {
  it("starts the post draft workflow for the business, with one id per business, and nothing about the person", async () => {
    const r = recorder();
    const followups = createFollowups({ db: hz.db, composer: r.composer, workflows: r.workflows, log: silentLogger });
    followups.firstFollower(hz.A.businessId);
    await followups.idle();
    expect(r.workflows.calls).toEqual([{ type: "postDraft", workflowId: `post-draft:${hz.A.businessId}:first_follower`, args: [{ businessId: hz.A.businessId, trigger: { kind: "first_follower" } }] }]);
    expect(r.composer.calls).toEqual([]);
  });

  it("an orchestrator that does not answer changes nothing and throws nothing", async () => {
    const down: WorkflowStarter = { start: async (_type, options) => ({ started: false, workflowId: options.workflowId, reason: "temporal unreachable" }), close: async () => undefined };
    const followups = createFollowups({ db: hz.db, composer: null, workflows: down, log: silentLogger });
    followups.firstFollower(hz.A.businessId);
    await expect(followups.idle()).resolves.toBeUndefined();
  });
});

describe("after a payment commits", () => {
  it("narrates the customer won within the delivery's follow-up, starts journeyBuild and the matching playbooks", async () => {
    const r = recorder();
    const built = buildWith(r);
    const onPayment = await repos.playbooks.create(hz.db, hz.A.businessId, { name: "Thank new customers", sourceText: "When a payment arrives, send a thank-you", compiled: { trigger: { event: "payment.received" }, steps: [{ type: "create_task", params: { title: "Thank you note" } }] }, enabled: true });
    const bigOnly = await repos.playbooks.create(hz.db, hz.A.businessId, { name: "Big wins", sourceText: "When a payment above 1,000 arrives", compiled: { trigger: { event: "payment.received", condition: "amount.amountMinor > 100000" }, steps: [] }, enabled: true });
    const onWin = await repos.playbooks.create(hz.db, hz.A.businessId, { name: "Celebrate", sourceText: "When a customer is won", compiled: { trigger: { event: "customer.converted", where: { kind: "payment" } }, steps: [] }, enabled: true });
    await repos.playbooks.create(hz.db, hz.A.businessId, { name: "Off", sourceText: "Disabled", compiled: { trigger: { event: "payment.received" }, steps: [] }, enabled: false });

    const res = await deliverTo(built.app, signedStripeRequest(hz.A.businessId, stripeEvent("invoice.paid", ST_INVOICES[0]!, "evt_followup_1")));
    expect(res.status).toBe(200);
    const [paymentId, convertedId] = (await json<{ eventIds: string[] }>(res)).eventIds;
    await built.deps.followups.idle();

    expect(r.composer.calls).toEqual([[convertedId]]);
    const converted = await repos.events.get(hz.db, hz.A.businessId, convertedId!);
    const conversionId = (converted.payload as { conversionId: string }).conversionId;
    const journeyStart = r.workflows.calls.find((c) => c.type === "journeyBuild");
    expect(journeyStart).toMatchObject({ workflowId: `journey:${conversionId}` });
    expect(journeyStart!.args[0]).toEqual({ businessId: hz.A.businessId, conversionId, convertedEventId: convertedId!, narrate: false } satisfies JourneyBuildRequest);

    const playbookStarts = r.workflows.calls.filter((c) => c.type === "playbook");
    expect(playbookStarts.map((c) => c.workflowId).sort()).toEqual([`playbook:${onPayment.id}:${paymentId}`, `playbook:${onWin.id}:${convertedId}`].sort());
    expect(playbookStarts.some((c) => c.workflowId.startsWith(`playbook:${bigOnly.id}`))).toBe(false);
    const request = playbookStarts.find((c) => c.workflowId.startsWith(`playbook:${onPayment.id}`))!.args[0] as PlaybookRequest;
    expect(request).toMatchObject({ businessId: hz.A.businessId, playbookId: onPayment.id, event: { type: "payment.received", id: paymentId, payload: { externalId: ST_INVOICES[0]!.id } } });
  });

  it("asks journeyBuild to narrate when the composer is down, and starts nothing for a renewal", async () => {
    const r = recorder();
    r.composer.fail = true;
    const built = buildWith(r);
    const res = await deliverTo(built.app, signedStripeRequest(hz.B.businessId, stripeEvent("invoice.paid", ST_INVOICES[2]!, "evt_followup_2")));
    await built.deps.followups.idle();
    const [, convertedId] = (await json<{ eventIds: string[] }>(res)).eventIds;
    expect(r.workflows.calls.find((c) => c.type === "journeyBuild")!.args[0]).toMatchObject({ convertedEventId: convertedId, narrate: true });

    const quiet = recorder();
    const again = buildWith(quiet);
    const renewal = { ...ST_INVOICES[2]!, id: "in_omar_renewal_1", billing_reason: "subscription_cycle" };
    expect((await deliverTo(again.app, signedStripeRequest(hz.B.businessId, stripeEvent("invoice.paid", renewal, "evt_followup_3")))).status).toBe(200);
    await again.deps.followups.idle();
    expect(quiet.composer.calls).toEqual([]);
    expect(quiet.workflows.calls.filter((c) => c.type === "journeyBuild")).toEqual([]);
  });

  it("a simulated payment takes the same path (Settings › Integrations › Simulate)", async () => {
    const r = recorder();
    const built = buildWith(r);
    const res = await built.app.request("/simulate/payment.received", { method: "POST", headers: { authorization: `Bearer ${simulateToken(hz.B.businessId)}`, "content-type": "application/json" }, body: JSON.stringify({ businessId: hz.B.businessId, seed: "followup-sim" }) });
    expect(res.status).toBe(200);
    const body = await json<{ eventIds: string[]; events: { journeyId: string | null; firstPayment: boolean | null; entityId: string | null }[] }>(res);
    expect(body.events[0]).toMatchObject({ firstPayment: true });
    expect(body.events[0]!.entityId).toBeTruthy();
    await built.deps.followups.idle();
    expect(r.composer.calls).toEqual([[body.eventIds[1]]]);
    expect(r.workflows.calls.filter((c) => c.type === "journeyBuild")).toHaveLength(1);
  });
});

describe("playbook triggers", () => {
  const reply = { type: "lead.replied", payload: { sentiment: "positive", requestsMeeting: true, channelKey: "email_automation", score: 7, nested: { flag: false } } };
  it("matches the event type, `where` equality and the condition language", () => {
    expect(playbookTriggerMatches({ event: "lead.replied" }, reply)).toBe(true);
    expect(playbookTriggerMatches({ event: "payment.received" }, reply)).toBe(false);
    expect(playbookTriggerMatches({ event: "lead.replied", where: { sentiment: "positive" } }, reply)).toBe(true);
    expect(playbookTriggerMatches({ event: "lead.replied", where: { sentiment: "negative" } }, reply)).toBe(false);
    expect(playbookTriggerMatches({ event: "lead.replied", condition: "sentiment == positive && requestsMeeting" }, reply)).toBe(true);
    expect(playbookTriggerMatches({ cron: "0 9 * * 1" }, reply)).toBe(false);
    expect(playbookTriggerMatches(null, reply)).toBe(false);
  });
  it("fails closed on what it cannot evaluate", () => {
    expect(conditionHolds("score >= 7 && !nested.flag && channelKey != 'seo'", reply.payload)).toBe(true);
    expect(conditionHolds("score > 7", reply.payload)).toBe(false);
    // The seeded Ledgerly trigger names fields the event does not carry: it never fires on a guess.
    expect(conditionHolds("trial_days_left == 3 && !stripe_connected", reply.payload)).toBe(false);
    expect(conditionHolds("sentiment == positive || score > 1", reply.payload)).toBe(false);
    expect(conditionHolds("(sentiment == positive)", reply.payload)).toBe(false);
    expect(conditionHolds("sentiment > 3", reply.payload)).toBe(false);
  });
});

describe("Temporal starter and composer client", () => {
  it("connects once, treats an id already running as started, and remembers an unreachable server", async () => {
    const started: { type: string; workflowId: string; taskQueue: string }[] = [];
    let connects = 0;
    const starter = createTemporalStarter({
      address: "temporal.test:7233",
      namespace: "default",
      taskQueue: "foundmill",
      log: silentLogger,
      connect: async () => {
        connects += 1;
        return {
          workflow: {
            async start(type, options) {
              if (started.some((s) => s.workflowId === options.workflowId)) throw Object.assign(new Error("already"), { name: "WorkflowExecutionAlreadyStartedError" });
              started.push({ type, workflowId: options.workflowId, taskQueue: options.taskQueue });
            },
          },
        };
      },
    });
    expect(await starter.start("journeyBuild", { workflowId: "journey:1", args: [] })).toEqual({ started: true, workflowId: "journey:1" });
    expect(await starter.start("journeyBuild", { workflowId: "journey:1", args: [] })).toMatchObject({ started: true, reason: "already running" });
    expect(connects).toBe(1);
    expect(started).toEqual([{ type: "journeyBuild", workflowId: "journey:1", taskQueue: "foundmill" }]);

    let attempts = 0;
    const down = createTemporalStarter({ address: "x", namespace: "default", taskQueue: "q", log: silentLogger, retryAfterMs: 60_000, connect: async () => { attempts += 1; throw new Error("ECONNREFUSED"); } });
    expect(await down.start("playbook", { workflowId: "playbook:a:b", args: [] })).toMatchObject({ started: false, reason: expect.stringContaining("ECONNREFUSED") });
    expect(await down.start("playbook", { workflowId: "playbook:a:c", args: [] })).toMatchObject({ started: false });
    expect(attempts).toBe(1);

    // A server that accepts the socket and never answers is given up on, not waited for.
    const hung = createTemporalStarter({ address: "x", namespace: "default", taskQueue: "q", log: silentLogger, connectTimeoutMs: 20, connect: () => new Promise<never>(() => undefined) });
    expect(await hung.start("journeyBuild", { workflowId: "journey:hung", args: [] })).toMatchObject({ started: false, reason: expect.stringContaining("connect timeout") });

    // One that answers after we gave up has its connection closed, not leaked.
    let closed = 0;
    let answer: (c: TemporalStartClient) => void = () => undefined;
    const slow = createTemporalStarter({ address: "x", namespace: "default", taskQueue: "q", log: silentLogger, connectTimeoutMs: 20, connect: () => new Promise<TemporalStartClient>((r) => (answer = r)) });
    expect(await slow.start("journeyBuild", { workflowId: "journey:slow", args: [] })).toMatchObject({ started: false, reason: expect.stringContaining("connect timeout") });
    answer({ workflow: { start: async () => undefined }, connection: { close: async () => void (closed += 1) } });
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(1);
  });

  it("posts the event ids to /v1/narrate and turns a failure into ComposerUnavailableError", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const ok = createComposerNarrator({ baseUrl: "http://composer.test/", fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ inboxItemId: "item-1" }), { status: 200 });
    }) as unknown as typeof fetch });
    expect(await ok.narrate({ businessId: hz.A.businessId, eventIds: ["e1"] })).toEqual({ inboxItemId: "item-1" });
    expect(seen).toEqual([{ url: "http://composer.test/v1/narrate", body: { businessId: hz.A.businessId, eventIds: ["e1"] } }]);
    const failing = createComposerNarrator({ baseUrl: "http://composer.test", fetch: (async () => new Response("{}", { status: 422 })) as unknown as typeof fetch });
    await expect(failing.narrate({ businessId: hz.A.businessId, eventIds: ["e1"] })).rejects.toBeInstanceOf(ComposerUnavailableError);
  });
});
