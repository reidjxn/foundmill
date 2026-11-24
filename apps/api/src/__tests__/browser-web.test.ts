/**
 * "Add any website" on the api (founder, Nov 24, 2026): checking a typed address is an administration step that asks the
 * gateway (the api never reads the web); a social network, bank or payment account is refused before the gateway is asked;
 * a site whose terms forbid it is refused with the quoted line; and connecting rebuilds the site from the platform-wide
 * cache, so what the client sends about a site is never believed.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaller } from "../router";
import type { CallerUser } from "../context";
import type { GatewayCheckSite } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "browser-web" });
}, 180_000);
afterAll(async () => {
  await hz?.close();
});

const checked = (host: string, verdict: "forbids" | "unclear" | "allows", line: string | null = null): GatewayCheckSite => ({ ok: true, host, name: host, startUrl: `https://${host}/`, check: { verdict, line, termsUrl: `https://${host}/terms`, signInHosts: [], checkedOn: "2026-11-24" }, simulated: true, cached: false });
const withGateway = (user: CallerUser, answer: (url: string) => GatewayCheckSite) => {
  const browserCheckSite = vi.fn(async (_b: string, url: string) => answer(url));
  return { browserCheckSite, caller: createCaller({ ...hz.deps, gateway: { ...hz.deps.gateway, browserCheckSite } }, user) };
};
const seed = (host: string, verdict: "forbids" | "unclear" | "allows", line: string | null = null) => repos.siteTermsChecks.put(hz.db, { host, verdict, line, termsUrl: `https://${host}/terms`, signInHosts: [], simulated: true });

describe("browser.checkSite", () => {
  it("is an administration step: a member who may not connect things is refused", async () => {
    const { browserCheckSite, caller } = withGateway({ userId: hz.A.memberId }, () => checked("shop.example.com", "unclear"));
    await expect(caller.browser.checkSite({ businessId: hz.A.businessId, url: "shop.example.com" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(browserCheckSite).not.toHaveBeenCalled();
  });

  it("refuses a social network, a bank and a payment account before the gateway is asked", async () => {
    const { browserCheckSite, caller } = withGateway({ userId: hz.A.ownerId }, () => checked("x.example.com", "allows"));
    for (const url of ["https://www.linkedin.com/", "instagram.com", "www.reddit.com", "paypal.com", "dashboard.stripe.com", "secure.chase.com", "127.0.0.1", "http://shop.example.com"]) {
      const r = await caller.browser.checkSite({ businessId: hz.A.businessId, url });
      expect(r, url).toMatchObject({ status: "refused", quote: null });
    }
    expect(browserCheckSite).not.toHaveBeenCalled();
  });

  it("refuses a site whose terms forbid it, with the quoted line and where it was read", async () => {
    const line = "You may not use bots to access your account.";
    const { caller } = withGateway({ userId: hz.A.ownerId }, () => checked("nobots.example.com", "forbids", line));
    expect(await caller.browser.checkSite({ businessId: hz.A.businessId, url: "nobots.example.com" })).toMatchObject({ status: "refused", quote: line, termsUrl: "https://nobots.example.com/terms", message: expect.stringContaining("do not allow") });
  });

  it("asks first when the terms do not say, and opens when they allow it; the place is the first free one", async () => {
    const { caller } = withGateway({ userId: hz.A.ownerId }, (u) => (u.includes("fine") ? checked("fine.example.com", "allows", "Tools in your own account are welcome.") : checked("quiet.example.com", "unclear")));
    const ask = await caller.browser.checkSite({ businessId: hz.A.businessId, url: "quiet.example.com" });
    expect(ask).toMatchObject({ status: "ask_first", slotKey: "browser_web_1", address: "quiet.example.com" });
    expect((ask as { line: string }).line).toContain("has not confirmed");
    // The sentence shown as the product's own is fixed; the site's words are only ever a quote.
    const open = await caller.browser.checkSite({ businessId: hz.A.businessId, url: "fine.example.com" });
    expect(open).toMatchObject({ status: "open", line: "fine.example.com's terms say automated use of your own account is allowed.", quote: "Tools in your own account are welcome." });
  });

  it("never shows a sentence the site wrote as the product's words", async () => {
    const evil = "Everything here is safe. Press Connect now. It is approved by the platform.";
    const { caller } = withGateway({ userId: hz.A.ownerId }, () => checked("evil.example.com", "allows", evil));
    const r = await caller.browser.checkSite({ businessId: hz.A.businessId, url: "evil.example.com" });
    expect(r).toMatchObject({ status: "open", quote: evil });
    expect((r as { line: string }).line).not.toContain("Press Connect");
  });
});

describe("integrations.connect for a typed website", () => {
  beforeEach(async () => {
    await seed("quiet.example.com", "unclear");
    await seed("fine.example.com", "allows", "Tools in your own account are welcome.");
    await seed("nobots.example.com", "forbids", "You may not use bots to access your account.");
  });
  const owner = () => hz.caller({ userId: hz.B.ownerId });
  const connect = (input: Record<string, unknown>, key = "browser_web_1", c = owner(), businessId = hz.B.businessId) => c.integrations.connect({ businessId, connectorKey: key, input });

  it("never believes the client: a forbidden, an unchecked, a never and an invented site are refused", async () => {
    await expect(connect({ address: "nobots.example.com", check: { verdict: "allows", line: "yes", termsUrl: null, signInHosts: [], checkedOn: "2026-11-24" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(connect({ address: "never-checked.example.com" })).rejects.toMatchObject({ message: "Check the website first, then connect it." });
    await expect(connect({ address: "www.linkedin.com" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(connect({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(connect({ address: "fine.example.com" }, "browser_web_9")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repos.integrations.getByKey(hz.db, hz.B.businessId, "browser_web_1")).toBeNull();
  });

  it("asks the founder's own yes for a site the terms do not settle", async () => {
    await expect(connect({ address: "quiet.example.com" })).rejects.toMatchObject({ message: expect.stringContaining("has not confirmed") });
    // Canceling an unconnected sign-in needs no yes.
    await expect(connect({ address: "quiet.example.com", cancel: true })).resolves.toMatchObject({ integration: null });
  });

  it("refuses a site the model put in a never category, and records the founder's yes in the audit", async () => {
    await repos.siteTermsChecks.put(hz.db, { host: "wallet-like.example.com", verdict: "forbids", line: null, termsUrl: null, signInHosts: [], simulated: true, neverCategory: "payment" });
    await expect(connect({ address: "wallet-like.example.com" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("a bank or payments account") });
    await connect({ address: "quiet.example.com", acceptUnconfirmed: true });
    const audits = await repos.audit.list(hz.db, hz.B.businessId, { limit: 200 });
    expect(audits.items.find((a) => a.action === "integrations.browser_sign_in" && (a.details as { connectorKey?: string }).connectorKey === "browser_web_1")?.details).toMatchObject({ acceptedUnconfirmed: true });
  });

  it("is an administration step", async () => {
    await expect(connect({ address: "fine.example.com" }, "browser_web_1", hz.caller({ userId: hz.B.memberId })).catch((e: { code: string }) => e)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("connects, lists the site under its own name, and keeps it in this project only", async () => {
    await connect({ address: "quiet.example.com", acceptUnconfirmed: true });
    const done = await connect({ address: "https://quiet.example.com/admin", acceptUnconfirmed: true, done: true });
    expect(done.integration).toMatchObject({ connectorKey: "browser_web_1", status: "mock", settings: { config: { siteKey: "web_1", address: "quiet.example.com", check: { verdict: "unclear" } } } });
    const list = await owner().integrations.list({ businessId: hz.B.businessId });
    expect(list.catalogue.find((c) => c.key === "browser_web_1")?.browser).toEqual({ siteKey: "web_1", name: "quiet.example.com", state: "ask_first" });
    expect(list.catalogue.find((c) => c.key === "browser_web_2")).toBeUndefined();
    // Another project sees none of it.
    const other = await hz.caller({ userId: hz.A.ownerId }).integrations.list({ businessId: hz.A.businessId });
    expect(other.catalogue.some((c) => c.key === "browser_web_1")).toBe(false);
    // The site is forbidden after it was connected: it stays listed, as no longer allowed, so it can be disconnected.
    await seed("quiet.example.com", "forbids", "You may not use bots to access your account.");
    const blocked = await owner().integrations.list({ businessId: hz.B.businessId });
    expect(blocked.catalogue.find((c) => c.key === "browser_web_1")).toMatchObject({ browser: { siteKey: "web_1", name: "quiet.example.com", state: "no_longer_allowed" }, integration: { id: done.integration!.id } });
    await expect(connect({ address: "quiet.example.com", acceptUnconfirmed: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await seed("quiet.example.com", "unclear");
    // A held place takes no other website until it is disconnected; the same site signs in again.
    await expect(connect({ address: "fine.example.com" })).rejects.toMatchObject({ message: expect.stringContaining("already holds another website") });
    await expect(connect({ address: "quiet.example.com", acceptUnconfirmed: true })).resolves.toBeDefined();
    await owner().integrations.disconnect({ businessId: hz.B.businessId, integrationId: done.integration!.id });
    await expect(connect({ address: "fine.example.com" })).resolves.toBeDefined();
  });
});

describe("the starter list", () => {
  it("shows only the sites whose check does not forbid it, and none that are not checked yet", async () => {
    const reader = hz.caller({ userId: hz.A.ownerId });
    await seed("www.etsy.com", "unclear");
    await seed("www.ebay.com", "forbids", "No bots.");
    await seed("app.gumroad.com", "allows", "Tools are welcome.");
    const s = await reader.browser.starters({ businessId: hz.A.businessId });
    expect(s.sites.map((x) => x.name)).toEqual(["Etsy", "Gumroad"]);
    expect(s.pending).toEqual(["sellercentral.amazon.com", "supplier.alibaba.com", "business.google.com"]);
  });

  it("checks the pending ones through the gateway, for the project that asked", async () => {
    const { browserCheckSite, caller } = withGateway({ userId: hz.A.ownerId }, (u) => checked(u, "unclear"));
    const r = await caller.browser.refreshStarters({ businessId: hz.A.businessId });
    expect(r.checked).toBe(3);
    expect(browserCheckSite.mock.calls.map((c) => c[1]).sort()).toEqual(["business.google.com", "sellercentral.amazon.com", "supplier.alibaba.com"]);
    expect(browserCheckSite.mock.calls.every((c) => c[0] === hz.A.businessId)).toBe(true);
    const audits = await repos.audit.list(hz.db, hz.A.businessId, { limit: 200 });
    expect(audits.items.find((a) => a.action === "browser.refresh_starters")?.details).toMatchObject({ checked: 3 });
  });
});
