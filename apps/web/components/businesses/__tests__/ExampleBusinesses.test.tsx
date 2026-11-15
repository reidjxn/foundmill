import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_CHIP_TOOLTIP, ExampleBusinesses, LEAVE_EXAMPLE_CONSEQUENCE, splitExampleRows } from "../ExampleBusinesses";
import type { FounderBusiness } from "@/components/shell/business-switcher";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const row = (over: Partial<FounderBusiness>): FounderBusiness => ({
  id: "b1",
  name: "Northwind Skincare",
  slug: "northwind-skincare",
  role: "viewer",
  planTier: "pro",
  gameMode: "personal",
  businessMode: "assisted",
  isDemo: true,
  isExample: true,
  kitPrimary: "#2f6f5e",
  kitSecondary: "#f2c94c",
  createdAt: new Date("2026-10-07T09:30:00Z"),
  committedAt: new Date("2026-10-07T09:30:00Z"),
  agentsStopped: false,
  logo: null,
  ...over,
});

describe("Your businesses › Example (§12 item 5)", () => {
  it("splits the founder's own rows from their example rows", () => {
    const rows = [row({ id: "b1" }), row({ id: "b2", name: "Mine", role: "owner", isDemo: false, isExample: false })];
    expect(splitExampleRows(rows).own.map((r) => r.id)).toEqual(["b2"]);
    expect(splitExampleRows(rows).examples.map((r) => r.id)).toEqual(["b1"]);
    expect(splitExampleRows([])).toEqual({ own: [], examples: [] });
  });

  it("renders nothing without an example row", () => {
    const { container } = render(<ExampleBusinesses rows={[]} logos={{}} onLeave={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the example under its own heading with the chip, the line, Leave and Open", () => {
    render(<ExampleBusinesses rows={[row({})]} logos={{}} onLeave={() => {}} />);
    const panel = within(screen.getByTestId("example-businesses"));
    expect(panel.getByTestId("example-row-chip").textContent).toBe("Example");
    expect(panel.getByText("Northwind Skincare")).toBeTruthy();
    expect(panel.getByText("Viewer")).toBeTruthy();
    expect(panel.getByText(EXAMPLE_CHIP_TOOLTIP)).toBeTruthy();
    expect(panel.getByRole("link", { name: "Open Northwind Skincare" }).getAttribute("href")).toBe("/b/b1/today");
    expect(panel.getByRole("button", { name: "Leave Northwind Skincare" })).toBeTruthy();
    // No Settings: a viewer has none, and the example is nobody's to configure.
    expect(panel.queryByRole("link", { name: /Settings/ })).toBeNull();
  });

  it("Leave asks first, says the consequence (nothing deleted, reopens from New business), then leaves", () => {
    const onLeave = vi.fn();
    render(<ExampleBusinesses rows={[row({})]} logos={{}} onLeave={onLeave} />);
    expect(screen.queryByTestId("example-leave-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("example-leave"));
    const dialog = screen.getByTestId("example-leave-dialog");
    expect(within(dialog).getByText("Leave Northwind Skincare?")).toBeTruthy();
    expect(within(dialog).getByTestId("example-leave-consequence").textContent).toContain(LEAVE_EXAMPLE_CONSEQUENCE);
    expect(within(dialog).getByTestId("example-leave-consequence").textContent).toContain("Reversible");
    expect(LEAVE_EXAMPLE_CONSEQUENCE).toBe("Nothing is deleted; you can open it again from New business.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("example-leave"));
    fireEvent.click(screen.getByTestId("example-leave-confirm"));
    expect(onLeave).toHaveBeenCalledWith("b1");
  });
});
