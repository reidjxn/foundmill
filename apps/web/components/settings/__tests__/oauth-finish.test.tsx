// @vitest-environment happy-dom
/**
 * Connecting an OAuth connector (Google, Notion, Shopify): the vendor's callback (app/integrations/oauth/callback) only
 * forwards the one-time code, the api-signed state and the store to the business's Integrations tab, where the founder's
 * click finishes the connection.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { oauthCallbackRedirect } from "@/app/integrations/oauth/callback/route";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const connect = vi.fn(async (vars: unknown) => ({ integration: { id: "i1" }, record: { accountLabel: "Northwind HQ" }, consentUrl: null, founderConsentRequired: false, vars }));
const replace = vi.fn();
let search = new URLSearchParams();
let catalogue: unknown[] = [];

vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ replace }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
      list: { queryOptions: () => ({ queryKey: [["integrations", "list"]], queryFn: async () => ({ mode: "live", integrations: [], catalogue }) }) },
      connect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "connect"]], mutationFn: (vars: unknown) => connect(vars), ...opts }) },
      disconnect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "disconnect"]], mutationFn: vi.fn(), ...opts }) },
      health: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "health"]], mutationFn: vi.fn(), ...opts }) },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved: vi.fn(), failed: vi.fn(), info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));

import { IntegrationsTab } from "../IntegrationsTab";

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <TooltipProvider>
        <IntegrationsTab />
      </TooltipProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  connect.mockClear();
  replace.mockClear();
  search = new URLSearchParams();
  catalogue = [];
});

/** A state as the api signs it: base64url JSON naming the business and the connector, then a signature the web never checks. */
const state = (c: string) => `${Buffer.from(JSON.stringify({ b: BUSINESS, u: "user-1", c, exp: 4102444800, n: "abcdefghijkl" })).toString("base64url")}.c2lnbmF0dXJl`;

describe("OAuth callback URL", () => {
  it("forwards the code, the signed state and the store to the business and connector the state names", () => {
    const to = new URL(oauthCallbackRedirect(new URLSearchParams({ code: "4/0Ab-code", state: state("gmail"), scope: "email" })), "https://app.test");
    expect(to.pathname).toBe(`/b/${BUSINESS}/settings/integrations`);
    expect(Object.fromEntries(to.searchParams)).toEqual({ oauth_connector: "gmail", oauth_code: "4/0Ab-code", oauth_state: state("gmail") });
    const shop = new URL(oauthCallbackRedirect(new URLSearchParams({ code: "abc123", state: state("shopify"), shop: "northwind.myshopify.com", hmac: "x" })), "https://app.test");
    expect(shop.searchParams.get("oauth_shop")).toBe("northwind.myshopify.com");
  });

  it("forwards the vendor's refusal, and sends anything else home", () => {
    const denied = new URL(oauthCallbackRedirect(new URLSearchParams({ error: "access_denied", state: state("notion") })), "https://app.test");
    expect(Object.fromEntries(denied.searchParams)).toEqual({ oauth_connector: "notion", oauth_error: "access_denied" });
    expect(oauthCallbackRedirect(new URLSearchParams({ code: "c0de", state: BUSINESS }))).toBe("/");
    expect(oauthCallbackRedirect(new URLSearchParams({ code: "c0de", state: `${Buffer.from(JSON.stringify({ b: BUSINESS, c: "../admin" })).toString("base64url")}.sig` }))).toBe("/");
    expect(oauthCallbackRedirect(new URLSearchParams({}))).toBe("/");
  });
});

describe("Settings › Integrations: finishing an OAuth connection", () => {
  it("connects only when the founder confirms it, then drops the code from the address", async () => {
    catalogue = [{ key: "notion", displayName: "Notion", phase: 1, auth: { kind: "oauth" }, tools: [], simulations: [], live: true, integration: null }];
    search = new URLSearchParams({ oauth_connector: "notion", oauth_code: "notion-code", oauth_state: state("notion") });
    renderTab();
    const button = await screen.findByRole("button", { name: "Connect Notion" });
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "notion", input: { code: "notion-code", state: state("notion") } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/b/${BUSINESS}/settings/integrations`));
  });

  it("explains a refusal and offers nothing to connect", () => {
    search = new URLSearchParams({ oauth_connector: "gmail", oauth_error: "access_denied" });
    renderTab();
    expect(screen.getByTestId("oauth-finish").textContent).toContain("You did not allow access");
    expect(screen.queryByRole("button", { name: /^Connect gmail/i })).toBeNull();
  });
});
