// @vitest-environment happy-dom
/**
 * Home's Autopilot chip: the state in words with the next planned cycle (an Estimate); it nudges the workflow to run
 * only when Autopilot is on and not paused; clicking it opens Settings › Mode.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOPILOT_GUIDE_LINE, GuidanceProvider, TooltipProvider } from "@foundmill/dugout";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
let businessId = BUSINESS;
const push = vi.fn();
const ensure = vi.fn(async () => ({ running: true, workflow: null }));
let status: Record<string, unknown> | null = null;
let role = "owner";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    business: {
      autopilot: {
        get: { queryOptions: () => ({ queryKey: [["business", "autopilot", "get"]], queryFn: async () => status }) },
        ensure: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["business", "autopilot", "ensure"]], mutationFn: () => ensure(), ...opts }) },
      },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId, data: { role } }) }));

import { HomeAutopilot } from "../HomeAutopilot";

const renderChip = (guidance: "on" | "off" = "on") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <GuidanceProvider value={{ guidance }}>
        <TooltipProvider>
          <HomeAutopilot />
        </TooltipProvider>
      </GuidanceProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  status = null;
  role = "owner";
  businessId = BUSINESS;
  push.mockClear();
  ensure.mockClear();
});

describe("Home Autopilot chip", () => {
  it("shows On with the next cycle labeled Estimate, and makes sure the workflow runs", async () => {
    status = { enabled: true, state: "on", label: "On", detail: "Autopilot is running the business.", pausedReason: null, nextAt: "2026-10-14T15:45:00.000Z" };
    renderChip();
    const chip = await screen.findByTestId("autopilot-chip");
    expect(chip.textContent).toContain("On");
    expect(chip.querySelector("[data-autopilot-next]")?.textContent).toContain("Oct 14, 3:45 PM");
    expect(chip.querySelector("[data-provenance='estimate']")).toBeTruthy();
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
  });

  it("makes sure once per business per browser session, not on every Home visit", async () => {
    businessId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    status = { enabled: true, state: "on", label: "On", detail: "", pausedReason: null, nextAt: null };
    const first = renderChip();
    await screen.findByTestId("autopilot-chip");
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.sessionStorage.getItem(`autopilot-ensured:${businessId}`)).toBe("1"));
    first.unmount();
    renderChip();
    await screen.findByTestId("autopilot-chip");
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("shows Waiting for you and Paused with their reasons, without nudging a paused Autopilot", async () => {
    status = { enabled: true, state: "paused", label: "Paused: agents stopped", detail: "Stop all agents was pressed, so Autopilot paused.", pausedReason: "kill_switch", nextAt: null };
    const { unmount } = renderChip();
    expect((await screen.findByTestId("autopilot-chip")).textContent).toContain("Paused: agents stopped");
    expect(ensure).not.toHaveBeenCalled();
    unmount();
    status = { enabled: true, state: "waiting", label: "Waiting for you", detail: "Two Inbox items need your decision.", pausedReason: null, nextAt: null };
    renderChip();
    expect((await screen.findByTestId("autopilot-chip")).textContent).toContain("Waiting for you");
  });

  it("shows Off and never nudges", async () => {
    status = { enabled: false, state: "off", label: "Off", detail: "Cycles start when you press Continue.", pausedReason: null, nextAt: null };
    renderChip();
    expect((await screen.findByTestId("autopilot-chip")).textContent).toContain("Off");
    expect(ensure).not.toHaveBeenCalled();
  });

  it("says beside the chip what Autopilot does and never does, in guided mode only (UX plan B16)", async () => {
    status = { enabled: false, state: "off", label: "Off", detail: "Cycles start when you press Continue.", pausedReason: null, nextAt: null };
    const { unmount } = renderChip("on");
    await screen.findByTestId("autopilot-chip");
    const guide = screen.getByTestId("home-autopilot").querySelector("[data-autopilot-guide]");
    expect(guide?.textContent).toBe(AUTOPILOT_GUIDE_LINE);
    expect(guide?.textContent).toBe("Autopilot presses Continue for you on a schedule. It never answers notes for you.");
    unmount();
    renderChip("off");
    await screen.findByTestId("autopilot-chip");
    expect(screen.getByTestId("home-autopilot").querySelector("[data-autopilot-guide]")).toBeNull();
  });

  it("does not nudge for a viewer, and opens Settings › Mode when clicked", async () => {
    role = "viewer";
    status = { enabled: true, state: "on", label: "On", detail: "", pausedReason: null, nextAt: null };
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /Autopilot: On/ }));
    expect(push).toHaveBeenCalledWith(`/b/${BUSINESS}/settings/mode`);
    expect(ensure).not.toHaveBeenCalled();
  });
});
