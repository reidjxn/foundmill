/**
 * services/push/notifier.ts: who gets told, with which words, through the gateway, and what is recorded. Members with a
 * registered phone, the kind switched on and read access to the event's section; amounts and names follow their walls
 * and the lock-screen switch; readers of the same words share one send; a duplicate delivery sends nothing; a gateway
 * failure is dropped; one `push.sent` event per source event.
 */
import { eq } from "drizzle-orm";
import { events, memberships, repos } from "@foundmill/db";
import { buildEvent, type PlatformEvent, type WriteEventInput } from "@foundmill/events";
import type { EventType } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayPushRequest, GatewayPushResult } from "../services/gateway";
import { createPushNotifier, type PushNotifier } from "../services/push/notifier";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let sent: GatewayPushRequest[] = [];
let failNext: Error | null = null;
let notifier: PushNotifier;
const token = (who: string, n = 1) => `onesignal-${who}-${n}-0123456789abcdef`;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "push-notifier" });
  const gateway = {
    ...hz.deps.gateway,
    sendPush: async (input: GatewayPushRequest): Promise<GatewayPushResult> => {
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
      sent.push(input);
      return { mode: "mock", id: `ntf-${sent.length}`, recipients: input.subscriptionIds.length, errors: [] };
    },
  };
  notifier = createPushNotifier({ db: hz.db, gateway, log: hz.deps.log }, { now: () => new Date("2026-11-08T12:00:00Z") });
  // The owner has two phones, the viewer one, the member none (yet); B's owner has one, so A's events must never reach it.
  await repos.devices.register(hz.db, hz.A.ownerId, { platform: "ios", token: token("owner", 1) });
  await repos.devices.register(hz.db, hz.A.ownerId, { platform: "android", token: token("owner", 2) });
  await repos.devices.register(hz.db, hz.A.viewerId, { platform: "ios", token: token("viewer") });
  await repos.devices.register(hz.db, hz.B.ownerId, { platform: "ios", token: token("b-owner") });
}, 120_000);
afterAll(() => hz.close());

const ev = <T extends EventType>(type: T, payload: WriteEventInput<T>["payload"], businessId = hz.A.businessId): PlatformEvent => buildEvent({ businessId, type, actor: { kind: "system", id: "test" }, payload }) as PlatformEvent;

const decision = (subject: string, businessId?: string) => ev("inbox.item_created", { inboxItemId: hz.A.inboxItemId, type: "decision", fromAgentId: hz.A.agentId, subject, blocksContinue: false, sourceEventIds: [], cost: null }, businessId);

const pushSentEvents = async (businessId: string) => (await hz.db.select().from(events).where(eq(events.businessId, businessId))).filter((e) => e.type === "push.sent");

describe("the push notifier", () => {
  it("tells every member with a phone who may read the Inbox, in one send when they read the same words, and records it", async () => {
    sent = [];
    const event = decision("Approve batch 002 before the Ireland launch?");
    const outcome = await notifier.handle(event);
    expect(outcome).toEqual({ status: "sent", kind: "decision", recipients: 2, devices: 3, sends: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ businessId: hz.A.businessId, kind: "decision", title: "Needs your answer", data: { businessId: hz.A.businessId, kind: "inbox", itemId: hz.A.inboxItemId }, collapseKey: `inbox:${hz.A.inboxItemId}` });
    expect(sent[0]!.body).toMatch(/Chief of Staff: Approve batch 002 before the Ireland launch\?$/);
    expect([...sent[0]!.subscriptionIds].sort()).toEqual([token("owner", 1), token("owner", 2), token("viewer")].sort());
    const recorded = await pushSentEvents(hz.A.businessId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.payload).toMatchObject({ kind: "decision", sourceEventId: event.id, sourceEventType: "inbox.item_created", recipients: 2, devices: 3, provider: "onesignal", mode: "mock", providerMessageIds: ["ntf-1"] });
    // B's phone never hears about A.
    expect(sent[0]!.subscriptionIds).not.toContain(token("b-owner"));
    expect(await pushSentEvents(hz.B.businessId)).toEqual([]);
  });

  it("a re-delivery of the same event sends nothing", async () => {
    sent = [];
    const event = decision("Approve batch 002 before the Ireland launch?");
    expect((await notifier.handle(event)).status).toBe("sent");
    expect(await notifier.handle(event)).toEqual({ status: "skipped", reason: "duplicate" });
    expect(sent).toHaveLength(1);
  });

  it("an event of another type, or a business with no phones, costs no send", async () => {
    sent = [];
    expect(await notifier.handle(ev("guidance.turned_off", { from: "settings", toursDone: 1, explainersSeen: 1 }))).toEqual({ status: "skipped", reason: "not_a_push_event" });
    const noPhones = await hz.h.createUser("no-phones@test.local");
    const business = await repos.businesses.create(hz.db, { name: "Quiet Co" });
    await hz.db.insert(memberships).values({ businessId: business.id, userId: noPhones, role: "owner" });
    expect(await notifier.handle(decision("Anything", business.id))).toEqual({ status: "skipped", reason: "no_devices" });
    expect(sent).toHaveLength(0);
  });

  it("a kind switched off, or no access to the section, leaves that person out", async () => {
    sent = [];
    await repos.preferences.update(hz.db, hz.A.ownerId, { notifications: { decision: false } });
    expect(await notifier.handle(decision("Only the viewer hears this"))).toMatchObject({ status: "sent", recipients: 1, devices: 1 });
    expect(sent[0]!.subscriptionIds).toEqual([token("viewer")]);
    await repos.preferences.update(hz.db, hz.A.ownerId, { notifications: { decision: true } });
    await hz.db.update(memberships).set({ sectionPermissions: { inbox: "none" } }).where(eq(memberships.userId, hz.A.viewerId));
    sent = [];
    expect(await notifier.handle(decision("Only the owner hears this"))).toMatchObject({ status: "sent", recipients: 1, devices: 2 });
    expect([...sent[0]!.subscriptionIds].sort()).toEqual([token("owner", 1), token("owner", 2)]);
    await hz.db.update(memberships).set({ sectionPermissions: {} }).where(eq(memberships.userId, hz.A.viewerId));
    // Nobody left: no send, no record.
    await repos.preferences.update(hz.db, hz.A.ownerId, { notifications: { decision: false } });
    await repos.preferences.update(hz.db, hz.A.viewerId, { notifications: { decision: false } });
    sent = [];
    const quiet = decision("Nobody hears this");
    expect(await notifier.handle(quiet)).toEqual({ status: "skipped", reason: "no_recipients" });
    expect((await pushSentEvents(hz.A.businessId)).some((e) => (e.payload as { sourceEventId: string }).sourceEventId === quiet.id)).toBe(false);
    await repos.preferences.update(hz.db, hz.A.ownerId, { notifications: { decision: true } });
    await repos.preferences.update(hz.db, hz.A.viewerId, { notifications: { decision: true } });
  });

  it("amounts follow the Finance wall and the lock-screen switch; different words mean separate sends", async () => {
    sent = [];
    const approval = ev("approval.requested", { approvalId: crypto.randomUUID(), planActionId: null, agentId: hz.A.agentId, sessionId: null, connectorKey: "sendgrid", tool: "send_mail", amount: { amountMinor: 60000, currency: "GBP" }, reasons: ["spend_above_threshold"], policyIds: ["60-assisted"], decisionType: "spend_above_threshold", hardGate: false, summary: "Set the LinkedIn Ads budget to £600 a week", expiresAt: null });
    // The viewer may not read Finance: no amount for them.
    await hz.db.update(memberships).set({ sectionPermissions: { finance: "none" } }).where(eq(memberships.userId, hz.A.viewerId));
    expect(await notifier.handle(approval)).toMatchObject({ status: "sent", kind: "approval", recipients: 2, devices: 3, sends: 2 });
    const byBody = Object.fromEntries(sent.map((s) => [s.body, [...s.subscriptionIds].sort()]));
    expect(byBody).toEqual({
      "Set the LinkedIn Ads budget to £600 a week · £600.00": [token("owner", 1), token("owner", 2)],
      "Set the LinkedIn Ads budget to £600 a week": [token("viewer")],
    });
    expect(sent.every((s) => s.title === "Needs your go-ahead")).toBe(true);
    // The owner hides amounts on the lock screen: now everyone reads the plain line, in one send.
    await repos.preferences.update(hz.db, hz.A.ownerId, { hideAmountsOnLockScreen: true });
    sent = [];
    const again = ev("approval.requested", { approvalId: crypto.randomUUID(), planActionId: null, agentId: hz.A.agentId, sessionId: null, connectorKey: "sendgrid", tool: "send_mail", amount: { amountMinor: 60000, currency: "GBP" }, reasons: [], policyIds: [], decisionType: null, hardGate: false, summary: "Set the LinkedIn Ads budget to £600 a week", expiresAt: null });
    expect(await notifier.handle(again)).toMatchObject({ status: "sent", recipients: 2, devices: 3, sends: 1 });
    expect(sent[0]!.body).toBe("Set the LinkedIn Ads budget to £600 a week");
    await repos.preferences.update(hz.db, hz.A.ownerId, { hideAmountsOnLockScreen: false });
    await hz.db.update(memberships).set({ sectionPermissions: {} }).where(eq(memberships.userId, hz.A.viewerId));
  });

  it("a customer won names the customer for readers of the CRM and routes to the Customer Update", async () => {
    sent = [];
    const entity = await repos.entities.get(hz.db, hz.A.businessId, hz.A.entityId);
    const journeyId = crypto.randomUUID();
    const won = ev("customer.converted", { entityId: hz.A.entityId, conversionId: crypto.randomUUID(), journeyId, kind: "payment", matchdayLevel: "cup", amount: { amountMinor: 9600, currency: "GBP" }, nthOfKind: 1, fullMatchDay: true, captainChannelKey: "seo", touchCount: 2, timeToConvertHours: 10, acquisitionCost: null });
    expect(await notifier.handle(won)).toMatchObject({ status: "sent", kind: "customer" });
    expect(sent[0]).toMatchObject({ title: "New customer", body: `${entity.displayName} just became a paying customer · £96.00`, data: { kind: "journey", journeyId }, collapseKey: `journey:${journeyId}` });
  });

  it("a gateway failure is dropped: no record, the next event still goes", async () => {
    sent = [];
    failNext = new Error("The gateway did not answer");
    const lost = decision("Lost in transit");
    expect(await notifier.handle(lost)).toEqual({ status: "failed", kind: "decision", reason: "The gateway did not answer" });
    expect((await pushSentEvents(hz.A.businessId)).some((e) => (e.payload as { sourceEventId: string }).sourceEventId === lost.id)).toBe(false);
    expect((await notifier.handle(decision("Arrives fine"))).status).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("the relay hook queues what matters and drains in order; stop() ends it", async () => {
    sent = [];
    const first = decision("First");
    const second = decision("Second");
    notifier.onPublished([ev("guidance.turned_off", { from: "settings", toursDone: 1, explainersSeen: 1 }), first, second]);
    await notifier.stop();
    expect(sent.map((s) => s.body.split(": ").at(-1))).toEqual(["First", "Second"]);
    expect(await notifier.handle(decision("After stop"))).toEqual({ status: "skipped", reason: "stopped" });
  });
});
