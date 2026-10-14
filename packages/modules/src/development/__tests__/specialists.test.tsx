import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SpecialistsScreen, specialistTasks } from "../SpecialistsScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { AGENT_PIKE, SESSION_SOURCING, TASK_SOURCING, agentsResponse, departments, emptyTasksResponse, rawFrame, sessionsResponse, sourcingEvents, tasks, tasksResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const specialistResponse = { ...tasksResponse, items: tasks.filter((t) => t.kind === "specialist") };
const responses = () => ({ "dev.tasks.list": specialistResponse, "dev.sessions.list": sessionsResponse, "team.agents.list": agentsResponse, "department.list": departments });

describe("SpecialistsScreen", () => {
  it("renders a specialist tile per specialist task with the four specialist views", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <SpecialistsScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Specialist tiles" });
    const tile = within(grid).getByRole("article", { name: /Wren: Supplier brief for the serum pump/ });
    for (const name of ["RFQ funnel", "Quotes", "Samples", "Shipments"]) expect(within(tile).getByRole("tab", { name })).toBeTruthy();
    expect(within(tile).queryByRole("tab", { name: "Terminal" })).toBeNull();
    // Nothing in the funnel yet: the tile says so in its own state, over its own task (no generic line shared by every tile).
    expect(within(tile).getByText("No supplier records yet")).toBeTruthy();
    expect(within(tile).getByText("Wren on Supplier brief for the serum pump.")).toBeTruthy();
    expect(fake.queried.get("dev.tasks.list")).toEqual({ kind: "specialist", limit: 200 });
    expect(fake.subscriberCount(`as:${SESSION_SOURCING}`)).toBe(1);
    expect(screen.getByTestId("specialist-counts").textContent).toBe("1 specialist · 1 task · 1 running · 0 reporting");
    expect(screen.getByText("Human gate on every purchase order")).toBeTruthy();
  });

  it("collapses finished specialists with no supplier records into one message and a list, never empty tiles", async () => {
    const finished = { ...tasks[4]!, id: "sp-done", title: "Supplier quote comparison #1", status: "done" as const, startedAt: "2026-10-06T09:00:00Z", endedAt: "2026-10-06T11:20:00Z" };
    const fake = createFakeSource({ responses: { ...responses(), "dev.tasks.list": { ...specialistResponse, items: [...specialistResponse.items, finished] } } });
    renderScreen(fake, <SpecialistsScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Specialist tiles" });
    expect(within(grid).getAllByRole("article")).toHaveLength(1);
    expect(within(grid).queryByRole("article", { name: /Supplier quote comparison/ })).toBeNull();
    const quiet = screen.getByTestId("specialists-quiet");
    expect(within(quiet).getByText("1 finished specialist task left no supplier records")).toBeTruthy();
    const list = within(quiet).getByRole("table", { name: "Finished specialist tasks" });
    expect(within(list).getByText("Supplier quote comparison #1")).toBeTruthy();
    expect(within(list).getByText("Done")).toBeTruthy();
    expect(within(list).getByText("2h 20m")).toBeTruthy();
    expect(screen.getByTestId("specialist-counts").textContent).toBe("1 specialist · 2 tasks · 1 running · 0 reporting");
  });

  it("counts specialists as distinct agents, not tasks (TPD-22)", async () => {
    const more = [1, 2, 3].map((n) => ({ ...tasks[4]!, id: `sp-done-${n}`, title: `Quote comparison #${n}`, status: "done" as const, startedAt: "2026-10-06T09:00:00Z", endedAt: "2026-10-06T10:00:00Z" }));
    const other = { ...tasks[4]!, id: "sp-pike", title: "Landed cost model", assigneeAgentId: AGENT_PIKE, status: "done" as const, startedAt: "2026-10-06T09:00:00Z", endedAt: "2026-10-06T10:00:00Z" };
    const fake = createFakeSource({ responses: { ...responses(), "dev.tasks.list": { ...specialistResponse, items: [...specialistResponse.items, ...more, other] } } });
    renderScreen(fake, <SpecialistsScreen {...props} />);
    await screen.findByRole("region", { name: "Specialist tiles" });
    expect(screen.getByTestId("specialist-counts").textContent).toBe("2 specialists · 5 tasks · 1 running · 0 reporting");
  });

  it("lists ready specialist tasks that never started as not started, never as finished (AC-11)", async () => {
    const ready = [1, 2].map((n) => ({ ...tasks[4]!, id: `sp-ready-${n}`, title: `Stability data request #${n}`, status: "ready" as const, progress: "0", phase: null, startedAt: null }));
    const fake = createFakeSource({ responses: { ...responses(), "dev.tasks.list": { ...specialistResponse, items: ready } } });
    renderScreen(fake, <SpecialistsScreen {...props} />);
    const waiting = await screen.findByTestId("specialists-waiting");
    expect(within(waiting).getByText("2 specialist tasks have not started yet")).toBeTruthy();
    const list = within(waiting).getByRole("table", { name: "Specialist tasks not started" });
    expect(within(list).getByText("Stability data request #1")).toBeTruthy();
    expect(within(list).getAllByText("Ready")).toHaveLength(2);
    expect(screen.queryByTestId("specialists-quiet")).toBeNull();
    expect(screen.queryByText(/finished specialist task/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Specialist tiles" })).toBeNull();
    expect(screen.getByTestId("specialist-counts").textContent).toBe("1 specialist · 2 tasks · 0 running · 0 reporting");
  });

  it("fills the funnel, quotes, samples and shipments from the session's structured notes", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <SpecialistsScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Specialist tiles" });
    act(() => {
      for (const e of sourcingEvents()) fake.emit(rawFrame(e), `as:${SESSION_SOURCING}`);
    });
    const tile = () => within(grid).getByRole("article", { name: /Wren: Supplier brief/ });
    await waitFor(() => expect(within(tile()).getByText("RFQ sent")).toBeTruthy());
    expect(within(tile()).getByText("40")).toBeTruthy();
    expect(screen.getByTestId("specialist-counts").textContent).toContain("1 reporting");
    await user.click(within(tile()).getByRole("tab", { name: "Quotes" }));
    expect(within(tile()).getByText("Baltic Pack OÜ")).toBeTruthy();
    expect(within(tile()).getByText("Shortlisted")).toBeTruthy();
    await user.click(within(tile()).getByRole("tab", { name: "Samples" }));
    expect(within(tile()).getByText("Shipped")).toBeTruthy();
    await user.click(within(tile()).getByRole("tab", { name: "Shipments" }));
    expect(within(tile()).getByText("NWS-2026-017")).toBeTruthy();
    expect(within(tile()).getByText("In transit")).toBeTruthy();
    expect(within(tile()).getAllByText("Estimate").length).toBeGreaterThanOrEqual(2);
  });

  it("routes the tile controls to the dev.tasks procedures", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses(), onMutate: () => ({}) });
    renderScreen(fake, <SpecialistsScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Specialist tiles" });
    const tile = within(grid).getByRole("article", { name: /Wren: Supplier brief/ });
    await user.click(within(tile).getByRole("button", { name: "Pause" }));
    expect(fake.mutations).toContainEqual({ path: "dev.tasks.pause", input: { taskId: TASK_SOURCING } });
    await user.click(within(tile).getByRole("button", { name: "Nudge Wren" }));
    await user.click(await screen.findByRole("menuitem", { name: /Simplify/ }));
    expect(fake.mutations).toContainEqual({ path: "dev.tasks.shout", input: { taskId: TASK_SOURCING, preset: "Simplify" } });
  });

  it("shows the empty, loading and error states", async () => {
    const empty = createFakeSource({ responses: { ...responses(), "dev.tasks.list": emptyTasksResponse } });
    const e = renderScreen(empty, <SpecialistsScreen {...props} />);
    expect(await screen.findByText("No specialists at work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Plan" }));
    expect(empty.navigations[0]).toBe(`/b/${BUSINESS_ID}/d/development/plan`);
    e.unmount();
    const loading = renderScreen(createFakeSource({ responses: { "team.agents.list": agentsResponse } }), <SpecialistsScreen {...props} />);
    expect(loading.container.querySelector('[data-state="loading"]')).not.toBeNull();
    loading.unmount();
    renderScreen(createFakeSource({ responses: { ...responses(), "dev.tasks.list": new Error("tasks unavailable") } }), <SpecialistsScreen {...props} />);
    expect(await screen.findByText("tasks unavailable")).toBeTruthy();
  });
});

describe("specialistTasks", () => {
  it("keeps specialist tasks only, live first, and drops planned ones", () => {
    const rows = specialistTasks([...tasks, { ...tasks[4]!, id: "sp-done", status: "done", startedAt: "2026-10-01T00:00:00Z" }, { ...tasks[4]!, id: "sp-planned", status: "planned" }]);
    expect(rows.map((t) => t.id)).toEqual([TASK_SOURCING, "sp-done"]);
  });
});
