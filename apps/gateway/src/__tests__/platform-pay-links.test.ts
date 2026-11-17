/**
 * `list_pay_links` (WP-07 T7): an agent sees its own project's payment links by key, name and price, never the URL,
 * never a simulated or an archived link, never another business's.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import type { PlatformCaller } from "@foundmill/connectors";
import { createDbPlatformHost } from "../platform-host";
import { silentLog } from "./harness";

let h: TestHarness;
let db: Db;
let a: PlatformCaller;
let b: PlatformCaller;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  const callerFor = async (name: string): Promise<PlatformCaller> => {
    const biz = await repos.businesses.create(db, { name });
    const agent = await repos.agents.create(db, biz.id, { name: "Lin", agentType: "frontend_engineer", modelKey: "sonnet" });
    const session = await repos.agents.createSession(db, biz.id, { agentId: agent.id, modelKey: "sonnet" });
    return { businessId: biz.id, agentId: agent.id, sessionId: session.id };
  };
  a = await callerFor("Lunchbox");
  b = await callerFor("Elsewhere");
  await repos.payLinks.add(db, a.businessId, { key: "starter-kit", label: "Starter kit", priceMinor: 1900, currency: "USD", url: "https://buy.stripe.com/test_a" });
  await repos.payLinks.add(db, a.businessId, { key: "sim", label: "Simulated", url: "https://buy.stripe.com/test_sim", source: "stripe", simulated: true });
  const old = await repos.payLinks.add(db, a.businessId, { key: "old", label: "Old", url: "https://buy.stripe.com/test_old" });
  await repos.payLinks.archive(db, a.businessId, old.id);
  await repos.payLinks.add(db, b.businessId, { key: "other", label: "Other", url: "https://buy.stripe.com/test_b" });
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe("list_pay_links", () => {
  it("lists the project's own live links without their URLs", async () => {
    const host = createDbPlatformHost({ db, log: silentLog });
    expect(await host.listPayLinks(a)).toEqual({ items: [{ key: "starter-kit", label: "Starter kit", priceMinor: 1900, currency: "USD" }] });
    expect(JSON.stringify(await host.listPayLinks(a))).not.toContain("buy.stripe.com");
    expect((await host.listPayLinks(b)).items.map((l) => l.key)).toEqual(["other"]);
  });
});
