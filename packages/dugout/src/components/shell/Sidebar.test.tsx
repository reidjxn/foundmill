import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { APP_NAME } from "@foundmill/config";
import { MONOGRAM_HEIGHT, MONOGRAM_WIDTH, WORDMARK_HEIGHT, WORDMARK_WIDTH } from "../../brand/marks";
import { WORDMARK_ASPECT } from "../foundation/Wordmark";
import { NORTHWIND_SIDEBAR } from "./fixtures";
import { SIDEBAR_BRAND_HEIGHT, SIDEBAR_BRAND_ID, Sidebar, nextSidebarIndex, sidebarBadgeClass, sidebarItemName } from "./Sidebar";
import { TabBar, nextTabIndex, visibleTabCount } from "./TabBar";
import { DISTRIBUTION_TABS } from "./fixtures";

describe("Sidebar", () => {
  it("renders groups, the active edge, badges in department colour and the accessible count", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="d-distribution" collapsed={false} onCollapsedChange={() => {}} showLive />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-collapsed")).toBeNull();
    const active = screen.getByRole("link", { name: "Distribution, 2 items" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("data-active")).toBe("true");
    expect(active.querySelector("[data-active-edge]")?.className).toContain("sidebar-edge");
    expect(active.querySelector("[data-badge]")?.className).toContain("tone-dept-3");
    expect(active.querySelector("[data-dept-dot]")?.className).toContain("tone-dept-3");
    expect(screen.getByRole("link", { name: "Inbox, 3 items" }).querySelector("[data-badge]")?.className).toContain("tone-status-bad");
    expect(screen.getByRole("link", { name: "Network" })).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(sidebarItemName({ id: "x", label: "Inbox", icon: NORTHWIND_SIDEBAR[0]!.icon, group: "main", badge: 1 })).toBe("Inbox, 1 item");
    expect(sidebarBadgeClass({ badgeTone: "neutral" })).toBe("");
    expect(sidebarBadgeClass({ dept: "dept-6" })).toBe("tone-dept-6");
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

describe("Sidebar labels", () => {
  const long = "Retail Partnerships, Wholesale and Marketplace Distribution across the Nordics and the Baltics";
  const items = [...NORTHWIND_SIDEBAR.slice(0, 2), { id: "d-long", label: long, icon: NORTHWIND_SIDEBAR[2]!.icon, href: "#", group: "department" as const, dept: "dept-3" as const, badge: 2 }];

  it("lets a long founder-defined label wrap to two lines and fit, never clipped silently", () => {
    render(<Sidebar items={items} collapsed={false} onCollapsedChange={() => {}} />);
    const link = screen.getByRole("link", { name: `${long}, 2 items` });
    const label = link.querySelector("[data-sidebar-label]");
    expect(label?.textContent).toBe(long);
    // FitText with two lines: wrap first, step the size down, truncate with a tooltip only as the last resort.
    expect(label?.getAttribute("data-lines")).toBe("2");
    expect(link.className).toContain("sidebar-item");
  });

  it("names a collapsed item in a tooltip with its chord, and keeps the badge on the icon", async () => {
    const user = userEvent.setup();
    render(<Sidebar items={[{ ...items[2]!, keys: ["G", "R"] }]} collapsed onCollapsedChange={() => {}} />);
    const link = screen.getByRole("link", { name: `${long}, 2 items` });
    expect(link.querySelector(".sr-only")?.textContent).toBe(long);
    expect(link.querySelector("[data-badge]")?.getAttribute("data-collapsed")).toBe("true");
    await user.hover(link);
    expect((await screen.findAllByText(`${long}, 2 items`)).length).toBeGreaterThan(0);
  });
});

describe("Sidebar brand (the Foundmill wordmark in the foot)", () => {
  const brand = { href: "/" };

  it("is a link to the given href named after the product, drawn as the wordmark and nothing else", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="home" collapsed={false} onCollapsedChange={() => {}} brand={brand} />);
    const link = screen.getByRole("link", { name: APP_NAME });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.getAttribute("data-sidebar-item")).toBe(SIDEBAR_BRAND_ID);
    // One decorative SVG: the wordmark path at the sidebar cap height. No FM monogram (two paths) and no visible text.
    const svgs = link.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(svgs[0]!.getAttribute("height")).toBe(String(SIDEBAR_BRAND_HEIGHT));
    expect(svgs[0]!.getAttribute("width")).toBe(String(Math.round(SIDEBAR_BRAND_HEIGHT * WORDMARK_ASPECT)));
    expect(svgs[0]!.querySelectorAll("path")).toHaveLength(1);
    expect(link.textContent).toBe("");
    // It sits on the same inset as the item icons (both are sidebar rows: 10 px in from the rail, 10 px padding).
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(link.className).toContain("sidebar-item");
    expect(settings.className).toContain("sidebar-item");
  });

  it("closes the foot, after the last item and before the collapse toggle", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} collapsed={false} onCollapsedChange={() => {}} brand={brand} />);
    const key = screen.getByRole("link", { name: "Anthropic key" });
    const link = screen.getByRole("link", { name: APP_NAME });
    const toggle = screen.getByTestId("sidebar-toggle");
    expect(key.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not drawn when the sidebar is collapsed, and no mark takes its place", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="home" collapsed onCollapsedChange={() => {}} brand={brand} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(screen.queryByRole("link", { name: APP_NAME })).toBeNull();
    expect(nav.querySelector(`[data-sidebar-item="${SIDEBAR_BRAND_ID}"]`)).toBeNull();
    // No wordmark and no FM monogram anywhere in the collapsed sidebar: only the items' Lucide icons remain.
    expect(nav.querySelector(`svg[viewBox="0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}"]`)).toBeNull();
    expect(nav.querySelector(`svg[viewBox="0 0 ${MONOGRAM_WIDTH} ${MONOGRAM_HEIGHT}"]`)).toBeNull();
  });

  it("is not drawn without the brand prop", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} collapsed={false} onCollapsedChange={() => {}} />);
    expect(screen.queryByRole("link", { name: APP_NAME })).toBeNull();
  });

  it("takes part in arrow-key navigation as the last stop, wrapping to the first", async () => {
    const user = userEvent.setup();
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="home" collapsed={false} onCollapsedChange={() => {}} brand={brand} />);
    const home = screen.getByRole("link", { name: "Home" });
    const link = screen.getByRole("link", { name: APP_NAME });
    expect(link.tabIndex).toBe(-1);
    home.focus();
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(link);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Anthropic key" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(link);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(home);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(home);
  });

  it("leaves the remaining items' arrow-key order unchanged when collapsed", async () => {
    const user = userEvent.setup();
    render(<Sidebar items={NORTHWIND_SIDEBAR} activeId="home" collapsed onCollapsedChange={() => {}} brand={brand} />);
    const home = screen.getByRole("link", { name: "Home" });
    home.focus();
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Anthropic key" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(home);
  });

  it("is the focus stop of the nav when there are no enabled items", () => {
    render(<Sidebar items={[]} collapsed={false} onCollapsedChange={() => {}} brand={brand} />);
    expect(screen.getByRole("link", { name: APP_NAME }).tabIndex).toBe(0);
  });

  it("uses a custom accessible name when given", () => {
    render(<Sidebar items={NORTHWIND_SIDEBAR} collapsed={false} onCollapsedChange={() => {}} brand={{ href: "/home", label: "Foundmill home" }} />);
    expect(screen.getByRole("link", { name: "Foundmill home" }).getAttribute("href")).toBe("/home");
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
    const first = screen.getByRole("tab", { name: /^Board$/ });
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

  it("puts counts in a pill, red with ink when the count needs the founder", () => {
    render(<TabBar tabs={[{ id: "all", label: "All" }, { id: "respond", label: "Respond", badge: 4, badgeTone: "bad" }, { id: "archive", label: "Archive", badge: 23 }]} activeId="all" />);
    expect(screen.getByLabelText("4 items").getAttribute("data-tone")).toBe("bad");
    expect(screen.getByLabelText("23 items").getAttribute("data-tone")).toBeNull();
    // Before the bar is measured, the active tab draws its own static bar.
    expect(screen.getByRole("tab", { name: /All/ }).querySelector("[data-tab-bar]")).not.toBeNull();
  });

  it("counts how many tabs fit before the rest move into More", () => {
    expect(visibleTabCount([80, 80, 80], 300, 4, 70)).toBe(3);
    expect(visibleTabCount([80, 80, 80, 80], 300, 4, 70)).toBe(2);
    expect(visibleTabCount([400], 300, 4, 70)).toBe(1);
    expect(visibleTabCount([80, 80], 0, 4, 70)).toBe(2);
    expect(visibleTabCount([], 300, 4, 70)).toBe(0);
  });

  it("moves the tabs that do not fit into a More menu, which takes the active tab's name when it holds it", async () => {
    const user = userEvent.setup();
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    // A 350 px bar and 100 px tabs: two tabs and More fit.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return this.parentElement?.getAttribute("role") === "tablist" || this.getAttribute("role") === "tab" ? 100 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get(this: HTMLElement) { return this.firstElementChild?.getAttribute("role") === "tablist" ? 350 : 0; } });
    try {
      const onChange = vi.fn();
      const { rerender } = render(<TabBar tabs={DISTRIBUTION_TABS} activeId="formation" onChange={onChange} />);
      const more = await screen.findByRole("button", { name: "More tabs" });
      expect(screen.getAllByRole("tab").filter((t) => !t.closest("[aria-hidden=true]")).map((t) => t.id)).toEqual(["tab-formation", "tab-channels"]);
      await user.click(more);
      await user.click(await screen.findByRole("menuitem", { name: "Creative" }));
      expect(onChange).toHaveBeenCalledWith("creative");
      rerender(<TabBar tabs={DISTRIBUTION_TABS} activeId="attribution" onChange={onChange} />);
      expect(await screen.findByRole("button", { name: "More tabs, Attribution selected" })).toBeTruthy();
    } finally {
      if (offset) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offset);
      else delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
      if (client) Object.defineProperty(HTMLElement.prototype, "clientWidth", client);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });
});
