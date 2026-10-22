import "./setup";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AttributionScreen, creditSharingHeadline } from "../AttributionScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, JOURNEY, dataResponses, emptyResponses } from "./fixtures";
import type { JourneyRow } from "../types";

const props = { businessId: BID, departmentId: "d1" };

describe("AttributionScreen", () => {
  it("says how credit is shared in plain words, with the model under Technical detail, then the touch funnel and the channel attribution table with partial-journey labels", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <AttributionScreen {...props} />);
    const model = screen.getByRole("region", { name: "How credit is shared" });
    expect(screen.queryByRole("region", { name: "Model in use" })).toBeNull();
    // The business thing first (UX plan §7.13, C7); the algorithm's name behind the disclosure.
    expect(screen.getByTestId("credit-headline").textContent).toBe("Early touches get 40 %, the last touch 40 %, the middle 20 %.");
    const technical = screen.getByTestId("credit-technical");
    expect(technical.querySelector("summary")!.textContent).toContain("Technical detail");
    expect(within(technical).getByText("Position-based 40/20/40")).toBeTruthy();
    expect(within(model).getByText("1 of 3")).toBeTruthy(); // partial journeys, over every journey (journey.attribution)
    expect(within(technical).getByText(/197 more to go/)).toBeTruthy();
    expect(within(model).queryByText(/Markov/)).toBeNull();
    expect(fake.queried.get("journey.list")).toEqual({ limit: 5, orderBy: "converted" });
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

  it("a Customer Update opened here comes back here (the replay's back button reads the from path)", () => {
    const here = `/b/${BID}/d/distribution/attribution`;
    window.history.pushState({}, "", here);
    try {
      const fake = createFakeSource({ businessId: BID, responses: dataResponses });
      renderScreen(fake, <AttributionScreen {...props} />);
      fireEvent.click(within(screen.getByRole("region", { name: "Latest wins" })).getAllByRole("button", { name: /Open Customer Update/ })[0]!);
      expect(fake.navigations[0]).toBe(`/b/${BID}/journey/${JOURNEY.first}?from=${encodeURIComponent(here)}`);
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("takes the model in use and the counts from the whole history, not from the journeys it lists", () => {
    // The newest wins are all signups (as for Northwind's newest 200), yet the business is far past 200 conversions.
    const signups = (dataResponses["journey.list"] as { items: JourneyRow[] }).items.map((j) => ({ ...j, conversion: { ...j.conversion, kind: "signup" as const } }));
    const summary = { conversionCount: 9228, byKind: { payment: 2125, signup: 4600, activation: 2503 }, attributionModel: "data_driven_markov", threshold: 200, remaining: 0, journeys: 3341, partialJourneys: 283 };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "journey.list": { items: signups, nextCursor: "next" }, "journey.attribution": summary } });
    renderScreen(fake, <AttributionScreen {...props} />);
    const model = screen.getByRole("region", { name: "How credit is shared" });
    expect(screen.getByTestId("credit-headline").textContent).toBe(creditSharingHeadline("data_driven_markov"));
    expect(within(screen.getByTestId("credit-technical")).getByText("Data-driven (Markov removal effect)")).toBeTruthy();
    expect(within(model).getByText("9,228")).toBeTruthy();
    expect(within(model).getByText("2,125")).toBeTruthy();
    expect(within(model).getByText("283 of 3,341")).toBeTruthy();
    expect(within(model).queryByText(/more to go/)).toBeNull();
    expect(within(model).getByText(/only first-party touches were weighted/)).toBeTruthy();
  });

  it("creditSharingHeadline reads as one plain sentence per model, never an algorithm's name", () => {
    expect(creditSharingHeadline("position_based_40_20_40")).toBe("Early touches get 40 %, the last touch 40 %, the middle 20 %.");
    expect(creditSharingHeadline("data_driven_markov")).toBe("Each touch gets the credit it earned: the more wins depended on it, the bigger its share.");
    for (const key of ["position_based_40_20_40", "data_driven_markov"] as const) expect(creditSharingHeadline(key)).not.toMatch(/Markov|position-based/i);
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
    expect(empty.refetches["journey.attribution"]).toBe(1);

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "journey.list": new Error("journeys down") } });
    renderScreen(failing, <AttributionScreen {...props} />);
    expect(screen.getByText("journeys down")).toBeTruthy();
    const noSummary = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "journey.attribution": new Error("summary down") } });
    renderScreen(noSummary, <AttributionScreen {...props} />);
    expect(screen.getByText("summary down")).toBeTruthy();

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <AttributionScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
