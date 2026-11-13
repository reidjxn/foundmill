/**
 * Founder notices and the former founder's cancel (security review P2-3), end to end through the api and the real
 * gateway app in process (its `platform_notify` on the mock):
 *   - a founder's role lowered, then the person removed, then the deletion asked for: every founder now and the person
 *     it happened to are emailed at each step, never the one who did it; the Inbox tells the other founders;
 *   - the founder removed gets the one-click cancel in the deletion's email: `/a/<token>` shows what it does and changes
 *     nothing until the POST, cancels once as them, tells every founder, and gives them nothing else back;
 *   - the card on their home lists the project while the deletion waits and cancels it the same way;
 *   - a founder on their own gets no email from their own steps; an unreachable gateway changes nothing of the change;
 *   - the purge needs no delay: the grace is already the 7 days a former founder has to cancel.
 */
import { createPlatformNotifyMock, createRegistry } from "@foundmill/connectors";
import { BUSINESS_DELETION_DELAY_DAYS, memberships, repos } from "@foundmill/db";
import { FORMER_FOUNDER_CANCEL_WINDOW_MS } from "@foundmill/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayDeps } from "../../../gateway/src/pipeline";
import { inProcessGateway } from "./gateway-double";
import { createApiHarness, type ApiHarness } from "./harness";

describe("founder notices and the former founder's cancel", () => {
  let hz: ApiHarness;
  let gw: GatewayDeps;
  const gateway = inProcessGateway();
  const mail = createPlatformNotifyMock();
  let ana = "";
  let ben = "";
  let cara = "";
  let token = "";
  const sentTo = async (userId: string) => {
    const email = await repos.founders.emailOf(hz.db, userId);
    return mail.sentFor(hz.A.businessId).filter((m) => m.to === email?.toLowerCase());
  };
  const isMember = async (userId: string) => (await hz.db.select().from(memberships).where(and(eq(memberships.businessId, hz.A.businessId), eq(memberships.userId, userId)))).length > 0;

  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "notices", gateway: gateway.client });
    gw = gateway.bind({ db: hz.db, vault: hz.deps.vault, registry: createRegistry([mail]) });
    gw.appEnv = "test";
    gw.platformMail = { domain: "mail.foundmill.test", dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", notifyLocalPart: "hello", appUrl: "http://localhost:3000" };
    ana = hz.A.ownerId;
    [ben, cara] = await Promise.all([hz.h.createUser("ben-notices@example.com"), hz.h.createUser("cara-notices@example.com")]);
    await hz.db.insert(memberships).values([
      { businessId: hz.A.businessId, userId: ben, role: "cofounder" },
      { businessId: hz.A.businessId, userId: cara, role: "cofounder" },
    ]);
    await repos.founders.upsert(hz.db, ana, { displayName: "Ana Ruiz" });
    await repos.founders.upsert(hz.db, ben, { displayName: "Ben Ode" });
    await repos.founders.upsert(hz.db, cara, { displayName: "Cara Lim" });
  }, 120_000);
  afterAll(() => hz.close());

  it("the purge needs no delay: the grace from a request is already the 7 days a former founder has to cancel", () => {
    expect(BUSINESS_DELETION_DELAY_DAYS * 86_400_000).toBeGreaterThanOrEqual(FORMER_FOUNDER_CANCEL_WINDOW_MS);
  });

  it("a founder's role lowered: the person and every other founder are emailed, never the one who did it; the Inbox says so", async () => {
    await hz.caller({ userId: cara }).team.humans.role({ businessId: hz.A.businessId, userId: ben, role: "member" });
    expect((await sentTo(ben)).map((m) => m.subject)).toEqual(["Your role in " + (await repos.businesses.get(hz.db, hz.A.businessId)).name + " changed"]);
    expect((await sentTo(ana)).at(-1)?.subject).toMatch(/^Cara Lim changed Ben Ode's role in /);
    expect(await sentTo(cara)).toHaveLength(0);
    const entry = (await repos.audit.list(hz.db, hz.A.businessId, { action: "team.humans.role", limit: 1 })).items[0]!;
    expect(entry.details).toMatchObject({ userId: ben, fromRole: "cofounder", role: "member" });
    const notes = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 50 })).items.filter((i) => i.subject === "Cara Lim changed Ben Ode's role");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.bodyMd).toMatch(/from a cofounder to a member on [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM) /);
    // A member's role changing is no founder's notice.
    const before = mail.sentFor(hz.A.businessId).length;
    await hz.caller({ userId: cara }).team.humans.role({ businessId: hz.A.businessId, userId: hz.A.memberId, role: "viewer" });
    await hz.caller({ userId: cara }).team.humans.role({ businessId: hz.A.businessId, userId: hz.A.memberId, role: "member" });
    expect(mail.sentFor(hz.A.businessId).length).toBe(before);
  });

  it("then removed: a founder's removal (they were lowered this week); the founders and Ben hear it", async () => {
    await hz.caller({ userId: cara }).team.humans.remove({ businessId: hz.A.businessId, userId: ben });
    expect(await isMember(ben)).toBe(false);
    const entry = (await repos.audit.list(hz.db, hz.A.businessId, { action: "team.humans.remove", limit: 1 })).items[0]!;
    expect(entry.details).toMatchObject({ userId: ben, role: "member", formerRole: "cofounder" });
    const toBen = (await sentTo(ben)).at(-1)!;
    expect(toBen.subject).toMatch(/^You were removed from /);
    expect(toBen.text).toContain("You were a cofounder.");
    expect((await sentTo(ana)).at(-1)?.subject).toMatch(/^Cara Lim removed Ben Ode from /);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 50 })).items.some((i) => i.subject === "Cara Lim removed Ben Ode")).toBe(true);
  });

  it("then the deletion: Ana and Ben hear it, Ben with the one-click cancel; Cara, who asked, does not", async () => {
    const before = (await sentTo(cara)).length;
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    expect((await sentTo(cara)).length).toBe(before);
    const toAna = (await sentTo(ana)).at(-1)!;
    expect(toAna.subject).toMatch(/^Cara Lim asked to delete /);
    expect(toAna.text).toContain("/settings/danger");
    expect(toAna.text).not.toContain("/a/");
    const toBen = (await sentTo(ben)).at(-1)!;
    token = /\/a\/([A-Za-z0-9_-]{43})/.exec(toBen.text)?.[1] ?? "";
    expect(token).toHaveLength(43);
    expect(toBen.text).toContain("It does not give you your place back");
  });

  it("/a/<token>: the page shows what it does and changes nothing; the POST cancels once, as Ben, and gives him nothing else", async () => {
    const anyone = hz.caller(null);
    const seen = await anyone.email.action.get({ token });
    expect(seen).toMatchObject({ kind: "cancel_deletion", state: "ready", businessName: (await repos.businesses.get(hz.db, hz.A.businessId)).name });
    expect(seen.until).toBeTruthy();
    expect((await hz.caller({ userId: ana }).business.deletionStatus({ businessId: hz.A.businessId })).status).toBe("scheduled");
    const done = await anyone.email.action.answer({ token });
    expect(done).toMatchObject({ kind: "cancel_deletion", state: "canceled" });
    expect((await hz.caller({ userId: ana }).business.deletionStatus({ businessId: hz.A.businessId })).status).toBe("cancelled");
    const entry = (await repos.audit.list(hz.db, hz.A.businessId, { action: "business.cancel_deletion", limit: 1 })).items[0]!;
    expect(entry.actorId).toBe(ben);
    expect(entry.details).toMatchObject({ formerFounder: true, via: "email" });
    expect(await isMember(ben)).toBe(false);
    // Every founder hears who canceled; Ben, who did it, gets nothing more.
    for (const who of [ana, cara]) expect((await sentTo(who)).at(-1)?.subject).toMatch(/^Ben Ode canceled the deletion of /);
    expect((await sentTo(ben)).at(-1)?.subject).not.toMatch(/canceled the deletion/);
    const note = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 50 })).items.find((i) => i.subject === "Deletion canceled");
    expect(note?.bodyMd).toContain("Ben Ode, a founder of this project until");
    // Once only; a dead link shows nothing of the project.
    expect(await anyone.email.action.answer({ token })).toMatchObject({ state: "used", businessName: null });
    expect(await anyone.email.action.get({ token: "x".repeat(43) })).toMatchObject({ kind: "answer", state: "unavailable" });
  });

  it("the card on Ben's home: listed while a deletion waits, cancels it the same way, then gone; nobody else may", async () => {
    const ben$ = hz.caller({ userId: ben });
    expect(await ben$.founder.formerProjects.list()).toEqual([]);
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    const [card, ...more] = await ben$.founder.formerProjects.list();
    expect(more).toHaveLength(0);
    expect(card).toMatchObject({ businessId: hz.A.businessId });
    expect(new Date(card!.until).getTime()).toBeLessThanOrEqual(new Date(card!.scheduledFor).getTime());
    // The new request's email carries a new link; the spent one stays dead.
    const fresh = /\/a\/([A-Za-z0-9_-]{43})/.exec((await sentTo(ben)).at(-1)!.text)?.[1];
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(token);
    await expect(hz.caller({ userId: hz.B.ownerId }).founder.formerProjects.cancel({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await ben$.founder.formerProjects.cancel({ businessId: hz.A.businessId })).toMatchObject({ canceled: true });
    expect(await ben$.founder.formerProjects.list()).toEqual([]);
    expect((await hz.caller({ userId: ana }).business.deletionStatus({ businessId: hz.A.businessId })).status).toBe("cancelled");
    // The link minted for that request no longer cancels anything.
    expect(await hz.caller(null).email.action.get({ token: fresh! })).toMatchObject({ kind: "cancel_deletion", state: "canceled", businessName: null });
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "business.cancel_deletion", limit: 1 })).items[0]!.details).toMatchObject({ formerFounder: true, via: "home" });
  });

  it("past the 7 days Ben is told nothing more and may cancel nothing", async () => {
    await hz.db.execute(`update founder_departures set departed_at = now() - interval '8 days', cancel_expires_at = null, cancel_token_hash = null, cancel_request_id = null where user_id = '${ben}'` as never);
    const before = (await sentTo(ben)).length;
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    expect((await sentTo(ben)).length).toBe(before);
    expect(await hz.caller({ userId: ben }).founder.formerProjects.list()).toEqual([]);
    await expect(hz.caller({ userId: ben }).founder.formerProjects.cancel({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await hz.caller({ userId: cara }).business.cancelDeletion({ businessId: hz.A.businessId });
  });

  it("a founder on their own: no email from their own deletion request; an unreachable gateway changes nothing of a change", async () => {
    const asked = gateway.paths.length;
    await hz.caller({ userId: hz.B.ownerId }).business.requestDeletion({ businessId: hz.B.businessId });
    expect(gateway.paths.slice(asked).filter((p) => p === "/v1/notify/email")).toHaveLength(0);
    await hz.caller({ userId: hz.B.ownerId }).business.cancelDeletion({ businessId: hz.B.businessId });
    // The gateway away: the role still changes.
    const dee = await hz.h.createUser("dee-notices@example.com");
    await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: dee, role: "cofounder" });
    const original = hz.deps.gateway.notifyEmail;
    hz.deps.gateway.notifyEmail = async () => {
      throw new Error("gateway down");
    };
    try {
      expect((await hz.caller({ userId: ana }).team.humans.role({ businessId: hz.A.businessId, userId: dee, role: "admin" })).role).toBe("admin");
    } finally {
      hz.deps.gateway.notifyEmail = original;
    }
  });
});
