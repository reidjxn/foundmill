import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WageBillScreen, readAgents, wageBillRows } from "../WageBillScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { AGENT, BID, agents, agentsResponse, dataResponses, emptyResponses, tasksDone, wages } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

describe("wageBillRows", () => {
  it("joins usage, agents and completed tasks per agent for the period", () => {
    const rows = wageBillRows(wages.rows, readAgents(agentsResponse), tasksDone.items, "2026-10");
    expect(rows.map((r) => r.name)).toEqual(["Atlas", "Nova", "Pip"]);
    const atlas = rows[0]!;
    expect(atlas).toMatchObject({ costMinor: 42_000, capMinor: 50_000, capUsedPct: 84, tasksDone: 3, outputPerHundred: 0.71, modelKey: "opus", role: "Engineering lead" });
    expect(rows[1]).toMatchObject({ name: "Nova", costMinor: 12_500, capUsedPct: 31.3, tasksDone: 0, outputPerHundred: 0 });
    expect(rows[2]).toMatchObject({ name: "Pip", costMinor: 0, capMinor: null, capUsedPct: null, outputPerHundred: null });
    expect(readAgents(agents)).toHaveLength(3);
    expect(readAgents(undefined)).toEqual([]);
  });
});

describe("WageBillScreen", () => {
  it("renders the summary tiles, the squad table with caps and output per euro, and the staff panel", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <WageBillScreen {...props} />);
    expect(fake.queried.get("finance.wages")).toEqual({ period: "2026-10" });
    expect(fake.queried.get("dev.tasks.list")).toEqual({ status: "done", limit: 500 });
    expect(fake.queried.get("finance.pnl")).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    const strip = screen.getByRole("region", { name: "Wage bill summary" });
    expect(within(strip).getByText("Squad wage bill").parentElement!.parentElement!.textContent).toContain("€545.00"); // 420 + 125 + 5 (unattributed)
    expect(within(strip).getByText("Human payroll").parentElement!.parentElement!.textContent).toContain("€16K");
    expect(within(strip).getByText("Total wage bill").parentElement!.parentElement!.textContent).toContain("€17K"); // €16,545 compacted
    expect(within(strip).getAllByText("Estimate").length).toBe(4);

    const table = screen.getByRole("grid", { name: "Squad wage bill" });
    expect(within(table).getByRole("link", { name: /Atlas/ }).getAttribute("href")).toBe(`/b/${BID}/agents/${AGENT.atlas}/overview`);
    expect(within(table).getByText("84%")).toBeTruthy();
    expect(within(table).getByText("Uncapped")).toBeTruthy();
    expect(within(table).getByText("0.71")).toBeTruthy();
    expect(within(table).getByText("opus")).toBeTruthy();
    expect(screen.getByText("1 near or over cap")).toBeTruthy();
    const staff = screen.getByRole("region", { name: "Staff" });
    expect(within(staff).getByRole("link", { name: /Mara Lindqvist/ })).toBeTruthy();
    expect(within(staff).getByText("owner")).toBeTruthy();
    expect(within(staff).getByText(/Payroll €16,000.00/)).toBeTruthy();
  });

  it("opens an agent from the right-click verbs and on Enter", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <WageBillScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Squad wage bill" });
    fireEvent.contextMenu(within(table).getByText("Full-stack engineer"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Adjust wage cap" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/agents/${AGENT.nova}/settings`);
  });

  it("shows the empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <WageBillScreen {...props} />);
    expect(screen.getByText("No agents hired yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open recruitment" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/team/recruitment`);
    unmount();

    const loading = createFakeSource({ businessId: BID });
    const { container, unmount: u2 } = renderScreen(loading, <WageBillScreen {...props} />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
    u2();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.wages": new Error("usage ledger offline") } });
    renderScreen(failing, <WageBillScreen {...props} />);
    expect(screen.getByText("usage ledger offline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failing.refetches["finance.wages"]).toBe(1);
  });
});
