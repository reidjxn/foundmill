import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContractsScreen } from "../ContractsScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, CONTRACT, PERSON, businessMember, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

describe("ContractsScreen", () => {
  it("renders the register with counterparties as CRM links, status pills and open obligations", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ContractsScreen {...props} />);
    const grid = screen.getByRole("grid", { name: "Contracts" });
    expect(within(grid).getAllByRole("row")).toHaveLength(4);
    expect(within(grid).getAllByRole("link", { name: /Acme Retail/ })[0]!.getAttribute("href")).toBe(`/b/${BID}/crm/${PERSON.acme}/overview`);
    expect(within(grid).getByText("Awaiting signature")).toBeTruthy();
    expect(within(grid).getByText("Lease agreement")).toBeTruthy();
    expect(within(grid).getByText("€12,000.00")).toBeTruthy();
    expect(within(grid).getByText("NDA")).toBeTruthy();
    expect(screen.getByText("3 contracts")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Signing" })).toBeNull();
  });

  it("opens a contract: obligations, founder-only signing link-out that only opens the envelope, and recording a signature", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ContractsScreen {...props} />);
    fireEvent.doubleClick(within(screen.getByRole("grid", { name: "Contracts" })).getByText("Acme Retail master services agreement"));
    const detail = await screen.findByRole("region", { name: "Acme Retail master services agreement" });
    expect(fake.queried.get("legal.contracts.get")).toEqual({ contractId: CONTRACT.msa });
    const obligations = within(detail).getByRole("table", { name: "Obligations" });
    expect(within(obligations).getAllByRole("row")).toHaveLength(5);
    expect(within(obligations).getByText("Provide product samples")).toBeTruthy();
    expect(within(obligations).getAllByText("Overdue")).toHaveLength(1);
    expect(within(obligations).getByText("Them")).toBeTruthy();
    expect(within(detail).getByText("4 open of 4")).toBeTruthy();
    // Letting a contract go cannot be undone: the line under the lifecycle buttons says so (UX plan §6.2).
    expect(within(detail).getByRole("button", { name: "Terminate" })).toBeTruthy();
    const consequence = within(detail).getByTestId("terminate-consequence");
    expect(within(consequence).getByText("Not reversible")).toBeTruthy();
    const signing = within(detail).getByRole("region", { name: "Signing" });
    const open = within(signing).getByRole("button", { name: "Open to sign" });
    expect(open.getAttribute("data-founder-only")).toBe("true");
    fireEvent.click(open);
    expect(fake.opened).toEqual(["https://app.hellosign.com/sign/abc"]);
    expect(fake.mutations).toHaveLength(0);
    expect(within(signing).getAllByText("Founder only").length).toBe(2);
    fireEvent.click(within(signing).getByRole("button", { name: "Record my signature" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    expect(fake.mutations[0]).toEqual({ path: "legal.contracts.setStatus", input: { contractId: CONTRACT.msa, status: "signed", provider: "dropbox_sign" } });
    await waitFor(() => expect(fake.refetches["legal.contracts.list"]).toBe(1));
    expect(fake.refetches["legal.contracts.get"]).toBe(1);
  });

  it("keeps recording a signature to the founder: members see the button disabled", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "business.get": businessMember } });
    renderScreen(fake, <ContractsScreen {...props} />);
    fireEvent.doubleClick(within(screen.getByRole("grid", { name: "Contracts" })).getByText("Acme Retail master services agreement"));
    const signing = within(await screen.findByRole("region", { name: "Signing" }));
    expect(signing.getByRole("button", { name: "Record my signature" }).hasAttribute("disabled")).toBe(true);
  });

  it("moves a contract along its lifecycle from the right-click verbs, never straight to signed", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ContractsScreen {...props} />);
    fireEvent.contextMenu(within(screen.getByRole("grid", { name: "Contracts" })).getByText("Lease agreement"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open", "Open the other side in CRM", "Send for review", "Mark awaiting signature", "Terminate"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Send for review" }));
    expect(fake.mutations[0]).toEqual({ path: "legal.contracts.setStatus", input: { contractId: CONTRACT.lease, status: "review", provider: "manual" } });
  });

  it("adds a contract by hand and refetches; shows the empty state first", async () => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses, onMutate: () => ({ id: CONTRACT.nda }) });
    renderScreen(fake, <ContractsScreen {...props} />);
    expect(screen.getByText("No contracts yet")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "New contract" })[0]!);
    const form = screen.getByRole("form", { name: "New contract" });
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Office lease" } });
    fireEvent.change(within(form).getByLabelText("Value"), { target: { value: "2400" } });
    fireEvent.change(within(form).getByLabelText("Starts"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add contract" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    expect(fake.mutations[0]).toEqual({ path: "legal.contracts.create", input: { kind: "customer", title: "Office lease", valueMinor: 240_000, currency: "EUR", startsAt: "2026-11-01", endsAt: null, docRef: null, obligations: [] } });
    await waitFor(() => expect(fake.refetches["legal.contracts.list"]).toBe(1));
    act(() => fake.setResponse("legal.contracts.list", new Error("register unavailable")));
    expect(screen.getByText("register unavailable")).toBeTruthy();
  });
});
