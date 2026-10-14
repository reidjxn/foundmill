import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { ResearchScreen } from "../ResearchScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, BLOCK, dataResponses, emptyResponses } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }, { id: "t2", slug: "sources", title: "Sources", position: 2 }] }];
const responses = { ...dataResponses, "department.list": departments };

describe("ResearchScreen", () => {
  it("renders competitor cards with estimates labelled, research notes with linked blocks, topics and the coverage chart", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ResearchScreen businessId={BID} departmentId="d1" />);
    const card = screen.getByRole("article", { name: "Invoicely" });
    expect(within(card).getByText(/From 9 EUR per month/)).toBeTruthy();
    expect(within(card).getByText("1.2M EU freelancers")).toBeTruthy();
    expect(within(card).getByText("Estimate")).toBeTruthy();
    expect(within(card).getByText(/· Brand/)).toBeTruthy();
    expect(within(card).getByText(/No reminder tone control/)).toBeTruthy();
    const notes = screen.getByRole("list", { name: "Research notes" });
    expect(within(notes).getAllByRole("listitem")).toHaveLength(3); // interview, issue, legal
    expect(within(notes).getByText(/Wants annual billing/)).toBeTruthy();
    expect(within(notes).getByText(/Mandatory structured e-invoices/)).toBeTruthy();
    const topicsList = screen.getByRole("list", { name: "Topics" });
    expect(within(topicsList).getByText("pricing")).toBeTruthy();
    // A real list (no role="img" over list items): one item per section with its count.
    const coverageList = screen.getByRole("list", { name: "Sources per spec section" });
    expect(within(coverageList).getAllByRole("listitem").some((li) => /Pricing\s*1$/.test(li.textContent ?? ""))).toBe(true);
    expect(screen.getByText(/^1 competitor · pricing and market figures are the agent's estimates/)).toBeTruthy();
  });

  it("navigates to a linked spec block from a note", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ResearchScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(screen.getByRole("list", { name: "Research notes" })).getByRole("button", { name: /^Pricing$/ }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/product/specification?block=${BLOCK.pricing}`);
  });

  it("shows empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "department.list": departments } });
    renderScreen(empty, <ResearchScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("No competitor cards yet")).toBeTruthy();
    expect(screen.getByText("No research notes yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open sources" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/product/sources`);
    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "product.sources.list": new Error("research down") } });
    renderScreen(failing, <ResearchScreen businessId={BID} departmentId="d1" />);
    expect(screen.getAllByText("research down").length).toBeGreaterThan(0);
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <ResearchScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
