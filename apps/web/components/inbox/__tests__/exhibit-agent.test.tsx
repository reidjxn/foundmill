// @vitest-environment happy-dom
/**
 * The agent tile exhibit (audit WEB-20): the agent's name is an EntityLink like every other mention, so a click goes
 * through the shell's EntityLink provider (client-side navigation) instead of a plain anchor that reloads the app.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityLinkProvider, TooltipProvider } from "@foundmill/dugout";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const AGENT = "37d03d31-2afd-4bdd-adbf-2a82479eadf3";

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({ dev: { tasks: { list: { queryOptions: (input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["dev", "tasks", "list"], input], queryFn: async () => ({ items: [] }), ...opts }) } } } }),
}));
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({
    businessId: BUSINESS,
    departments: [{ id: "d1", name: "Development", colourToken: "dept-2", squad: [{ id: AGENT, name: "Engineering Lead", role: "Lead engineer", status: "idle", modelKey: "balanced", avatarSeed: "s1" }] }],
  }),
}));

import { Exhibit } from "../Exhibit";

describe("Exhibit agent tile", () => {
  it("renders the agent's name as an EntityLink that opens through the provider", () => {
    const onOpen = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <EntityLinkProvider value={{ onOpen }}>
            <Exhibit exhibit={{ kind: "agent_tile", specRef: AGENT }} entityIds={[]} fromAgentId={null} currency="USD" />
          </EntityLinkProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const link = screen.getByTestId("exhibit-agent-link");
    expect(link.getAttribute("data-entity-kind")).toBe("agent");
    expect(link.getAttribute("data-entity-id")).toBe(AGENT);
    expect(link.getAttribute("href")).toBe(`/b/${BUSINESS}/agents/${AGENT}/overview`);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    // The provider navigates; the browser's own full-page navigation is prevented.
    expect(click.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: AGENT, kind: "agent", name: "Engineering Lead" }), expect.anything());
  });
});
