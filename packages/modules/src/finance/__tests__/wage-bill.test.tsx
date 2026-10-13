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

  it("accepts task dates as Date objects (superjson delivers them that way) without crashing", () => {
    const asDates = tasksDone.items.map((t) => ({ ...t, endedAt: t.endedAt ? (new Date(t.endedAt) as unknown as string) : t.endedAt, updatedAt: t.updatedAt ? (new Date(t.updatedAt) as unknown as string) : t.updatedAt }));
    const rows = wageBillRows(wages.rows, readAgents(agentsResponse), asDates, "2026-10");
    expect(rows.map((r) => r.tasksDone)).toEqual(wageBillRows(wages.rows, readAgents(agentsResponse), tasksDone.items, "2026-10").map((r) => r.tasksDone));
  });
});

describe("WageBillScreen", () => {
  it("renders the summary tiles, the team table with caps and output per euro, and the staff panel", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <WageBillScreen {...props} />);
    expect(fake.queried.get("finance.wages")).toEqual({ period: "2026-10" });
    expect(fake.queried.get("dev.tasks.list")).toEqual({ status: "done", limit: 500 });
    expect(fake.queried.get("finance.pnl")).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    const strip = screen.getByRole("region", { name: "Payroll summary" });
    expect(within(strip).getByText("Team payroll").parentElement!.parentElement!.textContent).toContain("€545.00"); // 420 + 125 + 5 (unattributed)
    expect(within(strip).getByText("Human payroll").parentElement!.parentElement!.textContent).toContain("€16K");
    expect(within(strip).getByText("Total payroll").parentElement!.parentElement!.textContent).toContain("€17K"); // €16,545 compacted
    expect(within(strip).getAllByText("Estimate").length).toBe(4);

    const table = screen.getByRole("grid", { name: "Team payroll" });
    expect(within(table).getByRole("link", { name: /Atlas/ }).getAttribute("href")).toBe(`/b/${BID}/agents/${AGENT.atlas}/overview`);
    expect(within(table).getByText("84%")).toBeTruthy();
    expect(within(table).getByText("Uncapped")).toBeTruthy();
    expect(within(table).getByText("0.71")).toBeTruthy();
    expect(within(table).queryByText("opus")).toBeNull(); // the model lives in the "Usage detail" view
    expect(screen.getByText("1 near or over cap")).toBeTruthy();
    const staff = screen.getByRole("region", { name: "Staff" });
    expect(within(staff).getByRole("link", { name: /Mara Lindqvist/ })).toBeTruthy();
    expect(within(staff).getByText("Owner")).toBeTruthy();
    expect(within(staff).getByText(/Payroll €16,000.00/)).toBeTruthy();
  });

  it("opens an agent from the right-click verbs and on Enter", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <WageBillScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Team payroll" });
    fireEvent.contextMenu(within(table).getByRole("link", { name: /Nova/ }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Adjust wage cap" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/agents/${AGENT.nova}/settings`);
  });

  it("shows the empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <WageBillScreen {...props} />);
    expect(screen.getByText("No agents hired yet")).toBeTruthy();
    // The department over the Team module is named and linked as the founder named it, never a hard-coded "Team".
    expect(screen.getByText(/Hire agents from People › Recruitment/)).toBeTruthy();
    expect(screen.getByText(/Invite staff from People › Staff/)).toBeTruthy();
    expect(screen.queryByText(/Team › /)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open recruitment" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/people/recruitment`);
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

  it("shows the team's cost in US dollars, keeps it apart from staff payroll in the business's currency, and shows no cap share across currencies", () => {
    const fake = createFakeSource({ businessId: BID, currency: "GBP", responses: { ...dataResponses, "finance.wages": { ...wages, currency: "USD" } } });
    renderScreen(fake, <WageBillScreen {...props} />);
    const strip = screen.getByRole("region", { name: "Payroll summary" });
    expect(within(strip).getByText("Team payroll").parentElement!.parentElement!.textContent).toContain("$545.00");
    expect(within(strip).getByText("Human payroll").parentElement!.parentElement!.textContent).toContain("£16K");
    // Never added across currencies: both parts, each in its own currency.
    expect(within(strip).getByText("Total payroll").parentElement!.parentElement!.textContent).toContain("$545 + £16K");
    const table = screen.getByRole("grid", { name: "Team payroll" });
    expect(within(table).getByText("$420.00")).toBeTruthy();
    expect(within(table).getByText("£500.00")).toBeTruthy(); // Atlas's wage cap, in the business's currency
    expect(within(table).queryByText("84%")).toBeNull();
    expect(wageBillRows(wages.rows, readAgents(agentsResponse), tasksDone.items, "2026-10", { cost: "USD", cap: "GBP" })[0]).toMatchObject({ costMinor: 42_000, capMinor: 50_000, capUsedPct: null });
    expect(wageBillRows(wages.rows, readAgents(agentsResponse), tasksDone.items, "2026-10", { cost: "USD", cap: "USD" })[0]).toMatchObject({ capUsedPct: 84 });
  });
});
