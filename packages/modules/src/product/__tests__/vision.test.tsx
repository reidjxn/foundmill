import "./setup";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { VisionScreen } from "../VisionScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { openExplainer } from "../../explainer.testing";
import { BID, BLOCK, dataResponses, emptyResponses } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }, { id: "t2", slug: "roadmap", title: "Roadmap", position: 2 }] }];

// The fixture's "Usage-based billing" item ends Oct 20, 2026: pin the clock inside its window so the computed status
// pill reads "In progress" whatever day the suite runs (it read "At risk" from Oct 21 on).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("VisionScreen", () => {
  it("renders the narrative sections, pinned paragraphs, the specification summary line and Now items", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const narrative = screen.getByRole("article");
    expect(within(narrative).getByText(/Freelancers chase late invoices/)).toBeTruthy();
    expect(within(narrative).getByRole("heading", { name: "Customers" })).toBeTruthy();
    expect(within(narrative).queryByText(/Monthly plan/)).toBeNull(); // Pricing is not narrative
    const pinned = screen.getByRole("list", { name: "Pinned paragraphs" });
    expect(within(pinned).getAllByRole("listitem")).toHaveLength(2);
    // "Block" is "paragraph" in copy (UX plan §7.11, C13); the six-count strip is one summary line.
    expect(screen.getByText("Version 3 · published Oct 4, 2026 · 5 paragraphs · 2 pinned")).toBeTruthy();
    expect(screen.getByTestId("spec-summary").textContent).toBe("Specification: 5 sections · not signed off yet");
    expect(screen.queryByText("Agent-written")).toBeNull();
    expect(screen.queryByText(/\bblocks?\b/)).toBeNull();
    const now = screen.getByRole("list", { name: "Roadmap items in Now" });
    expect(within(now).getByText("Usage-based billing")).toBeTruthy();
    expect(within(now).getByText("In progress")).toBeTruthy();
    expect(within(now).getByText("Done")).toBeTruthy();
  });

  it("guidance on: the department's intro sits in the first panel's body and the summary's first word is defined (UX plan §7.10)", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />, {}, { guidance: "on" });
    const button = document.querySelector("[data-explainer='product/vision']") as HTMLElement;
    expect(button).toBeTruthy();
    // The button sits inside the panel's body (no shell here); the lines open in a popover, never a banner.
    expect(button.closest("[data-panel-body]")).toBeTruthy();
    expect(screen.queryByText("What this screen is for")).toBeNull();
    const explainer = openExplainer("product/vision");
    expect(within(explainer).getByText("What your business is building.")).toBeTruthy();
    expect(within(explainer).getByText("Read the vision; sign off the specification and roadmap when they look right.")).toBeTruthy();
    const summary = screen.getByTestId("spec-summary");
    expect(summary.textContent).toBe("Specification: 5 sections · not signed off yet");
    expect(within(summary).getByRole("button", { name: "Specification" }).className).toContain("term-link");
  });

  it("guidance off: no intro, the summary's words are plain", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(document.querySelector("[data-explainer]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Specification" })).toBeNull();
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
    fireEvent.click(within(screen.getByRole("list", { name: "Pinned paragraphs" })).getAllByRole("button")[0]!);
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
    // The empty narrative names where to act and offers it (DESIGN §8 Panel: an action slot).
    fireEvent.click(screen.getByRole("button", { name: "Open Specification" }));
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/d/product/specification`);
    expect(screen.getByText(/Nothing is in Now/)).toBeTruthy();
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
  });

  it("says when the specification was signed off", () => {
    const signed = { stage: "building", spec: { id: "s1", kind: "spec", round: 1, status: "approved", requestedAt: "2026-10-10T09:00:00Z", decidedAt: "2026-10-18T09:00:00Z", decidedBy: { kind: "user", id: "u1" }, notes: null, specVersion: 3 }, roadmap: null, readyToSell: null };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments, "product.signoff.get": signed } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByTestId("spec-summary").textContent).toBe("Specification: 5 sections · signed off Oct 18, 2026");
  });

  it("refetches the spec when a version is published", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "department.list": departments } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    fake.emit({ type: "spec.version_published", payload: {} });
    expect(fake.refetches["product.spec.get"]).toBe(1);
  });
});
