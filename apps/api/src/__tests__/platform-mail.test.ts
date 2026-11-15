/**
 * The project's Foundmill sending address in the api (package 1.5): Settings › Integrations shows it only when the
 * deployment has a sending domain, with today's count against the project's cap; the Email channel becomes available
 * for a person's own project on staging once the address really sends (SendGrid live and the domain set), so the empty
 * Board's "Email opens first" line stops showing; a founder cannot raise their own cap. The founders' postal address for
 * marketing email (US CAN-SPAM): only they read and set it, and saving it answers the note that asked for it.
 */
import { repos } from "@foundmill/db";
import { POSTAL_ADDRESS_NOTE } from "@foundmill/shared";
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
    expect(first).toEqual({ address: `${row!.localPart}@mail.foundmill.test`, sentToday: 0, cap: 50, paused: false, live: false, ownSender: false, postalAddress: null, canEditPostalAddress: true });
    const event = buildEvent({ businessId: hz.A.businessId, type: "mail.sent", actor: { kind: "agent", id: hz.A.agentId }, payload: { messageRef: crypto.randomUUID(), messageId: "m-1", recipientHash: "b".repeat(64), fromLocalPart: row!.localPart, simulated: true } });
    await repos.events.write(hz.db, hz.A.businessId, { id: event.id, type: event.type, actor: event.actor, entityIds: [], payload: event.payload as Record<string, unknown>, occurredAt: new Date() });
    await repos.projectMail.setDailyCap(hz.db, hz.A.businessId, 120);
    const again = await callerWith({ ...ON, LIVE_CONNECTORS: "sendgrid" }, { userId: hz.A.ownerId }).integrations.platformMail({ businessId: hz.A.businessId });
    expect(again).toMatchObject({ address: first!.address, sentToday: 1, cap: 120, live: true });
  });

  it("ownSender is true while the founder's own Resend is connected, and false when it is degraded, disconnected or archived", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    const ownSender = async () => (await owner.integrations.platformMail({ businessId: hz.A.businessId }))!.ownSender;
    expect(await ownSender()).toBe(false);
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "resend", status: "connected", authKind: "api_key", accountLabel: "own" });
    expect(await ownSender(), "connected").toBe(true);
    // A degraded Resend cannot send; the project's own address stays its sender.
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "resend", status: "degraded", authKind: "api_key", accountLabel: "own" });
    expect(await ownSender(), "degraded").toBe(false);
    const row = await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "resend", status: "disconnected", authKind: "api_key", accountLabel: "own" });
    expect(await ownSender(), "disconnected").toBe(false);
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "resend", status: "connected", authKind: "api_key", accountLabel: "own" });
    expect(await ownSender()).toBe(true);
    await repos.integrations.archive(hz.db, hz.A.businessId, row.id);
    expect(await ownSender(), "archived").toBe(false);
    // Another business's Resend never counts here.
    await repos.integrations.upsert(hz.db, hz.B.businessId, { connectorKey: "resend", status: "connected", authKind: "api_key", accountLabel: "other" });
    expect(await ownSender(), "another business").toBe(false);
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

describe("the founders' postal address (US CAN-SPAM)", () => {
  const ADDRESS = "PO Box 1234, Springfield, IL 62701, USA";

  it("a founder enters it in one tidy line and reads it back; a collaborator neither reads nor sets it", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    expect(await owner.integrations.setPostalAddress({ businessId: hz.A.businessId, address: "PO Box 1234\nSpringfield, IL 62701\nUSA" })).toMatchObject({ address: ADDRESS });
    expect(await owner.integrations.platformMail({ businessId: hz.A.businessId })).toMatchObject({ postalAddress: ADDRESS, canEditPostalAddress: true });
    expect(await callerWith(ON, { userId: hz.A.adminId }).integrations.platformMail({ businessId: hz.A.businessId })).toMatchObject({ postalAddress: ADDRESS, canEditPostalAddress: true });
    const member = callerWith(ON, { userId: hz.A.memberId });
    await expect(member.integrations.setPostalAddress({ businessId: hz.A.businessId, address: "1 Other Street, Springfield 62701" })).rejects.toThrow();
    await expect(member.integrations.clearPostalAddress({ businessId: hz.A.businessId })).rejects.toThrow();
    await expect(callerWith(ON, { userId: hz.B.ownerId }).integrations.setPostalAddress({ businessId: hz.A.businessId, address: "1 Other Street, Springfield 62701" })).rejects.toThrow();
    expect(await repos.postalAddress.addressOf(hz.db, hz.A.businessId)).toBe(ADDRESS);
    // The audit says it changed, never the address.
    const logged = await repos.audit.list(hz.db, hz.A.businessId, { action: "mail.postal_address.added", limit: 5 });
    expect(logged.items).toHaveLength(1);
    expect(JSON.stringify(logged.items[0])).not.toContain("Springfield");
  });

  it("refuses what is not a postal address, in plain words", async () => {
    await expect(callerWith(ON, { userId: hz.A.ownerId }).integrations.setPostalAddress({ businessId: hz.A.businessId, address: "www.example.com 12" })).rejects.toThrow(/not a web or email address/);
  });

  it("the founders' note: in Needs you with one tap for a founder, decided in-process, and saving the address answers an open one", async () => {
    const { businessId, ownerId, agentId } = hz.B;
    const note = await repos.postalAddress.raiseNote(hz.db, businessId, { fromAgentId: agentId, now: new Date() });
    expect(note).not.toBeNull();
    const owner = callerWith(ON, { userId: ownerId });
    const today = await owner.today.get({ businessId });
    const row = today.needsYou?.items.find((i) => i.id === note!.id);
    expect(row?.quickOption).toEqual({ id: POSTAL_ADDRESS_NOTE.options.add, label: POSTAL_ADDRESS_NOTE.addLabel });
    // A collaborator sees it with no one-tap answer, and cannot answer it.
    const memberToday = await callerWith(ON, { userId: hz.B.memberId }).today.get({ businessId });
    expect(memberToday.needsYou?.items.find((i) => i.id === note!.id)?.quickOption ?? null).toBeNull();
    await expect(callerWith(ON, { userId: hz.B.memberId }).inbox.decide({ businessId, itemId: note!.id, chosenOption: POSTAL_ADDRESS_NOTE.options.later })).rejects.toThrow(/founders/);
    // "Later" answers it without a model call.
    const later = await owner.inbox.decide({ businessId, itemId: note!.id, chosenOption: POSTAL_ADDRESS_NOTE.options.later });
    expect(later.item.state).toBe("answered");
    expect(later.decision.chosenOption).toBe(POSTAL_ADDRESS_NOTE.options.later);
    // A later note, still open, is answered by saving the address.
    const again = await repos.postalAddress.raiseNote(hz.db, businessId, { fromAgentId: agentId, now: new Date(Date.now() + POSTAL_ADDRESS_NOTE.quietMs + 60_000) });
    expect(again).not.toBeNull();
    const saved = await owner.integrations.setPostalAddress({ businessId, address: ADDRESS });
    expect(saved.answeredNoteId).toBe(again!.id);
    expect((await repos.inbox.get(hz.db, businessId, again!.id)).state).toBe("answered");
    expect(await owner.integrations.clearPostalAddress({ businessId })).toEqual({ removed: true });
    expect(await repos.postalAddress.addressOf(hz.db, businessId)).toBeNull();
  });
});
