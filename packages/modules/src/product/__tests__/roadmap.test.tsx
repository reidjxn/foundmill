import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { RoadmapScreen, statusCounts } from "../RoadmapScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, BLOCK, ITEM, dataResponses, emptyResponses, roadmap } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }, { id: "t2", slug: "roadmap", title: "Roadmap", position: 2 }] }];
const responses = { ...dataResponses, "department.list": departments };

describe("RoadmapScreen", () => {
  it("renders the three columns with cards, computed status pills, task progress, linked blocks and dependencies", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    const now = screen.getByRole("list", { name: "Now items" });
    expect(within(now).getAllByRole("listitem")).toHaveLength(2);
    const billing = within(now).getByRole("listitem", { name: /Usage-based billing/ });
    expect(within(billing).getByText("In progress")).toBeTruthy();
    expect(within(billing).getByText(/1\/2 tasks/)).toBeTruthy();
    expect(within(billing).getByRole("button", { name: /^Pricing$/ })).toBeTruthy();
    expect(within(billing).getByText(/After SSO for teams/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Next items" })).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByRole("list", { name: "Later items" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/4 items · drag between columns/)).toBeTruthy();
  });

  it("moves a card to another column by drop and by keyboard through product.roadmap.upsert with the status untouched", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    const sso = screen.getByRole("listitem", { name: /SSO for teams/ });
    const nowColumn = screen.getByRole("region", { name: "Now" });
    const dataTransfer = { data: {} as Record<string, string>, setData(k: string, v: string) { this.data[k] = v; }, getData(k: string) { return this.data[k] ?? ""; }, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(sso, { dataTransfer });
    fireEvent.dragEnter(nowColumn, { dataTransfer });
    expect(nowColumn.getAttribute("data-drop-active")).toBe("true");
    await act(async () => {
      fireEvent.drop(nowColumn, { dataTransfer });
    });
    expect(fake.mutations).toHaveLength(1);
    expect(fake.mutations[0]!.path).toBe("product.roadmap.upsert");
    expect(fake.mutations[0]!.input).toMatchObject({ id: ITEM.sso, horizon: "now", position: 2, status: "planned", title: "SSO for teams" });
    expect(fake.refetches["product.roadmap.list"]).toBe(1);

    const reports = screen.getByRole("listitem", { name: /Quarterly reports/ });
    await act(async () => {
      fireEvent.keyDown(reports, { key: "ArrowLeft", altKey: true });
    });
    expect(fake.mutations[1]!.input).toMatchObject({ id: ITEM.reports, horizon: "next" });
    await act(async () => {
      fireEvent.keyDown(reports, { key: "ArrowRight", altKey: true });
    });
    expect(fake.mutations).toHaveLength(2); // already in Later: no-op
    await act(async () => {
      fireEvent.drop(screen.getByRole("region", { name: "Later" }), { dataTransfer: { getData: () => ITEM.reports } });
    });
    expect(fake.mutations).toHaveLength(2); // dropping on its own column is a no-op
  });

  it("opens the edit dialog from a card, links spec blocks and saves through upsert", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    fireEvent.keyDown(screen.getByRole("listitem", { name: /Quarterly reports/ }), { key: "Enter" });
    const dialog = await screen.findByRole("dialog", { name: "Edit roadmap item" });
    expect((within(dialog).getByLabelText(/Title/) as HTMLInputElement).value).toBe("Quarterly reports");
    fireEvent.click(within(dialog).getByLabelText("North star"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(fake.mutations.at(-1)).toMatchObject({ path: "product.roadmap.upsert", input: { id: ITEM.reports, specBlockIds: [BLOCK.metrics], horizon: "later" } });
  });

  it("switches to the timeline sub-view with bars, a today line and unscheduled items", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    const { container } = renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" subView="timeline" />);
    expect(screen.getByRole("tab", { name: "Timeline" }).getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(3);
    expect(container.querySelector("[data-today-line]")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Unscheduled items" })).getByText(/Quarterly reports/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByRole("list", { name: "Now items" })).toBeTruthy();
  });

  it("navigates to a linked spec block and shows the empty, loading and error states", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(screen.getByRole("listitem", { name: /Usage-based billing/ })).getByRole("button", { name: /^Pricing$/ }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/product/specification?block=${BLOCK.pricing}`);

    const empty = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "department.list": [] } });
    renderScreen(empty, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("Nothing on the roadmap yet")).toBeTruthy();
    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "product.roadmap.list": new Error("roadmap down") } });
    renderScreen(failing, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("roadmap down")).toBeTruthy();
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });

  it("counts items per computed status for the summary strip", () => {
    const counts = statusCounts(roadmap.items, new Date("2026-10-07T12:00:00Z"));
    expect(counts.map((c) => [c.status.key, c.count])).toEqual([
      ["planned", 2],
      ["in_progress", 1],
      ["done", 1],
    ]);
  });
});
