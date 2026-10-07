import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CapTableScreen, holderRows } from "../CapTableScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, ENTITY, capTable, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

describe("holderRows", () => {
  it("joins the summary holders with their entity kind", () => {
    const rows = holderRows(capTable);
    expect(rows.map((r) => [r.displayName, r.kind])).toEqual([
      ["Mara Lindqvist", "person"],
      ["Tomas Berg", "person"],
      ["Lena Okafor", "team_member"],
      ["Northcap Ventures", "organisation"],
    ]);
  });
});

describe("CapTableScreen", () => {
  it("renders holders as CRM links, classes, the option pool, convertibles and issuances with vesting", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CapTableScreen {...props} />);
    const strip = screen.getByRole("region", { name: "Cap table summary" });
    expect(within(strip).getByText("Fully diluted shares").parentElement!.parentElement!.textContent).toContain("9,200,001");
    expect(within(strip).getByText("Option pool").parentElement!.parentElement!.textContent).toContain("80%");
    expect(within(strip).getByText(/800,000 of 1,000,000 unallocated/)).toBeTruthy();
    expect(within(strip).getByText("Convertibles").parentElement!.parentElement!.textContent).toContain("€100K");
    const holders = screen.getByRole("grid", { name: "Holders" });
    expect(within(holders).getByRole("link", { name: /Mara Lindqvist/ }).getAttribute("href")).toBe(`/b/${BID}/crm/${ENTITY.mara}/overview`);
    expect(within(holders).getAllByText("48.91%")).toHaveLength(2);
    expect(within(holders).getAllByText("Common · 4,500,000")).toHaveLength(2);
    const classes = screen.getByRole("table", { name: "Share classes" });
    expect(within(classes).getByText("2026 Option Plan")).toBeTruthy();
    expect(within(classes).getByText("SAFE")).toBeTruthy();
    const issuances = screen.getByRole("grid", { name: "Issuances" });
    expect(within(issuances).getAllByText("4y / 1y cliff · 25% vested")).toHaveLength(2);
    expect(within(issuances).getByText("4y / 1y cliff · 0% vested")).toBeTruthy();
    expect(screen.getByText(/4 issuances · versioned and audited · last change 14 Aug 2026/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pay|Transfer|Wire/ })).toBeNull(); // no money movement
  });

  it("filters issuances to a holder from the right-click verb and opens the CRM on Enter", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CapTableScreen {...props} />);
    const holders = screen.getByRole("grid", { name: "Holders" });
    fireEvent.contextMenu(within(holders).getByText("Lena Okafor"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Show this holder's issuances" }));
    const panel = await screen.findByRole("region", { name: "Issuances · Lena Okafor" });
    const rows = within(within(panel).getByRole("grid", { name: "Issuances" })).getAllByRole("row");
    expect(rows).toHaveLength(2); // header + one issuance
    fireEvent.click(within(panel).getByRole("button", { name: "All holders" }));
    expect(screen.getByRole("region", { name: "Issuances" })).toBeTruthy();
    fireEvent.contextMenu(within(holders).getByText("Tomas Berg"));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Open in CRM" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/crm/${ENTITY.tomas}/overview`);
  });

  it("models a round with SAFE conversion and pool top-up, labelled Estimate (AC-11.8.4)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CapTableScreen {...props} />);
    expect(screen.getByText(/Enter a pre-money valuation and an investment/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Round inputs" });
    fireEvent.change(within(form).getByLabelText("Pre-money valuation"), { target: { value: "40000000" } });
    fireEvent.change(within(form).getByLabelText("Investment"), { target: { value: "1000000" } });
    fireEvent.change(within(form).getByLabelText("Option pool target"), { target: { value: "0" } });
    const proForma = screen.getByRole("table", { name: "Pro forma ownership" });
    expect(within(proForma).getByText("Northcap Ventures (converted)")).toBeTruthy();
    expect(within(proForma).getByText("Series Seed Preferred")).toBeTruthy();
    expect(within(proForma).getByText("2.44%")).toBeTruthy(); // 1M on 41M post-money
    expect(screen.getByText("€41M")).toBeTruthy();
    expect(screen.getByText(/Northcap Ventures: 101,010.101 via cap/)).toBeTruthy();
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(1);
  });

  it("exports the Delaware stock ledger and the aktiebok, falling back to a copyable register", async () => {
    const createObjectURL = URL.createObjectURL;
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined; // no downloads in this window → copyable register
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CapTableScreen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delaware stock ledger" }));
    let dialog = await screen.findByRole("dialog", { name: "Delaware stock ledger" });
    let csv = (within(dialog).getByRole("textbox") as HTMLTextAreaElement).value;
    expect(csv.split("\n")[0]).toContain("Certificate No.");
    expect(csv).toContain("C-0001,2025-10-01,Mara Lindqvist,person,Common,common,4500000");
    expect(csv).not.toContain("Northcap");
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Aktiebok" }));
    dialog = await screen.findByRole("dialog", { name: "Aktiebok" });
    csv = (within(dialog).getByRole("textbox") as HTMLTextAreaElement).value;
    expect(csv).toContain("Aktienummer (från)");
    expect(csv).toContain("4500001,9000000,4500000,Common,Tomas Berg,Fysisk person");
    expect(csv).not.toContain("Lena");
    URL.createObjectURL = createObjectURL;
  });

  it("shows the empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <CapTableScreen {...props} />);
    expect(screen.getAllByText("No cap table yet").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Open Legal" })[0]!);
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/legal/entity`);
    unmount();

    const loading = createFakeSource({ businessId: BID });
    const { container, unmount: u2 } = renderScreen(loading, <CapTableScreen {...props} />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
    u2();

    const failing = createFakeSource({ businessId: BID, responses: { "finance.capTable.get": new Error("register locked") } });
    renderScreen(failing, <CapTableScreen {...props} />);
    expect(screen.getAllByText("register locked").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["finance.capTable.get"]).toBe(1);
  });
});
