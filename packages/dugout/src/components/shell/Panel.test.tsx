import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCell, PageGrid, snapSpan, spanClass } from "./PageGrid";
import { Panel } from "./Panel";
import { ProcessingStrip, processingStatusText, segmentState } from "./ProcessingStrip";
import { RUNWAY_UNKNOWN_WORDS, RunwayChip, formatRunway, runwayTone } from "./RunwayChip";
import { RightRail } from "./RightRail";
import { NORTHWIND_SEGMENTS } from "./fixtures";

describe("Panel", () => {
  it("renders the title as the section name and the body when ready", () => {
    render(
      <Panel title="Cash and runway" span={6}>
        <p>Body</p>
      </Panel>,
    );
    const section = screen.getByRole("region", { name: "Cash and runway" });
    expect(section.getAttribute("data-state")).toBe("ready");
    expect(section.className).toContain("col-span-6");
    expect(screen.getByText("Body")).toBeTruthy();
  });
  it("shows a skeleton while loading, an empty state and an error state with retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(
      <Panel title="Leads" loading>
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Leads" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Body")).toBeNull();
    rerender(
      <Panel title="Leads" empty="Leads appear here once a channel is live.">
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole("status").textContent).toContain("Leads appear here");
    rerender(
      <Panel title="Leads" error="The leads query timed out." onRetry={onRetry}>
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole("alert").textContent).toContain("timed out");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("offers swap, settings and Pin to Home in the caret menu", async () => {
    const user = userEvent.setup();
    const menu = { onSwap: vi.fn(), onSettings: vi.fn(), onPinToHome: vi.fn(), pinned: true, items: [{ id: "csv", label: "Export CSV", onSelect: vi.fn() }] };
    render(
      <Panel title="Channels" menu={menu} footer="Updated 2 min ago">
        <p>Body</p>
      </Panel>,
    );
    const trigger = screen.getByRole("button", { name: "Panel menu" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const pin = await screen.findByRole("menuitem", { name: "Unpin from Home" });
    expect(screen.getByRole("menuitem", { name: "Swap content" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Export CSV" })).toBeTruthy();
    await user.click(pin);
    expect(menu.onPinToHome).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Updated 2 min ago")).toBeTruthy();
  });
  it("renders no caret without a menu", () => {
    render(<Panel title="Plain">x</Panel>);
    expect(screen.queryByRole("button", { name: "Panel menu" })).toBeNull();
  });

  it("draws the 40 px header on the panel's own surface: title style, mono meta, actions that wrap before the title is squeezed", () => {
    render(
      <Panel title="A long title the actions never squeeze" meta="6 Aug – 8 Nov 2026" actions={<button type="button">Forecast</button>}>
        x
      </Panel>,
    );
    const section = screen.getByRole("region", { name: "A long title the actions never squeeze" });
    const header = section.querySelector("[data-panel-header]")!;
    // No striped band: the header carries no background of its own and the title is never truncated.
    expect(header.className).toContain("panel-head");
    expect(header.className).not.toContain("bg-panel-alt");
    const title = screen.getByRole("heading", { name: "A long title the actions never squeeze" });
    expect(title.className).toContain("t-title");
    expect(title.className).not.toContain("truncate");
    expect(screen.getByText("6 Aug – 8 Nov 2026").className).toContain("t-mono");
  });

  it("lights the panel from its corner in a department colour or the brand", () => {
    const { rerender } = render(<Panel title="Product" glow="dept-1">x</Panel>);
    let section = screen.getByRole("region", { name: "Product" });
    expect(section.getAttribute("data-glow")).toBe("dept-1");
    expect(section.className).toContain("glow-dept");
    expect(section.className).toContain("tone-dept-1");
    rerender(<Panel title="Journey" glow="brand">x</Panel>);
    section = screen.getByRole("region", { name: "Journey" });
    expect(section.className).toContain("glow-brand");
    rerender(<Panel title="Plain">x</Panel>);
    expect(screen.getByRole("region", { name: "Plain" }).className).not.toContain("glow-");
  });
});

describe("PageGrid", () => {
  it("snaps spans to 3, 4, 6, 8, 12 and emits static classes", () => {
    expect(snapSpan(5)).toBe(4);
    expect(snapSpan(7)).toBe(6);
    expect(snapSpan(10)).toBe(8);
    expect(snapSpan(11)).toBe(12);
    expect(snapSpan(NaN)).toBe(12);
    expect(spanClass(4)).toBe("col-span-4");
    render(
      <PageGrid data-testid="grid">
        <GridCell span={8} rows={2} data-testid="cell" />
      </PageGrid>,
    );
    expect(screen.getByTestId("grid").className).toContain("grid-cols-12");
    expect(screen.getByTestId("grid").className).toContain("gap-gutter");
    expect(screen.getByTestId("cell").className).toContain("col-span-8");
    expect(screen.getByTestId("cell").className).toContain("row-span-2");
  });
});

describe("ProcessingStrip", () => {
  it("reports the working departments and shimmers only when active", () => {
    expect(processingStatusText(NORTHWIND_SEGMENTS, false)).toBe("No cycle running");
    expect(processingStatusText(NORTHWIND_SEGMENTS, true)).toBe("Cycle running: Product, Formulation Lab, Distribution, Operations");
    const { rerender } = render(<ProcessingStrip segments={NORTHWIND_SEGMENTS} active />);
    const strip = screen.getByRole("status");
    expect(strip.getAttribute("aria-label")).toContain("Formulation Lab");
    expect(strip.querySelectorAll("[data-working]").length).toBe(4);
    // A working department carries the travelling head (CSS, strip-segment[data-working]) in its own tone.
    const product = strip.querySelector("[data-segment='d-product']")!;
    expect(product.getAttribute("data-state")).toBe("working");
    expect(product.className).toContain("strip-segment");
    expect(product.className).toContain("tone-dept-1");
    expect(strip.querySelector("[data-segment='d-finance']")?.getAttribute("data-state")).toBe("waiting");
    expect(segmentState(NORTHWIND_SEGMENTS[0]!, false)).toBe("rest");
    rerender(<ProcessingStrip segments={NORTHWIND_SEGMENTS} active={false} />);
    expect(screen.getByRole("status").querySelectorAll("[data-working]").length).toBe(0);
  });
});

describe("RunwayChip", () => {
  it("follows the runway horizon rule and labels the estimate", () => {
    expect(runwayTone(12)).toBe("neutral");
    expect(runwayTone(8.9)).toBe("warn");
    expect(runwayTone(5.9)).toBe("bad");
    expect(runwayTone(null)).toBe("neutral");
    expect(formatRunway(11)).toBe("11 mo");
    expect(formatRunway(5.5)).toBe("5.5 mo");
    expect(formatRunway(undefined)).toBe("—");
    render(<RunwayChip date="2026-10-07" runwayMonths={5.5} cash={{ amountMinor: 18200000, currency: "EUR" }} />);
    const chip = screen.getByLabelText(/7 Oct 2026\. Runway 5\.5 mo, estimate, critical/);
    expect(chip.getAttribute("data-runway-tone")).toBe("bad");
    // The dashed "not measured" tag, the word in full.
    expect(screen.getByText("Estimate").className).toContain("kitbar-est");
  });

  it("without a figure says the words it is given (the ones Home's tiles use) and the reason, never a dash or an Estimate tag", () => {
    const { unmount } = render(<RunwayChip date="2026-10-07" runwayMonths={null} words={{ value: "No limit", caption: "Cash-flow positive, so no limit yet" }} />);
    expect(screen.getByText("No limit")).toBeTruthy();
    expect(screen.queryByText("Estimate")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    const chip = screen.getByLabelText("7 Oct 2026. Runway: No limit. Cash-flow positive, so no limit yet");
    expect(chip.getAttribute("data-runway-tone")).toBe("neutral");
    unmount();
    render(<RunwayChip date="2026-10-07" runwayMonths={null} words={{ value: "Not known yet", caption: "Connect a bank to estimate it" }} />);
    expect(screen.getByText("Not known yet")).toBeTruthy();
    expect(screen.getByLabelText(/Runway: Not known yet\. Connect a bank to estimate it$/)).toBeTruthy();
  });

  it("falls back to \"Not known yet\" when the app passes no words", () => {
    render(<RunwayChip date="2026-10-07" runwayMonths={null} />);
    expect(screen.getByText(RUNWAY_UNKNOWN_WORDS.value)).toBeTruthy();
    expect(screen.queryByText("No runway yet")).toBeNull();
  });
});

describe("RightRail", () => {
  it("collapses to a handle and toggles", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <RightRail title="Agent log" open onOpenChange={onOpenChange}>
        <p>Log line</p>
      </RightRail>,
    );
    const rail = screen.getByRole("complementary", { name: "Agent log" });
    expect(rail.getAttribute("data-state")).toBe("open");
    expect(rail.className).toContain("w-rail");
    expect(screen.getByText("Log line")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Collapse rail" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <RightRail title="Agent log" open={false} onOpenChange={onOpenChange}>
        <p>Log line</p>
      </RightRail>,
    );
    expect(screen.queryByText("Log line")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand rail" })).toBeTruthy();
  });
});
