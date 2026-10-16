import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegulatoryScreen } from "../RegulatoryScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, business, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

type Stored = { id: string; sector: string; applies: boolean; done: string[] };

/** A fake store behind `legal.regulatory.list` / `legal.regulatory.set`, like the api's table. */
function withStore(initial: Stored[] = [], base: Record<string, unknown> = dataResponses) {
  const rows = new Map<string, Stored>(initial.map((r) => [r.sector, r]));
  const responses = { ...base, "legal.regulatory.list": () => [...rows.values()] };
  const onMutate = (path: string, input: Record<string, unknown>) => {
    if (path !== "legal.regulatory.set") return {};
    const before = rows.get(input.sector as string);
    const next: Stored = { id: before?.id ?? `g-${input.sector}`, sector: input.sector as string, applies: (input.applies as boolean | undefined) ?? before?.applies ?? true, done: (input.done as string[] | undefined) ?? before?.done ?? [] };
    rows.set(next.sector, next);
    return next;
  };
  return { responses, onMutate, rows };
}

describe("RegulatoryScreen", () => {
  it("suggests sectors from the profile, opens their gates and lists what the team will not do", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    const sectors = screen.getByRole("list", { name: "Sectors" });
    expect(within(sectors).getAllByText("Suggested")).toHaveLength(2);
    expect(within(sectors).getAllByText("Gate open")).toHaveLength(2);
    expect(within(sectors).queryAllByText("Not applicable")).toHaveLength(0); // an off switch says it; no pill repeats it
    expect(within(sectors).getAllByRole("switch").filter((s) => s.getAttribute("aria-checked") === "true")).toHaveLength(2);
    expect(within(sectors).getByText(/Why: mentions "skincare"/)).toBeTruthy();
    expect(screen.getByText("2 open")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Cosmetics checklist" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Food and drink checklist" })).toBeTruthy();
    const blocked = screen.getByRole("list", { name: "Blocked activities" });
    expect(within(blocked).getByText(/Selling before the product information file/)).toBeTruthy();
    expect(within(blocked).getByText(/Selling before registration with the food authority/)).toBeTruthy();
  });

  it("saves each switch and tick, clears a gate when every checklist item is ticked and drops a sector when switched off (#176)", async () => {
    const user = userEvent.setup();
    const store = withStore();
    const fake = createFakeSource({ businessId: BID, responses: store.responses, onMutate: store.onMutate });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    const cosmetics = screen.getByRole("region", { name: "Cosmetics checklist" });
    expect(within(cosmetics).getAllByText("Founder only")).toHaveLength(2);
    for (const box of within(cosmetics).getAllByRole("checkbox")) await user.click(box);
    await waitFor(() => expect(fake.mutations).toHaveLength(4));
    const last = fake.mutations.at(-1)!;
    expect(last.path).toBe("legal.regulatory.set");
    expect(last.input).toMatchObject({ sector: "cosmetics", applies: true });
    expect([...(last.input.done as string[])].sort()).toEqual(["claims", "notification", "pif", "safety"]);
    expect(within(await screen.findByRole("region", { name: "Cosmetics checklist" })).getByText("Cleared")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Cosmetics checklist" })).getByText(/4 of 4 done/)).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Food and drink" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(5));
    expect(fake.mutations[4]).toEqual({ path: "legal.regulatory.set", input: { sector: "food", applies: false, done: [] } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Food and drink checklist" })).toBeNull());
    expect(screen.getByText("No open gates")).toBeTruthy();
    expect(screen.getByText(/No regulated-sector gate is open/)).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Finance" }));
    expect(await screen.findByRole("region", { name: "Finance checklist" })).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
  });

  it("keeps the founder's choices across a reload, over the suggestions (#176)", () => {
    // the store says: Health applies with one item done; Cosmetics was switched off; Food was never decided (still suggested)
    const store = withStore([
      { id: "g1", sector: "health", applies: true, done: ["claims"] },
      { id: "g2", sector: "cosmetics", applies: false, done: [] },
    ]);
    const fake = createFakeSource({ businessId: BID, responses: store.responses });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    const sectors = screen.getByRole("list", { name: "Sectors" });
    const on = within(sectors).getAllByRole("switch").filter((s) => s.getAttribute("aria-checked") === "true").map((s) => s.getAttribute("aria-label"));
    expect(on.sort()).toEqual(["Food and drink", "Health"]);
    expect(screen.getByText("2 open")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Health checklist" })).getByText(/1 of 4 done/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Cosmetics checklist" })).toBeNull();
  });

  it("says what the gates do: they go into the team's brief, and the choices are saved (#176)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    expect(screen.getByText(/goes into the team's brief each cycle/)).toBeTruthy();
    expect(screen.queryByText(/never performs these/)).toBeNull();
  });

  it("shows a failed save and keeps the change visible for another try", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "legal.regulatory.list": [] }, onMutate: () => { throw new Error("Settings could not be saved"); } });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    await user.click(screen.getByRole("switch", { name: "Health" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Settings could not be saved");
  });

  it("keeps a switch as the founder set it until the store's own copy shows it (the save answers before its reload)", async () => {
    const user = userEvent.setup();
    const store = withStore();
    // The list answers from a copy of the store that catches up only when told to, as a reload still on its way does.
    let copy: Stored[] = [];
    const fake = createFakeSource({ businessId: BID, responses: { ...store.responses, "legal.regulatory.list": () => copy }, onMutate: store.onMutate });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    const food = () => screen.getByRole("switch", { name: "Food and drink" });
    expect(food().getAttribute("aria-checked")).toBe("true");
    await user.click(food());
    await waitFor(() => expect(fake.refetches["legal.regulatory.list"]).toBe(1));
    // Saved, and reloaded from a copy that has not caught up: the switch does not flick back.
    expect(food().getAttribute("aria-checked")).toBe("false");
    copy = [...store.rows.values()];
    act(() => fake.setResponse("legal.regulatory.list", () => copy));
    expect(food().getAttribute("aria-checked")).toBe("false");
    // The store's copy now holds the choice, so the store wins again: a change from elsewhere shows.
    copy = copy.map((r) => (r.sector === "food" ? { ...r, applies: true } : r));
    act(() => fake.setResponse("legal.regulatory.list", () => copy));
    expect(food().getAttribute("aria-checked")).toBe("true");
  });

  it("shows no suggestions for a blank profile, loading and errors", () => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    expect(screen.queryByText("Suggested")).toBeNull();
    expect(screen.getByText("No open gates")).toBeTruthy();
    expect(screen.getByText("Blank Co")).toBeTruthy();
    act(() => fake.setResponse("business.get", new Error("business unavailable")));
    expect(screen.getByText("business unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fake.refetches["business.get"]).toBe(1);
    act(() => fake.setResponse("business.get", business));
    act(() => fake.setResponse("legal.regulatory.list", new Error("gates unavailable")));
    expect(screen.getByText("gates unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fake.refetches["legal.regulatory.list"]).toBe(1);
  });
});
