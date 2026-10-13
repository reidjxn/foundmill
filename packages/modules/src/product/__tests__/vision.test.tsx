import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { VisionScreen } from "../VisionScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, BLOCK, dataResponses, emptyResponses } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }, { id: "t2", slug: "roadmap", title: "Roadmap", position: 2 }] }];

describe("VisionScreen", () => {
  it("renders the narrative sections, pinned blocks, the glance facts and Now items", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const narrative = screen.getByRole("article");
    expect(within(narrative).getByText(/Freelancers chase late invoices/)).toBeTruthy();
    expect(within(narrative).getByRole("heading", { name: "Customers" })).toBeTruthy();
    expect(within(narrative).queryByText(/Monthly plan/)).toBeNull(); // Pricing is not narrative
    const pinned = screen.getByRole("list", { name: "Pinned blocks" });
    expect(within(pinned).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Version 3 · published Oct 4, 2026 · 5 blocks · 2 pinned")).toBeTruthy();
    const now = screen.getByRole("list", { name: "Roadmap items in Now" });
    expect(within(now).getByText("Usage-based billing")).toBeTruthy();
    expect(within(now).getByText("In progress")).toBeTruthy();
    expect(within(now).getByText("Done")).toBeTruthy();
  });

  it("gives each outline row a 24 px target (WCAG 2.5.8; they were 19 px, stacked)", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    const { container } = renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const rows = Array.from(container.querySelectorAll("[data-outline-section]"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.className).toContain("min-h-target");
  });

  it("navigates to the block in the Specification tab from a pinned block", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(screen.getByRole("list", { name: "Pinned blocks" })).getAllByRole("button")[0]!);
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/product/specification?block=${BLOCK.customers}`);
  });

  it("never nests the author's link inside the block's button (the link opens the agent, the button the block)", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    const { container } = renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    for (const button of container.querySelectorAll("[data-pinned-block]")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.querySelector("a, button, [role=button], [tabindex]")).toBeNull();
    }
    // The author line (with its link when an agent wrote the block) sits beside the button, in the same row.
    const meta = container.querySelectorAll("[data-pinned-block-meta]");
    expect(meta).toHaveLength(2);
    expect(meta[0]!.closest("button")).toBeNull();
  });

  it("shows empty states when the spec and roadmap are empty, and a loading state before data", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "department.list": [] } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("No narrative yet")).toBeTruthy();
    expect(screen.getByText(/Nothing is in Now/)).toBeTruthy();
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
  });

  it("refetches the spec when a version is published", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    fake.emit({ type: "spec.version_published", payload: {} });
    expect(fake.refetches["product.spec.get"]).toBe(1);
  });
});
