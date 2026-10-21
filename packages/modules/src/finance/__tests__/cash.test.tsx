import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashScreen, consentState, readAccounts, transactionColumns } from "../CashScreen";
import { NOW, createFakeSource, renderScreen } from "./fake-source";
import { ACCOUNT, BID, ENTITY, TX, accounts, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

describe("This month view (#171)", () => {
  const columns = transactionColumns(accounts, BID, "2026-10-01T00:00:00.000Z");
  const thisMonth = columns.find((c) => c.id === "thisMonth")! as unknown as { accessorFn: (row: unknown) => boolean };
  const row = (bookedAt: Date | string) => ({ id: "t", accountId: accounts[0]!.id, bookedAt, amountMinor: 1, currency: "EUR", counterparty: null, description: "", category: null, categorySource: null });

  it("compares instants whether bookedAt arrives as a Date (superjson) or an ISO string", () => {
    expect(thisMonth.accessorFn(row(new Date("2026-10-03T10:00:00.000Z")))).toBe(true);
    expect(thisMonth.accessorFn(row("2026-10-03T10:00:00.000Z"))).toBe(true);
    expect(thisMonth.accessorFn(row(new Date("2026-10-01T00:00:00.000Z")))).toBe(true); // the first instant of the month counts
    expect(thisMonth.accessorFn(row(new Date("2026-09-30T23:59:59.000Z")))).toBe(false);
    expect(thisMonth.accessorFn(row("not a date"))).toBe(false);
  });

  it("the built-in view lists this month's transactions when the rows carry Dates", async () => {
    const user = userEvent.setup();
    const withDates = { ...dataResponses, "finance.transactions.list": { items: (dataResponses["finance.transactions.list"] as { items: { bookedAt: string }[] }).items.map((t) => ({ ...t, bookedAt: new Date(t.bookedAt) })), nextCursor: null } };
    const fake = createFakeSource({ businessId: BID, responses: withDates });
    renderScreen(fake, <CashScreen {...props} />);
    const total = within(screen.getByRole("grid", { name: "Transactions" })).getAllByRole("row").length;
    await user.click(screen.getByRole("button", { name: /All transactions/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /This month/ }));
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "Transactions" })).getAllByRole("row").length).toBeLessThan(total));
    const rows = within(screen.getByRole("grid", { name: "Transactions" })).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1); // the header and October's rows, not "No rows match these filters"
    expect(screen.queryByText(/No rows match these filters/)).toBeNull();
    expect(within(screen.getByRole("grid", { name: "Transactions" })).getByText("Stripe")).toBeTruthy();
    expect(within(screen.getByRole("grid", { name: "Transactions" })).queryByText("Payroll run")).toBeNull(); // booked in September
  });
});

describe("consentState (AC-11.8.2)", () => {
  it("warns from 7 days before lapse and marks expired consents bad", () => {
    expect(consentState("2026-10-12T00:00:00.000Z", NOW)).toEqual({ tone: "warn", word: "Consent lapses in 5 days", days: 5 });
    expect(consentState("2026-10-14T11:00:00.000Z", NOW).tone).toBe("warn"); // 7 days
    expect(consentState("2026-10-15T13:00:00.000Z", NOW).tone).toBe("good");
    expect(consentState("2026-10-01T00:00:00.000Z", NOW)).toEqual({ tone: "bad", word: "Consent expired", days: -6 });
    expect(consentState(null, NOW).tone).toBe("neutral");
    expect(readAccounts({ accounts }).length).toBe(2);
    expect(readAccounts([{ ...accounts[0]!, archivedAt: "2026-01-01T00:00:00.000Z" }])).toEqual([]);
  });
});

describe("CashScreen", () => {
  it("renders accounts with balances and consent pills, and the transactions table with category chips", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CashScreen {...props} />);
    const ops = screen.getByRole("article", { name: "Ledgerly operating" });
    expect(ops.querySelector("[data-figure]")?.textContent).toBe("€110,000.00");
    expect(within(ops).getByText("Consent lapses in 5 days")).toBeTruthy();
    expect(within(ops).getByRole("button", { name: /Renew consent/ })).toBeTruthy();
    const savings = screen.getByRole("article", { name: "Ledgerly savings" });
    expect(within(savings).getByText(/Consent valid \d+ days/)).toBeTruthy();
    expect(within(savings).queryByRole("button", { name: /Renew consent/ })).toBeNull();
    expect(screen.getByText(/2 connected · €150,000\.00/)).toBeTruthy(); // total across accounts, in the panel meta
    expect(screen.getByText("1 consent to renew")).toBeTruthy();

    const table = screen.getByRole("grid", { name: "Transactions" });
    expect(within(table).getByRole("link", { name: /Stripe/ }).getAttribute("href")).toBe(`/b/${BID}/crm/${ENTITY.stripe}/overview`);
    expect(within(table).getByText("Revenue").closest("[title]")!.getAttribute("title")).toBe("Categorized by a rule");
    expect(within(table).getByText("Uncategorized")).toBeTruthy();
    expect(within(table).getByText("+€7,400.00")).toBeTruthy();
    expect(within(table).getByText("−€2,100.00")).toBeTruthy();
    expect(within(table).getAllByText("Ledgerly operating").length).toBeGreaterThan(0);
    expect(fake.queried.get("finance.transactions.list")).toEqual({ limit: 500 });
  });

  it("filters by account through the query, searches, and renews consent via Settings", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CashScreen {...props} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by account" })).getByRole("button", { name: "Ledgerly savings" }));
    expect(fake.queried.get("finance.transactions.list")).toEqual({ accountId: ACCOUNT.savings, limit: 500 });
    fireEvent.click(within(screen.getByRole("article", { name: "Ledgerly operating" })).getByRole("button", { name: /Renew consent/ }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/settings/integrations?connector=tink`); // lands on that connector's row (#165)
    fireEvent.change(screen.getByRole("textbox", { name: "Search transactions" }), { target: { value: "figma" } });
    const table = screen.getByRole("grid", { name: "Transactions" });
    expect(within(table).getAllByText(/FIGMA/).length).toBe(2);
    expect(within(table).queryByText(/Stripe payout/)).toBeNull();
  });

  it("recategorises a transaction from the right-click verb and refetches", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CashScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Transactions" });
    fireEvent.contextMenu(within(table).getByText("September salaries"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Other side not in the CRM" }).getAttribute("aria-disabled")).toBe("true");
    await user.click(within(menu).getByRole("menuitem", { name: "Recategorize…" }));
    const dialog = await screen.findByRole("dialog", { name: "Recategorize transaction" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save category" }));
    });
    expect(fake.mutations[0]).toEqual({ path: "finance.transactions.recategorise", input: { transactionId: TX.payroll, category: "Payroll", applyToCounterparty: true } });
    expect(fake.refetches["finance.transactions.list"]).toBe(1);
  });

  it("shows the empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <CashScreen {...props} />);
    expect(screen.getByText("No bank accounts connected")).toBeTruthy();
    expect(screen.getByText("No transactions yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect a bank" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/settings/integrations`);
    unmount();

    const loading = createFakeSource({ businessId: BID });
    const { container, unmount: u2 } = renderScreen(loading, <CashScreen {...props} />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
    u2();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.accounts.list": new Error("tink unavailable") } });
    renderScreen(failing, <CashScreen {...props} />);
    expect(screen.getByText("tink unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failing.refetches["finance.accounts.list"]).toBe(1);
  });
});
