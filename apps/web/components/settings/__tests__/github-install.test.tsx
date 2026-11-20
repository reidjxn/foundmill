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
const setRepository = vi.fn(async (vars: unknown) => ({ repository: null, vars }));
let repositoryState: { connected: boolean; status: string | null; repository: { fullName: string; owner: string; repo: string; writeEnabled: boolean } | null; simulated: boolean } = { connected: true, status: "connected", repository: null, simulated: false };
let search = new URLSearchParams();
let catalogue: unknown[] = [];

vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ replace }), usePathname: () => `/b/${BUSINESS}/settings/integrations` }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    dev: {
      code: {
        repository: { queryOptions: () => ({ queryKey: [["dev", "code", "repository"]], queryFn: async () => repositoryState }) },
        setRepository: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["dev", "code", "setRepository"]], mutationFn: (vars: unknown) => setRepository(vars), ...opts }) },
      },
    },
    integrations: {
      platformMail: { queryOptions: () => ({ queryKey: [["integrations", "platformMail"]], queryFn: async () => null }) },
      list: { queryOptions: () => ({ queryKey: [["integrations", "list"]], queryFn: async () => ({ mode: "mock", integrations: [], catalogue }) }) },
      connect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "connect"]], mutationFn: (vars: unknown) => connect(vars), ...opts }) },
      disconnect: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "disconnect"]], mutationFn: vi.fn(), ...opts }) },
      health: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "health"]], mutationFn: vi.fn(), ...opts }) },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business: {} }, departments: [{ id: "d-dev", name: "Formulation Lab", slug: "development", position: 1, hidden: false, moduleKeys: ["development"], tabs: [{ id: "t-code", slug: "code", title: "Code", position: 3 }] }] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved: vi.fn(), failed: vi.fn(), info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));

import { IntegrationsTab, modeLabel, navigation, showsModeChip } from "../IntegrationsTab";

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
  setRepository.mockClear();
  repositoryState = { connected: true, status: "connected", repository: null, simulated: false };
  replace.mockClear();
  search = new URLSearchParams();
  catalogue = [];
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
    // The Code tab is named by the department over the Development module, as the founder named it.
    expect(screen.getByTestId("github-installation").textContent).toContain("choose the repository below.");
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

describe("Settings › Integrations on a person's project where connectors are not live (WP-02 T3)", () => {
  it("a connector that cannot be connected here is hidden (LAUNCH_EVALUATION §2, MCP 6) and the section drops Test mode", async () => {
    catalogue = [
      { key: "sendgrid", displayName: "SendGrid", phase: 1, auth: { kind: "api_key" }, tools: [], simulations: [], live: false, available: false, integration: null },
      { key: "github", displayName: "GitHub", phase: 1, auth: { kind: "app" }, tools: [], simulations: [], live: true, available: true, integration: null },
    ];
    renderTab();
    await screen.findByText("GitHub");
    expect(screen.queryByText("SendGrid")).toBeNull();
    expect(screen.queryByText("Not available yet")).toBeNull();
    expect(screen.queryByText(/Test mode/)).toBeNull();
    expect(showsModeChip("mock", [{ live: false, available: true }])).toBe(true);
    expect(showsModeChip("mock", [{ live: false }])).toBe(true);
    expect(showsModeChip("live", [{ live: false, available: false }])).toBe(true);
  });
});

describe("Settings › Integrations: starting the GitHub connection", () => {
  it("goes to GitHub's installation page in this tab (a new tab opened after the request would be a blocked pop-up)", async () => {
    catalogue = [{ key: "github", displayName: "GitHub", phase: 1, auth: { kind: "app" }, tools: [], simulations: [], live: true, integration: null }];
    const install = "https://github.com/apps/foundmill/installations/new?state=abc.def";
    connect.mockImplementationOnce(async (vars: unknown) => ({ integration: null, record: { accountLabel: null }, consentUrl: install, founderConsentRequired: true, vars }) as never);
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    const open = vi.spyOn(window, "open");
    renderTab();
    expect(await screen.findByText("Test mode · GitHub live")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(install));
    expect(open).not.toHaveBeenCalled();
    assign.mockRestore();
    open.mockRestore();
  });

  it("names the connectors that run live while the rest are simulated", () => {
    expect(modeLabel("mock", [{ displayName: "GitHub", live: true }, { displayName: "Stripe", live: false }])).toBe("Test mode · GitHub live");
    expect(modeLabel("mock", [{ displayName: "Stripe" }])).toBe("Test mode");
    expect(modeLabel("live", [])).toBe("Live");
  });
});

describe("Settings › Integrations: choosing the repository (WP-07 T11)", () => {
  const github = (status: string) => [{ key: "github", displayName: "GitHub", phase: 1, auth: { kind: "app" }, tools: [], simulations: [], live: true, integration: { id: "i1", status, scopes: [], accountLabel: "acme" } }];

  it("a connected GitHub shows the panel; saving sends the repository and the push switch (off unless turned on)", async () => {
    catalogue = github("connected");
    renderTab();
    const panel = await screen.findByTestId("github-repository");
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: " acme/shop " } });
    fireEvent.click(screen.getByRole("button", { name: "Save repository" }));
    await waitFor(() => expect(setRepository).toHaveBeenCalledWith({ businessId: BUSINESS, repository: "acme/shop", pushEnabled: false }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Let the team push its work to this repository/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save repository" }));
    await waitFor(() => expect(setRepository).toHaveBeenLastCalledWith({ businessId: BUSINESS, repository: "acme/shop", pushEnabled: true }));
    expect(panel.textContent).toContain("This repository has no commits yet. Add a first commit with a README, then choose it again; the team cannot start an empty repository.");
  });

  it("shows the chosen repository and can forget it; nothing shows without a connected GitHub", async () => {
    catalogue = github("connected");
    repositoryState = { ...repositoryState, repository: { fullName: "acme/shop", owner: "acme", repo: "shop", writeEnabled: true } };
    renderTab();
    const input = (await screen.findByLabelText("Repository")) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("acme/shop"));
    fireEvent.click(screen.getByRole("button", { name: "Forget repository" }));
    await waitFor(() => expect(setRepository).toHaveBeenCalledWith({ businessId: BUSINESS, repository: null, pushEnabled: false }));
  });

  it("is absent when GitHub is not connected", async () => {
    catalogue = github("disconnected");
    renderTab();
    await screen.findByText("GitHub");
    expect(screen.queryByTestId("github-repository")).toBeNull();
  });
});
