/**
 * The project's Foundmill sending address in the api (package 1.5): Settings › Integrations shows it only when the
 * deployment has a sending domain, with today's count against the project's cap; the Email channel becomes available
 * for a person's own project on staging once the address really sends (SendGrid live and the domain set), so the empty
 * Board's "Email opens first" line stops showing; a founder cannot raise their own cap.
 */
import { repos } from "@foundmill/db";
import { buildEvent } from "@foundmill/events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pmail" });
}, 120_000);
afterAll(() => hz.close());

const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);
const ON = { PLATFORM_MAIL_DOMAIN: "mail.foundmill.test" } as const;
const STAGING = { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" } as const;

describe("integrations.platformMail", () => {
  it("is null when the deployment has no sending domain, and creates nothing", async () => {
    expect(await hz.caller({ userId: hz.A.ownerId }).integrations.platformMail({ businessId: hz.A.businessId })).toBeNull();
    expect(await repos.projectMail.get(hz.db, hz.A.businessId)).toBeNull();
  });

  it("shows the project's address, today's count against the cap, and whether it really sends", async () => {
    const caller = callerWith(ON, { userId: hz.A.ownerId });
    const first = await caller.integrations.platformMail({ businessId: hz.A.businessId });
    const row = await repos.projectMail.get(hz.db, hz.A.businessId);
    expect(first).toEqual({ address: `${row!.localPart}@mail.foundmill.test`, sentToday: 0, cap: 50, paused: false, live: false, ownSender: false });
    const event = buildEvent({ businessId: hz.A.businessId, type: "mail.sent", actor: { kind: "agent", id: hz.A.agentId }, payload: { messageRef: crypto.randomUUID(), messageId: "m-1", recipientHash: "b".repeat(64), fromLocalPart: row!.localPart, simulated: true } });
    await repos.events.write(hz.db, hz.A.businessId, { id: event.id, type: event.type, actor: event.actor, entityIds: [], payload: event.payload as Record<string, unknown>, occurredAt: new Date() });
    await repos.projectMail.setDailyCap(hz.db, hz.A.businessId, 120);
    const again = await callerWith({ ...ON, LIVE_CONNECTORS: "sendgrid" }, { userId: hz.A.ownerId }).integrations.platformMail({ businessId: hz.A.businessId });
    expect(again).toMatchObject({ address: first!.address, sentToday: 1, cap: 120, live: true });
  });

  it("another business's members never see it", async () => {
    await expect(callerWith(ON, { userId: hz.B.ownerId }).integrations.platformMail({ businessId: hz.A.businessId })).rejects.toThrow();
  });
});

describe("the Email channel on staging", () => {
  it("is not available while the address is simulated, and the empty Board says email opens first", async () => {
    const listed = await callerWith({ ...STAGING, ...ON }, { userId: hz.B.ownerId }).distribution.channels.list({ businessId: hz.B.businessId });
    expect(listed.availability.email_automation.available).toBe(false);
    expect(listed.noChannel).toMatch(/^No channel can run on its own yet\. Email opens first/);
  });

  it("opens for every project once the address really sends, with nothing to connect, and the line stops showing", async () => {
    const listed = await callerWith({ ...STAGING, ...ON, LIVE_CONNECTORS: "sendgrid" }, { userId: hz.B.ownerId }).distribution.channels.list({ businessId: hz.B.businessId });
    expect(listed.availability.email_automation).toEqual({ available: true, reason: "acts", sentence: null });
    expect(listed.noChannel).toBeNull();
  });

  it("without the domain, SendGrid live still asks the founder to connect their own (as before)", async () => {
    const listed = await callerWith({ ...STAGING, LIVE_CONNECTORS: "sendgrid" }, { userId: hz.B.ownerId }).distribution.channels.list({ businessId: hz.B.businessId });
    expect(listed.availability.email_automation).toMatchObject({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: true });
  });
});
