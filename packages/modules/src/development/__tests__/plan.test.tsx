import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PLAN_VIEWS, PlanScreen, toPlanRows } from "../PlanScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { AGENT_JUNO, ROADMAP_ITEM, TASK_BUNDLE, TASK_INDEX, TASK_PLAYWRIGHT, TASK_RATE, agents, agentsResponse, edges, emptyTasksResponse, roadmapResponse, tasks, tasksResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const responses = () => ({ "dev.tasks.list": tasksResponse, "product.roadmap.list": roadmapResponse, "team.agents.list": agentsResponse });

describe("PlanScreen", () => {
  it("lists every task with status pills, agents and dependencies, and offers the saved views", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    expect(within(table).getAllByRole("row")).toHaveLength(tasks.length + 1);
    expect(within(table).getByText("Add a bundle picker to the product page", { selector: ".text-body-strong" })).toBeTruthy();
    expect(within(table).getAllByText("Running")).toHaveLength(2);
    expect(within(table).getByText("Review")).toBeTruthy();
    expect(within(table).getAllByRole("link", { name: "Pike" })).toHaveLength(2);
    expect(within(table).getByText("Unassigned")).toBeTruthy();
    expect(screen.getByTestId("plan-counts").textContent).toBe("3 in progress · 1 ready · 1 done");
    expect(fake.queried.get("dev.tasks.list")).toEqual({ limit: 500 });
    expect(PLAN_VIEWS.map((v) => v.id)).toEqual(["all", "ready", "in-progress", "blocked", "done"]);
    expect(screen.getByText("All tasks")).toBeTruthy();
  });

  it("builds the task graph from a roadmap item through dev.tasks.plan", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({ tasks: tasks.slice(0, 2), graph: { tasks: tasks.slice(0, 2), edges }, costMinor: 120, costLabel: "Estimate" }) });
    renderScreen(fake, <PlanScreen {...props} />);
    await screen.findByRole("grid", { name: "Tasks" });
    const build = screen.getByRole("button", { name: "Build task graph" });
    expect(build).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("combobox", { name: "Roadmap item" }));
    await user.click(await screen.findByRole("option", { name: /Bundles and gifting/ }));
    expect(build).toHaveProperty("disabled", false);
    await user.click(build);
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.plan", input: { roadmapItemId: ROADMAP_ITEM } }));
    expect(await screen.findByText("Planned 2 tasks")).toBeTruthy();
    expect(fake.refetches["dev.tasks.list"]).toBe(1);
  });

  it("plans from a goal alone", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({ tasks: [], graph: { tasks: [], edges: [] }, costMinor: 0, costLabel: "Estimate" }) });
    renderScreen(fake, <PlanScreen {...props} />);
    await screen.findByRole("grid", { name: "Tasks" });
    await user.type(screen.getByLabelText("Goal"), "Rate-limit the public API");
    await user.click(screen.getByRole("button", { name: "Build task graph" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.plan", input: { goal: "Rate-limit the public API" } }));
  });

  it("shows the dependency view for the opened task and starts a ready task", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({ session: { id: "s" }, workflow: { queued: true } }) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    expect(screen.getByText(/Select a task/)).toBeTruthy();
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    const graph = await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(within(graph).getByRole("button", { name: /Add a bundle picker to the product page, Running/ })).toBeTruthy();
    expect(within(graph).queryByRole("button", { name: /Rate-limit the public API/ })).toBeNull();
    expect(screen.getByText(`agent/${TASK_PLAYWRIGHT}`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.start", input: { taskId: TASK_PLAYWRIGHT } }));
  });

  it("offers the right-click verbs and routes them to the procedures", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({}) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    fireEvent.contextMenu(within(table).getByText("Add a bundle picker to the product page", { selector: ".text-body-strong" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Start" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(menu).getByRole("menuitem", { name: "Open in Claude Code" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Pause" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.pause", input: { taskId: TASK_BUNDLE } }));

    fireEvent.contextMenu(within(table).getByText("Usage index for the Ledgerly dashboard", { selector: ".text-body-strong" }));
    const menu2 = await screen.findByRole("menu");
    expect(within(menu2).getByRole("menuitem", { name: "Upgrade to Opus" }).getAttribute("aria-disabled")).toBe("true");
    await user.click(within(menu2).getByRole("menuitem", { name: "Stop and discard" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop and discard" });
    await user.click(within(dialog).getByRole("button", { name: "Stop and discard" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.stop", input: { taskId: TASK_INDEX } }));
  });

  it("reassigns through the dialog", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({}) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    fireEvent.contextMenu(within(table).getByText("Add a bundle picker to the product page", { selector: ".text-body-strong" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog", { name: "Reassign task" });
    await user.click(within(dialog).getByRole("combobox", { name: "New agent" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).not.toContain(expect.stringContaining("Juno"));
    await user.click(screen.getByRole("option", { name: /Wren/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(fake.mutations.find((m) => m.path === "dev.tasks.reassign")?.input).toEqual({ taskId: TASK_BUNDLE, agentId: agents[2]!.id }));
  });

  it("surfaces a failed mutation inline and keeps the table", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => Promise.reject(new Error("Assign an agent before starting the task")) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    fireEvent.contextMenu(within(table).getByText("Playwright coverage for checkout"));
    await user.click(await screen.findByRole("menuitem", { name: "Start" }));
    expect(await screen.findByText("Assign an agent before starting the task")).toBeTruthy();
    expect(screen.getByRole("grid", { name: "Tasks" })).toBeTruthy();
  });

  it("shows the empty, loading and error states", async () => {
    const empty = createFakeSource({ responses: { ...responses(), "dev.tasks.list": emptyTasksResponse } });
    const r = empty && renderScreen(empty, <PlanScreen {...props} />);
    expect(await screen.findByText(/No tasks yet/)).toBeTruthy();
    r.unmount();
    const loading = renderScreen(createFakeSource({ responses: { "team.agents.list": agentsResponse } }), <PlanScreen {...props} />);
    expect(loading.container.querySelector('[data-state="loading"]')).not.toBeNull();
    loading.unmount();
    const failing = createFakeSource({ responses: { ...responses(), "dev.tasks.list": new Error("tasks unavailable") } });
    renderScreen(failing, <PlanScreen {...props} />);
    expect(await screen.findByText("tasks unavailable")).toBeTruthy();
  });

  it("refetches on task events", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PlanScreen {...props} />);
    await screen.findByRole("grid", { name: "Tasks" });
    act(() => fake.emit({ type: "task.started", payload: { taskId: TASK_RATE } }));
    expect(fake.refetches["dev.tasks.list"]).toBe(1);
  });
});

describe("toPlanRows", () => {
  it("resolves agent names, dependency titles and numeric progress", () => {
    const rows = toPlanRows(tasks, edges, new Map(agents.map((a) => [a.id, a])));
    const pw = rows.find((r) => r.id === TASK_PLAYWRIGHT)!;
    expect(pw.agentName).toBe("Juno");
    expect(pw.agent?.id).toBe(AGENT_JUNO);
    expect(pw.dependsOn).toEqual(["Add a bundle picker to the product page"]);
    expect(rows.find((r) => r.id === TASK_BUNDLE)?.blocks).toEqual(["Playwright coverage for checkout"]);
    expect(rows.find((r) => r.id === TASK_BUNDLE)?.progressNumber).toBe(35);
    expect(rows.find((r) => r.id === TASK_RATE)?.agentName).toBe("Unassigned");
  });
});
