import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell, KIT_VARIABLES, PROCESSING_LINE_MIN_PX, processingLineText, sidebarItemForTarget, withSidebarKeys, type AppShellProps } from "./AppShell";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
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

  describe("phone mode (package 2.1)", () => {
    it("with `phone` under 1280 px draws the phone layout: no larger-window ask, no sidebar, no floor, one @container", () => {
      render(<AppShell {...shellProps({ viewportWidth: 390, phone: true, tabs: { tabs: [{ id: "today", label: "Today", href: "#t" }, { id: "details", label: "Details", href: "#d" }], activeId: "today" } })} />);
      expect(screen.queryByTestId("needs-larger-window")).toBeNull();
      const root = screen.getByTestId("app-shell");
      expect(root.hasAttribute("data-phone")).toBe(true);
      expect(root.className).toContain("@container");
      expect(root.className).not.toContain("min-w-(--min-viewport)");
      expect(screen.getByTestId("phone-bar")).toBeTruthy();
      expect(screen.queryByTestId("kit-bar")).toBeNull();
      expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
      expect(screen.getByText("Content")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Today" })).toBeTruthy();
      // Continue and Stop all agents stay reachable, each a finger's size.
      expect(screen.getByRole("button", { name: /Continue/ }).className).toContain("min-h-tap");
      expect(screen.getByTestId("stop-all-trigger").className).toContain("min-h-tap");
    });

    it("leaves out the right rail on a phone", () => {
      render(<AppShell {...shellProps({ viewportWidth: 390, phone: true, rightRail: { open: true, onOpenChange: vi.fn(), title: "Rail", children: <p>Rail body</p> } })} />);
      expect(screen.queryByText("Rail body")).toBeNull();
    });

    it("the menu button opens the sidebar's items in a panel; choosing one navigates and closes it", async () => {
      const onNavigate = vi.fn();
      render(<AppShell {...shellProps({ viewportWidth: 390, phone: true, onNavigate })} />);
      expect(screen.queryByTestId("phone-menu")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = screen.getByTestId("phone-menu");
      const names = [...menu.querySelectorAll("[data-sidebar-item]")].map((el) => el.getAttribute("data-sidebar-item"));
      expect(names).toEqual(NORTHWIND_SIDEBAR.filter((it) => !it.disabled).map((it) => it.id));
      for (const row of menu.querySelectorAll("[data-sidebar-item]")) expect(row.className).toContain("min-h-tap");
      const first = NORTHWIND_SIDEBAR.find((it) => !it.disabled)!;
      await userEvent.click(menu.querySelector(`[data-sidebar-item="${first.id}"]`)!);
      expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
      expect(screen.queryByTestId("phone-menu")).toBeNull();
    });

    it("Esc closes the menu", async () => {
      render(<AppShell {...shellProps({ viewportWidth: 390, phone: true })} />);
      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      expect(screen.getByTestId("phone-menu")).toBeTruthy();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByTestId("phone-menu")).toBeNull();
    });

    it("at 1280 px and over `phone` changes nothing: the sidebar, the kit bar and no menu button", () => {
      render(<AppShell {...shellProps({ viewportWidth: 1280, phone: true })} />);
      const root = screen.getByTestId("app-shell");
      expect(root.hasAttribute("data-phone")).toBe(false);
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
      expect(screen.getByTestId("kit-bar")).toBeTruthy();
      expect(screen.queryByTestId("phone-bar")).toBeNull();
      expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    });

    it("without `phone` the 1280 px floor stays: NeedsLargerWindow below it, the floor class and an @container root above it", () => {
      const { unmount } = render(<AppShell {...shellProps({ viewportWidth: 390 })} />);
      expect(screen.getByTestId("needs-larger-window")).toBeTruthy();
      expect(screen.queryByTestId("phone-bar")).toBeNull();
      unmount();
      render(<AppShell {...shellProps({ viewportWidth: 1440 })} />);
      const root = screen.getByTestId("app-shell");
      expect(root.className).toContain("min-w-(--min-viewport)");
      expect(root.className).toContain("@container");
    });
  });

  it("passes the business's spend line and currency to the top bar's chip, which says the setting in words", () => {
    const onModeClick = vi.fn();
    render(<AppShell {...shellProps({ viewportWidth: 1440, spendLineMinor: 5_000, businessCurrency: "GBP", onModeClick })} />);
    const chip = screen.getByRole("button", { name: "What the team can do: asks before spending over £50" });
    expect(chip.querySelector("[data-chip-full]")?.textContent).toBe("Asks before spending over £50");
    chip.click();
    expect(onModeClick).toHaveBeenCalledOnce();
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
    expect(screen.getByRole("status", { name: "Product, Formulation Lab, Distribution and Operations are working" })).toBeTruthy();
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

  it("puts a badge after the business name and something else in Continue's slot when given (the Example frame)", () => {
    const { unmount } = render(<AppShell {...shellProps()} />);
    expect(screen.queryByTestId("kitbar-business-badge")).toBeNull();
    expect(screen.queryByTestId("kitbar-continue-slot")).toBeNull();
    expect(document.querySelector("[data-coachmark='continue']")).toBeTruthy();
    unmount();
    render(
      <AppShell
        {...shellProps({
          businessBadge: <span data-testid="badge">Example</span>,
          continueSlot: (
            <button type="button" data-coachmark="start-your-own">
              Start your own
            </button>
          ),
          continueButton: { state: { kind: "idle" }, disabled: true },
        })}
      />,
    );
    // The badge is a caption under the name (one column, the name first), so it takes no width from the bar.
    const name = screen.getByTestId("kitbar-business-name");
    const badge = screen.getByTestId("kitbar-business-badge");
    expect(name.parentElement).toBe(badge.parentElement);
    expect(name.parentElement?.className).toContain("flex-col");
    expect(name.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The slot replaces Continue and keeps its height and minimum width.
    const slot = screen.getByTestId("kitbar-continue-slot");
    expect(slot.className).toContain("h-kitbar-chip");
    expect(slot.className).toContain("min-w-continue-min");
    expect(slot.querySelector("[data-coachmark='start-your-own']")?.textContent).toBe("Start your own");
    expect(document.querySelector("[data-coachmark='continue']")).toBeNull();
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

  it("the logo and name are Switch project: the founder's other businesses, Start a new project and Today (audit IAE-08; Today since Nov 7, 2026)", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onOpenBusiness = vi.fn();
    const onNewBusiness = vi.fn();
    const businessMenu = { businesses: [{ id: "nw", name: "Northwind Skincare", current: true }, { id: "lg", name: "Ledgerly" }], onOpenBusiness, onNewBusiness };
    render(<AppShell {...shellProps({ onNavigate, businessMenu })} />);
    const trigger = screen.getByRole("button", { name: "Switch project: Northwind Skincare" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /Ledgerly/ }));
    expect(onOpenBusiness).toHaveBeenCalledWith("lg");
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /Start a new project/ }));
    expect(onNewBusiness).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /^Today$/ }));
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

  it("hides the LIVE chip and the sidebar's \"Live\" label in Personal mode; the sidebar shows the items the app gives it (Network stays: it is the founder's own)", () => {
    const { unmount } = render(<AppShell {...shellProps({ mode: "personal" })} />);
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.getByRole("link", { name: "Network" })).toBeTruthy();
    unmount();
    render(<AppShell {...shellProps({ mode: "live" })} />);
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("says in words what the strip shows: the tooltip and status sentence, and a line in the tab bar while guidance is on (B2)", () => {
    const tabs = { tabs: [{ id: "a", label: "Overview" }, { id: "b", label: "Cash" }, { id: "c", label: "Runway" }], activeId: "b" };
    const { unmount } = render(<AppShell {...shellProps({ tabs, processing: { segments: NORTHWIND_SEGMENTS, active: true, cycleNumber: 3 } })} />);
    const sentence = "Product, Formulation Lab, Distribution and Operations are working";
    expect(screen.getByRole("status", { name: sentence })).toBeTruthy();
    // Four departments: the tab bar says the count, so the line never reaches an ellipsis at 1280 px; the strip keeps the names.
    const line = screen.getByTestId("processing-line");
    expect(line.textContent).toBe("4 departments are working");
    expect(line.closest("[role=tablist]")).toBeNull();
    // A FitText box: it steps down to its floor before it truncates (DESIGN §2), not a plain `truncate`.
    expect(line.hasAttribute("data-fit-box")).toBe(true);
    expect(line.className).not.toMatch(/(^|\s)truncate(\s|$)/);
    unmount();
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <AppShell {...shellProps({ tabs, processing: { segments: NORTHWIND_SEGMENTS, active: false } })} />
      </GuidanceProvider>,
    );
    expect(screen.getByRole("status", { name: "The team is idle" })).toBeTruthy();
    expect(screen.queryByTestId("processing-line")).toBeNull();
  });

  it("the answer to a press of Continue replaces the strip's sentence and shows in the tab bar, guidance on or off (first-time founder report, Nov 8, 2026)", () => {
    const tabs = { tabs: [{ id: "a", label: "Overview" }], activeId: "a" };
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <AppShell {...shellProps({ tabs, processing: { segments: NORTHWIND_SEGMENTS, active: false, notice: "Cycle 2 started: 6 tasks ready to build" } })} />
      </GuidanceProvider>,
    );
    // Never "The team is idle" over a press that was answered.
    expect(screen.queryByRole("status", { name: "The team is idle" })).toBeNull();
    expect(screen.getByRole("status", { name: "Cycle 2 started: 6 tasks ready to build" }).hasAttribute("data-notice")).toBe(true);
    const line = screen.getByTestId("processing-line");
    expect(line.textContent).toBe("Cycle 2 started: 6 tasks ready to build");
    expect(line.hasAttribute("data-notice")).toBe(true);
    expect(line.className).toMatch(/text-secondary/);
  });

  it("Continue's caveat rides on the button and under its tooltip", () => {
    render(<AppShell {...shellProps({ continueButton: { state: { kind: "idle" }, onContinue: vi.fn(), caveat: "The orchestrator is not reachable: a press writes one note; no agent works." } })} />);
    expect(screen.getByRole("button", { name: "Continue" }).getAttribute("data-continue-caveat")).toBe("The orchestrator is not reachable: a press writes one note; no agent works.");
  });

  it("words the tab bar's processing line: the sentence for one or two departments, a count from three (review F45)", () => {
    const seg = (label: string, active: boolean) => ({ id: label, label, dept: "dept-1" as const, active });
    expect(processingLineText([seg("Product", true), seg("Finance", true), seg("Legal", false)], true, 12)).toBe("Product and Finance are working");
    expect(processingLineText([seg("Product", true)], true, null)).toBe("Product is working");
    expect(processingLineText([seg("Product", true), seg("Development", true), seg("Distribution", true), seg("Finance", true)], true, 12)).toBe(
      "4 departments are working",
    );
    expect(processingLineText([seg("Product", true), seg("Development", true), seg("Distribution", true)], false, 12)).toBe("The team is idle");
    expect(PROCESSING_LINE_MIN_PX).toBe(11);
  });

  it("opens the keyboard shortcuts from the sidebar's \"?\" cap and from the palette's Help row, and pauses coach marks while an overlay is open or a cycle runs (B15)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { unmount } = render(<AppShell {...shellProps({ search: { items: PALETTE_ITEMS, onSelect } })} />);
    const root = screen.getByTestId("app-shell");
    expect(root.getAttribute("data-coachmark-pause")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(await screen.findByTestId("keyboard-help")).toBeTruthy();
    expect(root.getAttribute("data-coachmark-pause")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("keyboard-help")).toBeNull());
    expect(root.getAttribute("data-coachmark-pause")).toBeNull();
    await user.click(screen.getByTestId("kitbar-search"));
    await user.click(await screen.findByRole("option", { name: /Keyboard shortcuts/ }));
    expect(await screen.findByTestId("keyboard-help")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
    render(<AppShell {...shellProps({ continueButton: { state: { kind: "processing" }, cycleNumber: 4 } })} />);
    expect(screen.getByTestId("app-shell").getAttribute("data-coachmark-pause")).toBe("true");
    expect(screen.getByRole("button", { name: "Pause the team" }).getAttribute("data-coachmark")).toBe("continue");
  });

  it("fills in sidebar chords and routes G chords to onNavigate", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const keyed = withSidebarKeys(NORTHWIND_SIDEBAR);
    expect(keyed.find((i) => i.id === "home")?.keys).toEqual(["G", "H"]);
    expect(keyed.find((i) => i.id === "inbox")?.keys).toEqual(["G", "I"]);
    expect(keyed.filter((i) => i.group === "area").map((i) => i.keys?.join(" "))).toEqual(["G P", "G C", "G M", "G R", "G T"]);
    expect(keyed.find((i) => i.id === "d-studio")?.keys).toEqual(["G", "S"]);
    expect(keyed.find((i) => i.id === "settings")?.keys).toBeUndefined();
    expect(sidebarItemForTarget(keyed, { kind: "inbox" })?.id).toBe("inbox");
    expect(sidebarItemForTarget(keyed, { kind: "area", area: "money" })?.id).toBe("area-money");
    expect(sidebarItemForTarget(keyed, { kind: "department", id: "d-studio" })?.id).toBe("d-studio");
    render(<AppShell {...shellProps({ onNavigate })} />);
    expect(screen.getByRole("link", { name: "Money" }).getAttribute("aria-keyshortcuts")).toBe("G M");
    document.body.focus();
    await user.keyboard("gm");
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "area-money" }));
    await user.keyboard("gs");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "d-studio" }));
    await user.keyboard("gi");
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "inbox" }));
    await user.click(screen.getByRole("button", { name: "Northwind Skincare: go to Home" }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "home" }));
  });

  it("honors a module-less department's stored letter, unless an area holds it, in the sidebar, the chord and the help overlay", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    // Studio stores Q: the name would give S. A stored M is Money's now, so it falls back to the name's letter.
    const sidebar = NORTHWIND_SIDEBAR.map((i) => (i.id === "d-studio" ? { ...i, shortcut: "Q" } : i));
    expect(withSidebarKeys(sidebar).find((i) => i.id === "d-studio")?.keys).toEqual(["G", "Q"]);
    expect(withSidebarKeys(NORTHWIND_SIDEBAR.map((i) => (i.id === "d-studio" ? { ...i, shortcut: "M" } : i))).find((i) => i.id === "d-studio")?.keys).toEqual(["G", "S"]);
    render(<AppShell {...shellProps({ onNavigate, sidebar: { items: sidebar, collapsed: false, onCollapsedChange: () => {} } })} />);
    expect(screen.getByRole("link", { name: "Studio, 1 item" }).getAttribute("aria-keyshortcuts")).toBe("G Q");
    document.body.focus();
    await user.keyboard("gq");
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "d-studio" }));
    await user.keyboard("?");
    const help = await screen.findByTestId("keyboard-help");
    expect(help.textContent).toContain("Go to Customers");
    expect(help.textContent).toContain("Go to Studio");
    expect(help.textContent).not.toContain("Contacts");
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

  it("Space does nothing while Continue is blocked without a respond handler, and shows Needs you · N (AC-11.3.3)", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<AppShell {...shellProps({ continueButton: { state: { kind: "blocked", count: 3 }, onContinue } })} />);
    expect(screen.getByRole("button", { name: "3 things need you before the team can work" }).textContent).toContain("Needs you · 3");
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
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "business", label: "Northwind Skincare", href: "/b/northwind/today" }));
  });

  it("keeps the search placeholder short enough never to be cut, with the short forms for a narrow bar", () => {
    render(<AppShell {...shellProps()} />);
    const search = screen.getByTestId("kitbar-search");
    expect(search.textContent).toContain("Search or jump to…");
    expect(search.querySelector(".kitbar-search-short")?.textContent).toBe("Search");
    expect(search.className).toContain("kitbar-search");
  });
});
