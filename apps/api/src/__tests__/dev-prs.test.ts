/**
 * Development › Pull requests through the API (BUILD §11.6): only code tasks are pull requests (TPD-13), and the
 * Merged table lists what the platform's own merge queue landed as well as GitHub's `pr.merged` events (TPD-14), so it
 * agrees with Environments and Home, which count done code tasks.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "devprs" });
}, 120_000);
afterAll(() => hz?.close());

describe("dev.prs.list", () => {
  it("lists code tasks only, and merged = GitHub's events plus done code tasks, one row per task", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const make = (kind: "code" | "finance" | "specialist", title: string, status: "review" | "merging" | "done") => repos.tasks.create(hz.db, businessId, { kind, title, status, assigneeAgentId: agentId });
    const reviewing = await make("code", "Approval queue screen", "review");
    const queued = await make("code", "Fix invoice PDF 500", "merging");
    const landed = await make("code", "Usage export", "done");
    const onGitHub = await make("code", "Sitemap fixes", "done");
    await make("finance", "Q3 investor update", "review");
    await make("specialist", "Stability data for serum reformulation", "review");
    await make("finance", "Set up the first runway forecast", "done");
    await repos.events.write(hz.db, businessId, {
      type: "pr.merged",
      actor: { kind: "system", id: "ingest" },
      payload: { taskId: onGitHub.id, repo: "acme/app", prNumber: 41, title: "Sitemap fixes", branch: `agent/${onGitHub.id}`, baseBranch: "main", mergeCommitSha: "a1b2c3d4e5f6", mergedBy: { kind: "agent", id: agentId }, additions: 12, deletions: 3, filesChanged: 2, url: "https://github.com/acme/app/pull/41" },
    });

    const prs = await owner.dev.prs.list({ businessId });
    expect(prs.open.map((p) => p.title).sort()).toEqual([queued.title, reviewing.title].sort());
    expect(prs.open.every((p) => p.kind === "code" && p.branch === `agent/${p.taskId}`)).toBe(true);

    // The queue's merge is listed without a GitHub event; the GitHub-reported one appears once, from its event.
    const byTask = new Map(prs.merged.map((m) => [m.taskId as string, m]));
    expect(prs.merged.filter((m) => m.taskId === onGitHub.id)).toHaveLength(1);
    expect(byTask.get(onGitHub.id)).toMatchObject({ source: "github", prNumber: 41 });
    expect(byTask.get(landed.id)).toMatchObject({ source: "merge_queue", eventId: null, title: "Usage export", branch: `agent/${landed.id}`, mergedBy: { kind: "agent", id: agentId } });
    expect(prs.merged.map((m) => m.title)).not.toContain("Set up the first runway forecast");
  });
});
