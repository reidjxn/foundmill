/**
 * Section walls over real sockets (security review S1): a member walled from Finance or the CRM opens a WebSocket and
 * subscribes to the business stream, which used to hand them every payment amount, payer email and note subject the
 * api's redaction keeps from them. Also: `as:<sessionId>` refused across sections, and open subscriptions re-checked
 * when the person's membership changes (at once on `membership.changed`, and periodically).
 */
import type { MemoryRedis } from "@foundmill/events";
import { EVENT_FIXTURES, fixtureId } from "@foundmill/events/testing/fixtures";
import { admittedBy, parseSignupAllowlist, type EventType, type SectionMembership } from "@foundmill/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createCachedAuthorizer, createMemoryAuthorizer, type Authorizer } from "../authorize";
import { businessChannel, sessionChannel } from "../protocol";
import { BUSINESS_A, devToken, openSocket, SESSION_A, sleep, startTestServer, USER_A, waitFor, type TestServer, type TestSocket } from "./helpers";

const USER_W = fixtureId("user-walled");
/** A Finance agent's session in business A. */
const SESSION_F = fixtureId("session-finance");

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** Business A: USER_A owns it, USER_W is a member walled from Finance. Mutable, so a test can change access. */
function world() {
  const walled: SectionMembership = { role: "member", sectionPermissions: { finance: "none" } };
  return {
    members: { [USER_A]: [BUSINESS_A], [USER_W]: [BUSINESS_A] } as Record<string, string[]>,
    sessions: { [SESSION_A]: BUSINESS_A, [SESSION_F]: BUSINESS_A },
    access: { [USER_W]: { [BUSINESS_A]: walled } } as Record<string, Record<string, SectionMembership>>,
    sessionModules: { [SESSION_F]: ["finance"] },
  };
}

async function boot(authorizer: Authorizer, options: NonNullable<Parameters<typeof startTestServer>[0]>["options"] = {}, admit?: (user: { userId: string; email: string | null }) => boolean): Promise<TestServer> {
  const t = await startTestServer({ authorizer, options, admit });
  cleanups.push(() => t.close());
  return t;
}

async function connect(t: TestServer, userId: string, ...channels: string[]): Promise<TestSocket> {
  const s = await openSocket(t.url, devToken(userId));
  cleanups.push(() => s.close());
  for (const ch of channels) s.sub(ch);
  await waitFor(() => s.subscribed.length + s.errors.length >= channels.length, 2_000, `${userId} subscribed`);
  return s;
}

let seq = 0;
/** Appends a platform event to `ev:A` the way the outbox relay does. */
async function publish<T extends EventType>(redis: MemoryRedis, type: T, payload: Record<string, unknown> = EVENT_FIXTURES[type] as Record<string, unknown>): Promise<void> {
  const id = fixtureId(`walls-server-${++seq}`);
  const event = { id, businessId: BUSINESS_A, type, occurredAt: new Date().toISOString(), actor: { kind: "system", id: "test" }, entityIds: [], payload, narrated: false };
  await redis.xadd(businessChannel(BUSINESS_A), "*", "id", id, "type", type, "json", JSON.stringify(event));
}

const types = (s: TestSocket) => s.events.map((e) => (e.e as { type: string }).type);
const PAYER = { externalId: "cus_123", email: "ada@example.com", name: "Ada Lovelace" };
const CASH_NOTE = { ...EVENT_FIXTURES["inbox.item_created"], subject: "Cash is £263,345; 14 months of runway" };

describe("section walls on ev:<businessId>", () => {
  it("a member walled from Finance gets no payment amount, payer email or Finance note subject; the owner gets all of it", async () => {
    const t = await boot(createMemoryAuthorizer(world()));
    const owner = await connect(t, USER_A, businessChannel(BUSINESS_A));
    const staff = await connect(t, USER_W, businessChannel(BUSINESS_A));
    await publish(t.redis, "payment.received", { ...EVENT_FIXTURES["payment.received"], customer: PAYER });
    await publish(t.redis, "inbox.item_created", CASH_NOTE);
    await publish(t.redis, "cycle.completed");
    await waitFor(() => owner.events.length === 3 && staff.events.length === 2, 2_000, "events delivered");

    expect(types(owner)).toEqual(["payment.received", "inbox.item_created", "cycle.completed"]);
    expect(JSON.stringify(owner.events)).toContain("ada@example.com");
    expect(JSON.stringify(owner.events)).toContain("263,345");

    expect(types(staff)).toEqual(["inbox.item_created", "cycle.completed"]);
    const sent = JSON.stringify(staff.events);
    for (const secret of ["ada@example.com", "Ada Lovelace", "263,345", "amountMinor"]) expect(sent).not.toContain(secret);
    expect(staff.events.map((e) => (e.e as { redacted?: string[] }).redacted)).toEqual([["finance"], ["finance"]]);
    expect(t.metrics.get("events_walled_total")).toBe(1);
  });

  it("a member walled from the CRM gets the payment without the payer", async () => {
    const w = world();
    w.access[USER_W]![BUSINESS_A] = { role: "member", sectionPermissions: { crm: "none" } };
    const t = await boot(createMemoryAuthorizer(w));
    const staff = await connect(t, USER_W, businessChannel(BUSINESS_A));
    await publish(t.redis, "payment.received", { ...EVENT_FIXTURES["payment.received"], customer: PAYER });
    await waitFor(() => staff.events.length === 1, 2_000, "payment delivered");
    const payment = staff.events[0]!.e as { payload: Record<string, unknown> };
    expect(payment.payload.amount).toEqual(EVENT_FIXTURES["payment.received"].amount);
    expect(payment.payload).not.toHaveProperty("customer");
  });
});

describe("a founder's network messages never ride a business stream (FU-S-2)", () => {
  it("a request or a message that reaches ev:<businessId> is delivered to nobody: not the owner, not staff; the next event is", async () => {
    const t = await boot(createMemoryAuthorizer(world()));
    const owner = await connect(t, USER_A, businessChannel(BUSINESS_A));
    const staff = await connect(t, USER_W, businessChannel(BUSINESS_A));
    await publish(t.redis, "connection.requested");
    await publish(t.redis, "message.received", { ...EVENT_FIXTURES["message.received"], preview: "Here is the term sheet" });
    await publish(t.redis, "cycle.completed");
    await waitFor(() => owner.events.length === 1 && staff.events.length === 1, 2_000, "the cycle event delivered");
    await sleep(100);
    expect(types(owner)).toEqual(["cycle.completed"]);
    expect(types(staff)).toEqual(["cycle.completed"]);
    expect(JSON.stringify([owner.events, staff.events])).not.toContain("term sheet");
  });
});

describe("section walls on as:<sessionId>", () => {
  it("refuses a session whose work belongs to a section the member cannot read, and allows the others", async () => {
    const t = await boot(createMemoryAuthorizer(world()));
    const staff = await connect(t, USER_W, sessionChannel(SESSION_F), sessionChannel(SESSION_A));
    expect(staff.errors).toEqual([expect.objectContaining({ ch: sessionChannel(SESSION_F), code: "forbidden" })]);
    expect(staff.subscribed).toEqual([sessionChannel(SESSION_A)]);
    const owner = await connect(t, USER_A, sessionChannel(SESSION_F));
    expect(owner.subscribed).toEqual([sessionChannel(SESSION_F)]);
  });
});

describe("the invite list", () => {
  it("an account the invite list does not name gets a 403 instead of a socket, whatever its memberships", async () => {
    const list = parseSignupAllowlist("owner@example.com");
    const t = await boot(createMemoryAuthorizer(world()), {}, (user) => admittedBy(list, { ...user, email: user.userId === USER_A ? "owner@example.com" : "staff@example.com" }));
    await expect(openSocket(t.url, devToken(USER_W))).rejects.toThrow(/403/);
    const owner = await connect(t, USER_A, businessChannel(BUSINESS_A));
    expect(owner.subscribed).toEqual([businessChannel(BUSINESS_A)]);
    expect(t.server.connections).toBe(1);
  });
});

describe("open subscriptions follow membership changes", () => {
  it("on membership.changed: new walls apply from that event on, and a removed member is cut off before the next event", async () => {
    const w = world();
    // Cached for a minute: only the membership change's invalidation lets the new access through.
    const t = await boot(createCachedAuthorizer(createMemoryAuthorizer(w), { allowTtlMs: 60_000, denyTtlMs: 60_000 }));
    const staff = await connect(t, USER_W, businessChannel(BUSINESS_A), sessionChannel(SESSION_A));
    expect(staff.subscribed).toHaveLength(2);

    // Development is walled off: the session tile closes, task events stop, the rest goes on.
    w.access[USER_W]![BUSINESS_A] = { role: "member", sectionPermissions: { finance: "none", development: "none" } };
    await publish(t.redis, "membership.changed", { userId: USER_W, change: "updated" });
    await publish(t.redis, "task.started");
    await publish(t.redis, "mode.changed");
    await waitFor(() => types(staff).includes("mode.changed"), 2_000, "mode.changed delivered");
    expect(staff.errors).toEqual([expect.objectContaining({ ch: sessionChannel(SESSION_A), code: "forbidden" })]);
    expect(types(staff)).toEqual(["membership.changed", "mode.changed"]);
    expect(t.server.subscriptions().find((s) => s.userId === USER_W)!.channels).toEqual([businessChannel(BUSINESS_A)]);

    // Removed from the business: nothing written after the change reaches them.
    w.members[USER_W] = [];
    await publish(t.redis, "membership.changed", { userId: USER_W, change: "removed" });
    await publish(t.redis, "cycle.completed");
    await waitFor(() => staff.errors.length === 2, 2_000, "ev: revoked");
    expect(staff.errors[1]).toMatchObject({ ch: businessChannel(BUSINESS_A), code: "forbidden" });
    await sleep(80);
    expect(types(staff)).toEqual(["membership.changed", "mode.changed"]);
    expect(t.server.subscriptions().find((s) => s.userId === USER_W)!.channels).toEqual([]);
    expect(t.metrics.get("subscriptions_revoked_total")).toBe(2);
  });

  it("a subscription whose access check raced a membership change is checked again before anything reaches it", async () => {
    const w = world();
    const inner = createMemoryAuthorizer(w);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    // USER_W's first check reads the membership as it was, then answers late (a slow database).
    const authorizer: Authorizer = {
      async canSubscribe(userId, ch) {
        if (userId !== USER_W || !first) return inner.canSubscribe(userId, ch);
        first = false;
        const stale = await inner.canSubscribe(userId, ch);
        await released;
        return stale;
      },
    };
    const t = await boot(authorizer);
    // The owner keeps a reader on ev:A open, so the stream reads the change while USER_W's check is pending.
    await connect(t, USER_A, businessChannel(BUSINESS_A));
    const staff = await openSocket(t.url, devToken(USER_W));
    cleanups.push(() => staff.close());
    staff.sub(businessChannel(BUSINESS_A));
    await sleep(30);
    w.members[USER_W] = [];
    await publish(t.redis, "membership.changed", { userId: USER_W, change: "removed" });
    await sleep(80);
    release();
    await publish(t.redis, "cycle.completed");
    await waitFor(() => staff.errors.length === 1, 2_000, "revoked after landing");
    expect(staff.errors[0]).toMatchObject({ ch: businessChannel(BUSINESS_A), code: "forbidden" });
    await sleep(60);
    expect(staff.events).toEqual([]);
  });

  it("another person's membership change leaves everyone else's subscriptions alone", async () => {
    const t = await boot(createMemoryAuthorizer(world()));
    const owner = await connect(t, USER_A, businessChannel(BUSINESS_A));
    await publish(t.redis, "membership.changed", { userId: USER_W, change: "removed" });
    await publish(t.redis, "cycle.completed");
    await waitFor(() => owner.events.length === 2, 2_000, "owner keeps receiving");
    expect(owner.errors).toEqual([]);
  });

  it("the periodic re-check closes what a change without an event took away, and keeps access while the database is down", async () => {
    const w = world();
    let down = false;
    const inner = createMemoryAuthorizer(w);
    const authorizer: Authorizer = { canSubscribe: (userId, ch) => (down ? Promise.resolve({ ok: false, code: "unavailable", message: "db down" }) : inner.canSubscribe(userId, ch)) };
    const t = await boot(authorizer, { reauthorizeMs: 40 });
    const staff = await connect(t, USER_W, businessChannel(BUSINESS_A));
    down = true;
    await sleep(150);
    expect(staff.errors).toEqual([]);
    down = false;
    w.members[USER_W] = [];
    await waitFor(() => staff.errors.length === 1, 2_000, "periodic revoke");
    expect(staff.errors[0]).toMatchObject({ ch: businessChannel(BUSINESS_A), code: "forbidden" });
  });
});
