// @vitest-environment happy-dom
/**
 * Renewing a connection's consent (audit W03 #165): a connected, expired or degraded connector, or one whose consent
 * lapses within a week, offers "Renew consent" (or "Reconnect" for a key), which connects again in place and never
 * disconnects first. Finance › Cash's "Renew consent" lands on that connector's row (?connector=tink).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const connect = vi.fn(async (vars: unknown) => ({ integration: { id: "i1" }, record: { accountLabel: "Test bank" }, consentUrl: null, founderConsentRequired: false, vars }));
const disconnect = vi.fn();
let search = new URLSearchParams();
let catalogue: unknown[] = [];

vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ replace: vi.fn() }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
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

import { CONSENT_RENEW_DAYS, IntegrationsTab, consentExpiry, needsRenewal } from "../IntegrationsTab";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const integration = (over: Record<string, unknown> = {}) => ({ id: "i1", status: "connected", accountLabel: "Test bank", scopes: ["accounts:read", "transactions:read"], lastHealthAt: NOW.toISOString(), lastError: null, settings: { expiresAt: inDays(40) }, ...over });
const connector = (key: string, displayName: string, kind: string, integ: unknown) => ({ key, displayName, phase: 1, auth: { kind }, tools: [{}, {}], simulations: [], live: false, integration: integ });

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

describe("needsRenewal", () => {
  it("is true for an expired or degraded connection, or one whose consent lapses within a week", () => {
    expect(needsRenewal(integration({ status: "expired" }), NOW)).toBe(true);
    expect(needsRenewal(integration({ status: "degraded" }), NOW)).toBe(true);
    expect(needsRenewal(integration({ settings: { expiresAt: inDays(CONSENT_RENEW_DAYS) } }), NOW)).toBe(true);
    expect(needsRenewal(integration({ settings: { expiresAt: inDays(-2) } }), NOW)).toBe(true);
    expect(needsRenewal(integration({ settings: { expiresAt: inDays(CONSENT_RENEW_DAYS + 1) } }), NOW)).toBe(false);
    expect(needsRenewal(integration({ settings: {} }), NOW)).toBe(false);
    expect(needsRenewal(integration({ status: "disconnected" }), NOW)).toBe(false);
    expect(needsRenewal(null, NOW)).toBe(false);
  });

  it("reads the consent expiry from what the connector reported, and nothing from a bad value", () => {
    expect(consentExpiry(integration({ settings: { expiresAt: "2026-10-12T00:00:00.000Z" } }))?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(consentExpiry(integration({ settings: { expiresAt: "soon" } }))).toBeNull();
    expect(consentExpiry(integration({ settings: undefined }))).toBeNull();
    expect(consentExpiry(null)).toBeNull();
  });
});

describe("Settings › Integrations: renewing consent", () => {
  it("offers Renew consent beside Health and Disconnect when the bank consent lapses soon, and connects again in place", async () => {
    catalogue = [connector("tink", "Tink", "oauth", integration({ settings: { expiresAt: inDays(6) } })), connector("plaid", "Plaid", "oauth", integration({ id: "i2" }))];
    renderTab();
    const tink = await row("tink");
    expect(within(tink).getByText(/^Consent until /)).toBeTruthy();
    expect(within(tink).getByRole("button", { name: "Check Tink health" })).toBeTruthy();
    expect(within(tink).getByRole("button", { name: "Disconnect Tink" })).toBeTruthy();
    fireEvent.click(within(tink).getByRole("button", { name: "Renew consent" }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "tink", input: {} }));
    expect(disconnect).not.toHaveBeenCalled(); // the stored credentials are never revoked first
    // a consent with weeks left needs no renewal
    const plaid = document.querySelector('[data-connector="plaid"]') as HTMLElement;
    expect(within(plaid).queryByRole("button", { name: "Renew consent" })).toBeNull();
  });

  it("says Reconnect for a key-based connector that expired, and nothing for a healthy one", async () => {
    catalogue = [connector("sendgrid", "SendGrid", "api_key", integration({ status: "expired", settings: {} })), connector("stripe", "Stripe", "api_key", integration({ id: "i3", settings: {} }))];
    renderTab();
    const sendgrid = await row("sendgrid");
    expect(within(sendgrid).getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(within(document.querySelector('[data-connector="stripe"]') as HTMLElement).queryByRole("button", { name: /Reconnect|Renew consent/ })).toBeNull();
  });

  it("brings the connector named in the address into view and marks its row", async () => {
    const scroll = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
    search = new URLSearchParams({ connector: "tink" });
    catalogue = [connector("plaid", "Plaid", "oauth", integration({ id: "i2" })), connector("tink", "Tink", "oauth", integration({ settings: { expiresAt: inDays(2) } }))];
    renderTab();
    const tink = await row("tink");
    expect(tink.getAttribute("aria-current")).toBe("true");
    expect((document.querySelector('[data-connector="plaid"]') as HTMLElement).getAttribute("aria-current")).toBeNull();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });
});
