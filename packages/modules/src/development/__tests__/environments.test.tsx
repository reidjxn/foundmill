import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BRANCH_NAME_MAX, EnvironmentsScreen, deploymentFromEvent, providerLabel, readableBranch, toEnvironmentRows, type Deployment } from "../EnvironmentsScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { TASK_BUNDLE, TASK_DONE, TASK_INDEX, agents, agentsResponse, emptyPrsResponse, emptyTasksResponse, prsResponse, tasks, tasksResponse } from "./fixtures";
import type { TaskRow } from "../types";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const codeTasks = { ...tasksResponse, items: tasks.filter((t) => t.kind === "code") };
const responses = () => ({ "dev.tasks.list": codeTasks, "dev.prs.list": prsResponse, "team.agents.list": agentsResponse });

describe("EnvironmentsScreen", () => {
  it("lists one environment per agent branch with its state", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <EnvironmentsScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Environments" });
    // bundle (running), index (review), done (merged); ready/planned tasks have no branch yet.
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getAllByText("Awaiting deployment")).toHaveLength(2);
    expect(within(table).getByText("Merged")).toBeTruthy();
    // The branch reads as its task ("Sitemap and canonical fixes"); the git branch itself is in the tooltip.
    const done = within(table).getByText("sitemap-canonical-fixes").closest("[data-branch]");
    expect(done?.getAttribute("data-branch")).toBe(`agent/${TASK_DONE}`);
    expect(done?.getAttribute("title")).toBe(`Branch agent/${TASK_DONE}`);
    expect(within(table).queryByText(`agent/${TASK_DONE}`)).toBeNull();
    expect(screen.getByTestId("env-counts").textContent).toBe("0 live · 2 awaiting · 1 merged");
    expect(fake.queried.get("dev.tasks.list")).toEqual({ kind: "code", limit: 500 });
  });

  it("goes live when a preview deployment event arrives and opens it from the context menu", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <EnvironmentsScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Environments" });
    act(() => fake.emit({ type: "deploy.succeeded", occurredAt: "2026-10-07T09:55:00Z", payload: { taskId: TASK_BUNDLE, environment: "preview", provider: "vercel", url: "https://bundle.preview.example", commitSha: "0123456789ab", branch: `agent/${TASK_BUNDLE}` } }));
    await waitFor(() => expect(within(table).getByText("Live")).toBeTruthy());
    expect(within(table).getByRole("link", { name: /bundle.preview.example/ }).getAttribute("href")).toBe("https://bundle.preview.example");
    expect(within(table).getByText("0123456")).toBeTruthy();
    expect(within(table).getByText("Vercel")).toBeTruthy();
    expect(screen.getByTestId("env-counts").textContent).toBe("1 live · 1 awaiting · 1 merged");
    fireEvent.contextMenu(within(table).getByText("usage-index-ledgerly"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Open preview" }).getAttribute("aria-disabled")).toBe("true");
    await user.click(within(menu).getByRole("menuitem", { name: "Show in Plan" }));
    expect(fake.navigations[0]).toBe(`/b/${BUSINESS_ID}/d/development/plan?task=${TASK_INDEX}`);
  });

  it("adds a production release row from a deploy without a task", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <EnvironmentsScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Environments" });
    act(() => fake.emit({ type: "deploy.succeeded", payload: { taskId: null, environment: "production", provider: "railway", url: "https://app.example", commitSha: "fedcba9876", branch: "main" } }));
    await waitFor(() => expect(within(table).getByText("Production release")).toBeTruthy());
    expect(within(table).getByText("main")).toBeTruthy();
  });

  it("shows the empty, loading and error states", async () => {
    const empty = renderScreen(createFakeSource({ responses: { ...responses(), "dev.tasks.list": emptyTasksResponse, "dev.prs.list": emptyPrsResponse } }), <EnvironmentsScreen {...props} />);
    expect(await screen.findByText(/Environments appear here/)).toBeTruthy();
    empty.unmount();
    const loading = renderScreen(createFakeSource({ responses: { "team.agents.list": agentsResponse } }), <EnvironmentsScreen {...props} />);
    expect(loading.container.querySelector('[data-state="loading"]')).not.toBeNull();
    loading.unmount();
    const failing = createFakeSource({ responses: { ...responses(), "dev.tasks.list": new Error("tasks unavailable") } });
    renderScreen(failing, <EnvironmentsScreen {...props} />);
    expect(await screen.findByText("tasks unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failing.refetches["dev.tasks.list"]).toBe(1);
    expect(failing.refetches["dev.prs.list"]).toBe(1);
  });
});

describe("toEnvironmentRows", () => {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  it("keeps the newest deployment per branch and merges PR-only branches", () => {
    const older: Deployment = { branch: `agent/${TASK_BUNDLE}`, taskId: TASK_BUNDLE, environment: "preview", provider: "vercel", url: "https://old", commitSha: "aaaaaaa1", occurredAt: new Date("2026-10-07T09:00:00Z") };
    const newer: Deployment = { ...older, url: "https://new", commitSha: "bbbbbbb2", occurredAt: new Date("2026-10-07T09:50:00Z") };
    const rows = toEnvironmentRows(tasks.filter((t) => t.id === TASK_BUNDLE), { open: [{ taskId: "pr-only", title: "PR only", status: "review", branch: "agent/pr-only", agentId: null }], merged: [] }, [newer, older], agentMap);
    expect(rows[0]).toMatchObject({ branch: `agent/${TASK_BUNDLE}`, state: "live", url: "https://new", agentName: "Juno" });
    expect(rows[1]).toMatchObject({ branch: "agent/pr-only", state: "awaiting", agentName: "Unassigned" });
  });
  it("puts what needs attention first: live, then awaiting, then merged and stopped, titles in number order", () => {
    const base = tasks.find((t) => t.kind === "code")!;
    const mk = (id: string, title: string, status: TaskRow["status"]) => ({ ...base, id, title, status });
    const rows = toEnvironmentRows([mk("t-10", "Storefront fix #10", "done"), mk("t-2", "Storefront fix #2", "done"), mk("t-s", "Stopped work", "stopped"), mk("t-r", "Running work", "running")], undefined, [], agentMap);
    expect(rows.map((r) => [r.title, r.state])).toEqual([
      ["Running work", "awaiting"],
      ["Storefront fix #2", "merged"],
      ["Storefront fix #10", "merged"],
      ["Stopped work", "stopped"],
    ]);
  });
  it("names agent branches by their task: a short slug, small words out, a trailing number kept, unique per table", () => {
    expect(readableBranch("agent/7c9cb72c-39ad-4e64-af5c-8df6e83e47a8", "Stability data for serum reformulation")).toBe("stability-data-serum");
    expect(readableBranch("agent/x1234567", "Fix invoice PDF 500 for customers with no address")).toBe("fix-invoice-pdf-500");
    expect(readableBranch("agent/x1234567", "Order webhook hardening #10")).toBe("order-webhook-hardening-10");
    expect(readableBranch("agent/x1234567", "Review: approval workflow PR #318")).toBe("review-approval-318");
    expect(readableBranch("agent/x1234567", "Crème brûlée & café copy")).toBe("creme-brulee-cafe-copy");
    for (const t of ["Stability data for serum reformulation", "Order webhook hardening #10", "A really quite extraordinarily long single title word here"]) expect(readableBranch("agent/x1234567", t).length).toBeLessThanOrEqual(BRANCH_NAME_MAX);
    // Branches with names of their own, and titles with nothing to slug, keep the branch.
    expect(readableBranch("main", "Production release")).toBe("main");
    expect(readableBranch("feature/pricing", "Pricing page")).toBe("feature/pricing");
    expect(readableBranch("agent/x1234567", "請求書")).toBe("agent/x1234567");
    expect(readableBranch("agent/x1234567", null)).toBe("agent/x1234567");
    // Two tasks with one title stay apart by their task ids.
    const base = tasks.find((t) => t.kind === "code")!;
    const rows = toEnvironmentRows([{ ...base, id: "aaaaaaaa-1111", title: "Storefront fix", status: "done" }, { ...base, id: "bbbbbbbb-2222", title: "Storefront fix", status: "done" }], undefined, [], agentMap);
    expect(rows.map((r) => r.branchName).sort()).toEqual(["storefront-fix-aaaaaa", "storefront-fix-bbbbbb"]);
  });
  it("names hosting providers in words and hides an unknown one", () => {
    expect(providerLabel("vercel")).toBe("Vercel");
    expect(providerLabel("fly")).toBe("Fly.io");
    expect(providerLabel("unknown")).toBeNull();
    expect(providerLabel("my_host")).toBe("My host");
  });
  it("marks done tasks merged and stopped tasks stopped regardless of deployments", () => {
    const rows = toEnvironmentRows([{ ...tasks[5]!, status: "stopped" }, tasks[5]!], undefined, [], agentMap);
    expect(rows.map((r) => r.state)).toEqual(["merged"]);
  });
  it("deploymentFromEvent validates the environment and commit", () => {
    expect(deploymentFromEvent({ type: "deploy.succeeded", payload: { environment: "preview", commitSha: "abc1234" } })?.environment).toBe("preview");
    expect(deploymentFromEvent({ type: "deploy.succeeded", payload: { environment: "qa", commitSha: "abc1234" } })).toBeNull();
    expect(deploymentFromEvent({ type: "deploy.succeeded", payload: { environment: "preview" } })).toBeNull();
  });
});
