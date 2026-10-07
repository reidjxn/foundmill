import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SpecialistsScreen, specialistTasks } from "../SpecialistsScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { SESSION_SOURCING, TASK_SOURCING, agentsResponse, departments, emptyTasksResponse, rawFrame, sessionsResponse, sourcingEvents, tasks, tasksResponse } from "./fixtures";

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
    expect(within(tile).getByText(/funnel fills as RFQs go out/)).toBeTruthy();
    expect(fake.queried.get("dev.tasks.list")).toEqual({ kind: "specialist", limit: 200 });
    expect(fake.subscriberCount(`as:${SESSION_SOURCING}`)).toBe(1);
    expect(screen.getByTestId("specialist-counts").textContent).toBe("1 specialists · 1 running · 0 reporting");
    expect(screen.getByText("Human gate on every purchase order")).toBeTruthy();
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
    await user.click(within(tile).getByRole("button", { name: "Shout to Wren" }));
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
