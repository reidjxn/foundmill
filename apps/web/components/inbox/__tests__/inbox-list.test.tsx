import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { InboxList, type InboxListRow } from "../InboxList";
import { ConfirmPlanDialog } from "../ReadingPane";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/trpc-react", () => ({ useTRPC: () => ({}) }));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: "b", data: { business: {} }, departments: [] }) }));

const row = (over: Partial<InboxListRow>): InboxListRow => ({
  id: "i1",
  subject: "Approve the launch budget",
  preview: "We need €500 for LinkedIn ads.",
  createdAt: new Date().toISOString(),
  needsAnswer: false,
  won: false,
  unread: true,
  tone: "info",
  typeWord: "Update",
  agent: { id: "a1", name: "Mara", role: "Lifecycle", seed: "s", dept: "dept-1", departmentId: "d1", departmentName: "Growth" },
  fromUser: false,
  ...over,
});

describe("InboxList (DESIGN §9 rows)", () => {
  it("renders the subject, preview, the red dot for items needing an answer and the gold edge for won customers", () => {
    const onSelect = vi.fn();
    const r = render(<InboxList rows={[row({}), row({ id: "i2", needsAnswer: true, typeWord: "Decision" }), row({ id: "i3", won: true, needsAnswer: true, typeWord: "Customer won" })]} selectedId="i2" onSelect={onSelect} loading={false} hasMore onLoadMore={vi.fn()} emptyText="" />);
    expect(r.getAllByRole("option")).toHaveLength(3);
    expect(r.getAllByTestId("needs-answer-dot")).toHaveLength(2);
    const won = r.container.querySelector("[data-inbox-row='i3']");
    expect(won?.className).toContain("border-l-gold");
    expect(r.container.querySelector("[data-inbox-row='i2']")?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(r.container.querySelector("[data-inbox-row='i1']")!);
    expect(onSelect).toHaveBeenCalledWith("i1");
    expect(r.getByTestId("inbox-load-more")).toBeTruthy();
  });
  it("shows a skeleton while loading and the empty line otherwise", () => {
    const a = render(<InboxList rows={[]} selectedId={null} onSelect={vi.fn()} loading hasMore={false} onLoadMore={vi.fn()} emptyText="Nothing" />);
    expect(a.getByTestId("inbox-list-loading")).toBeTruthy();
    a.unmount();
    const b = render(<InboxList rows={[]} selectedId={null} onSelect={vi.fn()} loading={false} hasMore={false} onLoadMore={vi.fn()} emptyText="Notes arrive here" />);
    expect(b.getByText("Notes arrive here")).toBeTruthy();
  });
});

describe("ConfirmPlanDialog ('Here is what will happen')", () => {
  it("lists every action with its policy outcome and the total cost, and confirms", () => {
    const onConfirm = vi.fn();
    const r = render(
      <ConfirmPlanDialog
        open
        onOpenChange={vi.fn()}
        summary="Enable paid ads with a €500 cap."
        currency="EUR"
        onConfirm={onConfirm}
        lines={[
          { label: "Enable channel paid ads", outcome: "allow", hardGate: false, cost: null, reasons: [] },
          { label: "Set budget for paid ads", outcome: "ask", hardGate: false, cost: { amountMinor: 50_000, currency: "EUR" }, reasons: [] },
          { label: "Founder action: pay the invoice", outcome: "allow", hardGate: true, cost: null, reasons: [] },
        ]}
      />,
    );
    expect(r.getByText("Here is what will happen")).toBeTruthy();
    expect(r.getByTestId("confirm-plan-lines").querySelectorAll("li")).toHaveLength(3);
    expect(r.getByText("Needs your go-ahead")).toBeTruthy();
    expect(r.getByText("You act")).toBeTruthy();
    expect(r.getAllByText("€500.00").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(r.getByTestId("confirm-plan-go"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
