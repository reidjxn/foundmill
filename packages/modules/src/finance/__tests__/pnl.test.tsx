import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfitAndLossScreen, periodRange, pnlRowClass } from "../ProfitAndLossScreen";
import { NOW, createFakeSource, renderScreen } from "./fake-source";
import { BID, TX, dataResponses, emptyResponses, pnlLedger } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

describe("periodRange", () => {
  it("covers full months before this month, or this month to date", () => {
    expect(periodRange("3m", NOW)).toEqual({ from: "2026-07-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", label: "Jul 2026 – Sep 2026" });
    expect(periodRange("this-month", NOW)).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z", label: "Oct 2026 to date" });
    expect(periodRange("12m", NOW).from).toBe("2025-10-01T00:00:00.000Z");
  });

  it("draws a 1 px text-secondary rule above subtotals and totals", () => {
    expect(pnlRowClass({ id: "s", label: "", depth: 0, kind: "subtotal", amountMinor: 0, count: 0, pctOfRevenue: null })).toContain("border-t border-secondary");
    expect(pnlRowClass({ id: "l", label: "", depth: 1, kind: "line", amountMinor: 0, count: 0, pctOfRevenue: null })).toBeUndefined();
  });
});

describe("ProfitAndLossScreen", () => {
  it("renders the indented management P&L with subtotals, the cash-basis label and the period footer", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ProfitAndLossScreen {...props} />);
    expect(fake.queried.get("finance.pnl")).toEqual({ from: "2026-07-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
    const table = screen.getByRole("grid", { name: "Profit and loss" });
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBe(24); // header row + 23 statement rows
    expect(within(table).getByText("Total revenue")).toBeTruthy();
    expect(within(table).getByText("Gross profit")).toBeTruthy();
    expect(within(table).getByText("Operating result")).toBeTruthy();
    expect(within(table).getAllByText("+€60,000.00")).toHaveLength(2); // the Revenue line and Total revenue
    expect(within(table).getByText("−€45,000.00")).toBeTruthy();
    expect(within(table).getByText("87.5%")).toBeTruthy();
    expect(within(table).getByText("Payroll").parentElement!.className).toContain("pl-4");
    // The API's label, in plain words (UX plan §7.14): what "cash basis" means is said, the term kept in brackets.
    expect(screen.getByText("Management view, unaudited, cash basis: counted when the cash moves")).toBeTruthy();
    expect(screen.queryByText("Management P&L, unaudited, cash basis")).toBeNull();
    expect(screen.getByText("Jul 2026 – Sep 2026")).toBeTruthy();
    expect(screen.getByText(/Uncategorized −€3,000/)).toBeTruthy();
    expect(within(table).getAllByLabelText("Needs categorizing")).toHaveLength(2); // header and line
    expect(screen.queryByRole("region", { name: /Transactions ·/ })).toBeNull();
  });

  it("shows a line's transactions from the right-click verb and recategorises one, creating a rule", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ transaction: {}, ruleApplied: 2 }) });
    renderScreen(fake, <ProfitAndLossScreen {...props} />);
    expect(fake.queried.has("finance.transactions.list")).toBe(false); // disabled until a line is picked
    const table = screen.getByRole("grid", { name: "Profit and loss" });
    fireEvent.contextMenu(within(table).getByText("Hosting"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Show transactions" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Show transactions" }));
    const panel = await screen.findByRole("region", { name: "Transactions · Hosting" });
    expect(fake.queried.get("finance.transactions.list")).toEqual({ from: "2026-07-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", limit: 500 });
    expect(within(panel).getByRole("link", { name: /Amazon Web Services/ })).toBeTruthy();
    expect(within(panel).queryByText(/Stripe/)).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Recategorize Amazon Web Services" }));
    const dialog = await screen.findByRole("dialog", { name: "Recategorize transaction" });
    expect(within(dialog).getAllByText(/Amazon Web Services/).length).toBeGreaterThan(0);
    const rule = within(dialog).getByRole("checkbox", { name: "Apply to every transaction with the same other side" });
    expect(rule.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save category" }));
    });
    expect(fake.mutations).toEqual([{ path: "finance.transactions.recategorise", input: { transactionId: TX.aws, category: "Hosting", applyToCounterparty: true } }]);
    expect(fake.refetches["finance.pnl"]).toBe(1);
    expect(fake.refetches["finance.transactions.list"]).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets the uncategorised line be opened and the counterparty rule be switched off", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ProfitAndLossScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Profit and loss" });
    fireEvent.contextMenu(within(table).getByText("Uncategorized transactions"));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Show transactions" }));
    const panel = await screen.findByRole("region", { name: "Transactions · Uncategorized transactions" });
    await user.click(within(panel).getByRole("button", { name: "Recategorize Figma Inc" }));
    const dialog = await screen.findByRole("dialog");
    const rule = within(dialog).getByRole("checkbox", { name: "Apply to every transaction with the same other side" });
    expect(rule.getAttribute("aria-disabled")).not.toBe("true"); // disabled only while the category is Uncategorised
    expect((rule as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save category" }));
    });
    expect(fake.mutations[0]).toEqual({ path: "finance.transactions.recategorise", input: { transactionId: TX.unknown, category: null, applyToCounterparty: false } });
  });

  it("shows the ledger when one is connected, and the empty, loading and error states", () => {
    const ledger = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.pnl": pnlLedger } });
    const { unmount } = renderScreen(ledger, <ProfitAndLossScreen {...props} />);
    expect(screen.getByText("Ledger · accrual basis")).toBeTruthy();
    const table = screen.getByRole("grid", { name: "Profit and loss" });
    expect(within(table).getByText("Subscriptions")).toBeTruthy();
    expect(within(table).getByText("Net result")).toBeTruthy();
    expect(within(table).queryByText("Gross profit")).toBeNull();
    expect(screen.getByText(/Ledger snapshot 2026-09 from Xero via Codat/)).toBeTruthy();
    unmount();

    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount: u2 } = renderScreen(empty, <ProfitAndLossScreen {...props} />);
    expect(screen.getByText("No transactions in this period")).toBeTruthy();
    u2();

    const loading = createFakeSource({ businessId: BID });
    const { container, unmount: u3 } = renderScreen(loading, <ProfitAndLossScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    u3();

    const failing = createFakeSource({ businessId: BID, responses: { "finance.pnl": new Error("categoriser down") } });
    renderScreen(failing, <ProfitAndLossScreen {...props} />);
    expect(screen.getByText("categoriser down")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failing.refetches["finance.pnl"]).toBe(1);
  });
});
