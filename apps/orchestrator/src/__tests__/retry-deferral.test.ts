/**
 * The planner's retry deferral (activities/cycle.ts `retryDeferral`): a failed or blocked task waits out its doubling
 * retry wait and, past the limit, the founder's restart. The founder's Continue is that restart: it retries every such
 * task at once, whatever the wait or the count (five tasks past their retries sat through a Continue that planned
 * nothing; Foundmill business, Oct 28, 2026). Autopilot, the schedule and wakes keep the waits and the limit.
 */
import { describe, expect, it } from "vitest";
import { retryDeferral } from "../activities/cycle";
import type { BriefTask } from "../activities/types";

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
