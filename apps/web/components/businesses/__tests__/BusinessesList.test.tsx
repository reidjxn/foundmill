import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusinessesList, businessFacts } from "../BusinessesList";
import type { FounderBusiness } from "@/components/shell/business-switcher";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const row = (over: Partial<FounderBusiness>): FounderBusiness => ({
  id: "b1",
  name: "Northwind Skincare",
  slug: "northwind",
  role: "owner",
  planTier: "pro",
  gameMode: "personal",
  businessMode: "assisted",
  isDemo: true,
  isExample: false,
  kitPrimary: "#2B6CB0",
  kitSecondary: "#FFFFFF",
  createdAt: new Date("2026-10-07T09:30:00Z"),
  committedAt: null,
  agentsStopped: true,
  logo: null,
  ...over,
});

describe("BusinessesList (Your businesses › Active)", () => {
  it("shows each business's role, chips, facts, Agents stopped, Settings for owners and admins, and Open", () => {
    const rows = [row({}), row({ id: "b2", name: "Ledgerly", role: "admin", isDemo: false, agentsStopped: false, planTier: "scale" }), row({ id: "b3", name: "Tutorlane", role: "viewer", isDemo: false, agentsStopped: false })];
    const { container } = render(<BusinessesList rows={rows} logos={{}} lastBusinessId="b1" onCreate={() => {}} />);
    const nw = within(container.querySelector<HTMLElement>('[data-business-row="b1"]')!);
    for (const text of ["Northwind Skincare", "Owner", "Demo", "Last opened", "Pro plan · Assisted · Personal · Created Oct 7, 2026", "Agents stopped"]) expect(nw.getByText(text)).toBeTruthy();
    expect(nw.getByRole("link", { name: "Open Northwind Skincare" }).getAttribute("href")).toBe("/b/b1/home");
    expect(nw.getByRole("link", { name: "Settings of Northwind Skincare" }).getAttribute("href")).toBe("/b/b1/settings/business");
    expect(screen.getByRole("link", { name: "Settings of Ledgerly" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings of Tutorlane" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Tutorlane" })).toBeTruthy();
    expect(screen.getByText("3 businesses")).toBeTruthy();
  });

  it("says LIVE for a live business", () => {
    expect(businessFacts(row({ gameMode: "live", businessMode: "automated", planTier: "free" }))).toBe("Free plan · Automated · LIVE · Created Oct 7, 2026");
  });

  it("offers Create a new business when there is none, and says when the list did not load", () => {
    const onCreate = vi.fn();
    const { unmount } = render(<BusinessesList rows={[]} logos={{}} onCreate={onCreate} />);
    expect(screen.getByText("No businesses yet. Create one from an idea in the Ideation Studio, or import what already exists.")).toBeTruthy();
    screen.getByRole("button", { name: /Create a new business/ }).click();
    expect(onCreate).toHaveBeenCalledTimes(1);
    unmount();
    render(<BusinessesList rows={[]} logos={{}} error="Could not load your businesses." onRetry={() => {}} onCreate={onCreate} />);
    expect(screen.getByText("Could not load your businesses.")).toBeTruthy();
  });
});
