import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PullRequestsScreen, previewFromEvent, toMergedRows, toOpenRows } from "../PullRequestsScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { TASK_BUNDLE, TASK_DONE, TASK_INDEX, agents, agentsResponse, emptyPrsResponse, mergedPrs, openPrs, prsResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const responses = () => ({ "dev.prs.list": prsResponse, "team.agents.list": agentsResponse });

describe("PullRequestsScreen", () => {
  it("lists open PRs with their merge-queue status and the merged PRs with links", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PullRequestsScreen {...props} />);
    const open = await screen.findByRole("grid", { name: "Open pull requests" });
    expect(within(open).getAllByRole("row")).toHaveLength(openPrs.length + 1);
    expect(within(open).getByText("In review")).toBeTruthy();
    expect(within(open).getByText("In merge queue")).toBeTruthy();
    expect(within(open).getByText(`agent/${TASK_INDEX}`)).toBeTruthy();
    expect(within(open).getAllByText("Deploying…")).toHaveLength(2);
    expect(within(open).getByRole("link", { name: "Pike" })).toBeTruthy();
    expect(screen.getByTestId("pr-counts").textContent).toBe("1 in review · 1 in the merge queue");

    const merged = screen.getByRole("grid", { name: "Merged pull requests" });
    expect(within(merged).getByRole("link", { name: "#41" }).getAttribute("href")).toBe(mergedPrs[0]!.url);
    expect(within(merged).getByText("Pike (integration agent)")).toBeTruthy();
    expect(within(merged).getByText("+120")).toBeTruthy();
    expect(within(merged).getByText("a1b2c3d")).toBeTruthy();
  });

  it("fills in preview links from deploy.succeeded events and refetches on pr.merged", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PullRequestsScreen {...props} />);
    const open = await screen.findByRole("grid", { name: "Open pull requests" });
    act(() => fake.emit({ type: "deploy.succeeded", payload: { taskId: TASK_BUNDLE, environment: "preview", provider: "vercel", url: "https://bundle-picker.preview.example", commitSha: "deadbeef0", branch: `agent/${TASK_BUNDLE}` } }));
    await waitFor(() => expect(within(open).getByRole("link", { name: /Open preview/ }).getAttribute("href")).toBe("https://bundle-picker.preview.example"));
    expect(within(open).getAllByText("Deploying…")).toHaveLength(1);
    act(() => fake.emit({ type: "pr.merged", payload: { taskId: TASK_BUNDLE } }));
    expect(fake.refetches["dev.prs.list"]).toBe(1);
  });

  it("navigates to the task from a row and opens the Claude Code export from the context menu", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: { ...responses(), "dev.tasks.openInClaudeCode": { branch: `agent/${TASK_INDEX}`, checkout: "git checkout x", contextMd: "# x", agent: null } } });
    renderScreen(fake, <PullRequestsScreen {...props} />);
    const open = await screen.findByRole("grid", { name: "Open pull requests" });
    fireEvent.contextMenu(within(open).getByText("Usage index for the Ledgerly dashboard"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Open preview" }).getAttribute("aria-disabled")).toBe("true");
    await user.click(within(menu).getByRole("menuitem", { name: "Show in Plan" }));
    expect(fake.navigations[0]).toBe(`/b/${BUSINESS_ID}/d/development/plan?task=${TASK_INDEX}`);
    fireEvent.contextMenu(within(open).getByText("Usage index for the Ledgerly dashboard"));
    await user.click(await screen.findByRole("menuitem", { name: "Open in Claude Code" }));
    expect(await screen.findByRole("dialog", { name: "Open in Claude Code" })).toBeTruthy();
    expect(fake.queried.get("dev.tasks.openInClaudeCode")).toEqual({ taskId: TASK_INDEX });
  });

  it("shows the empty, loading and error states", async () => {
    const empty = renderScreen(createFakeSource({ responses: { ...responses(), "dev.prs.list": emptyPrsResponse } }), <PullRequestsScreen {...props} />);
    expect(await screen.findByText(/Pull requests appear here/)).toBeTruthy();
    expect(screen.getByText(/Merged pull requests are listed here/)).toBeTruthy();
    empty.unmount();
    const loading = renderScreen(createFakeSource({ responses: { "team.agents.list": agentsResponse } }), <PullRequestsScreen {...props} />);
    expect(loading.container.querySelectorAll('[data-state="loading"]').length).toBe(2);
    loading.unmount();
    const failing = createFakeSource({ responses: { ...responses(), "dev.prs.list": new Error("github unavailable") } });
    renderScreen(failing, <PullRequestsScreen {...props} />);
    expect((await screen.findAllByText("github unavailable")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["dev.prs.list"]).toBe(1);
  });
});

describe("row builders", () => {
  it("toOpenRows resolves agents and previews by branch or task id", () => {
    const rows = toOpenRows(openPrs, new Map(agents.map((a) => [a.id, a])), new Map([[TASK_BUNDLE, "https://p.example"]]));
    expect(rows.find((r) => r.taskId === TASK_BUNDLE)).toMatchObject({ agentName: "Juno", queue: "In merge queue", previewUrl: "https://p.example" });
    expect(rows.find((r) => r.taskId === TASK_INDEX)).toMatchObject({ agentName: "Pike", queue: "In review", previewUrl: null });
  });
  it("toMergedRows labels PRs and who merged them", () => {
    const rows = toMergedRows([...mergedPrs, { eventId: "e2", occurredAt: "2026-10-05T10:00:00Z", taskId: TASK_DONE, mergedBy: { kind: "user", id: "u-1" } }]);
    expect(rows[0]).toMatchObject({ prLabel: "#41", mergedByName: "Pike (integration agent)" });
    expect(rows[1]).toMatchObject({ prLabel: "e2", mergedByName: "A staff member" });
  });
  it("previewFromEvent only reads preview deploys", () => {
    expect(previewFromEvent({ type: "deploy.succeeded", payload: { environment: "production", url: "https://x" } })).toBeNull();
    expect(previewFromEvent({ type: "deploy.succeeded", payload: { environment: "preview", url: "https://x", branch: "agent/t" } })).toEqual({ branch: "agent/t", taskId: null, url: "https://x" });
    expect(previewFromEvent({ type: "task.started", payload: {} })).toBeNull();
  });
});
