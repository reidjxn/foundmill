// @vitest-environment happy-dom
/**
 * An agent's request leads with one plain sentence (UX plan B5); the call's name and its raw arguments wait behind
 * "Details" on ink, and the status reads "Needs your answer" (B7).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuilderViewProvider, TooltipProvider } from "@foundmill/dugout";

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
  what: { kind: "spend", headline: "£600.00 for paid ads", rows: [{ label: "What", value: "paid ads", mono: false }, { label: "Amount", value: "£600.00", mono: false }], empty: false },
  githubConnected: null,
  batch: [],
} as unknown as ApprovalPanelProps["approval"];

describe("ApprovalPanel", () => {
  it("leads with the sentence, keeps the call and the arguments behind Details, and says Needs your answer", () => {
    render(
      <BuilderViewProvider on>
        <TooltipProvider>
          <ApprovalPanel approval={approval} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered={false} />
        </TooltipProvider>
      </BuilderViewProvider>,
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
      <BuilderViewProvider on>
        <TooltipProvider>
          <ApprovalPanel approval={{ ...approval, args: null, argsHidden: true, amount: null, amountHidden: true, outcome: "rejected" }} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered />
        </TooltipProvider>
      </BuilderViewProvider>,
    );
    expect(screen.getByTestId("approval-summary").textContent).toBe("Priya wants to set the budget.");
    // The arguments, the amount and the "What exactly" block all say they are hidden, never a placeholder.
    expect(screen.getAllByText("Hidden by your section permissions").length).toBe(3);
    expect(screen.getByTestId("approval-what").getAttribute("data-what-kind")).toBe("hidden");
    expect(screen.queryByTestId("approval-reason")).toBeNull();
    expect(screen.getByText("Rejected")).toBeTruthy();
  });

  it("Builder view off: the sentence, the amount and the answer stay; Details (the call, the rule, the arguments) is not there", () => {
    render(
      <TooltipProvider>
        <ApprovalPanel approval={approval} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered={false} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("approval-summary").textContent).toBe("Priya wants to set the paid ads budget to £600.00.");
    expect(screen.queryByTestId("approval-details")).toBeNull();
    expect(screen.getByTestId("approval-panel").textContent).not.toContain("Ledgerly › set budget");
    expect(screen.getByTestId("approval-amount").textContent).toBe("£600.00");
    expect(screen.getByTestId("approval-reason")).toBeTruthy();
    // "What exactly" stays, Builder view or not (first-time founder report, Nov 8, 2026): what is being decided is never plumbing.
    const what = screen.getByTestId("approval-what");
    expect(what.getAttribute("data-what-kind")).toBe("spend");
    expect(screen.getByTestId("approval-what-headline").textContent).toBe("£600.00 for paid ads");
    expect(what.textContent).toContain("Amount");
    // It comes right after the sentence, before who asked.
    const order = screen.getByTestId("approval-panel").textContent ?? "";
    expect(order.indexOf("What exactly")).toBeLessThan(order.lastIndexOf("Amount"));
  });

  it("a request that said nothing about what it would run says so where the founder decides (first-time founder report, Nov 8, 2026)", () => {
    render(
      <TooltipProvider>
        <ApprovalPanel approval={{ ...approval, connectorKey: "sendgrid", tool: "send_mail", action: "SendGrid › send mail", args: null, amount: null, what: { kind: "none", headline: null, rows: [], empty: true } }} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered={false} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("approval-what").getAttribute("data-what-kind")).toBe("none");
    expect(screen.getByTestId("approval-no-content").textContent).toMatch(/did not say exactly what it would run.*Ask for the details/);
    expect(screen.queryByTestId("approval-what-headline")).toBeNull();
  });

  it("a GitHub call with no repository connected says it has nowhere to run and links to Settings › Integrations", () => {
    render(
      <TooltipProvider>
        <ApprovalPanel approval={{ ...approval, connectorKey: "github", tool: "run_migration", action: "GitHub › run a change to the data layout", githubConnected: false, what: { kind: "code", headline: "A change to how the business's data is stored: 0019_idx.sql", rows: [{ label: "Files", value: "0019_idx.sql", mono: true }], empty: false } }} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered={false} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("approval-no-github").textContent).toContain("No GitHub repository is connected to this business");
    expect(screen.getByTestId("approval-connect-github").getAttribute("href")).toBe(`/b/${BID}/settings/integrations`);
    // What would run is still shown: the founder sees the file even before connecting.
    expect(screen.getByTestId("approval-what-headline").textContent).toContain("0019_idx.sql");
    expect(screen.getByText("0019_idx.sql")).toBeTruthy();
  });

  it("a batched note lists each request with its own what-exactly behind an expander, the first open", () => {
    const row = (id: string, channel: string, amountMinor: number) => ({ id, outcome: null, agent: { id: AGENT, name: "Priya", role: null, personaKey: null, layer: "worker" as const }, action: "Ledgerly › launch campaign", amount: { amountMinor, currency: "GBP" }, what: { kind: "campaign" as const, headline: `Launch “Spring” on ${channel} with £${amountMinor / 100}.00`, rows: [{ label: "Channel", value: channel, mono: false }, { label: "Ad copy draft", value: "Fill last-minute shifts.", mono: false }], empty: false } });
    render(
      <TooltipProvider>
        <ApprovalPanel approval={{ ...approval, tool: "launch_campaign", action: "Ledgerly › launch campaign", batch: [row("a1", "Paid advertising", 60_000), row("a2", "Social media", 20_000)] }} businessId={BID} departments={[]} reason="" onReasonChange={vi.fn()} answered={false} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("approval-what").getAttribute("data-what-kind")).toBe("batch");
    const rows = screen.getAllByTestId("approval-batch-row") as HTMLDetailsElement[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.open).toBe(true);
    expect(rows[1]!.open).toBe(false);
    expect(rows[0]!.textContent).toContain("Launch “Spring” on Paid advertising with £600.00");
    expect(rows[0]!.textContent).toContain("Fill last-minute shifts.");
    expect(rows[1]!.textContent).toContain("£200.00");
    expect(screen.queryByTestId("approval-no-content")).toBeNull();
  });
});
