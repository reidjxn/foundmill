/**
 * The credit saver in agent sessions: a session on the platform key whose month's credits are low starts on its route's
 * lower-cost model (a Sonnet worker on Haiku), unless its tools reach outside the business or spend money, or its agent
 * does money or legal work; a business on its own key and a business above the line are unchanged; and the orchestrator's
 * per-business client sends the call with `lowCredits`, so its routine routes move while its kept routes do not.
 */
import { lowCreditsThresholdMinor, includedCreditsMinor } from "@foundmill/config";
import { periodOf, repos } from "@foundmill/db";
import { MockModelClient, type UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionActivities } from "../activities/session";
import { LOW_CREDITS_KEPT_MODULES, sessionKeepsModelOnLowCredits } from "../activities/session-credits";
import { createBusinessModelClient } from "../models";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "low-credits" });
});
afterAll(async () => {
  await t?.close();
});

const B = () => t.businessId;
const period = () => periodOf(t.clock.now());
const LINE = lowCreditsThresholdMinor(includedCreditsMinor("free"));

/** Sets this month's balance to exactly `minor` (the row is created with the tier's included credits first). */
async function setBalance(minor: number, p: string = period()) {
  await repos.usage.ensurePeriodCredits(t.db, B(), p, includedCreditsMinor("free"));
  const now = (await repos.usage.creditBalance(t.db, B(), p))!;
  const diff = minor - Number(now.balanceMinor);
  if (diff > 0) await repos.usage.grantCredits(t.db, B(), p, diff);
  if (diff < 0) await repos.usage.chargeCredits(t.db, B(), p, -diff);
}

async function prepare() {
  const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
  return createSessionActivities(t.deps).prepareSession({ businessId: B(), agentId: t.workerId, taskId: t.codeTaskId, sessionId });
}

beforeEach(async () => {
  await repos.businesses.update(t.db, B(), { modelBilling: "credits" });
  const open = await repos.agents.listSessions(t.db, B(), { openOnly: true, limit: 50 });
  for (const s of open.items) await repos.agents.endSession(t.db, B(), s.id, { outcome: "done", endedAt: t.clock.now() });
});

describe("which sessions keep their model", () => {
  it("money and legal agents, and sessions whose tools reach outside or spend, keep theirs; research and code do not", () => {
    expect(LOW_CREDITS_KEPT_MODULES).toEqual(["finance", "legal"]);
    expect(sessionKeepsModelOnLowCredits({ module: "finance", toolRefs: [] })).toBe(true);
    expect(sessionKeepsModelOnLowCredits({ module: "legal", toolRefs: [] })).toBe(true);
    expect(sessionKeepsModelOnLowCredits({ module: "distribution", toolRefs: ["platform_mail:send_mail"] })).toBe(true);
    expect(sessionKeepsModelOnLowCredits({ module: "development", toolRefs: ["github:read_tree", "web:fetch_page"] })).toBe(false);
    expect(sessionKeepsModelOnLowCredits({ module: null, toolRefs: ["platform:request_human_action"] })).toBe(false);
  });
});

describe("prepareSession with low credits", () => {
  it("a worker on the platform key starts on the lower-cost model below the line, and on its own model above it", async () => {
    await setBalance(LINE);
    expect((await prepare()).modelKey).toBe("sonnet");
    await setBalance(LINE - 1);
    const low = await prepare();
    expect(low.modelKey).toBe("haiku");
    expect(low.modelBilling).toBe("credits");
    // A top-up above the line puts it back.
    await setBalance(LINE + 200);
    expect((await prepare()).modelKey).toBe("sonnet");
  });

  it("a business on its own key is never moved: its agents' work is the founder's", async () => {
    await setBalance(LINE - 1);
    await repos.businesses.update(t.db, B(), { modelBilling: "byok" });
    expect((await prepare()).modelKey).toBe("sonnet");
  });
});

describe("the per-business client with low credits", () => {
  it("sends routine routes on their lower-cost model and keeps the Chief of Staff and the Inbox on theirs", async () => {
    // The client's gate reads the wall clock's month (as in production), not the harness clock.
    await setBalance(LINE - 1, periodOf(new Date()));
    const events: UsageEvent[] = [];
    const client = createBusinessModelClient(new MockModelClient({ onUsage: (e) => void events.push(e) }), { db: t.db, vault: null, mode: "mock", now: () => t.clock.nowMs() });
    const ask = (route: "planner" | "chiefOfStaff" | "inboxComposer") => client.complete({ route, system: "Answer.", messages: [{ role: "user", content: "Plan the week." }], attribution: { businessId: B() } });
    await ask("planner");
    await ask("chiefOfStaff");
    await ask("inboxComposer");
    expect(events.map((e) => [e.route, e.modelKey])).toEqual([
      ["planner", "sonnet"],
      ["chiefOfStaff", "opus"],
      ["inboxComposer", "opus"],
    ]);
  });
});
