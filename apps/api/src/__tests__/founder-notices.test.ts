/**
 * Founder notices and the former founder's cancel (security review P2-3), end to end through the api and the real
 * gateway app in process (its `platform_notify` on the mock):
 *   - a founder's role lowered, then the person removed, then the deletion asked for: every founder now and the person
 *     it happened to are emailed at each step, never the one who did it; the Inbox tells the other founders;
 *   - the founder removed gets the one-click cancel in the deletion's email: `/a/<token>` shows what it does and changes
 *     nothing until the POST, cancels once as them, tells every founder, and gives them nothing else back;
 *   - the card on their home lists the project while the deletion waits and cancels it the same way;
 *   - the person who asked for a deletion gets a receipt, whatever the team's size; nobody else hears about their own step;
 *   - counted from the request: a founder taken out 20 days before it is told and may cancel, one taken out 31 days
 *     before is not; the cancel lasts until the request's own day (so the purge needs no delay);
 *   - lowering a founder's role and asking for a deletion are limited per person and project a day; a cancel never is;
 *   - an admin's removal of a just-lowered founder is announced; a second email's link never replaces the first;
 *   - an unreachable gateway changes nothing of the change;
 *   - a removal is announced once per demotion; a founder change whose transaction fails is given back; the notices of one
 *     change are asked for `NOTICE_CONCURRENCY` at a time.
 */
import { createPlatformNotifyMock, createRegistry } from "@foundmill/connectors";
import { memberships, repos } from "@foundmill/db";
import { FOUNDER_NOTICE_LIMITS } from "@foundmill/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayDeps } from "../../../gateway/src/pipeline";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { tellFounders, NOTICE_CONCURRENCY } from "../services/founder-notices";
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

  it("then the deletion: Ana and Ben hear it, Ben with the one-click cancel; Cara, who asked, gets the receipt", async () => {
    const before = (await sentTo(cara)).length;
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    const receipts = (await sentTo(cara)).slice(before);
    expect(receipts.map((m) => m.subject)).toEqual([`You asked to delete ${(await repos.businesses.get(hz.db, hz.A.businessId)).name}`]);
    expect(receipts[0]!.text).toContain("If this wasn't you, cancel in Settings › Danger zone and secure your account.");
    expect(receipts[0]!.text).not.toContain("/a/");
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
    // The link works until the request's own day, the day the sweep would purge on.
    expect(seen.until).toBe(seen.scheduledFor);
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

  it("the card on Ben's home: listed while a deletion waits, cancels that request, then gone; nobody else may", async () => {
    const ben$ = hz.caller({ userId: ben });
    expect(await ben$.founder.formerProjects.list()).toEqual([]);
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    const [card, ...more] = await ben$.founder.formerProjects.list();
    expect(more).toHaveLength(0);
    expect(card).toMatchObject({ businessId: hz.A.businessId });
    expect(card!.until).toBe(card!.scheduledFor);
    // The new request's email carries a new link; the spent one stays dead.
    const fresh = /\/a\/([A-Za-z0-9_-]{43})/.exec((await sentTo(ben)).at(-1)!.text)?.[1];
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(token);
    await expect(hz.caller({ userId: hz.B.ownerId }).founder.formerProjects.cancel({ businessId: hz.A.businessId, requestId: card!.requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A request id that is not the one waiting cancels nothing.
    await expect(ben$.founder.formerProjects.cancel({ businessId: hz.A.businessId, requestId: hz.A.inboxItemId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await ben$.founder.formerProjects.cancel({ businessId: hz.A.businessId, requestId: card!.requestId })).toMatchObject({ canceled: true });
    expect(await ben$.founder.formerProjects.list()).toEqual([]);
    expect((await hz.caller({ userId: ana }).business.deletionStatus({ businessId: hz.A.businessId })).status).toBe("cancelled");
    // The link minted for that request no longer cancels anything.
    expect(await hz.caller(null).email.action.get({ token: fresh! })).toMatchObject({ kind: "cancel_deletion", state: "canceled", businessName: null });
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "business.cancel_deletion", limit: 1 })).items[0]!.details).toMatchObject({ formerFounder: true, via: "home" });
  });

  it("counted from the request: waiting does not wear the right away; 31 days before a request, told but no cancel", async () => {
    // A new day for the project's own caps (3 deletion requests a day): the tests above asked for two already.
    hz.limits.reset();
    // Ben left 20 days ago: a request now still tells him and he may cancel it.
    await hz.db.execute(`update founder_departures set departed_at = now() - interval '20 days' where user_id = '${ben}'` as never);
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    const [card] = await hz.caller({ userId: ben }).founder.formerProjects.list();
    expect(card).toMatchObject({ businessId: hz.A.businessId });
    expect((await sentTo(ben)).at(-1)!.text).toMatch(/\/a\/[A-Za-z0-9_-]{43}/);
    await hz.caller({ userId: cara }).business.cancelDeletion({ businessId: hz.A.businessId });
    // 31 days before the request: still told (third review), but with no link, no card and no cancel.
    await hz.db.execute(`update founder_departures set departed_at = now() - interval '31 days' where user_id = '${ben}'` as never);
    const before = (await sentTo(ben)).length;
    await hz.caller({ userId: cara }).business.requestDeletion({ businessId: hz.A.businessId });
    expect((await sentTo(ben)).length).toBe(before + 1);
    expect((await sentTo(ben)).at(-1)!.text).toContain("If you want it kept, ask one of the founders to cancel it.");
    expect((await sentTo(ben)).at(-1)!.text).not.toMatch(/\/a\/[A-Za-z0-9_-]{43}/);
    expect(await hz.caller({ userId: ben }).founder.formerProjects.list()).toEqual([]);
    const waiting = (await repos.audit.list(hz.db, hz.A.businessId, { action: "business.request_deletion", limit: 1 })).items[0]!;
    await expect(hz.caller({ userId: ben }).founder.formerProjects.cancel({ businessId: hz.A.businessId, requestId: waiting.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A founder taken out after the request, whenever, may cancel it: their email carries the link, and an earlier
    // email's link is never replaced by a later one.
    const ivy = await hz.h.createUser("ivy-notices@example.com");
    await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: ivy, role: "cofounder" });
    await hz.caller({ userId: cara }).team.humans.role({ businessId: hz.A.businessId, userId: ivy, role: "member" });
    const first = /\/a\/([A-Za-z0-9_-]{43})/.exec((await sentTo(ivy)).at(-1)!.text)?.[1];
    await hz.caller({ userId: ana }).team.humans.remove({ businessId: hz.A.businessId, userId: ivy });
    const second = /\/a\/([A-Za-z0-9_-]{43})/.exec((await sentTo(ivy)).at(-1)!.text)?.[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(await hz.caller(null).email.action.get({ token: first! })).toMatchObject({ state: "ready" });
    expect(await hz.caller(null).email.action.get({ token: second! })).toMatchObject({ state: "ready" });
    await hz.caller({ userId: cara }).business.cancelDeletion({ businessId: hz.A.businessId });
  });

  it("an admin removes a founder someone else just lowered: still announced (read on the service connection)", async () => {
    const jo = await hz.h.createUser("jo-notices@example.com");
    await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: jo, role: "cofounder" });
    await hz.caller({ userId: ana }).team.humans.role({ businessId: hz.A.businessId, userId: jo, role: "member" });
    await hz.caller({ userId: hz.A.adminId }).team.humans.remove({ businessId: hz.A.businessId, userId: jo });
    const entry = (await repos.audit.list(hz.db, hz.A.businessId, { action: "team.humans.remove", limit: 1 })).items[0]!;
    expect(entry.details).toMatchObject({ userId: jo, formerRole: "cofounder" });
    expect((await sentTo(jo)).at(-1)?.subject).toMatch(/^You were removed from /);
  });

  it("one person may lower a founder's role, or ask for a deletion, so many times a day in a project; a cancel is never refused", async () => {
    hz.limits.reset();
    const hal = await hz.h.createUser("hal-notices@example.com");
    await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: hal, role: "cofounder" });
    const hal$ = hz.caller({ userId: hal });
    for (let i = 0; i <= FOUNDER_NOTICE_LIMITS.actorPerDay; i++) {
      const other = await hz.h.createUser(`limit-${i}-notices@example.com`);
      await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: other, role: "cofounder" });
      const lower = hal$.team.humans.role({ businessId: hz.A.businessId, userId: other, role: "member" });
      if (i < FOUNDER_NOTICE_LIMITS.actorPerDay) await lower;
      else await expect(lower).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^A founder's role can be lowered 5 times a day by one person in a project, and that is used up for now\. Try again in /) });
    }
    // Asking for a deletion: the project's own cap (3 a day, whoever asks) comes before Hal's 5.
    for (let i = 0; i <= FOUNDER_NOTICE_LIMITS.projectRequestsPerDay; i++) {
      const ask = hal$.business.requestDeletion({ businessId: hz.A.businessId });
      if (i < FOUNDER_NOTICE_LIMITS.projectRequestsPerDay) {
        await ask;
        await hal$.business.cancelDeletion({ businessId: hz.A.businessId });
      } else await expect(ask).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^This project has had as many deletion requests today as a day allows\. Try again in /) });
    }
    expect((await hal$.business.deletionStatus({ businessId: hz.A.businessId })).status).toBe("cancelled");
    // Two more in another project of Hal's make his 10 founder changes of the day.
    const E = await createBusinessFixture(hz.h, "notices-e");
    await hz.db.insert(memberships).values({ businessId: E.businessId, userId: hal, role: "cofounder" });
    for (let i = 0; i < 2; i++) {
      await hal$.business.requestDeletion({ businessId: E.businessId });
      await hal$.business.cancelDeletion({ businessId: E.businessId });
    }
    // Hal has used his 10 a day across every project: in another project, where he has his own 5, he is refused too.
    const C = await createBusinessFixture(hz.h, "notices-c");
    const kim = await hz.h.createUser("kim-notices@example.com");
    await hz.db.insert(memberships).values([
      { businessId: C.businessId, userId: hal, role: "cofounder" },
      { businessId: C.businessId, userId: kim, role: "cofounder" },
    ]);
    await expect(hal$.team.humans.role({ businessId: C.businessId, userId: kim, role: "member" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^One person can lower founders' roles and ask for deletions 10 times a day across every project/) });
    expect((await repos.memberships.get(hz.db, C.businessId, kim))!.role).toBe("cofounder");
    // Someone else in that project is not held back by Hal's day.
    expect((await hz.caller({ userId: kim }).team.humans.role({ businessId: C.businessId, userId: hal, role: "member" })).role).toBe("member");
  });

  it("a founder on their own gets the receipt of their own deletion request and nothing else; an unreachable gateway changes nothing", async () => {
    const asked = gateway.paths.length;
    await hz.caller({ userId: hz.B.ownerId }).business.requestDeletion({ businessId: hz.B.businessId });
    expect(gateway.paths.slice(asked).filter((p) => p === "/v1/notify/email")).toHaveLength(1);
    const email = await repos.founders.emailOf(hz.db, hz.B.ownerId);
    const toOwner = mail.sentFor(hz.B.businessId).filter((m) => m.to === email?.toLowerCase());
    expect(toOwner.map((m) => m.subject)).toEqual([`You asked to delete ${(await repos.businesses.get(hz.db, hz.B.businessId)).name}`]);
    expect(toOwner[0]!.text).not.toMatch(/\b(?:alone|on your own|cofounder|team of)\b/i);
    const cancelAsked = gateway.paths.length;
    await hz.caller({ userId: hz.B.ownerId }).business.cancelDeletion({ businessId: hz.B.businessId });
    expect(gateway.paths.slice(cancelAsked).filter((p) => p === "/v1/notify/email")).toHaveLength(0);
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

  it("a removal is a founder's removal once per demotion: re-invited and removed again, no second announcement", async () => {
    // Jo was lowered and then removed by an admin above, and that removal was announced.
    const joId = (await hz.h.pg.query<{ id: string }>("select id from auth.users where email = $1", ["jo-notices@example.com"])).rows[0]!.id;
    const before = (await sentTo(joId)).length;
    await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: joId, role: "member" });
    await hz.caller({ userId: ana }).team.humans.remove({ businessId: hz.A.businessId, userId: joId });
    const entry = (await repos.audit.list(hz.db, hz.A.businessId, { action: "team.humans.remove", limit: 1 })).items[0]!;
    expect(entry.details).toMatchObject({ userId: joId, role: "member" });
    expect(entry.details).not.toHaveProperty("formerRole");
    expect((await sentTo(joId)).length).toBe(before);
  });

  it("a founder change whose transaction fails is given back: the person still has their whole day", async () => {
    const lia = await hz.h.createUser("lia-notices@example.com");
    const C = await createBusinessFixture(hz.h, "notices-refund");
    const others = await Promise.all(Array.from({ length: FOUNDER_NOTICE_LIMITS.actorPerDay + 1 }, (_, i) => hz.h.createUser(`refund-${i}-notices@example.com`)));
    await hz.db.insert(memberships).values([{ businessId: C.businessId, userId: lia, role: "cofounder" }, ...others.map((userId) => ({ businessId: C.businessId, userId, role: "cofounder" as const }))]);
    const lia$ = hz.caller({ userId: lia });
    // Lowered to a collaborator with an end already past: refused after the change was counted, inside the transaction.
    await expect(lia$.team.humans.role({ businessId: C.businessId, userId: others[0]!, role: "collaborator", expiresAt: new Date(Date.now() - 86_400_000) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.memberships.get(hz.db, C.businessId, others[0]!))!.role).toBe("cofounder");
    for (let i = 0; i < FOUNDER_NOTICE_LIMITS.actorPerDay; i++) expect((await lia$.team.humans.role({ businessId: C.businessId, userId: others[i]!, role: "member" })).role).toBe("member");
  });

  it("the notices of one change are asked for a few at a time", async () => {
    const request = await repos.audit.append(hz.db, hz.A.businessId, { actorKind: "user", actorId: ana, action: "business.request_deletion", target: { kind: "business", id: hz.A.businessId }, details: { scheduledFor: new Date(Date.now() + 7 * 86_400_000).toISOString() } });
    let inFlight = 0;
    let most = 0;
    const result = await tellFounders(
      {
        db: hz.db,
        log: hz.deps.log,
        gateway: {
          notifyEmail: async () => {
            inFlight++;
            most = Math.max(most, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return { sent: false, reason: "off", message: "" } as never;
          },
        },
      },
      { businessId: hz.A.businessId, auditId: request.id, notice: "deletion_requested", actorUserId: ana },
    );
    expect(result.asked.length).toBeGreaterThan(NOTICE_CONCURRENCY);
    expect(most).toBe(NOTICE_CONCURRENCY);
    await repos.audit.append(hz.db, hz.A.businessId, { actorKind: "user", actorId: ana, action: "business.cancel_deletion", target: { kind: "business", id: hz.A.businessId }, details: {} });
  });

  it("a deletion asks for every former founder for it, however many were taken out after them; what is recorded is what the gateway says went", async () => {
    const C = await createBusinessFixture(hz.h, "notices-many");
    const victim = await hz.h.createUser("victim-notices@example.com");
    await hz.db.insert(memberships).values({ businessId: C.businessId, userId: victim, role: "cofounder" });
    await hz.db.delete(memberships).where(and(eq(memberships.businessId, C.businessId), eq(memberships.userId, victim)));
    const later = await Promise.all(Array.from({ length: FOUNDER_NOTICE_LIMITS.formerPerRequest + 1 }, (_, i) => hz.h.createUser(`later-${i}-notices@example.com`)));
    await hz.db.insert(memberships).values(later.map((userId) => ({ businessId: C.businessId, userId, role: "cofounder" as const })));
    for (const userId of later) await hz.db.delete(memberships).where(and(eq(memberships.businessId, C.businessId), eq(memberships.userId, userId)));
    const request = await repos.audit.append(hz.db, C.businessId, { actorKind: "user", actorId: C.ownerId, action: "business.request_deletion", target: { kind: "business", id: C.businessId }, details: { scheduledFor: new Date(Date.now() + 7 * 86_400_000).toISOString() } });
    const tokens = new Map<string, string | undefined>();
    const result = await tellFounders(
      {
        db: hz.db,
        log: hz.deps.log,
        gateway: {
          notifyEmail: async (input) => {
            tokens.set(input.userId, (input.data as { cancelToken?: string }).cancelToken);
            // The gateway folded the victim's notice into an email without the link.
            return { sent: true, simulated: true, eventId: null, offersCancel: input.userId !== victim };
          },
        },
      },
      { businessId: C.businessId, auditId: request.id, notice: "deletion_requested", actorUserId: C.ownerId },
    );
    expect(tokens.get(victim)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const userId of later) expect(tokens.has(userId)).toBe(true);
    expect(result.asked.find((a) => a.userId === victim)).toMatchObject({ sent: true, offersCancel: false });
    expect(result.asked.find((a) => a.userId === later[0])).toMatchObject({ sent: true, offersCancel: true });
  });

  it("many accounts in one project: the project's own caps hold, whoever asks (and a failed change gives its place back)", async () => {
    const F = await createBusinessFixture(hz.h, "notices-crowd");
    const n = FOUNDER_NOTICE_LIMITS.projectLowersPerDay + 1;
    const actors = await Promise.all(Array.from({ length: n }, (_, i) => hz.h.createUser(`crowd-actor-${i}-notices@example.com`)));
    const targets = await Promise.all(Array.from({ length: n + 1 }, (_, i) => hz.h.createUser(`crowd-target-${i}-notices@example.com`)));
    await hz.db.insert(memberships).values([...actors, ...targets].map((userId) => ({ businessId: F.businessId, userId, role: "cofounder" as const })));
    // A change refused inside its transaction costs the project nothing.
    await expect(hz.caller({ userId: actors[0]! }).team.humans.role({ businessId: F.businessId, userId: targets[n]!, role: "collaborator", expiresAt: new Date(Date.now() - 86_400_000) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Every account lowers one founder: 10 a day in the project, then refused, whoever it is.
    for (let i = 0; i < n; i++) {
      const lower = hz.caller({ userId: actors[i]! }).team.humans.role({ businessId: F.businessId, userId: targets[i]!, role: "member" });
      if (i < FOUNDER_NOTICE_LIMITS.projectLowersPerDay) expect((await lower).role, `account ${i + 1}`).toBe("member");
      else await expect(lower).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^This project has had as many founders' roles lowered today as a day allows\. Try again in /) });
    }
    expect((await repos.memberships.get(hz.db, F.businessId, targets[n - 1]!))!.role).toBe("cofounder");
    // Every account asks for the deletion (each one canceled): 3 a day in the project, then refused.
    for (let i = 0; i <= FOUNDER_NOTICE_LIMITS.projectRequestsPerDay; i++) {
      const caller = hz.caller({ userId: actors[i]! });
      const ask = caller.business.requestDeletion({ businessId: F.businessId });
      if (i < FOUNDER_NOTICE_LIMITS.projectRequestsPerDay) {
        await ask;
        await caller.business.cancelDeletion({ businessId: F.businessId });
      } else await expect(ask).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^This project has had as many deletion requests today as a day allows\. Try again in /) });
    }
    expect((await hz.caller({ userId: actors[0]! }).business.deletionStatus({ businessId: F.businessId })).status).toBe("cancelled");
  }, 120_000);
});
