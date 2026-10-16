import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell, KIT_VARIABLES, sidebarItemForTarget, withSidebarKeys, type AppShellProps } from "./AppShell";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import { kitBarGradient, kitStyle } from "./KitBar";
import { kitRamp } from "../../lib/colour";
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
    // No mark of any kind (the FM monogram is reserved for the favicon): the only image is the Lucide monitor glyph.
    const svgs = [...screen.getByTestId("needs-larger-window").querySelectorAll("svg")];
    expect(svgs.every((svg) => svg.classList.contains("lucide"))).toBe(true);
    expect(svgs.length).toBe(1);
    expect(screen.queryByTestId("app-shell")).toBeNull();
    expect(screen.queryByText("Content")).toBeNull();
  });

  it("renders the shell at 1280 px with the kit as CSS variables", () => {
    render(<AppShell {...shellProps({ viewportWidth: 1280 })} />);
    const root = screen.getByTestId("app-shell");
    expect(root.style.getPropertyValue("--kit-primary")).toBe("#2B6CB0");
    expect(root.style.getPropertyValue("--kit-secondary")).toBe("#FFFFFF");
    expect(root.style.getPropertyValue("--kit-on-primary")).toBe("#FFFFFF");
    // The glass slab: gloss, the brand gradient, the specular streak and the cast light are CSS on kitbar-slab.
    expect(screen.getByTestId("kit-bar").className).toContain("kitbar-slab");
    expect(screen.getByTestId("kitbar-business-name").textContent).toBe("Northwind Skincare");
    expect(screen.getByTestId("kitbar-screen-title").textContent).toBe("Home");
    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getByRole("status", { name: /Cycle running/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByTestId("stop-all-trigger")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Network" })).toBeTruthy();
    expect(kitStyle({ primary: "#F5B841", secondary: "#000" })).toMatchObject({ "--kit-on-primary": "#0F1318" });
    // The brand ramp is derived from the primary in OKLCH and written beside it.
    const ramp = kitRamp("#2B6CB0");
    expect(root.style.getPropertyValue("--kit-lift")).toBe(ramp.lift);
    expect(root.style.getPropertyValue("--kit-hi")).toBe(ramp.hi);
    expect(root.style.getPropertyValue("--kit-lo")).toBe(ramp.lo);
    expect(root.style.getPropertyValue("--kit-deep")).toBe(ramp.deep);
    expect(root.style.getPropertyValue("--kit-aura")).toBe(ramp.aura);
    expect(kitBarGradient(NORTHWIND_KIT)).toBe("linear-gradient(90deg, var(--kit-primary) 0%, #255D97 100%)");
  });

  it("leaves the brand ramp to the stylesheet's steel defaults when the primary is not a hex colour", () => {
    const style = kitStyle({ primary: "var(--dept-2)", secondary: "#FFFFFF" }) as Record<string, unknown>;
    expect(style["--kit-primary"]).toBe("var(--dept-2)");
    for (const key of ["--kit-on-primary", "--kit-lift", "--kit-hi", "--kit-lo", "--kit-deep", "--kit-aura"]) expect(style[key]).toBeUndefined();
    expect((kitStyle({ primary: "2E7D6B", secondary: "#FFFFFF" }) as Record<string, unknown>)["--kit-lift"]).toBe(kitRamp("#2E7D6B").lift);
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

  it("the logo and name are Switch business: the founder's other businesses, Create a new business and Home (audit IAE-08)", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onOpenBusiness = vi.fn();
    const onNewBusiness = vi.fn();
    const businessMenu = { businesses: [{ id: "nw", name: "Northwind Skincare", current: true }, { id: "lg", name: "Ledgerly" }], onOpenBusiness, onNewBusiness };
    render(<AppShell {...shellProps({ onNavigate, businessMenu })} />);
    const trigger = screen.getByRole("button", { name: "Switch business: Northwind Skincare" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /Ledgerly/ }));
    expect(onOpenBusiness).toHaveBeenCalledWith("lg");
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /Create a new business/ }));
    expect(onNewBusiness).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /^Home$/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "home" }));
  });

  it("says when the live connection is down (audit RES-11)", () => {
    const { rerender } = render(<AppShell {...shellProps({ connection: null })} />);
    expect(screen.queryByTestId("connection-chip")).toBeNull();
    rerender(<AppShell {...shellProps({ connection: { state: "reconnecting" } })} />);
    expect(screen.getByTestId("connection-chip").getAttribute("aria-label")).toBe("Reconnecting…");
    rerender(<AppShell {...shellProps({ connection: { state: "paused" } })} />);
    expect(screen.getByRole("status", { name: "Live updates paused" })).toBeTruthy();
  });

  it("hides the LIVE chip in Personal mode; the sidebar shows the items the app gives it (Network stays: it is the founder's own)", () => {
    render(<AppShell {...shellProps({ mode: "personal" })} />);
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

  it("honors a department's stored letter in the sidebar, the chord and the help overlay", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    // Finance stores Q (chosen in Settings › Departments): the name would give N.
    const sidebar = NORTHWIND_SIDEBAR.map((i) => (i.id === "d-finance" ? { ...i, shortcut: "Q" } : i));
    expect(withSidebarKeys(sidebar).find((i) => i.id === "d-finance")?.keys).toEqual(["G", "Q"]);
    render(<AppShell {...shellProps({ onNavigate, sidebar: { items: sidebar, collapsed: false, onCollapsedChange: () => {} } })} />);
    expect(screen.getByRole("link", { name: "Finance" }).getAttribute("aria-keyshortcuts")).toBe("G Q");
    document.body.focus();
    await user.keyboard("gq");
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "d-finance" }));
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

  it("carries the brand on the document while mounted, so overlays that portal to the body take the business's colour", () => {
    const { unmount } = render(<AppShell {...shellProps({ kit: { primary: "#2E7D6B", secondary: "#E8C56B" } })} />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--kit-primary")).toBe("#2E7D6B");
    expect(root.style.getPropertyValue("--kit-lift")).toBe(kitRamp("#2E7D6B").lift);
    unmount();
    for (const name of KIT_VARIABLES) expect(root.style.getPropertyValue(name)).toBe("");
  });

  it("finds the business by its name in the palette and opens Home", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AppShell {...shellProps({ search: { items: PALETTE_ITEMS, onSelect, remote: true } })} />);
    await user.click(screen.getByTestId("kitbar-search"));
    await user.type(await screen.findByRole("combobox"), "north");
    const row = await screen.findByRole("option", { name: /Northwind Skincare/ });
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "business", label: "Northwind Skincare", href: "/b/northwind" }));
  });

  it("keeps the search placeholder short enough never to be cut, with the short forms for a narrow bar", () => {
    render(<AppShell {...shellProps()} />);
    const search = screen.getByTestId("kitbar-search");
    expect(search.textContent).toContain("Search or jump to…");
    expect(search.querySelector(".kitbar-search-short")?.textContent).toBe("Search");
    expect(search.className).toContain("kitbar-search");
  });
});
