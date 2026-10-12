import "./setup";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { SourcesScreen } from "../SourcesScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { readState, summaryLine } from "../sources/kinds";
import { BID, BLOCK, dataResponses, emptyResponses, sources } from "./fixtures";

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

  it("says where the Source Watcher is with a source that has no summary yet", () => {
    const rows = [
      ...sources,
      { id: "00000000-0000-4000-8000-0000000000a1", kind: "competitor" as const, uri: "https://blocked.example/pricing", title: "Blocked page", contentRef: null, relevance: { watch: { status: "unreachable", reason: "The site's robots.txt does not allow reading this page." } }, fetchedAt: null, createdAt: "2026-10-06T10:00:00Z" },
    ];
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "product.sources.list": { items: rows, nextCursor: null } } });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const table = screen.getByRole("grid", { name: "Sources" });
    expect(within(table).getByText("Could not read it: The site's robots.txt does not allow reading this page.")).toBeTruthy();
    // The issue has linked blocks but no summary and was never read: it waits for the watcher.
    expect(within(table).getByText("Waiting for the Source Watcher to read it")).toBeTruthy();
    expect(readState(rows.at(-1)!)).toEqual({ state: "unreachable", reason: "The site's robots.txt does not allow reading this page." });
    expect(readState({ relevance: { watch: { status: "scored" } }, fetchedAt: null }).state).toBe("read");
    expect(summaryLine({ relevance: { watch: { status: "failed" } }, fetchedAt: null })).toMatch(/tries again on the next sweep/);
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
    expect(fake.mutations[0]).toEqual({ path: "product.sources.add", input: { kind: "doc", uri: "https://rival.example/pricing", title: "Pricing page", contentRef: null, relevance: { notes: "Annual plan 20% off" } } });
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
