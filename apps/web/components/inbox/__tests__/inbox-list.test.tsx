import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { APP_NAME } from "@foundmill/config";
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
  tag: { word: "Update", tone: "info", icon: "update" },
  agent: { id: "a1", name: "Mara", role: "Lifecycle", seed: "s", dept: "dept-1", departmentId: "d1", departmentName: "Growth" },
  fromUser: false,
  ...over,
});

describe("InboxList (DESIGN §9 rows)", () => {
  it("renders the subject (wrapping, never ellipsised), an icon + word tag per row, the preview and the gold edge for won customers", () => {
    const onSelect = vi.fn();
    const r = render(
      <InboxList
        rows={[row({}), row({ id: "i2", needsAnswer: true, typeWord: "Decision", tag: { word: "Respond", tone: "bad", icon: "respond" } }), row({ id: "i3", won: true, needsAnswer: true, typeWord: "Customer won", tag: { word: "Customer", tone: "gold", icon: "win" } })]}
        selectedId="i2"
        onSelect={onSelect}
        loading={false}
        hasMore
        onLoadMore={vi.fn()}
        emptyText=""
      />,
    );
    expect(r.getAllByRole("option")).toHaveLength(3);
    expect(r.getAllByTestId("row-tag").map((t) => t.getAttribute("data-row-tag"))).toEqual(["Update", "Respond", "Customer"]);
    // Every tag carries an icon beside its word (colour is never the only signal) and its legend sentence (UX plan B21).
    for (const t of r.getAllByTestId("row-tag")) expect(t.querySelector("svg")).toBeTruthy();
    expect(r.getAllByTestId("row-tag").map((t) => t.getAttribute("data-tag-legend"))).toEqual(["Update: Progress from an agent, nothing to do", "Respond: Needs your answer before the team can carry on", "Customer: A new paying customer, with its Customer Update"]);
    expect(r.container.querySelector("[data-inbox-row='i2']")?.getAttribute("aria-label")).toBe("Approve the launch budget. Respond");
    expect(r.container.querySelector("[data-inbox-row='i3']")?.getAttribute("aria-label")).toBe("Approve the launch budget. Customer, needs your answer, customer won");
    for (const s of r.getAllByTestId("row-subject")) expect(s.className).not.toMatch(/\btruncate\b|line-clamp/);
    const won = r.container.querySelector("[data-inbox-row='i3']");
    expect(won?.className).toContain("row-edge-gold");
    expect(r.container.querySelector("[data-inbox-row='i2']")?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(r.container.querySelector("[data-inbox-row='i1']")!);
    expect(onSelect).toHaveBeenCalledWith("i1");
    expect(r.getByTestId("inbox-load-more")).toBeTruthy();
  });
  it("gives a person's note the founder's initials only when it is their own; another founder's words come from Network (audit #65)", () => {
    const r = render(
      <InboxList
        rows={[row({ id: "own", agent: undefined, fromUser: true }), row({ id: "theirs", agent: undefined, fromUser: false, fromPerson: true }), row({ id: "team", agent: undefined, fromUser: false })]}
        selectedId={null}
        onSelect={vi.fn()}
        loading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        emptyText=""
        founderName="Jamie Reyes"
      />,
    );
    const avatarOf = (id: string) => r.container.querySelector(`[data-inbox-row='${id}'] [role='img']`)?.getAttribute("aria-label");
    expect(avatarOf("own")).toBe("Jamie Reyes");
    expect(avatarOf("theirs")).toBe("Network");
    expect(avatarOf("team")).toBe(APP_NAME);
  });

  it("draws only the rows near the viewport once hundreds of notes are loaded (audit SOAK-09)", () => {
    const rows = Array.from({ length: 400 }, (_, i) => row({ id: `n${i}`, subject: `Note ${i}` }));
    const r = render(<InboxList rows={rows} selectedId="n300" onSelect={vi.fn()} loading={false} hasMore onLoadMore={vi.fn()} emptyText="" />);
    const drawn = r.getAllByRole("option");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(60);
    // The first rows are drawn and the list says how long it is, for assistive technology.
    expect(drawn[0]?.getAttribute("aria-posinset")).toBe("1");
    expect(drawn[0]?.getAttribute("aria-setsize")).toBe("400");
    expect(r.getByTestId("inbox-list").getAttribute("data-virtual")).toBe("true");
  });
  it("draws every row of a short list", () => {
    const r = render(<InboxList rows={Array.from({ length: 30 }, (_, i) => row({ id: `s${i}` }))} selectedId={null} onSelect={vi.fn()} loading={false} hasMore={false} onLoadMore={vi.fn()} emptyText="" />);
    expect(r.getAllByRole("option")).toHaveLength(30);
    expect(r.getByTestId("inbox-list").getAttribute("data-virtual")).toBeNull();
  });
  it("shows a skeleton while loading and the empty line otherwise", () => {
    const a = render(<InboxList rows={[]} selectedId={null} onSelect={vi.fn()} loading hasMore={false} onLoadMore={vi.fn()} emptyText="Nothing" />);
    expect(a.getByTestId("inbox-list-loading")).toBeTruthy();
    a.unmount();
    const b = render(<InboxList rows={[]} selectedId={null} onSelect={vi.fn()} loading={false} hasMore={false} onLoadMore={vi.fn()} emptyText="Notes arrive here" />);
    expect(b.getByText("Notes arrive here")).toBeTruthy();
    b.unmount();
    // The screen may add key caps for operators: the empty line is a node, not only a string.
    const c = render(<InboxList rows={[]} selectedId={null} onSelect={vi.fn()} loading={false} hasMore={false} onLoadMore={vi.fn()} emptyText={<span>Notes land here. <kbd>R</kbd> pulls one.</span>} />);
    expect(c.container.querySelector("kbd")?.textContent).toBe("R");
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
    // Policy in plain words (UX plan B14): the reassurance first, then the three outcomes and the hard gate.
    expect(r.getByText(/^Nothing runs until you say go\./)).toBeTruthy();
    expect(r.getByText("Needs your go-ahead")).toBeTruthy();
    expect(r.getAllByText("Allowed on its own").length).toBe(2);
    expect(r.getByText("Only you can do this")).toBeTruthy();
    expect(r.queryByText(/Within policy|hard-gated|You act/)).toBeNull();
    expect(r.getAllByText("€500.00").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(r.getByTestId("confirm-plan-go"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("says why an action asks in plain words, under the action, keeping the agent's own sentence, and only for an ask", () => {
    const r = render(
      <ConfirmPlanDialog
        open
        onOpenChange={vi.fn()}
        summary=""
        onConfirm={vi.fn()}
        lines={[
          { label: "Set budget for paid ads", outcome: "ask", hardGate: false, cost: { amountMinor: 50_000, currency: "USD" }, reasons: ["Please set up my spend allowance"] },
          { label: "Set budget for seo", outcome: "ask", hardGate: false, cost: null, reasons: [] },
          { label: "Enable channel paid ads", outcome: "allow", hardGate: false, cost: null, reasons: ["not shown"] },
          { label: "Email a new lead", outcome: "ask", hardGate: false, cost: null, reasons: ["Recipient was first seen inside untrusted content and has not been verified"] },
        ]}
      />,
    );
    const reasons = r.getAllByTestId("confirm-plan-reason");
    expect(reasons.map((x) => x.textContent)).toEqual(["Needs your go-ahead because it spends money. Please set up my spend allowance.", "Needs your go-ahead because it contacts someone new."]);
    expect(r.getByTestId("confirm-plan-lines").querySelectorAll("li")[0]!.textContent).toContain("Set budget for paid ads");
    expect(r.getByText(/^Nothing runs until you say go\. 3 actions need your go-ahead\.$/)).toBeTruthy();
  });

  it("shows a total per currency when the lines are in more than one (never '£300' lines under a '€300' total)", () => {
    const r = render(
      <ConfirmPlanDialog
        open
        onOpenChange={vi.fn()}
        summary=""
        onConfirm={vi.fn()}
        lines={[
          { label: "Set budget for paid ads", outcome: "ask", hardGate: false, cost: { amountMinor: 30_000, currency: "GBP" }, reasons: [] },
          { label: "Set budget for seo", outcome: "allow", hardGate: false, cost: { amountMinor: 20_000, currency: "USD" }, reasons: [] },
        ]}
      />,
    );
    expect(r.getByTestId("confirm-plan-total").textContent).toContain("£300.00 + $200.00");
    expect(r.getByText(/listed side by side, not converted/)).toBeTruthy();
  });
});
