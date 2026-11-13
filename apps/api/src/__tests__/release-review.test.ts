/**
 * A release's approval carries the second read of its change (apps/orchestrator `merge.reviewed`): the review of the
 * task's pull request, newest first, shown after the change's own rows; nothing when there was none.
 */
import { approvalWhatExactly, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releaseReview } from "../services/approvals";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "release-review" });
}, 120_000);
afterAll(() => hz.close());

describe("releaseReview", () => {
  it("finds the review of the approval's task and pull request, and none for another", async () => {
    const { businessId, taskId, task2Id, agentId, agent2Id } = hz.A;
    const approval = await repos.approvals.create(hz.db, businessId, { agentId, taskId, connectorKey: "github", tool: "merge_pr", args: { owner: "acme", repo: "shop", prNumber: 7, mergeMethod: "squash", commitTitle: "Deploy contract (#7)" }, reasons: ["Going live is yours to decide"] });
    expect(await releaseReview(hz.db, businessId, approval)).toBeNull();

    const review = (prNumber: number, verdict: string, target = taskId) =>
      repos.audit.append(hz.db, businessId, { actorKind: "agent", actorId: agent2Id, action: "merge.reviewed", target: { kind: "task", id: target }, details: { prNumber, headSha: "abc", reviewerAgentId: agent2Id, reviewerName: "Review Agent", authorAgentId: agentId, verdict, summary: `Verdict ${verdict}.`, findings: [{ severity: "normal", file: "a.ts", line: 3, title: "No test for the new branch", suggestion: "Add one" }], simulated: false } });
    await review(6, "approve");
    await review(7, "comment", task2Id);
    expect(await releaseReview(hz.db, businessId, approval)).toBeNull();
    await review(7, "request_changes");

    const found = await releaseReview(hz.db, businessId, approval);
    expect(found).toEqual({ reviewerName: "Review Agent", verdict: "request_changes", summary: "Verdict request_changes.", simulated: false, findings: [{ severity: "normal", file: "a.ts", line: 3, title: "No test for the new branch", suggestion: "Add one" }] });
    const rows = approvalWhatExactly(approval, { review: found }).rows;
    expect(rows.at(-2)).toEqual({ label: "Second read", value: "Review Agent read the change and suggests changes first. Verdict request_changes." });
    expect(rows.at(-1)).toEqual({ label: "Worth fixing", value: "a.ts:3: No test for the new branch. Fix: Add one" });
  });
});
