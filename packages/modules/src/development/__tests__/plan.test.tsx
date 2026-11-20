import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createAgentPersonaApi } from "@foundmill/dugout";
import { PLAN_VIEWS, PlanScreen, toPlanRows, withRunColumn } from "../PlanScreen";
import { ReassignDialog } from "../dialogs";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { AGENT_JUNO, ROADMAP_ITEM, TASK_BUNDLE, TASK_DONE, TASK_INDEX, TASK_PLAYWRIGHT, TASK_RATE, agents, agentsResponse, edges, emptyTasksResponse, roadmapResponse, tasks, tasksResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const responses = () => ({ "dev.tasks.list": tasksResponse, "product.roadmap.list": roadmapResponse, "team.agents.list": agentsResponse });
/** Nothing waits on anything: every open task can run now. */
const freeResponses = () => ({ ...responses(), "dev.tasks.list": { ...tasksResponse, edges: [] } });

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
    // The Run column: running tasks say so, a task behind an open dependency says what it runs after.
    expect(within(table).getAllByRole("img", { name: "Running now" })).toHaveLength(2);
    expect(within(table).getByRole("img", { name: "Runs after Add a bundle picker to the product page finishes" })).toBeTruthy();
    expect(within(table).getByRole("img", { name: "Runs after Usage index for the Ledgerly dashboard finishes" })).toBeTruthy();
    expect(within(table).getByRole("img", { name: "In review" })).toBeTruthy();
    expect(within(table).getByRole("img", { name: "Done" })).toBeTruthy();
    // Kinds read as words, never the API's keys.
    expect(within(table).getAllByText("Code").length).toBe(5);
    expect(within(table).getByText("Specialist")).toBeTruthy();
    expect(within(table).queryByText("specialist")).toBeNull();
    expect(screen.getByTestId("plan-counts").textContent).toBe("3 in progress · 1 ready · 1 done");
    // The footer names both paths to a task's actions, never right-click alone (D6).
    expect(screen.getByText(/Use the … button or right-click a task for Start, Pause, Reassign, use the strongest model, Stop and Open in Claude Code/)).toBeTruthy();
    expect(screen.queryByText("Hard")).toBeNull();
    expect(fake.queried.get("dev.tasks.list")).toEqual({ limit: 500 });
    expect(PLAN_VIEWS.map((v) => v.id)).toEqual(["simple", "all", "ready", "in-progress", "blocked", "done"]);
    expect(screen.getByText("All tasks")).toBeTruthy();
  });

  it("guidance on: opens on the Simple view (Task, Run, Status, Agent, Progress) with the defined words on the panels (UX plan §7.10)", () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PlanScreen {...props} />, {}, { guidance: "on" });
    const table = screen.getByRole("grid", { name: "Tasks" });
    expect(screen.getByRole("button", { name: /^View: Simple/ })).toBeTruthy();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Task", "Run", "Status", "Agent", "Progress", "Actions"]);
    expect(within(table).getAllByRole("row")).toHaveLength(tasks.length + 1);
    // Nothing here asks the founder for a task graph: the panels say tasks and plan.
    expect(screen.queryByRole("button", { name: "Task graph" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plan something sooner" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/task graph/i);
    expect(screen.getByRole("button", { name: "About Dependencies" })).toBeTruthy();
    // Roadmap is defined by the planner field's help tip, never a Term button inside its <label>.
    expect(document.querySelector("label button")).toBeNull();
    expect(screen.getByRole("button", { name: "About Roadmap item" })).toBeTruthy();
  });

  it("guidance off: opens on All tasks, the words are plain and the help tip is gone", () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <PlanScreen {...props} />);
    expect(screen.getByRole("button", { name: /^View: All tasks/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Task graph" })).toBeNull();
    expect(screen.queryByRole("button", { name: "About Dependencies" })).toBeNull();
  });

  it("reopens on the view the person left it on and saves a change of view (audit #204)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: { ...responses(), "founder.tableViews.get": { views: PLAN_VIEWS, activeViewId: "done" } } });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    expect(fake.queried.get("founder.tableViews.get")).toEqual({ tableKey: "development.plan" });
    expect(screen.getByRole("button", { name: /^View: Done/ })).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(tasks.filter((t) => ["done", "failed", "stopped"].includes(t.status)).length + 1);
    await user.click(screen.getByRole("button", { name: /^View: Done/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /All tasks/ }));
    expect(fake.mutations.at(-1)).toMatchObject({ path: "founder.tableViews.save", input: { tableKey: "development.plan", activeViewId: "all" } });
  });

  it("plans a roadmap item into tasks sooner through dev.tasks.plan", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({ tasks: tasks.slice(0, 2), graph: { tasks: tasks.slice(0, 2), edges }, costMinor: 120, costLabel: "Estimate" }) });
    renderScreen(fake, <PlanScreen {...props} />);
    await screen.findByRole("grid", { name: "Tasks" });
    expect(screen.getByTestId("plan-sooner-hint").textContent).toBe("The team plans the roadmap's Now items into tasks on its own, round of work by round of work. Use this to plan one item or an objective ahead of that.");
    const build = screen.getByRole("button", { name: "Plan the tasks" });
    expect(build).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("combobox", { name: "Roadmap item" }));
    await user.click(await screen.findByRole("option", { name: /Bundles and gifting/ }));
    expect(build).toHaveProperty("disabled", false);
    await user.click(build);
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.plan", input: { roadmapItemId: ROADMAP_ITEM } }));
    expect(await screen.findByText("Planned 2 tasks")).toBeTruthy();
    expect(fake.refetches["dev.tasks.list"]).toBe(1);
  });

  it("plans from an objective alone", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({ tasks: [], graph: { tasks: [], edges: [] }, costMinor: 0, costLabel: "Estimate" }) });
    renderScreen(fake, <PlanScreen {...props} />);
    await screen.findByRole("grid", { name: "Tasks" });
    await user.type(screen.getByLabelText("Objective"), "Rate-limit the public API");
    await user.click(screen.getByRole("button", { name: "Plan the tasks" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.plan", input: { goal: "Rate-limit the public API" } }));
  });

  it("shows the dependency view for the opened task and says it runs after its open dependency", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({ session: { id: "s" }, workflow: { queued: true } }) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    expect(screen.getByText(/Select a task/)).toBeTruthy();
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    const graph = await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(within(graph).getByRole("button", { name: /Add a bundle picker to the product page, Running/ })).toBeTruthy();
    expect(within(graph).queryByRole("button", { name: /Rate-limit the public API/ })).toBeNull();
    // The branch and file scope are plumbing: they sit behind the "Technical" disclosure (UX plan §7.12, C11).
    const technical = screen.getByTestId("task-technical");
    expect(technical.querySelector("summary")!.textContent).toContain("Technical");
    expect(within(technical).getByText(`agent/${TASK_PLAYWRIGHT}`)).toBeTruthy();
    expect(within(technical).getByText("File scope")).toBeTruthy();
    // Its dependency is running, so it cannot start yet: the Next row says what it waits for and Start is off (same rule as the API).
    expect(screen.getByText("Runs after Add a bundle picker to the product page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
  });

  it("runs a task from the Run column, the Next row and Start, with no agent needed", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: freeResponses(), onMutate: () => ({ session: { id: "s" }, workflow: { queued: true } }) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    // Planned, ready and free: two Play buttons in the column, one per startable task ("Rate-limit" has no agent).
    const runButtons = within(table).getAllByRole("button", { name: "Run now" });
    expect(runButtons).toHaveLength(2);
    expect(fake.mutations).toEqual([]);
    const rateRow = within(table).getByText("Rate-limit the public API").closest("[role=row]") as HTMLElement;
    await user.click(within(rateRow).getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.start", input: { taskId: TASK_RATE } }));
    // A press on the button is not a row selection.
    expect(screen.getByText(/Select a task/)).toBeTruthy();
    // The panel: "Next" with the button beside it, and Start.
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(screen.getByRole("button", { name: "Start" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.start", input: { taskId: TASK_PLAYWRIGHT } }));
  });

  it("says when tasks cannot start because the orchestrator is not reachable, and offers no Start (first-time founder report, Nov 8, 2026)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: { ...freeResponses(), "business.get": { productStage: "building", orchestrator: { reachable: false } } }, onMutate: () => ({}) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    const banner = await screen.findByTestId("plan-orchestrator-banner");
    expect(banner.textContent).toMatch(/Tasks cannot start right now/);
    expect(banner.textContent).toMatch(/The orchestrator is not reachable from this server/);
    // No Run button in the column, Start off in the row menu and the panel; nothing is sent.
    expect(within(table).queryByRole("button", { name: "Run now" })).toBeNull();
    await user.click(within(table).getByRole("button", { name: "Actions for Rate-limit the public API" }));
    const menu = await screen.findByRole("menu", { name: "Row actions" });
    expect(within(menu).getByRole("menuitem", { name: "Start" }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(screen.getByRole("button", { name: "Start" })).toHaveProperty("disabled", true);
    expect(fake.mutations).toEqual([]);
    // Unknown reachability (the api has not probed yet) offers Start as before.
    const unknown = createFakeSource({ responses: { ...freeResponses(), "business.get": { productStage: "building", orchestrator: { reachable: null } } }, onMutate: () => ({}) });
    const second = renderScreen(unknown, <PlanScreen {...props} />);
    const again = (await screen.findAllByRole("grid", { name: "Tasks" })).at(-1)!;
    expect(within(again).getAllByRole("button", { name: "Run now" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId("plan-orchestrator-banner")).toHaveLength(1);
    second.unmount();
  });

  it("resumes a paused task from its Run button", async () => {
    const user = userEvent.setup();
    const paused = tasks.map((t) => (t.id === TASK_BUNDLE ? { ...t, status: "paused" as const } : t));
    const fake = createFakeSource({ responses: { ...responses(), "dev.tasks.list": { ...tasksResponse, items: paused } }, onMutate: () => ({}) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    await user.click(within(table).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.resume", input: { taskId: TASK_BUNDLE } }));
  });

  it("the … button opens the row menu, and Start follows the API's rule (no agent needed, never behind an open dependency)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: freeResponses(), onMutate: () => ({}) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    await user.click(within(table).getByRole("button", { name: "Actions for Rate-limit the public API" }));
    const menu = await screen.findByRole("menu", { name: "Row actions" });
    // Planned, unassigned, nothing to wait for: Start is on.
    expect(within(menu).getByRole("menuitem", { name: "Start" }).getAttribute("aria-disabled")).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: "Start" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.start", input: { taskId: TASK_RATE } }));
    // Review and done tasks cannot start.
    await user.click(within(table).getByRole("button", { name: "Actions for Usage index for the Ledgerly dashboard" }));
    expect((await screen.findByRole("menuitem", { name: "Start" })).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await user.click(within(table).getByRole("button", { name: "Actions for Sitemap and canonical fixes" }));
    expect((await screen.findByRole("menuitem", { name: "Start" })).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("Start is off for a task behind an open dependency, in the row menu too", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({}) });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    await user.click(within(table).getByRole("button", { name: "Actions for Playwright coverage for checkout" }));
    expect((await screen.findByRole("menuitem", { name: "Start" })).getAttribute("aria-disabled")).toBe("true");
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
    expect(within(menu2).getByRole("menuitem", { name: "Use the strongest model" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(menu2).queryByRole("menuitem", { name: "Upgrade to Opus" })).toBeNull();
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

  it("never offers a background helper in the reassign picker: helpers never take tasks (Leads first)", async () => {
    const user = userEvent.setup();
    const helper = { ...agents[2]!, id: "helper-1", name: "Entity linker", role: "Linking utility", layer: "utility", agentType: "entity_linker" };
    renderScreen(createFakeSource({ responses: responses() }), <ReassignDialog open onOpenChange={() => {}} taskTitle="Ship it" currentAgentId={AGENT_JUNO} agents={[...agents, helper]} onConfirm={() => {}} />);
    await user.click(screen.getByRole("combobox", { name: "New agent" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent ?? "");
    expect(options.some((o) => o.includes("Wren"))).toBe(true);
    expect(options.some((o) => o.includes("Entity linker"))).toBe(false);
  });

  it("surfaces a failed mutation inline and keeps the table", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: freeResponses(), onMutate: () => Promise.reject(new Error("Assign an agent before starting the task")) });
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

describe("PlanScreen › Result (WP-05 T7)", () => {
  const report = { id: "r-1", title: "Sitemap: what changed", bodyMd: "Fixed **three** canonical tags.", sources: [{ url: "https://example.com/sitemap", title: "Sitemap guide" }], simulated: true, createdAt: "2026-10-06T15:00:00Z" };
  const withReport = () => ({ ...freeResponses(), "dev.tasks.get": (input?: Record<string, unknown>) => ({ report: input?.taskId === TASK_DONE ? report : null }) });

  it("shows a finished task's result: title, body, sources, and the simulated notice", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: withReport() });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    expect(screen.queryByTestId("task-result")).toBeNull();
    await user.click(within(table).getByText("Sitemap and canonical fixes"));
    const panel = await screen.findByTestId("task-result");
    expect(within(panel).getByRole("heading", { name: "Result" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Sitemap: what changed" })).toBeTruthy();
    expect(within(panel).getByText("Simulated: sample data, nothing real was read")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /Sitemap guide/ }).getAttribute("href")).toBe("https://example.com/sitemap");
    expect(fake.queried.get("dev.tasks.get")).toEqual({ taskId: TASK_DONE });
  });

  it("asks for no result while a task has not finished, and shows no panel without one", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: withReport() });
    renderScreen(fake, <PlanScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(fake.queried.has("dev.tasks.get")).toBe(false);
    expect(screen.queryByTestId("task-result")).toBeNull();
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

  it("names the agent field as the cell shows it, so sort, filter and CSV follow the reader's preference (One name everywhere)", () => {
    const withKey = agents.map((a) => (a.id === AGENT_JUNO ? { ...a, personaKey: "malik" } : a));
    const persona = createAgentPersonaApi({ anthropomorphic: true });
    const juno = withKey.find((a) => a.id === AGENT_JUNO)!;
    const rows = toPlanRows(tasks, edges, new Map(withKey.map((a) => [a.id, a])), persona.labelFor);
    expect(rows.find((r) => r.id === TASK_PLAYWRIGHT)!.agentName).toBe(`Malik (${juno.role || juno.name})`);
    expect(rows.find((r) => r.id === TASK_RATE)?.agentName).toBe("Unassigned");
  });

  it("lists the dependencies that are not done yet as what a task waits on", () => {
    const rows = toPlanRows(tasks, edges, new Map());
    expect(rows.find((r) => r.id === TASK_PLAYWRIGHT)?.waitingOn).toEqual(["Add a bundle picker to the product page"]);
    expect(rows.find((r) => r.id === TASK_BUNDLE)?.waitingOn).toEqual([]);
    // A finished dependency is not waited on; neither is one the list does not hold.
    const doneDep = tasks.map((t) => (t.id === TASK_BUNDLE ? { ...t, status: "done" as const } : t));
    expect(toPlanRows(doneDep, edges, new Map()).find((r) => r.id === TASK_PLAYWRIGHT)?.waitingOn).toEqual([]);
    expect(toPlanRows(tasks, [{ fromTask: "missing", toTask: TASK_RATE }], new Map()).find((r) => r.id === TASK_RATE)?.waitingOn).toEqual([]);
  });
});

describe("withRunColumn", () => {
  it("puts Run after Task in every built-in view, and in a view saved before the column existed", () => {
    for (const v of PLAN_VIEWS) expect(v.columns.slice(0, 2)).toEqual(["title", "run"]);
    const old = { id: "mine", name: "Mine", columns: ["title", "status"], sort: [], filters: [] };
    expect(withRunColumn([old])[0]?.columns).toEqual(["title", "run", "status"]);
    expect(withRunColumn(PLAN_VIEWS)).toEqual(PLAN_VIEWS);
  });
});
