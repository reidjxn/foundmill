// @vitest-environment happy-dom
/**
 * Connecting the GitHub App: GitHub's setup URL (app/integrations/github/callback) only forwards a numeric installation
 * id to the business's Integrations tab, where the founder's click connects it.
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

describe("GitHub App setup URL", () => {
  it("forwards a numeric installation id and a business id, nothing else", () => {
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "48213377", state: BUSINESS, setup_action: "install" }))).toBe(`/b/${BUSINESS}/settings/integrations?github_installation=48213377`);
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "1; drop", state: BUSINESS }))).toBe("/");
    expect(githubSetupRedirect(new URLSearchParams({ installation_id: "1", state: "../../admin" }))).toBe("/");
    expect(githubSetupRedirect(new URLSearchParams({}))).toBe("/");
  });
});

describe("Settings › Integrations: finishing the GitHub connection", () => {
  it("connects the installation only when the founder confirms it, then drops it from the address", async () => {
    search = new URLSearchParams({ github_installation: "48213377" });
    renderTab();
    expect(screen.getByTestId("github-installation").textContent).toContain("GitHub installation 48213377 is ready");
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect installation" }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ businessId: BUSINESS, connectorKey: "github", input: { installationId: 48213377 } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/b/${BUSINESS}/settings/integrations`));
  });

  it("shows nothing to confirm without a valid installation id", () => {
    search = new URLSearchParams({ github_installation: "abc" });
    renderTab();
    expect(screen.queryByTestId("github-installation")).toBeNull();
  });
});
