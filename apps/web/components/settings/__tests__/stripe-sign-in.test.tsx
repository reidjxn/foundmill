// @vitest-environment happy-dom
/**
 * Stripe's two ways in on Settings › Integrations (WP-11, Nov 17, 2026): "Sign in with Stripe" opens Stripe's page, "Use
 * an API key" opens the key dialog, the row says both, and renewing follows how the project connected.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const connect = vi.fn(async (vars: unknown) => ({ integration: null, record: { accountLabel: null }, consentUrl: null, founderConsentRequired: false, vars }));
const disconnect = vi.fn();
let search = new URLSearchParams();
let catalogue: unknown[] = [];

vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ replace: vi.fn() }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
      platformMail: { queryOptions: () => ({ queryKey: [["integrations", "platformMail"]], queryFn: async () => null }) },
      list: { queryOptions: () => ({ queryKey: [["integrations", "list"]], queryFn: async () => ({ mode: "mock", integrations: [], catalogue }) }) },
      connect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "connect"]], mutationFn: (vars: unknown) => connect(vars), ...opts }) },
      disconnect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "disconnect"]], mutationFn: (vars: unknown) => disconnect(vars), ...opts }) },
      health: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "health"]], mutationFn: vi.fn(), ...opts }) },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved: vi.fn(), failed: vi.fn(), info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));

import { IntegrationsTab, authWordFor, offersSignInAndKey } from "../IntegrationsTab";

const FIELDS = [{ name: "apiKey", label: "Restricted key", secret: true, required: true }, { name: "webhookSecret", label: "Payment signing secret", secret: true, required: false }];
const stripe = (integ: unknown, live = true) => ({ key: "stripe", displayName: "Stripe", phase: 2, auth: { kind: "oauth", scopes: ["read_write"], platformKey: true, authorizationCode: true }, connectFields: FIELDS, tools: [{}, {}], simulations: [], live, available: true, integration: integ });
const integration = (over: Record<string, unknown> = {}) => ({ id: "i1", status: "connected", accountLabel: "Founder Ltd", scopes: ["read_write"], lastHealthAt: new Date().toISOString(), lastError: null, settings: { externalAccountId: "acct_1", config: { kind: "connect" } }, ...over });

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <TooltipProvider>
        <IntegrationsTab />
      </TooltipProvider>
    </QueryClientProvider>,
  );

/** A connector's row, once the list has loaded. */
const row = (key: string) =>
  waitFor(() => {
    const el = document.querySelector(`[data-connector="${key}"]`) as HTMLElement | null;
    expect(el).toBeTruthy();
    return el!;
  });

afterEach(() => {
  connect.mockClear();
  disconnect.mockClear();
  search = new URLSearchParams();
  catalogue = [];
});

describe("Stripe: Sign in with Stripe, or an API key", () => {
  it("names both ways and offers both buttons when Stripe runs live", async () => {
    catalogue = [stripe(null)];
    renderTab();
    const r = await row("stripe");
    expect(r.textContent).toContain("Sign in with Stripe, or an API key");
    expect(r.textContent).not.toContain("Sign in with the vendor");
    fireEvent.click(within(r).getByTestId("sign-in-with-vendor"));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "stripe", input: {} }));
    fireEvent.click(within(r).getByTestId("use-an-api-key"));
    await waitFor(() => expect(document.querySelector('[data-testid="connect-fields-dialog"]')).toBeTruthy());
    expect(document.querySelector('[data-testid="connect-fields-dialog"]')!.textContent).toContain("Restricted key");
  });

  it("a test connection keeps its one Connect button", async () => {
    catalogue = [stripe(null, false)];
    renderTab();
    const r = await row("stripe");
    expect(within(r).queryByTestId("sign-in-with-vendor")).toBeNull();
    expect(within(r).getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(offersSignInAndKey(stripe(null, false))).toBe(false);
    expect(authWordFor(stripe(null, false))).toBe("Sign in with the vendor");
  });

  it("renewing follows how the project connected: sign in again, or a new key", async () => {
    catalogue = [stripe(integration({ status: "expired", lastError: "Stripe access was removed in your Stripe dashboard. Sign in with Stripe again to reconnect." }))];
    renderTab();
    const signedIn = await row("stripe");
    expect(signedIn.textContent).toContain("Stripe access was removed");
    fireEvent.click(within(signedIn).getByRole("button", { name: "Sign in with Stripe again" }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "stripe", input: {} }));
  });

  it("a key-connected Stripe renews with the key dialog", async () => {
    catalogue = [stripe(integration({ status: "expired", settings: { externalAccountId: "acct_1", config: { kind: "own" } } }))];
    renderTab();
    const r = await row("stripe");
    fireEvent.click(within(r).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(document.querySelector('[data-testid="connect-fields-dialog"]')).toBeTruthy());
    expect(connect).not.toHaveBeenCalled();
  });
});
