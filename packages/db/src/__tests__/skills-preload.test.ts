/**
 * The skills preload test's comparison (WP-06 T13; founder, Nov 18, 2026): code sessions on real projects whose token
 * rows carry `skills_preload`, averaged per half over the test's window, from the ledger and the sessions only.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../repos";
import * as s from "../schema";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
let Demo: BusinessFixture;
const day = (d: string) => new Date(`${d}T12:00:00Z`);

async function session(biz: BusinessFixture, tokensIn: number, tokensOut: number, rows: { costMinor: number; half?: "on" | "off"; at: string }[]) {
  const created = await repos.agents.createSession(h.db, biz.businessId, { agentId: biz.agentId, modelKey: "sonnet" });
  await h.db.execute(sql`update agent_sessions set tokens_in = ${tokensIn}, tokens_out = ${tokensOut} where id = ${created.id}::uuid`);
  for (const r of rows) {
    await h.db.insert(s.usageLedger).values({ businessId: biz.businessId, agentId: biz.agentId, sessionId: created.id, kind: "tokens", quantity: tokensIn + tokensOut, costMinor: r.costMinor, costMicroMinor: r.costMinor * 1_000_000, occurredAt: day(r.at), details: { label: "Estimate", ...(r.half ? { skills_preload: r.half } : {}) } });
  }
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "preload-a");
  Demo = await createBusinessFixture(h, "preload-demo");
  await h.db.execute(sql`update businesses set is_demo = true where id = ${Demo.businessId}::uuid`);
  // "on": two sessions, one with a partial row and its closing row (both tagged).
  await session(A, 1000, 200, [{ costMinor: 3, half: "on", at: "2026-12-02" }, { costMinor: 2, half: "on", at: "2026-12-02" }]);
  await session(A, 3000, 400, [{ costMinor: 5, half: "on", at: "2026-12-03" }]);
  // "off": one session.
  await session(A, 4000, 800, [{ costMinor: 9, half: "off", at: "2026-12-04" }]);
  // Not counted: untagged, before the window, after it, and a demo project.
  await session(A, 9999, 9999, [{ costMinor: 99, at: "2026-12-03" }]);
  await session(A, 9999, 9999, [{ costMinor: 99, half: "on", at: "2026-11-30" }]);
  await session(A, 9999, 9999, [{ costMinor: 99, half: "off", at: "2026-12-09" }]);
  await session(Demo, 9999, 9999, [{ costMinor: 99, half: "off", at: "2026-12-03" }]);
}, 120_000);
afterAll(() => h?.close());

describe("skills preload comparison", () => {
  it("averages each half's code sessions in the window, counting every token row of a session", async () => {
    const out = await repos.metrics.skillsPreloadComparison(h.db, day("2026-12-01"), day("2026-12-08"));
    expect(out.on).toEqual({ sessions: 2, avgTokensIn: 2000, avgTokensOut: 300, avgCostMinor: 5 });
    expect(out.off).toEqual({ sessions: 1, avgTokensIn: 4000, avgTokensOut: 800, avgCostMinor: 9 });
  });

  it("is empty for a window with no tagged sessions", async () => {
    const out = await repos.metrics.skillsPreloadComparison(h.db, day("2025-01-01"), day("2025-01-08"));
    expect(out).toEqual({ on: { sessions: 0, avgTokensIn: 0, avgTokensOut: 0, avgCostMinor: 0 }, off: { sessions: 0, avgTokensIn: 0, avgTokensOut: 0, avgCostMinor: 0 } });
  });
});
