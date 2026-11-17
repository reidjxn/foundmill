/**
 * payLink.* (WP-07 T7): a founder pastes a payment link from their own Stripe account. A member cannot add one; an
 * owner adds and archives; a link off buy.stripe.com is refused in plain words; keys come from the label; a sample
 * business is refused; no agent capability reaches these procedures.
 */
import { CAPABILITY_TOOLS } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pay-link", env: { SITES_DOMAIN: "sites.localhost" } });
}, 180_000);
afterAll(async () => {
  await hz?.close();
});

let n = 0;
async function project(options: { demo?: boolean } = {}) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => hz.h.createUser(`pay-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `Lunchbox ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  return { id: b.id, owner: hz.caller({ userId: ownerId! }), member: hz.caller({ userId: memberId! }) };
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string; message?: string }) => `${err.code}: ${err.message}`);
const URL_1 = "https://buy.stripe.com/test_9AQ7tL0ab";

describe("payLink", () => {
  it("an owner adds a link with a key from its label, and archives it; a member reads but cannot add", async () => {
    const p = await project();
    const list = await p.owner.payLink.add({ businessId: p.id, label: "Starter kit", url: URL_1, priceMinor: 1900, currency: "USD" });
    expect(list).toMatchObject([{ key: "starter-kit", label: "Starter kit", url: URL_1, priceMinor: 1900, currency: "USD", source: "pasted", simulated: false }]);
    expect(await p.member.payLink.list({ businessId: p.id })).toHaveLength(1);
    expect(await code(p.member.payLink.add({ businessId: p.id, label: "Other", url: "https://buy.stripe.com/x2" }))).toMatch(/^FORBIDDEN/);
    // The same label again gets a numbered key, the same URL is refused.
    const two = await p.owner.payLink.add({ businessId: p.id, label: "Starter kit", url: "https://buy.stripe.com/other" });
    expect(two.map((l) => l.key)).toEqual(["starter-kit", "starter-kit-2"]);
    expect(await code(p.owner.payLink.add({ businessId: p.id, label: "Again", url: URL_1 }))).toMatch(/already on the list/);
    expect(await code(p.member.payLink.archive({ businessId: p.id, id: list[0]!.id }))).toMatch(/^FORBIDDEN/);
    expect((await p.owner.payLink.archive({ businessId: p.id, id: list[0]!.id })).map((l) => l.key)).toEqual(["starter-kit-2"]);
    const audits = (await hz.db.execute(sql`select action from audit_log where business_id = ${p.id} and action like 'pay_link.%' order by created_at`)) as unknown as { rows: { action: string }[] };
    expect(audits.rows.map((r) => r.action)).toEqual(["pay_link.added", "pay_link.added", "pay_link.archived"]);
  });

  it("refuses a link that is not a Stripe payment link, in plain words", async () => {
    const p = await project();
    expect(await code(p.owner.payLink.add({ businessId: p.id, label: "Bad", url: "https://evil.example/pay" }))).toMatch(/Only Stripe payment links/);
    expect(await code(p.owner.payLink.add({ businessId: p.id, label: "Bad", url: "http://buy.stripe.com/x" }))).toMatch(/https/);
    expect(await code(p.owner.payLink.add({ businessId: p.id, label: "", url: URL_1 }))).toMatch(/Give the button a name/);
    expect(await code(p.owner.payLink.add({ businessId: p.id, label: "No currency", url: URL_1, priceMinor: 100 }))).toMatch(/currency/);
  });

  it("refuses a sample business", async () => {
    const p = await project({ demo: true });
    expect(await code(p.owner.payLink.add({ businessId: p.id, label: "Kit", url: URL_1 }))).toMatch(/sample business/);
  });

  it("another business's owner reaches none of it", async () => {
    const a = await project();
    const b = await project();
    const [link] = await a.owner.payLink.add({ businessId: a.id, label: "Kit", url: URL_1 });
    expect(await code(b.owner.payLink.list({ businessId: a.id }))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
    expect(await b.owner.payLink.archive({ businessId: b.id, id: link!.id })).toEqual([]);
    expect(await a.owner.payLink.list({ businessId: a.id })).toHaveLength(1);
  });

  it("no agent capability maps to payLink procedures", () => {
    const tools = Object.values(CAPABILITY_TOOLS).flat().map(String);
    expect(tools.filter((t) => /pay_?link\.(add|archive)|payLink/i.test(t))).toEqual([]);
  });
});
