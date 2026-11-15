/**
 * The same sender to an account about the account itself (`ACCOUNT_EMAIL_KINDS`, notify-account-email.ts; WP-03 T2):
 * `waitlist_admitted`, once per waitlist entry, when the person's place opens.
 *   - the orchestrator only; the user id and the entry's id in: the entry must be that person's, admitted and not yet
 *     emailed; the address from `auth.users`, never from the request;
 *   - once per entry; three a day per address; Foundmill's daily ceiling; an address suppressed platform-wide is never
 *     mailed; the footer's one link stops email to the address;
 *   - mock mode answers simulated, and is refused outside development and test; no address in a log line.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformNotifyMock, suppressionHashOfEmail } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { ACCOUNT_EMAIL_OFF_LINK_LABEL, NOTIFY_PER_PERSON_PER_DAY } from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, type PlatformMailConfig } from "../platform-mail";
import { NOTIFY_EMAIL_ROUTE, PLATFORM_NOTIFY_CEILING_KEY } from "../notify-email";
import { notifyAddressDayKey } from "../notify-address-email";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const NIL = "00000000-0000-0000-0000-000000000000";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", notifyLocalPart: "hello", appUrl: "http://localhost:3000", ...over });

describe("the waitlist's email (gateway)", () => {
  let g: GatewayFixture;
  const mock = createPlatformNotifyMock();
  let n = 0;
  const logged: string[] = [];

  beforeAll(async () => {
    g = await setupGateway({ connectors: [mock] });
    g.deps.appEnv = "test";
    const log = g.deps.log;
    for (const level of ["info", "warn", "error"] as const) {
      const original = log[level].bind(log);
      (log as unknown as Record<string, (...a: unknown[]) => void>)[level] = (...args: unknown[]) => {
        logged.push(JSON.stringify(args));
        (original as (...a: unknown[]) => void)(...args);
      };
    }
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
  });

  async function ask(body: Record<string, unknown>, svc: string | null = "orchestrator") {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
    const res = await fetch(`${g.server.url}${NOTIFY_EMAIL_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { sent?: boolean; simulated?: boolean; reason?: string } };
  }
  /** A person on the waitlist; admitted unless `admitted: false`. */
  async function entry(opts: { admitted?: boolean } = {}) {
    const email = `waiting${++n}@example.com`;
    const userId = await g.h.createUser(email);
    const [row] = await g.h.db.insert(s.waitlistEntries).values({ userId, email, admittedAt: opts.admitted === false ? null : new Date() }).returning();
    return { id: row!.id, userId, email };
  }
  const body = (e: { id: string; userId: string }) => ({ kind: "waitlist_admitted", userId: e.userId, data: { waitlistEntryId: e.id } });
  const sentTo = (email: string) => mock.sentFor(NIL).filter((m) => m.to === email);

  it("is off until platform mail is configured", async () => {
    const e = await entry();
    g.deps.platformMail = config({ domain: null });
    expect((await ask(body(e))).body.reason).toBe("off");
    expect(sentTo(e.email)).toHaveLength(0);
  });

  it("goes once, to the address the account signs in with, saying the place is open, with the way to stop email", async () => {
    const e = await entry();
    expect((await ask(body(e))).body).toMatchObject({ sent: true, simulated: true });
    const [mail, ...more] = sentTo(e.email);
    expect(more).toHaveLength(0);
    expect(mail!.from).toBe(`hello@${DOMAIN}`);
    expect(mail!.subject).toMatch(/^Your place on .+ is open$/);
    expect(mail!.text).toContain("Your place is open. Sign in with this address to pick up where you left off.");
    expect(mail!.text).toContain("http://localhost:3000/start");
    expect(mail!.text).not.toContain("Your card");
    const off = new RegExp(`${ACCOUNT_EMAIL_OFF_LINK_LABEL}: (http://localhost:4005/mail/invitations/off\\?t=\\S+)`).exec(mail!.text)?.[1];
    expect(off).toBeDefined();
    expect((mail!.body as { headers?: Record<string, string> }).headers).toEqual({ "List-Unsubscribe": `<${off}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect((await ask(body(e))).body.reason).toBe("already_sent");
    expect(logged.join("\n")).not.toContain(e.email);
  });

  it("names the card the waitlist keeps", async () => {
    const e = await entry();
    const card = { id: "c", name: "Tutorlane", pitch: "p", archetype: "b2b_saas", stars_current: 3, stars_potential: 4, attributes: [], citations: [], crest_seed: "t" };
    const draft = await repos.ideaDrafts.create(g.db, { tokenHash: "a".repeat(64), claimHash: "b".repeat(64), prompt: "", interest: null, card, modelMode: "mock", costMicro: 0 });
    await g.h.pg.query("update waitlist_entries set idea_draft_id = $1 where id = $2", [draft.id, e.id]);
    expect((await ask(body(e))).body).toMatchObject({ sent: true });
    expect(sentTo(e.email)[0]!.text).toContain("Your card for Tutorlane is saved in your account.");
  });

  it("only for the entry's own person, once it is admitted and not yet emailed; the orchestrator's only", async () => {
    const e = await entry();
    const other = await entry();
    expect((await ask({ ...body(e), userId: other.userId })).body.reason).toBe("not_pending");
    const waiting = await entry({ admitted: false });
    expect((await ask(body(waiting))).body.reason).toBe("not_pending");
    const told = await entry();
    await g.h.pg.query("update waitlist_entries set notified_at = now() where id = $1", [told.id]);
    expect((await ask(body(told))).body.reason).toBe("not_pending");
    expect((await ask({ ...body(e), data: { waitlistEntryId: NIL } })).body.reason).toBe("not_pending");
    expect((await ask(body(e), "api")).status).toBe(403);
    expect((await ask({ kind: "waitlist_admitted", userId: e.userId, data: { waitlistEntryId: e.id, email: "x@y.com" } })).status).toBe(400);
    expect(sentTo(e.email)).toHaveLength(0);
    expect(sentTo(other.email)).toHaveLength(0);
  });

  it("never to an address suppressed platform-wide", async () => {
    const e = await entry();
    await repos.channels.suppressEverywhere(g.db, { emailHash: suppressionHashOfEmail(e.email), reason: "asked for no email", source: "invitation_link" });
    expect((await ask(body(e))).body.reason).toBe("suppressed");
    expect(sentTo(e.email)).toHaveLength(0);
  });

  it("three a day per address, then Foundmill's own ceiling", async () => {
    const e = await entry();
    for (let i = 0; i < NOTIFY_PER_PERSON_PER_DAY; i++) await g.rateLimits.hit(notifyAddressDayKey(DEV_PLATFORM_MAIL_SECRET, e.email), 86_400_000, Date.now());
    expect((await ask(body(e))).body.reason).toBe("per_address");
    expect(sentTo(e.email)).toHaveLength(0);
    // The refusal gave back its marker: the same entry goes once the day's room is there again.
    const f = await entry();
    g.deps.platformMail = config({ notifyCeiling: 1 });
    await g.rateLimits.hit(PLATFORM_NOTIFY_CEILING_KEY, 86_400_000, Date.now());
    expect((await ask(body(f))).body.reason).toBe("ceiling");
  });

  it("is never simulated on staging", async () => {
    const e = await entry();
    g.deps.appEnv = "staging";
    try {
      expect((await ask(body(e))).body.reason).toBe("unconfigured");
      g.deps.platformMail = config({ signingSecret: "s".repeat(64), appUrl: "https://foundmill.test", unsubscribeBase: "https://in.foundmill.test" });
      expect((await ask(body(e))).body.reason).toBe("simulated");
    } finally {
      g.deps.appEnv = "test";
    }
    expect(sentTo(e.email)).toHaveLength(0);
  });
});
