/**
 * Builder view off (docs/DESIGN.md "Builder view"): the Development screens keep their content and drop the technical
 * columns and details (PR number, branch, lines, commit, provider; the Technical disclosure and the technical subtitle;
 * tokens and the ETA on a tile). The fake source renders Builder view on by default; these render it off.
 */
import "./setup";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EnvironmentsScreen } from "../EnvironmentsScreen";
import { PlanScreen } from "../PlanScreen";
import { PullRequestsScreen } from "../PullRequestsScreen";
import { TrainingGroundScreen } from "../TrainingGroundScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { TASK_BUNDLE, TASK_DONE, TASK_INDEX, TASK_PLAYWRIGHT, agentsResponse, emptyPrsResponse, emptyTasksResponse, prsResponse, tasks, tasksResponse, trainingGroundResponses } from "./fixtures";
import type { DeploymentsListResponse, PrsListResponse, TasksListResponse } from "../types";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const off = { builder: false };
const heads = (grid: HTMLElement) => within(grid).getAllByRole("columnheader").map((h) => h.textContent?.replace(/Resize.*$/, "").trim());

describe("Development with Builder view off", () => {
  it("What changed: 'Waiting for your go-ahead' and 'Gone live' in founder words, with no PR number, branch, lines or commit", async () => {
    // One open change has a founder title (0070); the other is rewritten by founderPhrase.
    const prs: PrsListResponse = { ...prsResponse, open: prsResponse.open.map((p) => (p.taskId === TASK_BUNDLE ? { ...p, founderTitle: "Let shoppers build their own bundle" } : p)) };
    const fake = createFakeSource({ responses: { "dev.prs.list": prs, "team.agents.list": agentsResponse } });
    renderScreen(fake, <PullRequestsScreen {...props} />, {}, off);
    const waiting = await screen.findByRole("grid", { name: "Waiting for your go-ahead" });
    expect(heads(waiting)).toEqual(expect.arrayContaining(["Change", "Agent", "Status", "See it"]));
    expect(within(waiting).getByText("Let shoppers build their own bundle")).toBeTruthy();
    expect(within(waiting).getByText("Usage index for the Ledgerly dashboard")).toBeTruthy();
    expect(within(waiting).getByText("Being checked")).toBeTruthy();
    expect(within(waiting).getByText("Ready for your go-ahead")).toBeTruthy();
    expect(within(waiting).getAllByText("Not ready yet").length).toBeGreaterThan(0);
    // A preview reported live becomes the row's "See it" link.
    act(() => fake.emit({ id: "dep-1", type: "deploy.succeeded", occurredAt: "2026-10-07T09:50:00Z", payload: { environment: "preview", taskId: TASK_INDEX, branch: `agent/${TASK_INDEX}`, url: "https://preview-index.example", commitSha: "abcdef1234", provider: "vercel" } }));
    await waitFor(() => expect(within(waiting).getByRole("link", { name: "See it" }).getAttribute("href")).toBe("https://preview-index.example"));
    const live = screen.getByRole("grid", { name: "Gone live" });
    expect(within(live).getByText("Sitemap and canonical fixes")).toBeTruthy();
    expect(within(live).getByText(/^Put live Oct \d{1,2}$/)).toBeTruthy();
    expect(within(within(live).getByRole("row", { name: /Sitemap and canonical fixes/ })).getAllByText("Pike").length).toBeGreaterThan(0);
    expect(screen.queryByRole("grid", { name: "Open pull requests" })).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/#41|a1b2c3d|agent\/|\+120|Merge|pull request/i);
  });

  it("What changed with Builder view on keeps the pull request tables", async () => {
    renderScreen(createFakeSource({ responses: { "dev.prs.list": prsResponse, "team.agents.list": agentsResponse } }), <PullRequestsScreen {...props} />);
    expect(await screen.findByRole("grid", { name: "Open pull requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "#41" })).toBeTruthy();
    expect(screen.queryByRole("grid", { name: "Waiting for your go-ahead" })).toBeNull();
  });

  it("Live product: the live product card and the previews of changes, with no branch, commit or provider", async () => {
    const codeTasks = { ...tasksResponse, items: tasks.map((t) => (t.id === TASK_INDEX ? { ...t, founderTitle: "Show usage on the dashboard" } : t)).filter((t) => t.kind === "code") };
    const deployments: DeploymentsListResponse = {
      items: [
        { eventId: "e-2", occurredAt: "2026-10-06T16:00:00Z", taskId: TASK_INDEX, environment: "preview", provider: "vercel", url: "https://preview-index.example", commitSha: "abcdef1234", branch: `agent/${TASK_INDEX}` },
        { eventId: "e-1", occurredAt: "2026-10-06T12:00:00Z", taskId: null, environment: "production", provider: "vercel", url: "https://northwind.example", commitSha: "1234abcdef", branch: "main" },
      ],
    };
    renderScreen(createFakeSource({ responses: { "dev.tasks.list": codeTasks, "dev.prs.list": prsResponse, "team.agents.list": agentsResponse, "dev.deployments.list": deployments } }), <EnvironmentsScreen {...props} />, {}, off);
    const card = await screen.findByTestId("live-product-card");
    expect(within(card).getByText("Your live product")).toBeTruthy();
    expect(within(card).getByTestId("live-product-url").getAttribute("href")).toBe("https://northwind.example");
    expect(within(card).getByTestId("live-product-updated").textContent).toMatch(/^Updated Oct \d{1,2}$/);
    const previews = screen.getByRole("grid", { name: "Previews of changes" });
    const row = within(previews).getByRole("row", { name: /Show usage on the dashboard/ });
    expect(within(row).getByRole("link", { name: "Open preview" }).getAttribute("href")).toBe("https://preview-index.example");
    // Merged changes are not previews; the builder's table is not there.
    expect(within(previews).queryByText("Sitemap and canonical fixes")).toBeNull();
    expect(screen.queryByRole("grid", { name: "Environments" })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/Vercel|abcdef1|1234abc|agent\/|Branch|Commit|Provider/);
  });

  it("Live product before any release says none is recorded, never that the product is down", async () => {
    renderScreen(createFakeSource({ responses: { "dev.tasks.list": emptyTasksResponse, "dev.prs.list": emptyPrsResponse, "team.agents.list": agentsResponse, "dev.deployments.list": { items: [] } } }), <EnvironmentsScreen {...props} />, {}, off);
    const card = await screen.findByTestId("live-product-card");
    expect(within(card).getByText("No release recorded yet")).toBeTruthy();
  });

  it("Environments with Builder view on keeps today's table and never asks for the recorded deployments", async () => {
    const codeTasks = { ...tasksResponse, items: tasks.filter((t) => t.kind === "code") };
    const fake = createFakeSource({ responses: { "dev.tasks.list": codeTasks, "dev.prs.list": prsResponse, "team.agents.list": agentsResponse } });
    renderScreen(fake, <EnvironmentsScreen {...props} />);
    expect(await screen.findByRole("grid", { name: "Environments" })).toBeTruthy();
    expect(document.querySelector(`[data-branch="agent/${TASK_DONE}"]`)).toBeTruthy();
    expect(fake.queried.has("dev.deployments.list")).toBe(false);
  });

  it("Plan: no Technical disclosure and no technical subtitle under a founder title", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: { "dev.tasks.list": tasksResponse, "team.agents.list": agentsResponse }, onMutate: () => ({ session: { id: "s" }, workflow: { queued: true } }) });
    renderScreen(fake, <PlanScreen {...props} />, {}, off);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(screen.queryByTestId("task-technical")).toBeNull();
    expect(screen.queryByText(`agent/${TASK_PLAYWRIGHT}`)).toBeNull();
    expect(document.querySelector("[data-technical-title]")).toBeNull();
  });

  it("Working now: a tile keeps its agent, task, progress, elapsed and cost Estimate; no terminal, diff, tokens, ETA or Task graph", async () => {
    renderScreen(createFakeSource({ responses: trainingGroundResponses() }), <TrainingGroundScreen {...props} />, {}, off);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await waitFor(() => expect(within(tile).getByLabelText(/Progress \d+%/)).toBeTruthy());
    const footer = within(tile).getByTestId("tile-footer");
    expect(footer.textContent).not.toMatch(/ETA|tokens/);
    expect(footer.textContent).toContain("Estimate");
    expect(within(tile).queryByRole("tab", { name: "Terminal" })).toBeNull();
    expect(within(tile).queryByRole("tab", { name: "Diff" })).toBeNull();
    expect(within(tile).queryByRole("log")).toBeNull();
    expect(within(tile).getByRole("button", { name: /Nudge/ })).toBeTruthy();
    expect(screen.getByText("Working now")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Live sessions view" })).toBeNull();
  });

  it("Working now names the task by its founder title, and the Task graph link opens the tiles", async () => {
    const responses = trainingGroundResponses();
    const withFounder = (r: TasksListResponse): TasksListResponse => ({ ...r, items: r.items.map((t) => (t.id === TASK_BUNDLE ? { ...t, founderTitle: "Let shoppers build their own bundle" } : t)) });
    const base = responses["dev.tasks.list"];
    renderScreen(createFakeSource({ responses: { ...responses, "dev.tasks.list": (i: Record<string, unknown> | undefined) => withFounder(base(i)) } }), <TrainingGroundScreen {...props} subView="formation" />, {}, off);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    expect(within(grid).getByRole("article", { name: /Juno: Let shoppers build their own bundle/ })).toBeTruthy();
  });

  it("Live sessions with Builder view on keeps the terminal and the Task graph toggle", async () => {
    renderScreen(createFakeSource({ responses: trainingGroundResponses() }), <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    expect(within(grid).getAllByRole("tab", { name: "Terminal" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("radiogroup", { name: "Live sessions view" })).toBeTruthy();
  });
});
