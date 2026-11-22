// @vitest-environment happy-dom
/**
 * Settings › Integrations › "Add a website the team can work in" (founder, Nov 22, 2026): the sites are listed there
 * and never as ordinary connectors; connecting is the plain words, then the founder's own sign-in in a live view, with
 * Done and Cancel; Disconnect says the saved sign-in is deleted.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const connect = vi.fn(async (vars: { input: Record<string, unknown> }) => ({ integration: null, record: { accountLabel: null }, consentUrl: null, founderConsentRequired: false, signIn: vars.input.done || vars.input.cancel ? null : { liveViewUrl: "https://6080-isample0000000001.e2b.app/vnc.html" } }));
const disconnect = vi.fn(async () => ({}));
let catalogue: unknown[] = [];

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
      platformMail: { queryOptions: () => ({ queryKey: [["integrations", "platformMail"]], queryFn: async () => null }) },
      list: { queryOptions: () => ({ queryKey: [["integrations", "list"]], queryFn: async () => ({ mode: "mock", integrations: [], catalogue }) }) },
      connect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "connect"]], mutationFn: (vars: never) => connect(vars), ...opts }) },
      disconnect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "disconnect"]], mutationFn: () => disconnect(), ...opts }) },
      health: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "health"]], mutationFn: vi.fn(), ...opts }) },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved: vi.fn(), failed: vi.fn(), info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));

import { IntegrationsTab } from "../IntegrationsTab";

const site = (siteKey: string, name: string, state: "open" | "ask_first", integration: unknown = null) => ({ key: `browser_${siteKey}`, displayName: `${name} (website)`, phase: 2, auth: { kind: "oauth", scopes: [] }, connectFields: [], tools: [], simulations: [], live: false, available: true, browser: { siteKey, name, state }, integration });
const github = { key: "github", displayName: "GitHub", phase: 1, auth: { kind: "app", scopes: [] }, connectFields: [], tools: [], simulations: [], live: false, available: true, browser: null, integration: null };

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <TooltipProvider>
        <IntegrationsTab />
      </TooltipProvider>
    </QueryClientProvider>,
  );
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const waitForTestId = (id: string) => waitFor(() => expect(byTestId(id)).toBeTruthy());

afterEach(() => {
  connect.mockClear();
  disconnect.mockClear();
  catalogue = [];
});

describe("Add a website the team can work in", () => {
  it("lists the sites in their own section and never in the general connector list", async () => {
    catalogue = [github, site("carrd", "Carrd", "ask_first")];
    renderTab();
    await waitForTestId("browser-sites-section");
    expect(document.querySelector('[data-connector="browser_carrd"]')).toBeNull();
    expect(document.querySelector('[data-connector="github"]')).toBeTruthy();
    expect(byTestId("browser-never")!.textContent).toContain("never offered");
  });

  it("the first site shows the plain words and its caution, then the live view; Done connects", async () => {
    catalogue = [site("carrd", "Carrd", "ask_first")];
    renderTab();
    fireEvent.click(await waitFor(() => { const b = byTestId("browser-connect-carrd"); expect(b).toBeTruthy(); return b!; }));
    await waitForTestId("browser-connect-intro");
    expect(byTestId("browser-connect-intro")!.textContent).toContain("The team will work in this account as you.");
    expect(byTestId("browser-connect-ask-first")!.textContent).toContain("has not yet confirmed that Carrd's terms allow this");
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(byTestId("browser-connect-start")!);
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "browser_carrd", input: {} }));
    await waitForTestId("browser-live-view");
    expect(byTestId("browser-live-view")!.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
    fireEvent.click(byTestId("browser-connect-done")!);
    await waitFor(() => expect(connect).toHaveBeenLastCalledWith({ businessId: BUSINESS, connectorKey: "browser_carrd", input: { done: true } }));
    await waitFor(() => expect(byTestId("browser-connect-dialog")).toBeNull());
  });

  it("Cancel throws the unsaved sign-in away", async () => {
    catalogue = [site("carrd", "Carrd", "open")];
    renderTab();
    fireEvent.click(await waitFor(() => { const b = byTestId("browser-connect-carrd"); expect(b).toBeTruthy(); return b!; }));
    fireEvent.click(await waitFor(() => { const b = byTestId("browser-connect-start"); expect(b).toBeTruthy(); return b!; }));
    await waitForTestId("browser-live-view");
    fireEvent.click(byTestId("browser-connect-cancel")!);
    await waitFor(() => expect(connect).toHaveBeenLastCalledWith({ businessId: BUSINESS, connectorKey: "browser_carrd", input: { cancel: true } }));
    await waitFor(() => expect(byTestId("browser-connect-dialog")).toBeNull());
  });

  it("a signed-in site reads Signed in to <site> and Disconnect says the saved sign-in is deleted", async () => {
    catalogue = [site("carrd", "Carrd", "ask_first", { id: "i1", status: "connected" })];
    renderTab();
    await waitForTestId("browser-site-list");
    expect(byTestId("browser-site-list")!.textContent).toContain("Signed in to Carrd");
    expect(byTestId("browser-site-list")!.textContent).toContain("Disconnect deletes the saved sign-in.");
    fireEvent.click(byTestId("browser-disconnect-carrd")!);
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
  });

  it("a site the provider signed out says Sign in again once, with no retry loop", async () => {
    catalogue = [site("carrd", "Carrd", "open", { id: "i1", status: "expired" })];
    renderTab();
    await waitForTestId("browser-sign-in-again-carrd");
    expect(byTestId("browser-site-list")!.textContent).toContain("Carrd signed you out");
    expect(connect).not.toHaveBeenCalled();
  });
});
