import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegulatoryScreen } from "../RegulatoryScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

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

  it("clears a gate when every checklist item is ticked and drops a sector when switched off", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RegulatoryScreen {...props} />);
    const cosmetics = screen.getByRole("region", { name: "Cosmetics checklist" });
    expect(within(cosmetics).getAllByText("Founder only")).toHaveLength(2);
    for (const box of within(cosmetics).getAllByRole("checkbox")) await user.click(box);
    expect(within(cosmetics).getByText("Cleared")).toBeTruthy();
    expect(within(cosmetics).getByText(/4 of 4 done/)).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Food and drink" }));
    expect(screen.queryByRole("region", { name: "Food and drink checklist" })).toBeNull();
    expect(screen.getByText("No open gates")).toBeTruthy();
    expect(screen.getByText(/No regulated-sector gate is open/)).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Finance" }));
    expect(screen.getByRole("region", { name: "Finance checklist" })).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
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
  });
});
