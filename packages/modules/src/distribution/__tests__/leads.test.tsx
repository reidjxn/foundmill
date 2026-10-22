import "./setup";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { LeadsScreen } from "../LeadsScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, LEAD, dataResponses, emptyResponses, leads } from "./fixtures";

const props = { businessId: BID, departmentId: "d1" };

describe("LeadsScreen", () => {
  it("lists leads with entity links, lawful basis, suppression and owner", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <LeadsScreen {...props} />);
    expect(fake.queried.get("crm.roles.byRole")).toEqual({ role: "lead", limit: 500 });
    const table = screen.getByRole("grid", { name: "Leads" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("link", { name: /Anna Lindqvist/ }).getAttribute("href")).toBe(`/b/${BID}/crm/${LEAD.anna}/overview`);
    expect(within(table).getByText("Legitimate interest")).toBeTruthy();
    expect(within(table).getByText("Not recorded")).toBeTruthy();
    expect(within(table).getAllByText("Suppressed")).toHaveLength(2); // the stage chip and the suppression pill
    expect(within(table).getAllByText("Clear")).toHaveLength(2);
    expect(screen.getByText(/3 leads · 1 without a lawful basis · 1 suppressed/)).toBeTruthy();
    // "Lawful basis" is defined in the sentence where it first appears (UX plan §7.13).
    // The footer defines "lawful basis" (a Term, plain text while guidance is off), so the sentence spans two nodes.
    expect(screen.getByRole("region", { name: "Leads" }).querySelector("footer")!.textContent).toContain("A lawful basis is your legal reason for contacting someone; suppressed means never contact.");
  });

  it("shows companies and owners in their own view", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <LeadsScreen {...props} />);
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Companies and owners/ }));
    const table = screen.getByRole("grid", { name: "Leads" });
    await waitFor(() => expect(within(table).getByRole("link", { name: /Mara/ })).toBeTruthy());
    expect(within(table).getByText("Unassigned")).toBeTruthy();
  });

  it("filters with the built-in views (Needs lawful basis, Suppressed)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <LeadsScreen {...props} />);
    await user.click(screen.getByRole("button", { name: /All leads/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Needs lawful basis/ }));
    const table = screen.getByRole("grid", { name: "Leads" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    expect(within(table).getByText("Bo Nakamura")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Needs lawful basis/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /^Suppressed/ }));
    await waitFor(() => expect(within(table).getByText("Cai Oduya")).toBeTruthy());
    expect(within(table).getByText("Unsubscribed 2026-09-30")).toBeTruthy();
  });

  it("sets a lawful basis through crm.entity.update, adds a note through crm.notes.add and ends the role through crm.roles.end", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({}) });
    renderScreen(fake, <LeadsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Leads" });
    fireEvent.contextMenu(within(table).getByText("bo@kintsugi.jp"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Set lawful basis…" }));
    const dialog = await screen.findByRole("dialog", { name: "Set lawful basis" });
    const save = within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Consent" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "crm.entity.update", input: { entityId: LEAD.bo, patch: { lawfulBasis: "consent" } } });
    expect(fake.refetches["crm.roles.byRole"]).toBe(1);

    fireEvent.contextMenu(within(table).getByText("anna@lumen.se"));
    const menu2 = await screen.findByRole("menu");
    await user.click(within(menu2).getByRole("menuitem", { name: "Add note…" }));
    const note = await screen.findByRole("dialog", { name: "Add note" });
    fireEvent.change(within(note).getByLabelText("Note"), { target: { value: "Met at the Berlin fair." } });
    await act(async () => {
      fireEvent.click(within(note).getByRole("button", { name: "Add note" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "crm.notes.add", input: { entityId: LEAD.anna, note: "Met at the Berlin fair." } });

    fireEvent.contextMenu(within(table).getByText("cai@example.eu"));
    const menu3 = await screen.findByRole("menu");
    await user.click(within(menu3).getByRole("menuitem", { name: "End lead role" }));
    await waitFor(() => expect(fake.mutations.at(-1)).toEqual({ path: "crm.roles.end", input: { roleId: leads[2]!.role.id } }));
  });

  it("opens the CRM profile from the keyboard (ArrowDown to the newest lead, Enter) and refetches on lead.created", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <LeadsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Leads" });
    fireEvent.keyDown(table, { key: "ArrowDown" });
    fireEvent.keyDown(table, { key: "Enter" });
    expect(fake.navigations[0]).toBe(`/b/${BID}/crm/${LEAD.anna}/overview`);
    act(() => {
      fake.emit({ type: "lead.created", payload: {} });
    });
    expect(fake.refetches["crm.roles.byRole"]).toBe(1);
  });

  it("shows the empty state, the error and the loading skeleton", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(empty, <LeadsScreen {...props} />);
    expect(screen.getByText("No leads yet")).toBeTruthy();
    expect(screen.getByText(/once Lead generation runs on the board/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Lead generation" }));
    expect(empty.navigations.at(-1)).toBe(`/b/${BID}/d/distribution/formation?channel=lead_generation`);

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "crm.roles.byRole": new Error("crm down") } });
    renderScreen(failing, <LeadsScreen {...props} />);
    expect(screen.getByText("crm down")).toBeTruthy();

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <LeadsScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
