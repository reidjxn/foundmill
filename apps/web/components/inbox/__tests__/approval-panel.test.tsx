// @vitest-environment happy-dom
/**
 * An agent's request leads with one plain sentence (UX plan B5); the call's name and its raw arguments wait behind
 * "Details" on ink, and the status reads "Needs your answer" (B7).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ApprovalPanel, type ApprovalPanelProps } from "../ApprovalPanel";

const BID = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const AGENT = "37d03d31-2afd-4bdd-adbf-2a82479eadf3";

const approval: ApprovalPanelProps["approval"] = {
  id: "ap-1",
  outcome: null,
  resolvedAt: null,
  connectorKey: "platform",
  tool: "set_budget",
  action: "Ledgerly › set budget",
  args: JSON.stringify({ channelKey: "paid_ads", budgetMinor: 60_000, currency: "GBP" }),
  argsHidden: false,
  amount: { amountMinor: 60_000, currency: "GBP" },
  amountHidden: false,
  reasons: ["spend above the per-decision cap (£500.00)"],
  agent: { id: AGENT, name: "Priya" },
  task: null,
  sessionWaiting: true,
  section: "finance",
  canAnswer: true,
} as unknown as ApprovalPanelProps["approval"];

describe("ApprovalPanel", () => {
  it("leads with the sentence, keeps the call and the arguments behind Details, and says Needs your answer", () => {
    render(
      <TooltipProvider>
        <ApprovalPanel approval={approval} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered={false} />
      </TooltipProvider>,
    );
    const panel = screen.getByTestId("approval-panel");
    expect(screen.getByTestId("approval-summary").textContent).toBe("Priya wants to set the paid ads budget to £600.00.");
    // The sentence comes before anything the system would say.
    const order = panel.textContent ?? "";
    expect(order.indexOf("Priya wants to set")).toBeLessThan(order.indexOf("Ledgerly › set budget"));
    const details = screen.getByTestId("approval-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("Details");
    expect(screen.getByTestId("approval-action").textContent).toBe("Ledgerly › set budget");
    expect(screen.getByTestId("approval-args").textContent).toContain("paid_ads");
    expect(screen.getByText("Needs your answer")).toBeTruthy();
    expect(screen.queryByText(/Waiting for you|Wants to run/)).toBeNull();
    expect(screen.getByTestId("approval-amount").textContent).toBe("£600.00");
    expect(screen.getByTestId("approval-reason")).toBeTruthy();
  });

  it("leaves out what the reader's walls hide, and locks the reason once answered", () => {
    render(
      <TooltipProvider>
        <ApprovalPanel approval={{ ...approval, args: null, argsHidden: true, amount: null, amountHidden: true, outcome: "rejected" }} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("approval-summary").textContent).toBe("Priya wants to set the budget.");
    expect(screen.getAllByText("Hidden by your section permissions").length).toBe(2);
    expect(screen.queryByTestId("approval-reason")).toBeNull();
    expect(screen.getByText("Rejected")).toBeTruthy();
  });
});
