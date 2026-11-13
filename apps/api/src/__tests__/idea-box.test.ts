/**
 * The landing page's idea box (docs/IDEA_BOX.md) through the api's HTTP app and its tRPC caller: a signed-out visitor's
 * card streamed and kept by a cookie, the checks before any model call (origin, shape, honeypot, one card per browser,
 * Turnstile, per-address windows, the day's ceiling), the card back with a fresh claim token, the claim into the deck
 * (same browser or another device, once), and the waitlist for someone not on the invite list.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import * as s from "@foundmill/db";
import { IDEA_COOKIE, type IdeaBoxEvent } from "@foundmill/shared";
import { createApp } from "../app";
import type { GatewayTurnstileResult } from "../services/gateway";
import { IDEA_BOX_LIMITS, ideaTokenHash } from "../services/idea-box";
import { createApiHarness, type ApiHarness } from "./harness";

const ORIGIN = "http://localhost:3000";
let hz: ApiHarness | null = null;
afterEach(async () => {
  await hz?.close();
  hz = null;
});

async function setup(env: Partial<NodeJS.ProcessEnv> = {}, turnstile?: () => Promise<GatewayTurnstileResult>) {
  hz = await createApiHarness({ prefix: `ib${Math.random().toString(36).slice(2, 7)}`, env });
  if (turnstile) hz.deps.gateway = { ...hz.deps.gateway, verifyTurnstile: turnstile };
  return { hz, app: createApp(hz.deps) };
}

type App = ReturnType<typeof createApp>;
async function draft(app: App, body: unknown, opts: { cookie?: string; address?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.address ?? "198.51.100.7" };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = `${IDEA_COOKIE}=${opts.cookie}`;
  const res = await app.request("/idea-box/draft", { method: "POST", headers, body: JSON.stringify(body) });
  const text = res.status === 200 ? await res.text() : "";
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as IdeaBoxEvent);
  const setCookie = res.headers.get("set-cookie");
  const token = setCookie?.match(new RegExp(`${IDEA_COOKIE}=([A-Za-z0-9_-]+)`))?.[1] ?? null;
  return { res, events, setCookie, token };
}
const idea = { prompt: "An AI teaching assistant for independent tutors", turnstile: "ok" };
const last = (events: IdeaBoxEvent[]) => events.at(-1)!;

describe("POST /idea-box/draft", () => {
  it("streams the card (started, the name and pitch, ten ratings, the card), sets an httpOnly cookie and stores only hashes", async () => {
    const { hz, app } = await setup();
    const { res, events, setCookie, token } = await draft(app, idea);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=604800/);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(events[0]).toEqual({ type: "started" });
    expect(events.filter((e) => e.type === "rating")).toHaveLength(10);
    // The first words come first: a partial card with the name and the pitch before any rating.
    const firstPartial = events.findIndex((e) => e.type === "partial" && !!e.card.name && !!e.card.pitch);
    expect(firstPartial).toBeGreaterThan(0);
    expect(firstPartial).toBeLessThan(events.findIndex((e) => e.type === "rating"));
    const card = last(events);
    expect(card.type).toBe("card");
    if (card.type !== "card") return;
    expect(card.card.name.length).toBeGreaterThan(0);
    expect(card.card.attributes).toHaveLength(10);
    expect([card.again, card.sample, card.prompt]).toEqual([false, true, idea.prompt]);
    expect(card.claim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await hz.db.select().from(s.ideaDrafts).where(eq(s.ideaDrafts.tokenHash, ideaTokenHash(token!)));
    expect(row!.claimHash).toBe(ideaTokenHash(card.claim!));
    expect(JSON.stringify(row)).not.toContain(token!);
  });

  it("one card per browser: the same cookie gets its card back with no new draft and no new cookie", async () => {
    const { hz, app } = await setup();
    const first = await draft(app, idea);
    const again = await draft(app, { ...idea, prompt: "Something else entirely" }, { cookie: first.token! });
    expect(again.setCookie).toBeNull();
    expect(again.events).toHaveLength(1);
    expect(again.events[0]).toMatchObject({ type: "card", again: true, prompt: idea.prompt });
    expect((await hz.db.select().from(s.ideaDrafts)).length).toBe(1);
  });

  it("refuses with one fixed line and no cookie: another origin, a bad shape, the honeypot, a failed bot check", async () => {
    const { app } = await setup({}, async () => ({ ok: false, reason: "invalid", simulated: false }));
    expect((await draft(app, idea, { origin: "https://evil.example" })).res.status).toBe(403);
    expect((await draft(app, idea, { origin: null })).res.status).toBe(403);
    for (const body of [{ prompt: "hi", turnstile: "ok" }, { prompt: "x".repeat(501), turnstile: "ok" }, { prompt: "ok idea here" }, { ...idea, interest: "Not on the list" }]) {
      const r = await draft(app, body);
      expect(r.events, JSON.stringify(body)).toEqual([{ type: "error", code: "invalid", message: expect.any(String) }]);
      expect(r.setCookie).toBeNull();
    }
    expect((await draft(app, { ...idea, website: "http://spam.example" })).events[0]).toMatchObject({ type: "error", code: "bot" });
    expect((await draft(app, idea)).events[0]).toMatchObject({ type: "error", code: "bot" });
  });

  it("on a test stack without a gateway, the mock token passes and any other fails as not open", async () => {
    const { app } = await setup({}, async () => {
      throw new Error("gateway unreachable");
    });
    expect(last((await draft(app, { ...idea, turnstile: "mock-ok" })).events).type).toBe("card");
    expect((await draft(app, idea, { address: "198.51.100.99" })).events[0]).toMatchObject({ type: "error", code: "unavailable" });
  });

  it("Turnstile unconfigured or down reads as not open right now", async () => {
    const { app } = await setup({}, async () => ({ ok: false, reason: "unconfigured", simulated: false }));
    expect((await draft(app, idea)).events[0]).toMatchObject({ type: "error", code: "unavailable" });
  });

  it("an interest drafts a card with no line typed", async () => {
    const { app } = await setup();
    const r = await draft(app, { interest: "Pets", turnstile: "ok" });
    expect(last(r.events)).toMatchObject({ type: "card", interest: "Pets", prompt: "" });
  });

  it("per address: three an hour, then the limit line", async () => {
    const { app } = await setup();
    for (let i = 0; i < IDEA_BOX_LIMITS.perAddressHour.limit; i++) expect(last((await draft(app, idea, { address: "203.0.113.5" })).events).type).toBe("card");
    expect((await draft(app, idea, { address: "203.0.113.5" })).events[0]).toMatchObject({ type: "error", code: "limit" });
    expect(last((await draft(app, idea, { address: "203.0.113.6" })).events).type).toBe("card");
  });

  it("the day's ceiling across every visitor: resting once spent", async () => {
    const { app } = await setup({ IDEA_BOX_DAILY_CEILING_CENTS: "0" });
    expect((await draft(app, idea)).events[0]).toMatchObject({ type: "error", code: "resting" });
  });
});

describe("GET /idea-box/mine", () => {
  it("answers the browser's card with a fresh claim token, and 204 without one", async () => {
    const { hz, app } = await setup();
    const first = await draft(app, idea);
    const firstClaim = (last(first.events) as { claim: string }).claim;
    const mine = await app.request("/idea-box/mine", { headers: { origin: ORIGIN, cookie: `${IDEA_COOKIE}=${first.token}` } });
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as IdeaBoxEvent;
    expect(body).toMatchObject({ type: "card", again: true });
    const claim = (body as { claim: string }).claim;
    expect(claim).not.toBe(firstClaim);
    const [row] = await hz.db.select().from(s.ideaDrafts);
    expect(row!.claimHash).toBe(ideaTokenHash(claim));
    expect((await app.request("/idea-box/mine", { headers: { origin: ORIGIN } })).status).toBe(204);
    expect((await app.request("/idea-box/mine", { headers: { origin: ORIGIN, cookie: `${IDEA_COOKIE}=nonsense` } })).status).toBe(204);
  });
});

describe("ideaBox.claim and the waitlist", () => {
  it("claims into the deck by the cookie's token; again gives the same idea; nobody else gets it", async () => {
    const { hz, app } = await setup();
    const first = await draft(app, idea);
    const owner = hz.caller({ userId: hz.A.ownerId, email: "owner@test.local" });
    const claimed = await owner.ideaBox.claim({ token: first.token });
    expect(claimed).toMatchObject({ again: false });
    const [row] = await hz.db.select().from(s.ideas).where(eq(s.ideas.id, claimed!.ideaId));
    expect(row!.ownerUserId).toBe(hz.A.ownerId);
    expect(await owner.ideaBox.claim({ token: first.token })).toEqual({ ideaId: claimed!.ideaId, again: true });
    expect(await hz.caller({ userId: hz.B.ownerId, email: "b@test.local" }).ideaBox.claim({ token: first.token })).toBeNull();
  });

  it("claims on another device with the sign-in link's claim token, once", async () => {
    const { hz, app } = await setup();
    const first = await draft(app, idea);
    const claim = (last(first.events) as { claim: string }).claim;
    // Signed in long ago: a link cannot drop a card into the deck.
    expect(await hz.caller({ userId: hz.B.ownerId, email: "b@test.local", authenticatedAt: new Date(Date.now() - 2 * 60 * 60_000) }).ideaBox.claim({ claim })).toBeNull();
    const other = hz.caller({ userId: hz.B.ownerId, email: "b@test.local" });
    expect(await other.ideaBox.claim({ claim })).toMatchObject({ again: false });
    expect(await hz.caller({ userId: hz.A.ownerId, email: "a@test.local" }).ideaBox.claim({ claim })).toBeNull();
  });

  it("someone not on the invite list joins the waitlist and keeps the card; the claim itself waits for the list", async () => {
    const { hz, app } = await setup({ SIGNUP_ALLOWLIST: "someone-else@test.local" });
    const first = await draft(app, idea);
    const outsider = hz.caller({ userId: hz.B.ownerId, email: "outsider@test.local", emailConfirmed: true });
    await expect(outsider.ideaBox.claim({ token: first.token })).rejects.toThrow();
    expect(await outsider.waitlist.join({ token: first.token })).toEqual({ joined: true, cardKept: true });
    expect(await outsider.waitlist.status()).toEqual({ joined: true, cardKept: true });
    const [draftRow] = await hz.db.select().from(s.ideaDrafts);
    expect(draftRow!.heldUntil!.getTime() - Date.now()).toBeGreaterThan(80 * 24 * 60 * 60_000);
    await expect(hz.caller({ userId: hz.B.ownerId, email: "outsider@test.local", emailConfirmed: false }).waitlist.join({})).rejects.toThrow(/Confirm/);
  });
});
