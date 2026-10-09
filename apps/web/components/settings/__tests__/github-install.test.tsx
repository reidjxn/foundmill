// @vitest-environment happy-dom
/**
 * Connecting the GitHub App: GitHub's callback URL (app/integrations/github/callback) only forwards the installation id,
 * its one-time code and the api-signed state to the business's Integrations tab, where the founder's click connects it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { githubSetupRedirect } from "@/app/integrations/github/callback/route";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const connect = vi.fn(async (vars: unknown) => ({ integration: { id: "i1" }, record: { accountLabel: "acme" }, consentUrl: null, founderConsentRequired: false, vars }));
const replace = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ replace }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
      list: { queryOptions: () => ({ queryKey: [["integrations", "list"]], queryFn: async () => ({ mode: "mock", integrations: [], catalogue: [] }) }) },
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
});

/** A state as the api signs it: base64url JSON naming the business, then a signature the web never checks. */
const STATE = `${Buffer.from(JSON.stringify({ b: BUSINESS, u: "user-1", exp: 4102444800, n: "abcdefghijkl" })).toString("base64url")}.c2lnbmF0dXJl`;

describe("GitHub App callback URL", () => {
  it("forwards the installation id, GitHub's code and the signed state to the business the state names", () => {
    const to = new URL(githubSetupRedirect(new URLSearchParams({ installation_id: "48213377", code: "c0de", state: STATE, setup_action: "install" })), "https://app.test");
    expect(to.pathname).toBe(`/b/${BUSINESS}/settings/integrations`);
    expect(Object.fromEntries(to.searchParams)).toEqual({ github_installation: "48213377", github_state: STATE, github_code: "c0de" });
  });

  it("sends anything else home", () => {
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "1; drop", code: "c0de", state: STATE }))).toBe("/");
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "1", code: "c0de", state: BUSINESS }))).toBe("/");
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "1", state: `${Buffer.from(JSON.stringify({ b: "../../admin" })).toString("base64url")}.sig` }))).toBe("/");
    expect(githubSetupRedirect(new URLSearchParams({}))).toBe("/");
    // A malformed code is dropped (the page then asks for a fresh installation) rather than forwarded.
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "1", code: "<script>", state: STATE }))).not.toContain("github_code");
  });
});

describe("Settings › Integrations: finishing the GitHub connection", () => {
  it("connects the installation only when the founder confirms it, then drops it from the address", async () => {
    search = new URLSearchParams({ github_installation: "48213377", github_code: "c0de", github_state: STATE });
    renderTab();
    expect(screen.getByTestId("github-installation").textContent).toContain("GitHub installation 48213377 is ready");
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect installation" }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "github", input: { installationId: 48213377, code: "c0de", state: STATE } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/b/${BUSINESS}/settings/integrations`));
  });

  it("offers no connect without GitHub's code, and nothing without a valid installation id", () => {
    search = new URLSearchParams({ github_installation: "48213377", github_state: STATE });
    renderTab();
    expect(screen.getByTestId("github-installation").textContent).toContain("GitHub did not confirm who installed installation 48213377");
    expect(screen.queryByRole("button", { name: "Connect installation" })).toBeNull();
  });

  it("shows nothing to confirm without a valid installation id", () => {
    search = new URLSearchParams({ github_installation: "abc" });
    renderTab();
    expect(screen.queryByTestId("github-installation")).toBeNull();
  });
});
