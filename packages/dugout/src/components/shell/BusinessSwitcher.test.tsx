import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusinessSwitcher, filterSwitcherBusinesses, orderSwitcherBusinesses, type KitBarBusinessMenu } from "./BusinessSwitcher";
import { MANY_SWITCHER_BUSINESSES, SWITCHER_BUSINESSES } from "./fixtures";

beforeAll(() => {
  // cmdk scrolls the selected item into view; happy-dom has no layout.
  if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {};
});

function setup(over: Partial<KitBarBusinessMenu> = {}, onHome = vi.fn()) {
  const menu: KitBarBusinessMenu = { businesses: SWITCHER_BUSINESSES, onOpenBusiness: vi.fn(), onNewBusiness: vi.fn(), onManageBusinesses: vi.fn(), onProfile: vi.fn(), onPublicProfile: vi.fn(), onIntent: vi.fn(), ...over };
  const user = userEvent.setup();
  render(
    <BusinessSwitcher businessName="Northwind Skincare" menu={menu} onHome={onHome}>
      <span>Northwind Skincare</span>
    </BusinessSwitcher>,
  );
  const trigger = screen.getByRole("button", { name: /^Switch business: Northwind Skincare$/ });
  const open = async () => {
    await user.click(trigger);
    return screen.findByRole("dialog", { name: "Switch business" });
  };
  return { menu, onHome, user, trigger, open };
}

describe("orderSwitcherBusinesses / filterSwitcherBusinesses", () => {
  it("puts the current business first, then A to Z ignoring case", () => {
    const list = [{ name: "zed" }, { name: "Beta" }, { name: "alpha" }, { name: "Mid", current: true }];
    expect(orderSwitcherBusinesses(list).map((b) => b.name)).toEqual(["Mid", "alpha", "Beta", "zed"]);
  });
  it("ranks a name prefix over a word prefix over anywhere, and keeps everything for an empty query", () => {
    const list = [{ name: "Swiftledger Payroll" }, { name: "Open Ledger" }, { name: "Ledgerly" }, { name: "Tutorlane" }];
    expect(filterSwitcherBusinesses(list, "LED").map((b) => b.name)).toEqual(["Ledgerly", "Open Ledger", "Swiftledger Payroll"]);
    expect(filterSwitcherBusinesses(list, "  ")).toHaveLength(4);
    expect(filterSwitcherBusinesses(list, "zz")).toEqual([]);
  });
});

describe("BusinessSwitcher", () => {
  it("names the trigger, shows the tooltip and asks the host to load on pointer and focus", async () => {
    const { menu, user, trigger } = setup();
    await user.hover(trigger);
    expect(menu.onIntent).toHaveBeenCalled();
    expect((await screen.findAllByText("Switch business")).length).toBeGreaterThan(0);
    trigger.blur();
    trigger.focus();
    expect((menu.onIntent as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("adds the caption's line under Switch business in its one tooltip (the sample business)", async () => {
    const user = userEvent.setup();
    const menu: KitBarBusinessMenu = { businesses: SWITCHER_BUSINESSES, onOpenBusiness: vi.fn() };
    render(
      <BusinessSwitcher businessName="Northwind Skincare" menu={menu} tooltipLine="Its figures are made up for the example.">
        <span>Northwind Skincare</span>
        <span data-testid="caption">Sample business</span>
      </BusinessSwitcher>,
    );
    await user.hover(screen.getByTestId("caption"));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain("Switch business");
    expect(tip.textContent).toContain("Its figures are made up for the example.");
  });

  it("opens a dialog listing the current business first and checked, with Demo and role chips", async () => {
    const { open } = setup();
    await open();
    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toContain("Northwind Skincare");
    expect(options[0]?.textContent).toContain("Current business");
    expect(screen.getByRole("option", { name: /Ledgerly/ }).textContent).toContain("Demo");
    expect(screen.getByRole("option", { name: /Tutorlane/ }).textContent).toContain("Admin");
    expect(screen.queryByRole("combobox", { name: "Find a business" })).toBeNull();
  });

  it("opens another business, or Home for the current one, and closes", async () => {
    const { menu, onHome, user, open } = setup();
    await open();
    await user.click(screen.getByRole("option", { name: /Ledgerly/ }));
    expect(menu.onOpenBusiness).toHaveBeenCalledWith("lg");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await open();
    await user.click(screen.getByRole("option", { name: /Northwind Skincare/ }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(menu.onOpenBusiness).toHaveBeenCalledTimes(1);
  });

  it("each action calls its callback", async () => {
    const { menu, onHome, user, open } = setup();
    for (const [label, fn] of [
      ["Create a new business", menu.onNewBusiness],
      ["Manage businesses", menu.onManageBusinesses],
      ["Today", onHome],
      ["Your profile", menu.onProfile],
      ["Your public profile", menu.onPublicProfile],
    ] as const) {
      await open();
      await user.click(screen.getByRole("option", { name: new RegExp(`^${label}$`) }));
      expect(fn, label).toHaveBeenCalledTimes(1);
    }
  });

  it("gives the focus back to the trigger on Escape", async () => {
    const { user, trigger, open } = setup();
    await open();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("picks with the arrow keys and Enter", async () => {
    const { menu, user, open } = setup();
    await open();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(menu.onOpenBusiness).toHaveBeenCalledWith("lg");
  });

  it("from six businesses, a focused filter narrows the list and says when nothing matches", async () => {
    const { user, open } = setup({ businesses: MANY_SWITCHER_BUSINESSES });
    await open();
    const filter = screen.getByRole("combobox", { name: "Find a business" });
    await waitFor(() => expect(document.activeElement).toBe(filter));
    await user.type(filter, "led");
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.filter((n) => /Ledgerly|Swiftledger/.test(n))).toHaveLength(2);
    expect(names.some((n) => n.includes("Tutorlane"))).toBe(false);
    expect(names.some((n) => n.includes("Create a new business"))).toBe(true);
    await user.clear(filter);
    await user.type(filter, "zz");
    expect(screen.getByText("No business found for “zz”.")).toBeTruthy();
  });

  it("says when the list is loading or did not load, and retries", async () => {
    const onRetry = vi.fn();
    const { user, open } = setup({ loading: true, error: "Could not load your other businesses.", onRetry });
    await open();
    expect(screen.getByText("Loading your businesses")).toBeTruthy();
    expect(screen.getByText("Could not load your other businesses.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is busy while another business opens", () => {
    const { trigger } = setup({ pendingBusinessId: "lg" });
    expect(trigger.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Opening Ledgerly…");
  });
});
