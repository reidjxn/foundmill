import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityScreen } from "../EntityScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, PERSON, dataResponses, emptyResponses, lookupResult } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

describe("EntityScreen", () => {
  it("renders the entity facts, officers as CRM links and the incorporation history", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <EntityScreen {...props} />);
    const facts = screen.getByRole("region", { name: "Legal entity" });
    expect(within(facts).getByText("Northwind Skincare Ltd")).toBeTruthy();
    expect(within(facts).getByText("12345678")).toBeTruthy();
    expect(within(facts).getByText("1 Market Street, Manchester, M1 1AA, United Kingdom")).toBeTruthy();
    expect(within(facts).getByText("£10,000.00")).toBeTruthy();
    expect(within(facts).getAllByText("Active").length).toBeGreaterThan(0);
    const officers = screen.getByRole("grid", { name: "Officers" });
    expect(within(officers).getByRole("link", { name: /Mara Lindqvist/ }).getAttribute("href")).toBe(`/b/${BID}/crm/${PERSON.mara}/overview`);
    expect(within(officers).getByRole("link", { name: /Tomas Berg/ })).toBeTruthy();
    expect(within(officers).getByText("Priya Shah")).toBeTruthy();
    expect(within(officers).getByText("Not in CRM yet")).toBeTruthy();
    expect(within(officers).getAllByText("In CRM")).toHaveLength(2);
    expect(screen.getByText("3 officers")).toBeTruthy();
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByText("Companies House started")).toBeTruthy();
    expect(within(history).getByText("Stripe Atlas started")).toBeTruthy();
    expect(within(history).getByText("Asked the founder to review and submit.")).toBeTruthy();
    expect(fake.queried.get("crm.roles.byRole")).toEqual({ role: "officer", limit: 200 });
  });

  it("guidance on: the department's intro sits in the Legal entity panel, above the facts or the empty state, and Jurisdiction is defined (UX plan §7.10, §7.16)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    const { unmount } = renderScreen(fake, <EntityScreen {...props} />, {}, { guidance: "on" });
    const facts = screen.getByRole("region", { name: "Legal entity" });
    const explainer = facts.querySelector("[data-explainer='legal/entity']") as HTMLElement;
    expect(within(explainer).getByText("The company itself: where it is registered, what it must file, what it has signed.")).toBeTruthy();
    expect(within(explainer).getByText("Information, not legal advice. Signing, filing and paying are always yours.")).toBeTruthy();
    expect(within(facts).getAllByRole("button", { name: "Jurisdiction" })[0]!.className).toContain("term-link");
    expect(screen.getByRole("button", { name: /^View: Simple/ })).toBeTruthy();
    unmount();
    // Before an entity exists the empty state sits under the intro, never in place of it.
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(empty, <EntityScreen {...props} />, {}, { guidance: "on" });
    const panel = screen.getByRole("region", { name: "Legal entity" });
    expect(panel.querySelector("[data-explainer='legal/entity']")).toBeTruthy();
    expect(within(panel).getByText("No legal entity yet")).toBeTruthy();
    // A Term is a button: it never sits inside a form label (the definition is the Field's help tip instead).
    expect(document.querySelector("label button")).toBeNull();
  });

  it("opens the CRM from the right-click verb and on Enter", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <EntityScreen {...props} />);
    const officers = screen.getByRole("grid", { name: "Officers" });
    fireEvent.contextMenu(within(officers).getByText("Priya Shah"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Find in CRM" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/crm?q=Priya%20Shah`);
    fireEvent.doubleClick(within(officers).getByText("Tomas Berg"));
    expect(fake.navigations[1]).toBe(`/b/${BID}/crm/${PERSON.tomas}/overview`);
  });

  it("shows the empty state before an entity exists and runs the import lookup → confirm flow (AC-11.11.3)", async () => {
    const fake = createFakeSource({
      businessId: BID,
      responses: emptyResponses,
      onMutate: (path) => (path === "legal.import.lookup" ? lookupResult : path === "legal.import.confirm" ? { entity: { id: "e" }, people: ["p1", "p2"] } : {}),
    });
    renderScreen(fake, <EntityScreen {...props} />);
    expect(screen.getByText("No legal entity yet")).toBeTruthy();
    expect(screen.getByText(/Officers appear once a company is imported or formed/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Import existing company" });
    const lookupButton = within(form).getByRole("button", { name: "Look up" });
    expect(lookupButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(form).getByLabelText("Registration number"), { target: { value: "12345678" } });
    expect(lookupButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(lookupButton);
    expect(fake.mutations[0]).toEqual({ path: "legal.import.lookup", input: { country: "gb", regNo: "12345678" } });
    const result = await screen.findByRole("region", { name: "Lookup result" });
    expect(within(result).getByText("Untrusted until confirmed")).toBeTruthy();
    expect(within(result).getByText("From Companies House")).toBeTruthy();
    expect(within(within(result).getByRole("table", { name: "Officers found" })).getAllByRole("row")).toHaveLength(3);
    expect(within(result).getByText(/Deadlines found: Annual accounts Mar 31, 2027 · Confirmation statement Mar 14, 2027/)).toBeTruthy();
    fireEvent.change(within(result).getByLabelText("Share capital"), { target: { value: "25000" } });
    fireEvent.click(within(result).getByRole("button", { name: "Confirm and import" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(2));
    expect(fake.mutations[1]!.path).toBe("legal.import.confirm");
    expect(fake.mutations[1]!.input).toMatchObject({ source: "companies_house", legalName: "Northwind Skincare Ltd", regNo: "12345678", jurisdiction: "england-wales", shareCapitalMinor: 2_500_000, currency: "EUR", officers: lookupResult.officers, deadlines: lookupResult.deadlines });
    await screen.findByText("Imported · 2 officers in the CRM");
    expect(screen.queryByRole("region", { name: "Lookup result" })).toBeNull();
    expect(fake.refetches["legal.incorporate.status"]).toBe(1);
    expect(fake.refetches["crm.roles.byRole"]).toBe(1);
  });

  it("says 'Updated' when the same company is imported again (#175)", async () => {
    const fake = createFakeSource({
      businessId: BID,
      responses: emptyResponses,
      onMutate: (path) => (path === "legal.import.lookup" ? lookupResult : path === "legal.import.confirm" ? { entity: { id: "e" }, people: ["p1", "p2"], created: false } : {}),
    });
    renderScreen(fake, <EntityScreen {...props} />);
    const form = screen.getByRole("form", { name: "Import existing company" });
    fireEvent.change(within(form).getByLabelText("Registration number"), { target: { value: "12345678" } });
    fireEvent.click(within(form).getByRole("button", { name: "Look up" }));
    const result = await screen.findByRole("region", { name: "Lookup result" });
    fireEvent.click(within(result).getByRole("button", { name: "Confirm and import" }));
    await screen.findByText("Updated · 2 officers in the CRM");
  });

  it("lets the founder record the registration number and formation date a finished incorporation lacks (#166)", async () => {
    const user = userEvent.setup();
    const formed = { ...dataResponses["legal.incorporate.status"], entity: { ...dataResponses["legal.incorporate.status"].entity!, status: "active", regNo: null, formedAt: null } };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "legal.incorporate.status": formed }, onMutate: () => ({}) });
    renderScreen(fake, <EntityScreen {...props} />);
    const form = screen.getByRole("form", { name: "Registry details" });
    const save = within(form).getByRole("button", { name: "Save details" });
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.type(within(form).getByLabelText("Registration number"), "15432198");
    fireEvent.change(within(form).getByLabelText("Date formed"), { target: { value: "2026-10-05" } });
    await user.click(save);
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    expect(fake.mutations[0]).toEqual({ path: "legal.entity.update", input: { legalEntityId: formed.entity.id, regNo: "15432198", formedAt: "2026-10-05" } });
    expect(fake.refetches["legal.incorporate.status"]).toBe(1);
  });

  it("offers no registry-details form while the entity is still forming or has both facts", () => {
    const forming = { ...dataResponses["legal.incorporate.status"], entity: { ...dataResponses["legal.incorporate.status"].entity!, status: "forming", regNo: null, formedAt: null } };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "legal.incorporate.status": forming } });
    const { unmount } = renderScreen(fake, <EntityScreen {...props} />);
    expect(screen.queryByRole("form", { name: "Registry details" })).toBeNull();
    unmount();
    const full = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(full, <EntityScreen {...props} />);
    expect(screen.queryByRole("form", { name: "Registry details" })).toBeNull();
  });

  it("shows loading skeletons, then a retryable error", () => {
    const fake = createFakeSource({ businessId: BID });
    renderScreen(fake, <EntityScreen {...props} />);
    expect(screen.queryByRole("grid", { name: "Officers" })).toBeNull();
    act(() => fake.setResponse("legal.incorporate.status", new Error("legal status unavailable")));
    expect(screen.getByText("legal status unavailable")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(fake.refetches["legal.incorporate.status"]).toBe(1);
  });
});
