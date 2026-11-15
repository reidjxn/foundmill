// @vitest-environment happy-dom
/**
 * Settings › What the team can do › Autopilot: the switch and the limits (business.autopilot.set), the state in words (the chip and its
 * sentence), and the validation of the limits (1 to 24 cycles a day, 1 to 10 idle cycles, a ceiling in dollars).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";

const status = (patch: Record<string, unknown> = {}) => ({
  enabled: false,
  state: "off",
  label: "Off",
  detail: "Cycles start when you press Continue.",
  pausedReason: null,
  waitingFor: null,
  nextAt: null,
  settings: { cadence: "every_4h", dailyHour: 9, maxCyclesPerDay: 6, spendCeilingMinor: null, maxIdleCycles: 3 },
  cyclesToday: 0,
  spentTodayMinor: 0,
  creditsRemainingMinor: 500,
  changedAt: null,
  ...patch,
});

let current = status();
const set = vi.fn(async (vars: Record<string, unknown>) => ({ status: { ...current, enabled: vars.enabled ?? current.enabled }, change: "turned_on", workflow: { queued: true, workflowId: "autopilot:x" } }));
const saved = vi.fn();
const failed = vi.fn();

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    business: {
      autopilot: {
        get: { queryOptions: () => ({ queryKey: [["business", "autopilot", "get"]], queryFn: async () => current }) },
        set: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["business", "autopilot", "set"]], mutationFn: (vars: Record<string, unknown>) => set(vars), ...opts }) },
      },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved, failed, info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));

import { AutopilotSection } from "../AutopilotSection";

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <TooltipProvider>
        <AutopilotSection />
      </TooltipProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  current = status();
  set.mockClear();
  saved.mockClear();
  failed.mockClear();
});

describe("Autopilot section", () => {
  it("is off by default and turns on with the switch", async () => {
    renderSection();
    const toggle = await screen.findByRole("switch", { name: "Run this business on Autopilot" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // Settings › What the team can do never says "hard gate" or "policy" to the founder (DESIGN §10).
    expect(document.body.textContent).not.toMatch(/\b(hard gates?|policy|policies)\b/i);
    expect(screen.getByTestId("autopilot-chip").getAttribute("data-autopilot-state")).toBe("off");
    fireEvent.click(toggle);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0]![0]).toEqual({ businessId: BUSINESS, enabled: true });
    await waitFor(() => expect(saved).toHaveBeenCalledWith("Autopilot is on", undefined));
  });

  it("says Needs your answer, in plain words, when an Inbox item needs the founder", async () => {
    current = status({ enabled: true, state: "waiting", label: "Needs your answer", detail: "2 notes in the Inbox need your answer. Autopilot never answers them for you.", waitingFor: "inbox", nextAt: "2026-10-14T15:45:00.000Z", cyclesToday: 2 });
    renderSection();
    const chip = await screen.findByTestId("autopilot-chip");
    expect(chip.getAttribute("data-autopilot-state")).toBe("waiting");
    expect(chip.textContent).toContain("Needs your answer");
    expect(screen.getByTestId("autopilot-detail").textContent).toContain("2 notes in the Inbox need your answer. Autopilot never answers them for you.");
    // The next cycle is a forecast and says so.
    expect(chip.querySelector("[data-provenance='estimate']")).toBeTruthy();
    expect(screen.getByTestId("autopilot-today").textContent).toContain("2 of 6 cycles today");
    expect(screen.getByTestId("autopilot-today").textContent).toContain("Estimate");
  });

  it("shows why a guard rail paused it and keeps the switch off until the founder turns it on", async () => {
    current = status({ enabled: true, state: "paused", label: "Paused: credits used up", detail: "This month's credits are used up, so Autopilot paused. Top up in Settings › Billing, then turn Autopilot back on.", pausedReason: "credits_exhausted", creditsRemainingMinor: 0 });
    renderSection();
    expect((await screen.findByTestId("autopilot-chip")).textContent).toContain("Paused: credits used up");
    expect(screen.getByRole("switch", { name: "Run this business on Autopilot" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "Run this business on Autopilot" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ businessId: BUSINESS, enabled: true }));
  });

  it("lets the founder turn a paused Autopilot off for good, and offers that only while it is paused", async () => {
    current = status({ enabled: true, state: "paused", label: "Paused: agents stopped", detail: "Stop all agents was pressed, so Autopilot paused.", pausedReason: "kill_switch" });
    renderSection();
    fireEvent.click(await screen.findByTestId("autopilot-turn-off"));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ businessId: BUSINESS, enabled: false }));
  });

  it("does not offer Turn off while it is running or off", async () => {
    current = status({ enabled: true, state: "on", label: "On", detail: "Autopilot is running the business." });
    const { unmount } = renderSection();
    await screen.findByTestId("autopilot-chip");
    expect(screen.queryByTestId("autopilot-turn-off")).toBeNull();
    unmount();
    current = status();
    renderSection();
    await screen.findByTestId("autopilot-chip");
    expect(screen.queryByTestId("autopilot-turn-off")).toBeNull();
  });

  it("shows the API's reason when it cannot be turned on (the team is stopped)", async () => {
    set.mockRejectedValueOnce(new Error("Agents are stopped (Stop all agents), so Autopilot cannot start."));
    renderSection();
    fireEvent.click(await screen.findByRole("switch", { name: "Run this business on Autopilot" }));
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(String((failed.mock.calls[0]![0] as Error).message)).toMatch(/Stop all agents/);
  });

  it("validates the limits, then saves them as typed (dollars become cents)", async () => {
    renderSection();
    const cycles = (await screen.findByLabelText(/Most cycles per day/)) as HTMLInputElement;
    const save = screen.getByTestId("autopilot-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(cycles, { target: { value: "25" } });
    expect(screen.getByText(/Use a whole number from 1 to 24/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(cycles, { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Spend ceiling per day/), { target: { value: "12.50" } });
    fireEvent.change(screen.getByLabelText(/Pause after failed or empty cycles/), { target: { value: "2" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0]![0]).toEqual({ businessId: BUSINESS, cadence: "every_4h", dailyHour: 9, maxCyclesPerDay: 8, spendCeilingMinor: 1250, maxIdleCycles: 2, ownMaxCyclesPerDay: null, ownSpendCeilingMinor: null });
  });
});
