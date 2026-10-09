import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell, sidebarItemForTarget, withSidebarKeys, type AppShellProps } from "./AppShell";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import { kitBarGradient, kitStyle } from "./KitBar";
import { FIXTURE_TODAY, NORTHWIND_KIT, NORTHWIND_SEGMENTS, NORTHWIND_SIDEBAR, PALETTE_ITEMS } from "./fixtures";

beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {};
});

function shellProps(over: Partial<AppShellProps> = {}): AppShellProps {
  return {
    mode: "live",
    businessMode: "assisted",
    kit: NORTHWIND_KIT,
    businessName: "Northwind Skincare",
    screenTitle: "Home",
    sidebar: { items: NORTHWIND_SIDEBAR, activeId: "home", collapsed: false, onCollapsedChange: vi.fn() },
    continueButton: { state: { kind: "idle" }, onContinue: vi.fn() },
    stopAll: { onConfirm: vi.fn() },
    processing: { segments: NORTHWIND_SEGMENTS, active: true },
    date: FIXTURE_TODAY,
    runwayMonths: 11,
    viewportWidth: 1440,
    children: <p>Content</p>,
    ...over,
  };
}

describe("AppShell", () => {
  it("renders NeedsLargerWindow only, below 1280 px", () => {
    render(<AppShell {...shellProps({ viewportWidth: 1279 })} />);
    expect(screen.getByTestId("needs-larger-window")).toBeTruthy();
    expect(screen.getByText("This needs a larger window")).toBeTruthy();
    expect(screen.getByText("1279 px")).toBeTruthy();
    // No mark of any kind: the FM monogram is reserved for the favicon.
    expect(screen.getByTestId("needs-larger-window").querySelector("svg")).toBeNull();
    expect(screen.queryByTestId("app-shell")).toBeNull();
    expect(screen.queryByText("Content")).toBeNull();
  });

  it("renders the shell at 1280 px with the kit as CSS variables", () => {
    render(<AppShell {...shellProps({ viewportWidth: 1280 })} />);
    const root = screen.getByTestId("app-shell");
    expect(root.style.getPropertyValue("--kit-primary")).toBe("#2B6CB0");
    expect(root.style.getPropertyValue("--kit-secondary")).toBe("#FFFFFF");
    expect(root.style.getPropertyValue("--kit-on-primary")).toBe("#FFFFFF");
    expect(screen.getByTestId("kit-bar").style.backgroundImage).toContain("linear-gradient");
    expect(screen.getByTestId("kitbar-business-name").textContent).toBe("Northwind Skincare");
    expect(screen.getByTestId("kitbar-screen-title").textContent).toBe("Home");
    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getByRole("status", { name: /Cycle running/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByTestId("stop-all-trigger")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Network" })).toBeTruthy();
    expect(kitStyle({ primary: "#F5B841", secondary: "#000" })).toMatchObject({ "--kit-on-primary": "#0F1318" });
    expect(kitBarGradient(NORTHWIND_KIT)).toBe("linear-gradient(90deg, var(--kit-primary) 0%, #255D97 100%)");
  });

  it("draws the Foundmill wordmark in the sidebar foot when expanded and nothing for the brand when collapsed", () => {
    const { unmount } = render(<AppShell {...shellProps({ sidebar: { items: NORTHWIND_SIDEBAR, activeId: "home", collapsed: false, onCollapsedChange: vi.fn(), brand: { href: "/" } } })} />);
    const link = screen.getByRole("link", { name: "Foundmill" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.querySelectorAll("svg")).toHaveLength(1);
    unmount();
    render(<AppShell {...shellProps({ sidebar: { items: NORTHWIND_SIDEBAR, activeId: "home", collapsed: true, onCollapsedChange: vi.fn(), brand: { href: "/" } } })} />);
    expect(screen.queryByRole("link", { name: "Foundmill" })).toBeNull();
  });

  it("shows the business logo in the top bar, or the initials mark (never a shield) when there is none", () => {
    const { unmount } = render(<AppShell {...shellProps({ logoSrc: SAMPLE_LOGOS.stack })} />);
    const logo = screen.getByTestId("kitbar-logo");
    expect(logo.getAttribute("data-logo")).toBe("image");
    expect(logo.querySelector("img")?.getAttribute("src")).toBe(SAMPLE_LOGOS.stack);
    expect(logo.getAttribute("aria-label")).toBe("Northwind Skincare logo");
    unmount();
    render(<AppShell {...shellProps({ logoSrc: null })} />);
    const mark = screen.getByTestId("kitbar-logo");
    expect(mark.getAttribute("data-logo")).toBe("initials");
    expect(mark.querySelector("text")?.textContent).toBe("NS");
    expect(mark.querySelector("path")).toBeNull();
  });

  it("hides the LIVE block and chip in Personal mode", () => {
    render(<AppShell {...shellProps({ mode: "personal" })} />);
    expect(screen.queryByRole("link", { name: "Network" })).toBeNull();
    expect(screen.queryByText("LIVE")).toBeNull();
  });

  it("fills in sidebar chords and routes G chords to onNavigate", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const keyed = withSidebarKeys(NORTHWIND_SIDEBAR);
    expect(keyed.find((i) => i.id === "home")?.keys).toEqual(["G", "H"]);
    expect(keyed.find((i) => i.id === "crm")?.keys).toEqual(["G", "C"]);
    expect(keyed.find((i) => i.id === "d-finance")?.keys).toEqual(["G", "N"]);
    expect(keyed.find((i) => i.id === "settings")?.keys).toBeUndefined();
    expect(sidebarItemForTarget(keyed, { kind: "inbox" })?.id).toBe("inbox");
    expect(sidebarItemForTarget(keyed, { kind: "department", id: "d-team" })?.id).toBe("d-team");
    render(<AppShell {...shellProps({ onNavigate })} />);
    expect(screen.getByRole("link", { name: "Finance" }).getAttribute("aria-keyshortcuts")).toBe("G N");
    document.body.focus();
    await user.keyboard("gn");
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "d-finance" }));
    await user.keyboard("gi");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "inbox" }));
    await user.click(screen.getByRole("button", { name: "Northwind Skincare: go to Home" }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "home" }));
  });

  it("Space continues, / opens the palette, ? opens help, Esc closes them in order", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onSelect = vi.fn();
    const onEscape = vi.fn();
    render(<AppShell {...shellProps({ continueButton: { state: { kind: "idle" }, onContinue }, search: { items: PALETTE_ITEMS, onSelect }, keyboard: { onEscape } })} />);
    document.body.focus();
    await user.keyboard(" ");
    expect(onContinue).toHaveBeenCalledTimes(1);
    await user.keyboard("/");
    expect(await screen.findByTestId("command-palette")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("command-palette")).toBeNull());
    expect(onEscape).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("kitbar-search"));
    expect(await screen.findByTestId("command-palette")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("command-palette")).toBeNull());
    await user.keyboard("?");
    expect(await screen.findByTestId("keyboard-help")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("keyboard-help")).toBeNull());
    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("Space does nothing while Continue is blocked without a respond handler, and shows Respond · N (AC-11.3.3)", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<AppShell {...shellProps({ continueButton: { state: { kind: "blocked", count: 3 }, onContinue } })} />);
    expect(screen.getByRole("button", { name: "Respond to 3 items" }).textContent).toContain("Respond · 3");
    document.body.focus();
    await user.keyboard(" ");
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("renders tabs, breadcrumbs and the right rail", () => {
    render(
      <AppShell
        {...shellProps({
          tabs: { tabs: [{ id: "a", label: "Overview" }, { id: "b", label: "Cash" }, { id: "c", label: "Runway" }], activeId: "b" },
          breadcrumbs: [{ label: "Finance", href: "#" }, { label: "Cash" }],
          rightRail: { title: "Decision preview", open: true, onOpenChange: vi.fn(), children: <p>Rail body</p> },
        })}
      />,
    );
    expect(screen.getByRole("tab", { name: "Cash" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Finance");
    expect(screen.getByRole("complementary", { name: "Decision preview" })).toBeTruthy();
    expect(screen.getByText("Rail body")).toBeTruthy();
  });
});
