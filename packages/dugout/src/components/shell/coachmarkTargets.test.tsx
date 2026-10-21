/**
 * The shell's coach-mark anchors (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark; the three first-visit tours in apps/web
 * find their targets by `data-coachmark`): the sidebar, the top bar and its Continue button, the processing strip, the
 * tab bar's tabs, the DecisionBar and its "Ask <agent>" button. The attribute values are the contract the tour
 * definitions (apps/web/components/tours/definitions.ts) point at, so they are asserted here by name.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "../foundation/Tooltip";
import { ContinueButton } from "./ContinueButton";
import { DecisionBar } from "./DecisionBar";
import { KitBar } from "./KitBar";
import { ProcessingStrip } from "./ProcessingStrip";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { findCoachmarkTarget } from "../firstrun/Coachmark";
import { DISTRIBUTION_TABS, NORTHWIND_KIT, NORTHWIND_SEGMENTS, NORTHWIND_SIDEBAR } from "./fixtures";

describe("shell coach-mark anchors", () => {
  it("the sidebar rail is data-coachmark=sidebar, expanded or collapsed", () => {
    const { unmount } = render(<Sidebar items={NORTHWIND_SIDEBAR} collapsed={false} onCollapsedChange={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Primary" }).getAttribute("data-coachmark")).toBe("sidebar");
    expect(findCoachmarkTarget("sidebar")?.tagName).toBe("NAV");
    unmount();
    render(<Sidebar items={NORTHWIND_SIDEBAR} collapsed onCollapsedChange={() => {}} />);
    expect(findCoachmarkTarget("sidebar")?.tagName).toBe("NAV");
  });

  it("the top bar is data-coachmark=top-bar and Continue inside it keeps data-coachmark=continue in every state", () => {
    render(
      <TooltipProvider>
        <KitBar kit={NORTHWIND_KIT} businessName="Northwind Skincare" screenTitle="Home" onSearch={() => {}} date={null} runwayMonths={7} businessMode="assisted" continueButton={{ state: { kind: "blocked", count: 2 } }} stopAll={{ onConfirm: () => {} }} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("kit-bar").getAttribute("data-coachmark")).toBe("top-bar");
    const target = findCoachmarkTarget("continue");
    expect(target?.tagName).toBe("BUTTON");
    expect(target?.getAttribute("data-continue-state")).toBe("blocked");
  });

  it("Continue carries data-coachmark=continue on its button in the idle, processing, matchday and holiday states", () => {
    const states = [{ kind: "idle" }, { kind: "processing" }, { kind: "matchday" }, { kind: "holiday", until: "2026-10-21" }] as const;
    for (const state of states) {
      const { unmount } = render(
        <TooltipProvider>
          <ContinueButton state={state} />
        </TooltipProvider>,
      );
      const target = findCoachmarkTarget("continue");
      expect(target?.tagName, state.kind).toBe("BUTTON");
      expect(document.querySelectorAll("[data-coachmark='continue']"), state.kind).toHaveLength(1);
      unmount();
    }
  });

  it("the processing strip is data-coachmark=processing-strip, at rest and while a cycle runs", () => {
    const { rerender } = render(
      <TooltipProvider>
        <ProcessingStrip segments={NORTHWIND_SEGMENTS} active={false} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status").getAttribute("data-coachmark")).toBe("processing-strip");
    rerender(
      <TooltipProvider>
        <ProcessingStrip segments={NORTHWIND_SEGMENTS} active cycleNumber={3} />
      </TooltipProvider>,
    );
    expect(findCoachmarkTarget("processing-strip")?.getAttribute("data-active")).toBe("true");
  });

  it("the tab bar's tablist is data-coachmark=tabs (the trailing slot is not part of the ring)", () => {
    render(
      <TabBar tabs={DISTRIBUTION_TABS} activeId="channels" trailing={<button type="button">Edit</button>} />,
    );
    const list = screen.getByRole("tablist", { name: "Screen tabs" });
    expect(list.getAttribute("data-coachmark")).toBe("tabs");
    expect(findCoachmarkTarget("tabs")).toBe(list);
    expect(list.contains(screen.getByRole("button", { name: "Edit" }))).toBe(false);
  });

  it("the DecisionBar is data-coachmark=decision-bar and its ask button data-coachmark=decision-ask; without onAsk there is no ask anchor", () => {
    const options = [
      { id: "a", label: "Approve", recommended: true, cost: null, reversible: true },
      { id: "b", label: "Hold", reversible: true },
    ];
    const { unmount } = render(<DecisionBar options={options} onChoose={() => {}} onAsk={() => {}} askLabel="Ask Juno" />);
    expect(screen.getByRole("group", { name: "Decision" }).getAttribute("data-coachmark")).toBe("decision-bar");
    const ask = findCoachmarkTarget("decision-ask");
    expect(ask?.tagName).toBe("BUTTON");
    expect(ask?.textContent).toContain("Ask Juno");
    unmount();
    render(<DecisionBar options={options} onChoose={() => {}} onExecute={() => {}} />);
    expect(findCoachmarkTarget("decision-bar")).not.toBeNull();
    expect(findCoachmarkTarget("decision-ask")).toBeNull();
  });
});
