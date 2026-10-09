import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { RoadmapScreen } from "../RoadmapScreen";
import { SpecificationScreen } from "../SpecificationScreen";
import { VisionScreen } from "../VisionScreen";
import { foundationsBasis, foundationsSummary } from "../foundations";
import type { FoundationsResponse } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses } from "./fixtures";

const base: FoundationsResponse = { status: "drafting", door: "ideation", attempt: 1, runner: "local", startedAt: "2026-10-09T08:00:00Z", finishedAt: null, error: null, vision: null, summary: {}, importLinked: false, stale: false };
const ready: FoundationsResponse = {
  ...base,
  status: "ready",
  finishedAt: "2026-10-09T08:01:00Z",
  vision: {
    statement: "Ledgerly exists so that freelancers get paid on time without chasing.",
    forWhom: "Solo consultants in the EU who bill a handful of clients a month.",
    problem: "Late invoices cost a week a quarter.",
    whyNow: "Open banking makes payment status visible.",
    principles: [
      { title: "First customer first", detail: "Everything moves a customer closer to paying." },
      { title: "Agents act, the founder decides", detail: "Spending waits for the founder." },
      { title: "Every number has a source or a label", detail: "Estimate or Forecast otherwise." },
    ],
    northStar: { metric: "Invoices paid within 30 days", definition: "Share of invoices paid within 30 days of issue.", target: "80% of invoices by the end of the second chapter (Forecast)", label: "Forecast" },
  },
  summary: { sectionsWritten: 5, sectionsTotal: 5, roadmap: { now: 2, next: 3, later: 1 }, importedIssues: 0 },
};

describe("foundations on the Product tabs", () => {
  it("Vision: drafting shows the status with what it reads, polls, and fills in the vision when ready", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": base, "department.list": [] } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    expect(status.getAttribute("data-foundations-state")).toBe("drafting");
    expect(within(status).getByText("Drafting your vision, specification and roadmap…")).toBeTruthy();
    expect(within(status).getByText(foundationsBasis("ideation"))).toBeTruthy();
    expect(screen.queryByTestId("vision-record")).toBeNull();
    // The narrative still renders under its usual title while drafting.
    expect(screen.getByRole("region", { name: "Vision" })).toBeTruthy();

    act(() => fake.setResponse("product.foundations.get", ready));
    expect(screen.queryByTestId("foundations-status")).toBeNull();
    const record = screen.getByTestId("vision-record");
    expect(within(record).getByText(ready.vision!.statement)).toBeTruthy();
    expect(within(record).getByText("Solo consultants in the EU who bill a handful of clients a month.")).toBeTruthy();
    expect(within(record).getAllByRole("listitem")).toHaveLength(3);
    const northStar = screen.getByTestId("north-star");
    expect(within(northStar).getByText("Invoices paid within 30 days")).toBeTruthy();
    expect(within(northStar).getByText("Forecast")).toBeTruthy();
    expect(screen.getByRole("region", { name: "From the specification" })).toBeTruthy();
    // Turning ready reloads what the tab shows.
    expect(fake.refetches["product.spec.get"]).toBe(1);
    expect(fake.refetches["product.roadmap.list"]).toBe(1);
  });

  it("failed: the reason and Try again, which calls product.foundations.retry", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": { ...base, status: "failed", error: "The model service did not answer. Try again in a few minutes." } } });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    expect(status.getAttribute("data-foundations-state")).toBe("failed");
    expect(within(status).getByText("The model service did not answer. Try again in a few minutes.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(status).getByRole("button", { name: "Try again" }));
    });
    expect(fake.mutations).toEqual([{ path: "product.foundations.retry", input: {} }]);
  });

  it("Roadmap: pending reads as drafting; a settled or foundation-less business shows nothing", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": { ...base, status: "pending", door: "import" } } });
    renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByTestId("foundations-status").getAttribute("data-foundations-state")).toBe("pending");
    expect(screen.getByText(foundationsBasis("import"))).toBeTruthy();
    act(() => fake.setResponse("product.foundations.get", { ...base, status: "none", door: null }));
    expect(screen.queryByTestId("foundations-status")).toBeNull();
    act(() => fake.setResponse("product.foundations.get", ready));
    expect(screen.queryByTestId("foundations-status")).toBeNull();
  });

  it("summarises what was written", () => {
    expect(foundationsSummary(ready)).toBe("5 specification sections · 6 roadmap items, 2 in Now");
    expect(foundationsSummary({ summary: { sectionsWritten: 1, roadmap: { now: 1 }, importedIssues: 3 } })).toBe("1 specification section · 1 roadmap item, 1 in Now · 3 imported issues");
    expect(foundationsSummary({ summary: {} })).toBeNull();
  });
});
