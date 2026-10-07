import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IPScreen } from "../IPScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

describe("IPScreen", () => {
  it("screens a mark with the 'screen, not legal clearance' caption, objections, classes and register links", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <IPScreen {...props} />);
    expect(screen.getAllByText("Screen, not legal clearance").length).toBeGreaterThan(0);
    const form = screen.getByRole("form", { name: "Screen a mark" });
    fireEvent.change(within(form).getByLabelText("Word mark"), { target: { value: "Fresh Skincare" } });
    fireEvent.click(within(form).getByRole("button", { name: "Screen" }));
    const result = screen.getByRole("region", { name: "Screen of Fresh Skincare" });
    expect(within(result).getByRole("heading", { level: 2 }).textContent).toBe("Fresh Skincare");
    expect(within(result).getByText("Descriptive")).toBeTruthy();
    expect(within(result).getByText(/describes the product; descriptive marks are refused/)).toBeTruthy();
    expect(within(result).getByText("Objection likely")).toBeTruthy();
    expect(within(result).getByText("Class 3 · Cosmetics and cleaning preparations")).toBeTruthy();
    fireEvent.click(within(result).getByRole("button", { name: "USPTO trademark search" }));
    expect(fake.opened[0]).toContain("tmsearch.uspto.gov");
    expect(fake.opened[0]).toContain("Fresh%20Skincare");
    expect(screen.getAllByText("Screen, not legal clearance").length).toBeGreaterThanOrEqual(2);
    const grid = screen.getByRole("grid", { name: "Marks screened" });
    expect(within(grid).getAllByRole("row")).toHaveLength(2);
  });

  it("screens the business name with one click, flags a clash with it and removes marks from the list", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <IPScreen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: 'Screen "Northwind Skincare"' }));
    expect(screen.getByRole("region", { name: "Screen of Northwind Skincare" })).toBeTruthy();
    const form = screen.getByRole("form", { name: "Screen a mark" });
    fireEvent.change(within(form).getByLabelText("Word mark"), { target: { value: "Northwind" } });
    fireEvent.click(within(form).getByRole("button", { name: "Screen" }));
    expect(screen.getByText(/Contains or is contained by a mark on your list: "northwind skincare"/)).toBeTruthy();
    const grid = screen.getByRole("grid", { name: "Marks screened" });
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
    fireEvent.contextMenu(within(grid).getByText("Northwind Skincare"));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Remove from list" }));
    expect(within(screen.getByRole("grid", { name: "Marks screened" })).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("GitHub connected")).toBeTruthy();
  });

  it("shows empty states and errors", () => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(fake, <IPScreen {...props} />);
    expect(screen.getByText(/Enter a word mark to see its distinctiveness/)).toBeTruthy();
    expect(screen.getByText(/Marks you screen are listed here/)).toBeTruthy();
    expect(screen.getByText("No repository connected")).toBeTruthy();
    act(() => fake.setResponse("integrations.list", new Error("integrations down")));
    expect(screen.getByText("integrations down")).toBeTruthy();
  });
});
