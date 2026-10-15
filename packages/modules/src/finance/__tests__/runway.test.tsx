import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunwayScreen, latestByScenario, parseField, runwayText, scenarioHint, toField } from "../RunwayScreen";
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

describe("driver fields (#172)", () => {
  const drivers = { startingCashMinor: 150_050, monthlyRevenueMinor: 2_000_000, revenueGrowthPct: 2.5, monthlyCostsMinor: 3_500_000, costGrowthPct: 1, horizonMonths: 18 };

  it("reads what is typed into a number only once it means one", () => {
    expect(parseField("", "percent")).toBeNull();
    expect(parseField("-", "percent")).toBeNull();
    expect(parseField("2.", "percent")).toBe(2);
    expect(parseField("2.5", "percent")).toBe(2.5);
    expect(parseField(" 2.5% ", "percent")).toBe(2.5);
    expect(parseField("18", "months")).toBe(18);
    expect(parseField("99", "months")).toBe(60); // a horizon is held to 1 to 60 months
    expect(parseField("0", "months")).toBe(1);
    expect(parseField("1500.50", "money")).toBe(150_050);
    expect(parseField("1,500.50", "money")).toBe(150_050);
    expect(parseField("abc", "money")).toBeNull();
  });

  it("shows a stored driver with its cents and decimals, in the form it would be typed", () => {
    expect(toField(drivers, "startingCashMinor", "money")).toBe("1500.5");
    expect(toField(drivers, "revenueGrowthPct", "percent")).toBe("2.5");
    expect(toField(drivers, "horizonMonths", "months")).toBe("18");
    expect(toField(drivers, "runway_months", "months")).toBe("");
  });

  it("builds the scenario sentence and the runway words from the drivers", () => {
    expect(scenarioHint("base", { ...drivers })).toBe("Base: what the plan says, revenue up 2.5% and costs up 1% a month, over 18 months.");
    expect(runwayText({ kind: "beyond", horizonMonths: 24 })).toMatchObject({ pill: "Runway healthy", figure: "Beyond 24 months" });
    expect(runwayText({ kind: "no_limit" })).toMatchObject({ pill: "No limit", figure: "No limit" });
    expect(runwayText({ kind: "unknown", value: "Not known yet", caption: "Connect a bank to estimate it" })).toMatchObject({ pill: "Runway not known yet", tone: "neutral" });
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
    // The pill carries the judgement in words; the Runway row under it carries the figure (never both the same words).
    expect(within(base).getByText(/^(Runway under 12 months|Runway under 9 months|Runway healthy)$/)).toBeTruthy();
    const downside = list.querySelector("[data-scenario='downside']") as HTMLElement;
    expect(within(downside).getByText("Runway under 9 months")).toBeTruthy(); // 150k ÷ 20k net burn growing 2 %/month
    expect(within(downside).getByText(/Below the 12, 9-month thresholds/)).toBeTruthy();
    const upside = list.querySelector("[data-scenario='upside']") as HTMLElement;
    expect(within(upside).getByText("not saved yet")).toBeTruthy();
    expect(screen.getByText(/Upside not saved/)).toBeTruthy(); // footer lists versions
    expect(screen.queryByText(/Continue is blocked/)).toBeNull();
  });

  it("labels every projected figure Forecast: runway, cash out, cash at the horizon, the panel and the driver line", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    const warnings = screen.getByRole("region", { name: "Runway warnings" });
    // Panel header chip + three chips (Runway, Cash out, Cash at the horizon) for each of the three scenarios.
    expect(within(warnings).getAllByText("Forecast").length).toBe(1 + 3 * 3);
    for (const li of within(warnings).getByRole("list", { name: "Runway by scenario" }).querySelectorAll("li[data-scenario]")) {
      expect(within(li as HTMLElement).getAllByText("Forecast")).toHaveLength(3);
    }
    const driverLine = document.querySelector("[data-driver-runway]") as HTMLElement;
    expect(driverLine.textContent).toMatch(/runway with these drivers: .+Forecast$/);
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

  it("keeps what is typed in a driver field: 2.5 stays 2.5, horizon 18 stays 18, 1500.50 stays 1500.50 (#172)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    const form = screen.getByRole("form", { name: "Base drivers" });
    const growth = within(form).getByLabelText("Revenue growth") as HTMLInputElement;
    const horizon = within(form).getByLabelText("Horizon") as HTMLInputElement;
    const cash = within(form).getByLabelText("Starting cash") as HTMLInputElement;
    // keyboard input after clear(): user-event's own cursor tracking resets on a click, which a person's typing does not
    await user.clear(growth);
    expect(growth.value).toBe(""); // clearing is not "0"
    await user.keyboard("2.5");
    expect(growth.value).toBe("2.5");
    await user.clear(horizon);
    expect(horizon.value).toBe(""); // not clamped to 1 mid-edit
    await user.keyboard("18");
    expect(horizon.value).toBe("18");
    await user.clear(cash);
    await user.keyboard("1500.50");
    expect(cash.value).toBe("1500.50");
    // after a field loses focus it shows the value it holds in its usual form
    fireEvent.blur(cash);
    expect(cash.value).toBe("1,500.5");
    fireEvent.blur(growth);
    expect(growth.value).toBe("2.5");
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Save Base forecast" }));
    });
    const drivers = fake.mutations[0]!.input.drivers as Record<string, number | null>;
    expect(drivers.revenueGrowthPct).toBe(2.5);
    expect(drivers.horizonMonths).toBe(18);
    expect(drivers.startingCashMinor).toBe(150_050);
    expect((fake.mutations[0]!.input.series as unknown[]).length).toBe(18);
  });

  it("says 'Not known yet' with its reason, not 'Runway healthy', for a business with no bank and nothing saved (#352)", () => {
    const noBank = { ...emptyResponses, "finance.overview": { ...(emptyResponses["finance.overview"] as object), runway: { months: null, reason: "no_bank", label: "Estimate", warnings: [], blocksContinue: false } } };
    const fake = createFakeSource({ businessId: BID, responses: noBank });
    renderScreen(fake, <RunwayScreen {...props} />);
    const list = screen.getByRole("list", { name: "Runway by scenario" });
    for (const s of ["base", "upside", "downside"]) {
      const row = list.querySelector(`[data-scenario='${s}']`) as HTMLElement;
      expect(within(row).getByText("Runway not known yet")).toBeTruthy();
      expect(within(row).getByText("Connect a bank to estimate it")).toBeTruthy();
      expect(within(row).queryByText("Runway healthy")).toBeNull();
      expect(within(row).queryByText(/Beyond 24 months/)).toBeNull();
    }
  });

  it("describes each scenario from its own drivers, not fixed text (#173)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    const form = screen.getByRole("form", { name: "Base drivers" });
    fireEvent.change(within(form).getByLabelText("Revenue growth"), { target: { value: "7" } });
    expect(screen.getByText(/revenue up 7% and costs up 1% a month, over 24 months/)).toBeTruthy();
  });

  it("switches scenario tabs and seeds an unsaved scenario from today's numbers", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RunwayScreen {...props} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Scenario" })).getByRole("button", { name: "Upside" }));
    const form = screen.getByRole("form", { name: "Upside drivers" });
    expect((within(form).getByLabelText("Starting cash") as HTMLInputElement).value).toBe("150,000");
    expect((within(form).getByLabelText("Monthly revenue") as HTMLInputElement).value).toBe("20,000");
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
