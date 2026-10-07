import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { RunwayScreen, latestByScenario } from "../RunwayScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses, emptyResponses, forecasts } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

describe("latestByScenario", () => {
  it("keeps the newest non-archived version per scenario", () => {
    const latest = latestByScenario(forecasts);
    expect(latest.base?.id).toBe("77777777-7777-4777-8777-777777777771");
    expect(latest.downside?.createdAt).toBe("2026-10-01T09:00:00.000Z");
    expect(latest.upside).toBeUndefined();
  });
});

describe("RunwayScreen", () => {
  it("projects every scenario from stored or seeded drivers with Forecast chips and threshold warnings", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    expect(screen.getByRole("region", { name: "Cash forecast" })).toBeTruthy();
    expect(screen.getAllByText("Forecast").length).toBeGreaterThan(3);
    const list = screen.getByRole("list", { name: "Runway by scenario" });
    const base = list.querySelector("[data-scenario='base']") as HTMLElement;
    // €150,000 cash, €20,000 revenue growing 5 %, €35,000 costs growing 1 %: cash lasts into the second year.
    expect(within(base).getByText(/Runway under 12 months|Runway under 9 months|Runway healthy|Beyond 24 months/)).toBeTruthy();
    const downside = list.querySelector("[data-scenario='downside']") as HTMLElement;
    expect(within(downside).getByText("Runway under 9 months")).toBeTruthy(); // 150k ÷ 20k net burn growing 2 %/month
    expect(within(downside).getByText(/Below the 12, 9-month thresholds/)).toBeTruthy();
    const upside = list.querySelector("[data-scenario='upside']") as HTMLElement;
    expect(within(upside).getByText("not saved yet")).toBeTruthy();
    expect(screen.getByText(/Upside unsaved/)).toBeTruthy(); // footer lists versions
    expect(screen.queryByText(/Continue is blocked/)).toBeNull();
  });

  it("edits drivers, shows the live runway, saves a new version through finance.forecast.update and resets", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    const form = screen.getByRole("form", { name: "Base drivers" });
    const save = within(form).getByRole("button", { name: "Save Base forecast" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // stored and untouched
    fireEvent.change(within(form).getByLabelText("Monthly costs"), { target: { value: "95000" } });
    expect(save.disabled).toBe(false);
    expect(within(form).getByText(/Base runway with these drivers: 2(\.\d)? mo/)).toBeTruthy(); // 150k ÷ (95k − 20k) ≈ 2 months
    expect(screen.getByText(/Continue is blocked until the warning is acknowledged/)).toBeTruthy();
    const reset = within(form).getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(fake.mutations).toHaveLength(1);
    const m = fake.mutations[0]!;
    expect(m.path).toBe("finance.forecast.update");
    expect(m.input.scenario).toBe("base");
    expect(m.input.currency).toBe("EUR");
    const drivers = m.input.drivers as Record<string, number | null>;
    expect(drivers.monthlyCostsMinor).toBe(9_500_000);
    expect(drivers.startingCashMinor).toBe(15_000_000);
    expect(drivers.runway_months).toBeGreaterThan(1.5);
    expect(drivers.runway_months).toBeLessThan(3);
    const series = m.input.series as { month: string; cashMinor: number }[];
    expect(series).toHaveLength(24);
    expect(series[0]!.month).toBe("2026-10");
    expect(series[0]!.cashMinor).toBe(15_000_000 + 2_000_000 - 9_500_000);
    expect(fake.refetches["finance.forecast.list"]).toBe(1);
    expect((within(form).getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches scenario tabs and seeds an unsaved scenario from today's numbers", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Scenario" })).getByRole("button", { name: "Upside" }));
    const form = screen.getByRole("form", { name: "Upside drivers" });
    expect((within(form).getByLabelText("Starting cash") as HTMLInputElement).value).toBe("150000");
    expect((within(form).getByLabelText("Monthly revenue") as HTMLInputElement).value).toBe("20000");
    expect((within(form).getByLabelText("Revenue growth") as HTMLInputElement).value).toBe("10");
    expect((within(form).getByRole("button", { name: "Save Upside forecast" }) as HTMLButtonElement).disabled).toBe(false); // nothing stored yet
  });

  it("shows seeded lines without forecasts, a loading state and an error with retry", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <RunwayScreen {...props} />);
    expect(screen.getByText(/No forecast saved yet/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Runway by scenario" }).querySelectorAll("[data-scenario]")).toHaveLength(3);
    unmount();

    const loading = createFakeSource({ businessId: BID });
    const { container, unmount: u2 } = renderScreen(loading, <RunwayScreen {...props} />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
    u2();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.forecast.list": new Error("forecast store offline") } });
    renderScreen(failing, <RunwayScreen {...props} />);
    expect(screen.getAllByText("forecast store offline").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["finance.forecast.list"]).toBe(1);
  });
});
