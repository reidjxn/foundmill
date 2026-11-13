/**
 * The credit saver in agent sessions: a session on the platform key whose month's credits are low starts on its route's
 * lower-cost model (a Sonnet worker on Haiku), unless its tools reach outside the business or spend money, or its agent
 * does money or legal work; a business on its own key and a business above the line are unchanged; and the orchestrator's
 * per-business client sends the call with `lowCredits`, so its routine routes move while its kept routes do not.
 */
import { lowCreditsThresholdMinor, includedCreditsMinor } from "@foundmill/config";
import { periodOf, repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { MockModelClient, type UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionActivities } from "../activities/session";
import { keptModelForRun, LOW_CREDITS_KEPT_MODULES, sessionKeepsModelOnLowCredits } from "../activities/session-credits";
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

describe("every run checks the keep rule again (security review, finding 1)", () => {
  it("a session launched low that resumes after the founder grants an outward tool runs on its usual model, and books on it", async () => {
    await setBalance(LINE - 1);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: B(), agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const acts = createSessionActivities(t.deps);
    const launch = await acts.prepareSession(input);
    expect(launch.modelKey).toBe("haiku");
    // While the session waits (an approval, a park), the founder gives the agent a tool that sends mail outside.
    const agent = await repos.agents.get(t.db, B(), t.workerId);
    const before = agent.currentVersionId!;
    const current = await repos.agents.getVersion(t.db, B(), before);
    const outward = await repos.agents.createVersion(t.db, B(), t.workerId, { instructions: current.instructions as never, tools: [...(current.tools as unknown[]), { connectorKey: "platform_mail", tools: ["mail.send"] }], state: "live" });
    await repos.agents.promoteVersion(t.db, B(), t.workerId, outward.id, { keepAgentModel: true });
    try {
      // The run stops before it starts (the team is stopped), which is enough to see the model it would run and book on.
      await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
      const result = await acts.runAgentSession(input, launch, null, null);
      expect(result.outcome).toBe("stopped");
      expect(result.modelKey).toBe("sonnet");
    } finally {
      await resumeBusinessAgents(t.db, B());
      await repos.agents.promoteVersion(t.db, B(), t.workerId, before, { keepAgentModel: true });
    }
  });

  it("a run whose tools are still routine keeps the launch's lower-cost model", async () => {
    await setBalance(LINE - 1);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: B(), agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const acts = createSessionActivities(t.deps);
    const launch = await acts.prepareSession(input);
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    try {
      const result = await acts.runAgentSession(input, launch, null, null);
      expect(result.modelKey).toBeUndefined();
      expect(launch.modelKey).toBe("haiku");
    } finally {
      await resumeBusinessAgents(t.db, B());
    }
  });

  it("keptModelForRun moves a run up only when its tools keep it, never down", () => {
    const run = { route: "worker" as const, agentModel: "sonnet" as const, module: "development" as const };
    const low = (modelKey: "haiku" | "sonnet" | "opus") => ({ modelKey, lowCredits: true });
    expect(keptModelForRun(low("haiku"), { ...run, toolRefs: ["platform_mail:send_mail"] })?.modelKey).toBe("sonnet");
    expect(keptModelForRun(low("haiku"), { ...run, toolRefs: ["github:merge_pr"] })?.modelKey).toBe("sonnet");
    expect(keptModelForRun(low("haiku"), { ...run, toolRefs: ["github:read_tree"] })).toBeNull();
    expect(keptModelForRun(low("sonnet"), { ...run, toolRefs: ["platform_mail:send_mail"] })).toBeNull();
    expect(keptModelForRun(low("opus"), { ...run, toolRefs: ["platform_mail:send_mail"] })).toBeNull();
    // A launch prepared before the field existed is compared as before.
    expect(keptModelForRun({ modelKey: "haiku" }, { ...run, toolRefs: ["platform_mail:send_mail"] })?.modelKey).toBe("sonnet");
  });

  it("a launch the credit saver did not lower is never moved by it, even when the founder raised the agent's model mid-session", async () => {
    await setBalance(LINE + 200);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: B(), agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const acts = createSessionActivities(t.deps);
    const launch = await acts.prepareSession(input);
    expect(launch).toMatchObject({ modelKey: "sonnet", lowCredits: false });
    // The agent holds an outward tool and the founder moves it to Opus while the session waits.
    const agent = await repos.agents.get(t.db, B(), t.workerId);
    const before = agent.currentVersionId!;
    const current = await repos.agents.getVersion(t.db, B(), before);
    const outward = await repos.agents.createVersion(t.db, B(), t.workerId, { instructions: current.instructions as never, tools: [...(current.tools as unknown[]), { connectorKey: "platform_mail", tools: ["mail.send"] }], state: "live" });
    await repos.agents.promoteVersion(t.db, B(), t.workerId, outward.id, { keepAgentModel: true });
    await repos.agents.update(t.db, B(), t.workerId, { modelKey: "opus" });
    try {
      await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
      const result = await acts.runAgentSession(input, launch, null, null);
      expect(result.outcome).toBe("stopped");
      // No credit-saver move, and no note blaming the tools for low credits.
      expect(result.modelKey).toBeUndefined();
      const notes = (await readSessionEvents(t.redis, sessionId)).map((e) => JSON.stringify(e));
      expect(notes.some((n) => n.includes("even though credits are low"))).toBe(false);
    } finally {
      await resumeBusinessAgents(t.db, B());
      await repos.agents.update(t.db, B(), t.workerId, { modelKey: "sonnet" });
      await repos.agents.promoteVersion(t.db, B(), t.workerId, before, { keepAgentModel: true });
    }
  });

  it("a launch the credit saver lowered says so", async () => {
    await setBalance(LINE - 1);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    expect(await createSessionActivities(t.deps).prepareSession({ businessId: B(), agentId: t.workerId, taskId: t.codeTaskId, sessionId })).toMatchObject({ modelKey: "haiku", lowCredits: true });
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
