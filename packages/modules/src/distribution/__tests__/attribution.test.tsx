import "./setup";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AttributionScreen } from "../AttributionScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, JOURNEY, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d1" };

describe("AttributionScreen", () => {
  it("shows the model in use, the touch funnel and the channel attribution table with partial-journey labels", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <AttributionScreen {...props} />);
    const model = screen.getByRole("region", { name: "Model in use" });
    expect(within(model).getByText("Position-based 40/20/40")).toBeTruthy();
    expect(within(model).getByText("1 of 3")).toBeTruthy(); // partial journeys
    expect(within(model).getByText(/198 more paying customers/)).toBeTruthy();
    const wins = within(model).getByRole("region", { name: "Latest wins" });
    expect(within(wins).getAllByRole("listitem")).toHaveLength(3);
    expect(within(wins).getByText("Partial journey")).toBeTruthy();
    expect(within(wins).getAllByText("Featured")).toHaveLength(2);
    expect(within(wins).getByText("Brief")).toBeTruthy();

    const funnel = screen.getByRole("region", { name: "Touch funnel" });
    expect(within(funnel).getByText("Impressions")).toBeTruthy();
    expect(within(funnel).getByText("Customers")).toBeTruthy();

    const table = screen.getByRole("grid", { name: "Channel attribution" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByText("Paid advertising")).toBeTruthy();
    expect(within(table).getByText("60%")).toBeTruthy();
    expect(within(table).getByText("Partial journey")).toBeTruthy();
    expect(within(table).getAllByText("Measured")).toHaveLength(3);
    expect(within(table).getAllByText("Estimate").length).toBeGreaterThan(0);
  });

  it("opens a Customer Update and a channel profile", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <AttributionScreen {...props} />);
    const wins = screen.getByRole("region", { name: "Latest wins" });
    fireEvent.click(within(wins).getAllByRole("button", { name: /Open Customer Update/ })[0]!);
    expect(fake.navigations[0]).toBe(`/b/${BID}/journey/${JOURNEY.first}`);
    const table = screen.getByRole("grid", { name: "Channel attribution" });
    fireEvent.contextMenu(within(table).getByText("Print"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Open channel profile" }));
    await waitFor(() => expect(fake.navigations[1]).toBe(`/b/${BID}/d/distribution/formation?channel=print`));
  });

  it("uses the data-driven model once 200 paying customers are labelled", () => {
    const paying = Array.from({ length: 200 }, (_, i) => ({ ...(dataResponses["journey.list"] as { items: unknown[] }).items[0] as object, id: `j${i}`, conversionId: `c${i}` }));
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "journey.list": { items: paying, nextCursor: null } } });
    renderScreen(fake, <AttributionScreen {...props} />);
    expect(screen.getByText("Data-driven (Markov removal effect)")).toBeTruthy();
  });

  it("handles empty, error and loading, and refetches on customer.converted", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(empty, <AttributionScreen {...props} />);
    expect(screen.getByText(/No wins yet/)).toBeTruthy();
    expect(screen.getByText(/The funnel fills as channels report/)).toBeTruthy();
    expect(screen.getByText("No measured touches yet")).toBeTruthy();
    act(() => {
      empty.emit({ type: "customer.converted", payload: {} });
    });
    expect(empty.refetches["distribution.channels.list"]).toBe(1);
    expect(empty.refetches["journey.list"]).toBe(1);

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "journey.list": new Error("journeys down") } });
    renderScreen(failing, <AttributionScreen {...props} />);
    expect(screen.getByText("journeys down")).toBeTruthy();

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <AttributionScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
