/**
 * The planner's retry deferral (activities/cycle.ts `retryDeferral`): a failed or blocked task waits out its doubling
 * retry wait and, past the limit, the founder's restart. The founder's Continue is that restart: it retries every such
 * task at once, whatever the wait or the count (five tasks past their retries sat through a Continue that planned
 * nothing; Foundmill business, Oct 28, 2026). Autopilot, the schedule and wakes keep the waits and the limit.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDispatchFacts } from "../activities/brief";
import { retryDeferral } from "../activities/cycle";
import type { BriefTask } from "../activities/types";
import { emitEvent } from "../events";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

const task = (patch: Partial<BriefTask>): BriefTask =>
  ({ id: "t1", title: "Fix the chip", kind: "code", status: "blocked", departmentId: null, assigneeAgentId: null, blocked: false, awaitingApproval: false, approvalHold: null, fileScope: [], budgetMinor: null, priority: 0, retry: null, ...patch }) as BriefTask;

describe("retryDeferral", () => {
  const exhausted = { failures: 4, due: false, exhausted: true, nextAttemptAt: null };
  const waiting = { failures: 2, due: false, exhausted: false, nextAttemptAt: "2026-10-28T10:00:00.000Z" };

  it("defers a task past its retries, and one still waiting, on an automatic cycle", () => {
    expect(retryDeferral(task({ retry: exhausted }))).toBe("blocked 4 times in a row; start it from the Plan once the cause is fixed");
    expect(retryDeferral(task({ retry: exhausted }), "autopilot")).toBe("blocked 4 times in a row; start it from the Plan once the cause is fixed");
    expect(retryDeferral(task({ status: "failed", retry: waiting }), "schedule")).toBe("retrying after 2 failed sessions; next try after Oct 28, 10:00 AM UTC");
    expect(retryDeferral(task({ retry: waiting }), "wake")).toMatch(/^retrying after 2 blocked sessions/);
  });

  it("retries both on the founder's Continue, which is the restart the rule waits for", () => {
    expect(retryDeferral(task({ retry: exhausted }), "continue")).toBeNull();
    expect(retryDeferral(task({ status: "failed", retry: waiting }), "continue")).toBeNull();
  });

  it("never overrides an approval the founder has not decided, and leaves a due task alone", () => {
    expect(retryDeferral(task({ retry: exhausted, awaitingApproval: true }), "continue")).toBe("waiting for your approval in the Inbox");
    expect(retryDeferral(task({ retry: { failures: 1, due: true, exhausted: false, nextAttemptAt: null } }))).toBeNull();
    expect(retryDeferral(task({ status: "ready", retry: null }), "continue")).toBeNull();
  });
});

describe("loadDispatchFacts: a task blocked not_connected waits for the founder (WP-05 T2)", () => {
  let t: OrchestratorTestHarness;
  beforeAll(async () => {
    t = await setupOrchestratorHarness({ prefix: "retry" });
  });
  afterAll(async () => {
    await t?.close();
  });

  /** A research task whose one session ended blocked for `reason`, an hour ago (well past the first retry wait). */
  const blockedOnce = async (title: string, reason: "not_connected" | "no_result") => {
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "research", title, goalMd: "Find suppliers.", assigneeAgentId: t.workerId, status: "ready" });
    await repos.tasks.setStatus(t.db, t.businessId, task.id, "blocked", { force: true });
    const sessionId = await openSessionRow(t, t.workerId, task.id);
    await repos.agents.endSession(t.db, t.businessId, sessionId, { outcome: "blocked", endedAt: new Date(t.clock.now().getTime() - 3_600_000) });
    await emitEvent(t.db, { businessId: t.businessId, type: "task.blocked", actor: { kind: "agent", id: t.workerId }, payload: { taskId: task.id, kind: task.kind, title, assigneeAgentId: t.workerId, sessionId, reason, detail: `blocked: ${reason}`, approvalId: null, occurrence: 1 } });
    return task.id;
  };

  it("is not retried on a timer, only on the founder's Continue; a task blocked for another reason retries when due", async () => {
    const waiting = await blockedOnce("Research the market", "not_connected");
    const other = await blockedOnce("Write the welcome email", "no_result");
    const facts = await loadDispatchFacts(t.deps, t.businessId);
    const byId = new Map(facts.openTasks.map((x) => [x.id, x]));
    expect(byId.get(waiting)!.retry).toMatchObject({ due: false, exhausted: true, nextAttemptAt: null });
    expect(retryDeferral(byId.get(waiting)!, "schedule")).toBe("blocked once; start it from the Plan once the cause is fixed");
    expect(retryDeferral(byId.get(waiting)!, "continue")).toBeNull();
    expect(byId.get(other)!.retry).toMatchObject({ due: true, exhausted: false });
  });
});
