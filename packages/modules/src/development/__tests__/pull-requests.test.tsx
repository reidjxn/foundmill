import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PullRequestsScreen, previewFromEvent, toMergedRows, toOpenRows } from "../PullRequestsScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { AGENT_PIKE, TASK_BUNDLE, TASK_DONE, TASK_INDEX, agents, agentsResponse, emptyPrsResponse, mergedPrs, openPrs, prsResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const responses = () => ({ "dev.prs.list": prsResponse, "team.agents.list": agentsResponse });

describe("PullRequestsScreen", () => {
  it("guidance on: what a pull request is, in the intro, and both tables open on their Simple view (UX plan §7.12)", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PullRequestsScreen {...props} />, {}, { guidance: "on" });
    const open = await screen.findByRole("grid", { name: "Open pull requests" });
    const explainer = document.querySelector("[data-explainer='development/pull-requests']") as HTMLElement;
    expect(within(explainer).getByText("A bundle of finished code waiting for review.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^View: Simple/ })).toHaveLength(2);
    expect(within(open).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Pull request", "Merge queue", "Agent", "Preview", "Actions"]);
    expect(screen.getByRole("button", { name: "Open pull requests" }).className).toContain("term-link");
  });

  it("lists open PRs with their merge-queue status and the merged PRs with links", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PullRequestsScreen {...props} />);
    const open = await screen.findByRole("grid", { name: "Open pull requests" });
    expect(within(open).getAllByRole("row")).toHaveLength(openPrs.length + 1);
    expect(within(open).getByText("In review")).toBeTruthy();
    expect(within(open).getByText("In merge queue")).toBeTruthy();
    expect(within(open).getByText(`agent/${TASK_INDEX}`)).toBeTruthy();
    expect(within(open).getAllByText("Awaiting deployment")).toHaveLength(2);
    expect(within(open).queryByText("Deploying…")).toBeNull();
    expect(within(open).getByRole("link", { name: "Pike" })).toBeTruthy();
    expect(screen.getByTestId("pr-counts").textContent).toBe("1 in review · 1 in the merge queue");
    // Guidance off: no intro, and the title is plain text, not a defined word.
    expect(document.querySelector("[data-explainer]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open pull requests" })).toBeNull();

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
    expect(within(open).getAllByText("Awaiting deployment")).toHaveLength(1);
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

  it("lists merges the merge queue landed without a GitHub event, with no invented line counts (TPD-14)", async () => {
    const queued = { eventId: null, source: "merge_queue" as const, occurredAt: "2026-10-07T09:00:00Z", taskId: TASK_BUNDLE, title: "Gift wrap option at checkout", branch: `agent/${TASK_BUNDLE}`, mergedBy: { kind: "agent", id: AGENT_PIKE } };
    renderScreen(createFakeSource({ responses: { ...responses(), "dev.prs.list": { open: [], merged: [queued, ...mergedPrs] } } }), <PullRequestsScreen {...props} />);
    const merged = await screen.findByRole("grid", { name: "Merged pull requests" });
    const row = within(merged).getByText("Gift wrap option at checkout").closest("[role='row']") as HTMLElement;
    expect(within(row).getByText("Pike")).toBeTruthy();
    expect(within(row).queryByText(/^\+/)).toBeNull();
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("2 merged")).toBeTruthy();
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
    // The founder's title is the row's title (0070); the technical one stays on the row for the developer's dialog.
    const titled = toOpenRows([{ ...openPrs[0]!, founderTitle: "Put the usage export live" }], new Map(), new Map());
    expect(titled[0]).toMatchObject({ title: "Put the usage export live", founderTitle: "Put the usage export live" });
    expect(toOpenRows([{ ...openPrs[0]!, founderTitle: null }], new Map(), new Map())[0]!.title).toBe(openPrs[0]!.title);
  });
  it("toMergedRows labels PRs and who merged them", () => {
    const rows = toMergedRows([...mergedPrs, { eventId: "e2", occurredAt: "2026-10-05T10:00:00Z", taskId: TASK_DONE, mergedBy: { kind: "user", id: "u-1" } }]);
    expect(rows[0]).toMatchObject({ prLabel: "#41", mergedByName: "Pike (integration agent)" });
    expect(rows[1]).toMatchObject({ prLabel: "e2", mergedByName: "A staff member" });
  });
  it("toMergedRows names the agent behind a merge the queue landed itself (TPD-14)", () => {
    const rows = toMergedRows([{ eventId: null, source: "merge_queue", occurredAt: "2026-10-05T10:00:00Z", taskId: TASK_DONE, title: "Sitemap", branch: `agent/${TASK_DONE}`, mergedBy: { kind: "agent", id: AGENT_PIKE } }], new Map(agents.map((a) => [a.id, a])));
    expect(rows[0]).toMatchObject({ id: `task:${TASK_DONE}`, prLabel: "—", mergedByName: "Pike", title: "Sitemap" });
    expect(toMergedRows([{ eventId: null, source: "merge_queue", occurredAt: "2026-10-05T10:00:00Z", taskId: TASK_DONE, mergedBy: { kind: "agent", id: "unknown" } }])[0]!.mergedByName).toBe("An agent");
    // A merge found on GitHub (made by hand there) is said so, never "Webhook".
    expect(toMergedRows([{ eventId: "e3", source: "github", occurredAt: "2026-10-05T10:00:00Z", taskId: TASK_DONE, prNumber: 44, mergedBy: { kind: "webhook", id: "github" } }])[0]).toMatchObject({ mergedByName: "Merged on GitHub", prLabel: "#44" });
  });
  it("toOpenRows never lists a non-code task as a pull request (TPD-13)", () => {
    const rows = toOpenRows([...openPrs, { taskId: "f-1", title: "Q3 investor update", status: "review", branch: "agent/f-1", agentId: null, kind: "finance" }], new Map(), new Map());
    expect(rows.map((r) => r.title)).not.toContain("Q3 investor update");
    expect(rows).toHaveLength(openPrs.length);
  });
  it("previewFromEvent only reads preview deploys", () => {
    expect(previewFromEvent({ type: "deploy.succeeded", payload: { environment: "production", url: "https://x" } })).toBeNull();
    expect(previewFromEvent({ type: "deploy.succeeded", payload: { environment: "preview", url: "https://x", branch: "agent/t" } })).toEqual({ branch: "agent/t", taskId: null, url: "https://x" });
    expect(previewFromEvent({ type: "task.started", payload: {} })).toBeNull();
  });
});
