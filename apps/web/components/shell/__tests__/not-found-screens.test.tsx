// @vitest-environment happy-dom
/**
 * An unknown settings section or agent address inside a business (audit IAE-15): the page says what is missing (the
 * section, the agent or the tab) and links back inside the business, instead of "No business at this address".
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const AGENT = "37d03d31-2afd-4bdd-adbf-2a82479eadf3";
const nav = vi.hoisted(() => ({ params: {} as Record<string, string>, push: vi.fn(), chrome: vi.fn() }));

vi.mock("next/navigation", () => ({ useParams: () => nav.params, useRouter: () => ({ push: nav.push }) }));
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: nav.chrome }));
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({ businessId: BUSINESS, departments: [{ id: "d1", slug: "team", name: "Team", moduleKeys: ["team"], tabs: [{ slug: "squad", title: "Agents", position: 0 }] }] }),
}));

import { AgentNotFound } from "@/components/agents/AgentNotFound";
import { SettingsTabNotFound } from "@/components/settings/SettingsTabNotFound";

const mount = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

beforeEach(() => {
  nav.push.mockClear();
  nav.chrome.mockClear();
});

describe("not-found screens inside a business", () => {
  it("an unknown settings section names the section and opens Business settings", () => {
    nav.params = { bid: BUSINESS, tab: "nope" };
    mount(<SettingsTabNotFound />);
    expect(screen.getByText("No such settings tab")).toBeTruthy();
    expect(document.body.textContent).toContain("“nope” is not a section of Settings.");
    expect(document.body.textContent).not.toMatch(/No business at this address/);
    expect(nav.chrome.mock.calls[0]![0]).toMatchObject({ title: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Open Business settings" }));
    expect(nav.push).toHaveBeenCalledWith(`/b/${BUSINESS}/settings/business`);
  });

  it("an address that is not an agent id says there is no such agent and opens the Agents tab", () => {
    nav.params = { bid: BUSINESS, agentId: "not-a-uuid", tab: "overview" };
    mount(<AgentNotFound />);
    expect(screen.getByText("No such agent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Agents" }));
    expect(nav.push).toHaveBeenCalledWith(`/b/${BUSINESS}/d/team/squad`);
  });

  it("an unknown agent tab names the tab and opens the agent's Overview", () => {
    nav.params = { bid: BUSINESS, agentId: AGENT, tab: "profile" };
    mount(<AgentNotFound />);
    expect(screen.getByText("No such tab")).toBeTruthy();
    expect(document.body.textContent).toContain("“profile” is not a tab of an agent profile.");
    fireEvent.click(screen.getByRole("button", { name: "Open Overview" }));
    expect(nav.push).toHaveBeenCalledWith(`/b/${BUSINESS}/agents/${AGENT}/overview`);
  });
});
