/**
 * A release's approval carries the second read of its change (apps/orchestrator `merge.reviewed`): the review of the
 * commit the merge was asked for, shown after the change's own rows, saying how much of the change it read and whether
 * the branch changed since; nothing when there was none.
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

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const FINDING = { severity: "normal", file: "a.ts", line: 3, title: "No test for the new branch", suggestion: "Add one" };

describe("releaseReview", () => {
  const review = (target: string, prNumber: number, verdict: string, headSha: string, more: Record<string, unknown> = {}) =>
    repos.audit.append(hz.db, hz.A.businessId, { actorKind: "agent", actorId: hz.A.agent2Id, action: "merge.reviewed", target: { kind: "task", id: target }, details: { prNumber, headSha, reviewerAgentId: hz.A.agent2Id, reviewerName: "Review Agent", authorAgentId: hz.A.agentId, verdict, summary: `Verdict ${verdict}.`, findings: [FINDING], filesReviewed: ["a.ts"], filesTotal: 1, truncated: false, simulated: false, ...more } });
  const mergeApproval = (taskId: string, prNumber: number, headSha?: string) =>
    repos.approvals.create(hz.db, hz.A.businessId, { agentId: hz.A.agentId, taskId, connectorKey: "github", tool: "merge_pr", args: { owner: "acme", repo: "shop", prNumber, mergeMethod: "squash", commitTitle: `Change (#${prNumber})`, ...(headSha ? { headSha } : {}) }, reasons: ["Going live is yours to decide"] });

  it("finds the review of the approval's task, pull request and commit, and none for another", async () => {
    const { businessId, taskId, task2Id } = hz.A;
    const approval = await mergeApproval(taskId, 7, SHA_A);
    expect(await releaseReview(hz.db, businessId, approval)).toBeNull();
    await review(taskId, 6, "approve", SHA_A);
    await review(task2Id, 7, "comment", SHA_A);
    expect(await releaseReview(hz.db, businessId, approval)).toBeNull();
    await review(taskId, 7, "request_changes", SHA_A);

    const found = await releaseReview(hz.db, businessId, approval);
    expect(found).toEqual({ reviewerName: "Review Agent", verdict: "request_changes", summary: "Verdict request_changes.", simulated: false, findings: [FINDING], truncated: false, filesReviewed: 1, filesTotal: 1, stale: false });
    const rows = approvalWhatExactly(approval, { review: found }).rows;
    expect(rows.at(-2)).toEqual({ label: "Second read", value: "Review Agent read the change and suggests changes first. Verdict request_changes." });
    expect(rows.at(-1)).toEqual({ label: "Worth fixing", value: "a.ts:3: No test for the new branch. Fix: Add one" });
  });

  it("says the branch changed since the review when the newest review is of another commit, or the merge names none (M4)", async () => {
    const { businessId, task2Id, taskIds } = hz.A;
    const pinned = await mergeApproval(task2Id, 21, SHA_A);
    await review(task2Id, 21, "approve", SHA_A);
    expect(await releaseReview(hz.db, businessId, pinned)).toMatchObject({ verdict: "approve", stale: false });
    // The branch moved and was reviewed again: the approval's commit is not what would go live.
    await review(task2Id, 21, "approve", SHA_B);
    const moved = await releaseReview(hz.db, businessId, pinned);
    expect(moved).toMatchObject({ stale: true });
    const rows = approvalWhatExactly(pinned, { review: moved }).rows;
    expect(rows.some((r) => r.label === "Changed since")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("found nothing that should stop it");
    // A merge asked without a commit cannot be tied to any review.
    const unpinnedTask = taskIds[0]!;
    await review(unpinnedTask, 22, "approve", SHA_A);
    expect(await releaseReview(hz.db, businessId, await mergeApproval(unpinnedTask, 22))).toMatchObject({ stale: true });
  });

  it("a review that left files unread says how many it read, and a row without the counts is not shown as complete (M3)", async () => {
    const { businessId, taskIds } = hz.A;
    const task = taskIds[1]!;
    await review(task, 31, "approve", SHA_A, { filesReviewed: ["a.ts", "b.ts"], filesTotal: 5, truncated: true });
    const partial = await releaseReview(hz.db, businessId, await mergeApproval(task, 31, SHA_A));
    expect(partial).toMatchObject({ truncated: true, filesReviewed: 2, filesTotal: 5, stale: false });
    const rows = approvalWhatExactly(await mergeApproval(task, 31, SHA_A), { review: partial }).rows;
    expect(rows.find((r) => r.label === "Second read")?.value).toMatch(/^Review Agent read 2 of 5 files of the change and found nothing in what it read/);
    const legacy = taskIds[2]!;
    await review(legacy, 32, "approve", SHA_A, { truncated: undefined, filesTotal: undefined });
    expect(await releaseReview(hz.db, businessId, await mergeApproval(legacy, 32, SHA_A))).toMatchObject({ truncated: true });
  });
});
