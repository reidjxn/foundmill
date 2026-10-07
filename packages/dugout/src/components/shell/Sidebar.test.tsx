import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NORTHWIND_SIDEBAR } from "./fixtures";
import { Sidebar, nextSidebarIndex, sidebarBadgeClass, sidebarItemName } from "./Sidebar";
import { TabBar, nextTabIndex } from "./TabBar";
import { DISTRIBUTION_TABS } from "./fixtures";

describe("Sidebar", () => {
  it("renders groups, the active edge, badges in department colour and the accessible count", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="d-distribution" collapsed={false} onCollapsedChange={() => {}} showLive />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-collapsed")).toBeNull();
    const active = screen.getByRole("link", { name: "Distribution, 2 items" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.querySelector("[data-active-edge]")?.className).toContain("bg-kit-primary");
    expect(active.querySelector("[data-badge]")?.className).toContain("bg-dept-3");
    expect(active.querySelector("[data-dept-dot]")?.className).toContain("bg-dept-3");
    expect(screen.getByRole("link", { name: "Inbox, 3 items" }).querySelector("[data-badge]")?.className).toContain("bg-status-bad");
    expect(screen.getByRole("link", { name: "Network" })).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(sidebarItemName({ id: "x", label: "Inbox", icon: NORTHWIND_SIDEBAR[0]!.icon, group: "main", badge: 1 })).toBe("Inbox, 1 item");
    expect(sidebarBadgeClass({ badgeTone: "neutral" })).toContain("bg-panel-alt");
  });

  it("hides the LIVE block in Personal mode", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} collapsed={false} onCollapsedChange={() => {}} showLive={false} />);
    expect(screen.queryByRole("link", { name: "Network" })).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("collapses to icons with sr-only labels and a toggle", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="home" collapsed onCollapsedChange={onCollapsedChange} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-collapsed")).toBe("true");
    expect(nav.className).toContain("w-sidebar-collapsed");
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.querySelector(".sr-only")?.textContent).toBe("Home");
    // Badges survive collapse.
    expect(screen.getByRole("link", { name: "Inbox, 3 items" }).querySelector("[data-badge]")).not.toBeNull();
    const toggle = screen.getByTestId("sidebar-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("moves focus with arrow keys, wrapping, and activates with Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="home" collapsed={false} onCollapsedChange={() => {}} onSelect={onSelect} />);
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.tabIndex).toBe(0);
    expect(screen.getByRole("link", { name: "CRM" }).tabIndex).toBe(-1);
    home.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Inbox, 3 items" }));
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Anthropic key" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(home);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Anthropic key" }));
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "key" }));
    expect(nextSidebarIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextSidebarIndex("x", 0, 3)).toBeNull();
  });
});

describe("TabBar", () => {
  it("wraps arrow navigation and skips disabled tabs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tabs = [...DISTRIBUTION_TABS.slice(0, 3), { id: "off", label: "Off", disabled: true }, DISTRIBUTION_TABS[3]!];
    render(<TabBar tabs={tabs} activeId="formation" activeSubViewId="paid" onChange={onChange} />);
    const list = screen.getByRole("tablist", { name: "Screen tabs" });
    expect(list.querySelectorAll('[role="tab"]').length).toBe(5);
    const first = screen.getByRole("tab", { name: /Formation/ });
    expect(first.getAttribute("aria-selected")).toBe("true");
    first.focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Campaigns/ }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Campaigns/ }));
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("campaigns");
    expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextTabIndex("Home", 3, 4)).toBe(0);
  });

  it("shows a caret for tabs with sub-views and the active sub-view name", () => {
    render(<TabBar tabs={DISTRIBUTION_TABS} activeId="channels" activeSubViewId="paid" />);
    expect(screen.getByRole("button", { name: "Channels views" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Channels/ }).textContent).toContain("Paid");
    expect(screen.getByRole("tab", { name: /Leads/ }).textContent).toContain("12");
    expect(screen.queryByRole("button", { name: "Formation views" })).toBeNull();
  });
});
