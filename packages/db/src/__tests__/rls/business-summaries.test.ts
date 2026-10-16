/**
 * `businesses.listSummariesForUser` (the top bar's Switch business, the palette, Your businesses) runs as the user: RLS
 * on memberships and businesses holds it to the businesses the caller belongs to, whoever's id it is asked for.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import type { Executor } from "../../repos/_shared";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#1b4fd8"/></svg>';

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "summary-a");
  B = await createBusinessFixture(h, "summary-b");
  outsiderId = await h.createUser("summary-outsider@test.local");
});
afterAll(() => h?.close());

const summaries = (asUserId: string, forUserId: string) => h.asUser(asUserId).run((tx) => repos.businesses.listSummariesForUser(tx as unknown as Executor, forUserId));

describe("business summaries (founder.businesses.list)", () => {
  it("lists the caller's businesses with their role and logo version", async () => {
    const [mine] = await summaries(A.ownerId, A.ownerId);
    expect(mine).toMatchObject({ id: A.businessId, role: "owner", agentsStopped: false, logo: null });
    expect(mine).not.toHaveProperty("logoSha256");
    const { meta } = await h.service().run((tx) => repos.logos.set(tx as unknown as Executor, A.businessId, { source: "generated", logo: { mime: "image/svg+xml", svg: SVG } }));
    expect((await summaries(A.ownerId, A.ownerId))[0]?.logo).toEqual({ sha256: meta.sha256 });
    expect(await summaries(A.viewerId, A.viewerId)).toEqual([expect.objectContaining({ id: A.businessId, role: "viewer" })]);
  });

  it("cross-tenant: another business's owner never sees A's businesses, even asked by A's owner's id", async () => {
    expect(await summaries(B.ownerId, A.ownerId)).toEqual([]);
    expect((await summaries(B.ownerId, B.ownerId)).map((b) => b.id)).toEqual([B.businessId]);
    expect(await summaries(outsiderId, outsiderId)).toEqual([]);
    expect(await summaries(outsiderId, A.ownerId)).toEqual([]);
  });

  it("orders A to Z regardless of case and leaves archived businesses out", async () => {
    const svc = <T>(fn: (tx: Executor) => Promise<T>) => h.service().run((tx) => fn(tx as unknown as Executor));
    const make = async (name: string) => {
      const b = await svc((tx) => repos.businesses.create(tx, { name, createdBy: A.ownerId }));
      await svc((tx) => repos.memberships.add(tx, b.id, { userId: A.ownerId, role: "owner" }));
      return b;
    };
    await make("alpha Studio");
    const gone = await make("Beta Works");
    await make("Zed Labs");
    await svc((tx) => repos.businesses.archive(tx, gone.id));
    expect((await summaries(A.ownerId, A.ownerId)).map((b) => b.name)).toEqual(["alpha Studio", "SUMMARY-A", "Zed Labs"]);
  });
});
