/**
 * The skills preload test's mark on the ledger (WP-06 T13; founder, Nov 18, 2026): a code session in the test books its
 * partial token rows with `skills_preload`, and a session outside the test books them as before.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionCredits } from "../activities/session-credits";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "preload-ledger" });
});
afterAll(async () => {
  await t?.close();
});

async function partialRow(skillsPreload: "on" | "off" | null) {
  const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
  const opened = await SessionCredits.open(t.deps, { businessId: t.businessId, agentId: t.workerId, sessionId, modelKey: "sonnet", skillsPreload });
  if (!opened.ok) throw new Error(opened.reason);
  await opened.credits.settle({ tokensIn: 100, tokensOut: 20, costMinor: 2 });
  const rows = (await repos.usage.list(t.db, t.businessId, { sessionId, kind: "tokens" })).items;
  return rows.map((r) => r.details);
}

describe("skills preload on the ledger", () => {
  it("marks a test session's partial token rows with its half, and leaves other sessions' rows as they were", async () => {
    expect(await partialRow("on")).toEqual([expect.objectContaining({ partial: true, skills_preload: "on" })]);
    expect(await partialRow("off")).toEqual([expect.objectContaining({ partial: true, skills_preload: "off" })]);
    const none = await partialRow(null);
    expect(none).toHaveLength(1);
    expect(none[0]).not.toHaveProperty("skills_preload");
  });
});
