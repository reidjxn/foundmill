// @vitest-environment happy-dom
/**
 * The Simulate panel (SEC-2): every click is a `dev.simulate` mutation through the API; the browser never fetches
 * apps/ingest and sends no credential of its own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const simulate = vi.fn();
const toast = { saved: vi.fn(), failed: vi.fn(), info: vi.fn() };
const invalidate = vi.fn(async () => undefined);

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    dev: {
      simulate: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["dev", "simulate"]], mutationFn: (vars: unknown) => simulate(vars), ...opts }),
      },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: "b1", isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => toast }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => invalidate }));

import { SimulatePanel } from "../IntegrationsTab";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SimulatePanel businessId={BUSINESS} connectors={[{ key: "stripe", label: "Stripe", simulations: ["payment.received", "signup.created"] }]} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("SimulatePanel (Settings › Integrations › Simulate)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    simulate.mockReset();
    toast.saved.mockReset();
    toast.failed.mockReset();
    invalidate.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls dev.simulate with the business and event name, shows the API's answer and never fetches ingest", async () => {
    simulate.mockResolvedValue({ ok: true, status: 200, body: { ok: true, written: 1, duplicates: 0, connector: "stripe", label: "Simulated" }, label: "Simulated" });
    renderPanel();
    expect(screen.getByTestId("simulate-panel")).toBeTruthy();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-simulate="payment.received"]')!);
    });
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate).toHaveBeenCalledWith({ businessId: BUSINESS, eventName: "payment.received" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("simulate-result").textContent).toContain("payment.received → 200");
    expect(screen.getByTestId("simulate-result").textContent).toContain('"written": 1');
    expect(toast.saved).toHaveBeenCalledWith("Simulated", "payment.received went through the webhook path.");
    expect(invalidate).toHaveBeenCalledWith(["inbox", "journey", "finance", "integrations", "distribution"]);
  });

  it("shows a refusal from ingest verbatim and a failed mutation (viewer, unreachable) as a toast", async () => {
    simulate.mockResolvedValueOnce({ ok: false, status: 400, body: { ok: false, error: "unknown_simulation" }, label: "Simulated" });
    renderPanel();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-simulate="signup.created"]')!);
    });
    expect(screen.getByTestId("simulate-result").textContent).toContain("signup.created → 400");
    expect(toast.failed).toHaveBeenCalledTimes(1);
    expect((toast.failed.mock.calls[0]![0] as Error).message).toBe('400: {"ok":false,"error":"unknown_simulation"}');
    expect(invalidate).not.toHaveBeenCalled();

    simulate.mockRejectedValueOnce(new Error("Your role (viewer) cannot perform administration"));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-simulate="payment.received"]')!);
    });
    expect(toast.failed).toHaveBeenCalledTimes(2);
    expect(toast.failed.mock.calls[1]![1]).toBe("Simulation failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
