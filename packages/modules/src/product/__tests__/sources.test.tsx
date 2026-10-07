import "./setup";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { SourcesScreen } from "../SourcesScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, BLOCK, dataResponses, emptyResponses } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }] }];
const responses = { ...dataResponses, "department.list": departments };

describe("SourcesScreen", () => {
  it("renders every source with its kind chip, summary, linked blocks and kind counts", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const table = screen.getByRole("grid", { name: "Sources" });
    expect(within(table).getByText(/Customer interview 7/)).toBeTruthy();
    expect(within(table).getByText("Invoicely")).toBeTruthy();
    expect(within(table).getByText(/Reminder sent twice/)).toBeTruthy();
    expect(within(table).getByText("EU e-invoicing directive note")).toBeTruthy();
    expect(within(table).getAllByText("Interview").length).toBeGreaterThan(0);
    expect(within(table).getByText(/Wants annual billing/)).toBeTruthy();
    const filters = screen.getByRole("group", { name: "Filter by kind" });
    expect(within(filters).getByRole("button", { name: /Competitor 1/ })).toBeTruthy();
    expect(screen.getByText(/4 sources ·/)).toBeTruthy();
  });

  it("filters by kind through the query input and navigates to a linked spec block", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by kind" })).getByRole("button", { name: /Issue/ }));
    expect(fake.queried.get("product.sources.list")).toEqual({ kind: "issue", limit: 200 });
    fireEvent.click(within(screen.getByRole("grid", { name: "Sources" })).getByRole("button", { name: /Automatic reminders/ }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/product/specification?block=${BLOCK.features}`);
  });

  it("adds a source through product.sources.add and refetches", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a source" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    });
    expect(within(dialog).getAllByRole("alert").some((a) => /title or a link/.test(a.textContent ?? ""))).toBe(true);
    expect(fake.mutations).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Pricing page" } });
    fireEvent.change(within(dialog).getByLabelText(/Link/), { target: { value: "https://rival.example/pricing" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "Annual plan 20% off" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    });
    expect(fake.mutations[0]).toEqual({ path: "product.sources.add", input: { kind: "doc", uri: "https://rival.example/pricing", title: "Pricing page", contentRef: null, relevance: { summary: "Annual plan 20% off" } } });
    expect(fake.refetches["product.sources.list"]).toBe(1);
  });

  it("opens the link in a new tab when a row is opened", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const row = within(screen.getByRole("grid", { name: "Sources" })).getByText("Invoicely").closest("[role='row']")!;
    fireEvent.doubleClick(row);
    expect(open).toHaveBeenCalledWith("https://invoicely.example.com/pricing", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("shows the empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "department.list": [] } });
    renderScreen(empty, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("No sources yet")).toBeTruthy();
    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "product.sources.list": new Error("sources down") } });
    renderScreen(failing, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("sources down")).toBeTruthy();
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
