import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StartingTeamList, type StartingTeamAgent } from "./StartingTeamList";

const agent = (key: string, name: string): StartingTeamAgent => ({ key, name, role: `${name}'s work`, dept: "dept-1", model: "Opus" });
const starting = [agent("chief_of_staff", "Chief of Staff"), agent("product_lead", "Product Lead"), agent("researcher", "Researcher")];
const later = [agent("planner", "Planner"), agent("finance_lead", "Finance lead")];

describe("StartingTeamList (WP-04 T4)", () => {
  it("lists the starting agents, and everyone after See everyone", () => {
    render(<StartingTeamList starting={starting} later={later} />);
    const list = screen.getByRole("list", { name: "Team" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    const button = screen.getByRole("button", { name: "See everyone" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("names models only with showModels, and has no See everyone when nobody waits", () => {
    const { unmount } = render(<StartingTeamList starting={starting} later={[]} />);
    expect(screen.queryByText("Opus")).toBeNull();
    expect(screen.queryByRole("button", { name: "See everyone" })).toBeNull();
    unmount();
    render(<StartingTeamList starting={starting} later={later} showModels />);
    expect(screen.getAllByText("Opus")).toHaveLength(3);
  });
});
