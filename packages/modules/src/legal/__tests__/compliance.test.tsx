import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComplianceScreen, daysLeftText } from "../ComplianceScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

describe("daysLeftText", () => {
  it("words the countdown", () => {
    expect(daysLeftText(null)).toBe("No date");
    expect(daysLeftText(0)).toBe("Today");
    expect(daysLeftText(1)).toBe("1 day");
    expect(daysLeftText(-6)).toBe("6 days overdue");
  });
});

describe("ComplianceScreen", () => {
  it("renders the summary strip and the open deadlines with status pills", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ComplianceScreen {...props} />);
    const strip = screen.getByRole("region", { name: "Compliance summary" });
    expect(within(strip).getByText("Overdue").parentElement!.parentElement!.textContent).toContain("1");
    expect(within(strip).getByText("Due within 30 days").parentElement!.parentElement!.textContent).toContain("1");
    const grid = screen.getByRole("grid", { name: "Deadlines" });
    const rows = within(grid).getAllByRole("row");
    expect(rows).toHaveLength(5); // header + 4 open (the filed incorporation is hidden by the Open view)
    expect(within(grid).getByText("Paye submission")).toBeTruthy();
    expect(within(grid).getByText("6 days overdue")).toBeTruthy();
    expect(within(grid).getByText("Annual accounts")).toBeTruthy();
    expect(within(grid).getAllByText("Due soon")).toHaveLength(1);
    expect(within(grid).getAllByText("Upcoming")).toHaveLength(2);
    expect(within(grid).getByText("Quarterly")).toBeTruthy();
    expect(within(grid).queryByText(/Incorporation via/)).toBeNull();
    expect(screen.getByText(/5 deadlines · 1 overdue/)).toBeTruthy();
    expect(fake.queried.get("legal.compliance.list")).toEqual({ pendingOnly: false, days: 365 });
  });

  it("guidance on: opens on the Simple view (Deadline, Due, Days left, Status), defines 'filing' in the footer and lines the tiles with plain words (UX plan §7.10, §7.16)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ComplianceScreen {...props} />, {}, { guidance: "on" });
    const grid = screen.getByRole("grid", { name: "Deadlines" });
    expect(screen.getByRole("button", { name: /^View: Simple/ })).toBeTruthy();
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Deadline", "Due", "Days left", "Status", "Actions"]);
    expect(within(grid).getAllByRole("row")).toHaveLength(5); // header + 4 open, as the Open view shows
    expect(screen.getByRole("button", { name: "filing" }).className).toContain("term-link");
    expect(document.querySelectorAll("[data-plain-line]")).toHaveLength(4);
  });

  it("switches to the twelve-month calendar from the toggle, the sub-view and the right-click verb", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    const { unmount } = renderScreen(fake, <ComplianceScreen {...props} />);
    fireEvent.contextMenu(within(screen.getByRole("grid", { name: "Deadlines" })).getByText("Annual accounts"));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Show in calendar" }));
    const calendar = screen.getByRole("list", { name: "Twelve-month calendar" });
    const months = within(calendar).getAllByRole("listitem").filter((li) => li.getAttribute("aria-label"));
    expect(months).toHaveLength(12);
    expect(months[0]!.getAttribute("aria-label")).toBe("Oct 2026");
    expect(within(months[0]!).getByText(/Annual accounts/)).toBeTruthy();
    expect(within(months[0]!).getByText(/Paye submission/)).toBeTruthy();
    expect(within(months[1]!).getByText(/VAT return Q3/)).toBeTruthy();
    expect(within(months[2]!).getByText("Nothing due")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("grid", { name: "Deadlines" })).toBeTruthy();
    unmount();
    renderScreen(fake, <ComplianceScreen {...props} subView="calendar" />);
    expect(screen.getByRole("list", { name: "Twelve-month calendar" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("button", { name: "List" }));
  });

  it("navigates to the Inbox from the verb", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ComplianceScreen {...props} />);
    fireEvent.contextMenu(within(screen.getByRole("grid", { name: "Deadlines" })).getByText("VAT return Q3"));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Open the Inbox" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/inbox`);
  });

  it("shows the empty state, loading and errors", () => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(fake, <ComplianceScreen {...props} />);
    expect(screen.getByText("No deadlines yet")).toBeTruthy();
    act(() => fake.setResponse("legal.compliance.list", new Error("calendar unavailable")));
    expect(screen.getByText("calendar unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fake.refetches["legal.compliance.list"]).toBe(1);
  });
});
