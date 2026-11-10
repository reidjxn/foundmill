/**
 * Development › Pull requests through the API (BUILD §11.6): only code tasks are pull requests (TPD-13), and the
 * Merged table lists what the platform's own merge queue landed as well as GitHub's `pr.merged` events (TPD-14), so it
 * agrees with Environments and Home, which count done code tasks. Also the physical-product Operations department,
 * which sits over the development module's Specialists and Plan tabs only (DB-11), when its defaults are restored.
 */
import { repos } from "@foundmill/db";
import { MODULE_TABS } from "@foundmill/shared";
import { sql } from "drizzle-orm";
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
    // Merged rows carry the task's founder title and agent (Builder view off reads them).
    expect(byTask.get(onGitHub.id)).toMatchObject({ agentId, founderTitle: null });
    expect(byTask.get(landed.id)).toMatchObject({ agentId });
  });
});

describe("dev.deployments.list", () => {
  it("lists the business's deploy.succeeded events, newest first, with the task's founder title; another business sees none", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const task = await repos.tasks.create(hz.db, businessId, { kind: "code", title: "Fix hydration mismatch in /pricing", status: "review", assigneeAgentId: agentId });
    await repos.tasks.update(hz.db, businessId, task.id, { founderTitle: "Fix a display bug on the pricing page" });
    const deploy = (environment: "preview" | "production", at: string, extra: Record<string, unknown> = {}) =>
      repos.events.write(hz.db, businessId, { type: "deploy.succeeded", occurredAt: new Date(at), actor: { kind: "system", id: "gateway" }, payload: { environment, provider: "vercel", commitSha: "9f2c1d7e4b8a", url: environment === "production" ? "https://northwind.example" : "https://preview-1.example", ...extra } });
    await deploy("production", "2026-11-06T10:00:00Z");
    await deploy("preview", "2026-11-07T10:00:00Z", { taskId: task.id, branch: `agent/${task.id}` });
    const list = await hz.caller({ userId: ownerId }).dev.deployments.list({ businessId });
    expect(list.items.map((d) => d.environment).slice(0, 2)).toEqual(["preview", "production"]);
    expect(list.items[0]).toMatchObject({ taskId: task.id, url: "https://preview-1.example", founderTitle: "Fix a display bug on the pricing page" });
    expect(list.items[1]).toMatchObject({ taskId: null, url: "https://northwind.example", founderTitle: null });
    const other = await hz.caller({ userId: hz.B.ownerId }).dev.deployments.list({ businessId: hz.B.businessId });
    expect(other.items.filter((d) => d.url === "https://northwind.example")).toEqual([]);
    await expect(hz.caller({ userId: hz.B.ownerId }).dev.deployments.list({ businessId })).rejects.toBeTruthy();
  });
});

describe("department.resetDefaults", () => {
  it("re-creates a hardware business's Operations over Specialists and Plan only, and Development with every tab (DB-11)", async () => {
    const { businessId, ownerId } = hz.B;
    await hz.db.execute(sql`update businesses set archetype = 'hardware' where id = ${businessId}::uuid`);
    const departments = await hz.caller({ userId: ownerId }).department.resetDefaults({ businessId });
    const tabsOf = async (slug: string) => {
      const dept = departments.find((d) => d.slug === slug);
      expect(dept, slug).toBeTruthy();
      return (await repos.screens.list(hz.db, businessId, dept!.id)).sort((a, b) => a.position - b.position).map((s) => s.tabSlug);
    };
    expect(await tabsOf("operations")).toEqual(["specialists", "plan"]);
    expect(await tabsOf("development")).toEqual(MODULE_TABS.development.map((t) => t.slug));
  });
});
