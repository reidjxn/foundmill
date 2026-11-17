// @vitest-environment happy-dom
/**
 * The Simulate panel on Settings › Integrations renders on a development stack only. Staging and production never show
 * it, whatever the integrations mode (production runs APP_ENV=staging with mock integrations, Nov 17, 2026).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { resetPublicEnvCache } from "@/lib/env";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const catalogue = [{ key: "stripe", displayName: "Stripe", phase: 1, auth: { kind: "api_key" }, tools: [{}], simulations: ["payment.received"], live: false, available: true, integration: null }];

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
      platformMail: { queryOptions: () => ({ queryKey: [["integrations", "platformMail"]], queryFn: async () => null }) },
      list: { queryOptions: () => ({ queryKey: [["integrations", "list"]], queryFn: async () => ({ mode: "mock", integrations: [], catalogue }) }) },
      connect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "connect"]], mutationFn: vi.fn(), ...opts }) },
      disconnect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "disconnect"]], mutationFn: vi.fn(), ...opts }) },
      health: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "health"]], mutationFn: vi.fn(), ...opts }) },
    },
    dev: { simulate: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["dev", "simulate"]], mutationFn: vi.fn(), ...opts }) } },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved: vi.fn(), failed: vi.fn(), info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));

import { IntegrationsTab, healthLine } from "../IntegrationsTab";

async function renderIn(appEnv: string) {
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", appEnv);
  resetPublicEnvCache();
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <IntegrationsTab />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector('[data-connector="stripe"]')).toBeTruthy());
  return view;
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetPublicEnvCache();
});

describe("Settings › Integrations: the Simulate panel", () => {
  for (const appEnv of ["staging", "production"]) {
    it(`is absent on ${appEnv}, even with mock integrations and an owner`, async () => {
      const view = await renderIn(appEnv);
      expect(view.queryByTestId("simulate-panel")).toBeNull();
      view.unmount();
    });
  }

  it("is there on a development stack", async () => {
    const view = await renderIn("development");
    expect(view.getByTestId("simulate-panel")).toBeTruthy();
    expect(view.getByTestId("simulate-panel").textContent).not.toMatch(/apps\/|ingest|the API/);
    view.unmount();
  });
});

describe("healthLine", () => {
  it("never shows a test connection's own words", () => {
    expect(healthLine({ status: "mock", message: "stripe mock healthy" })).toBe("Test data: nothing was checked with the vendor.");
    expect(healthLine({ status: "connected", message: "Account acct_1 reachable" })).toBe("Account acct_1 reachable");
    expect(healthLine({ status: "connected" })).toBeUndefined();
  });
});
