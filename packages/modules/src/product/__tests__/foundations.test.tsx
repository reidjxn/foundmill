import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { RoadmapScreen } from "../RoadmapScreen";
import { SpecificationScreen } from "../SpecificationScreen";
import { VisionScreen } from "../VisionScreen";
import { FOUNDATIONS_INTERRUPTED, FOUNDATIONS_POLL_MS, FOUNDATIONS_STREAM_POLL_MS, foundationsBasis, foundationsItems, foundationsProgressLine, foundationsSteps, foundationsSummary } from "../foundations";
import type { FoundationsProgress, FoundationsResponse } from "../types";
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

  it("a failed read says so with Try again instead of vanishing; a person walled from Product sees nothing", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": new Error("tRPC: INTERNAL_SERVER_ERROR") } });
    const { unmount } = renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    expect(status.textContent).toContain("could not be loaded");
    fireEvent.click(within(status).getByRole("button", { name: "Try again" }));
    expect(fake.refetches["product.foundations.get"]).toBe(1);
    unmount();
    const walled = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": Object.assign(new Error("You do not have read access to product"), { data: { code: "FORBIDDEN" } }) } });
    renderScreen(walled, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(screen.queryByTestId("foundations-status")).toBeNull();
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

  it("polls while drafting and stops when the attempt is stale, which reads as failed with Try again", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": base } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(fake.intervals["product.foundations.get"]).toBe(FOUNDATIONS_POLL_MS);
    act(() => fake.setResponse("product.foundations.get", { ...base, stale: true }));
    expect(fake.intervals["product.foundations.get"]).toBeUndefined();
    const status = screen.getByTestId("foundations-status");
    expect(status.getAttribute("data-foundations-state")).toBe("failed");
    expect(within(status).getByText(FOUNDATIONS_INTERRUPTED)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(status).getByRole("button", { name: "Try again" }));
    });
    expect(fake.mutations).toEqual([{ path: "product.foundations.retry", input: {} }]);
  });

  it("Vision: agent-written spec text renders as plain text, never as an image, a link or an entity mention (M1)", () => {
    const ID = "4f5e6d7c-1111-4222-8333-444455556666";
    const hostile = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Why ![x](https://beacon.example/h.png)" }] },
        { type: "paragraph", content: [{ type: "text", text: `Pay [here](https://phish.example/login) and ask [[ent:${ID}|Ada]] <img src=x onerror=alert(1)> https://phish.example` }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "![b](https://beacon.example/b.png)", marks: [{ type: "bold" }] }] }] }] },
      ],
    };
    const spec = dataResponses["product.spec.get"] as { blocks: { section: string; content: unknown }[] };
    const blocks = spec.blocks.map((b) => (b.section === "Problem" ? { ...b, content: hostile } : b));
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.spec.get": { ...spec, blocks }, "product.foundations.get": ready, "department.list": [] } });
    const { container } = renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const narrative = container.querySelector("[data-vision-narrative]")!;
    // The only links are the app's own author references, outside the block text.
    expect(narrative.querySelectorAll("[data-plain-doc]").length).toBeGreaterThan(0);
    expect(narrative.querySelectorAll("img, [data-plain-doc] a, [data-plain-doc] [data-entity-id], [data-plain-doc] [data-entity]")).toHaveLength(0);
    expect(narrative.textContent).toContain("Why ![x](https://beacon.example/h.png)");
    expect(narrative.textContent).toContain(`[[ent:${ID}|Ada]] <img src=x onerror=alert(1)>`);
    expect(within(narrative as HTMLElement).getByRole("heading", { name: "Why ![x](https://beacon.example/h.png)" })).toBeTruthy();
    expect(narrative.querySelectorAll("li strong")).toHaveLength(1);
  });

  it("summarises what was written", () => {
    expect(foundationsSummary(ready)).toBe("5 specification sections · 6 roadmap items, 2 in Now");
    expect(foundationsSummary({ summary: { sectionsWritten: 1, roadmap: { now: 1 }, importedIssues: 3 } })).toBe("1 specification section · 1 roadmap item, 1 in Now · 3 imported issues");
    expect(foundationsSummary({ summary: {} })).toBeNull();
  });
});

/* ---------- The document writing itself (audit P3) ---------- */

const pdoc = (title: string, text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] }, { type: "paragraph", content: [{ type: "text", text }] }] });
const SECTIONS = ["Problem", "Customers", "Value proposition", "Features", "Pricing"];
function progress(done: number, roadmap: { written: number; done?: boolean } = { written: 0 }): FoundationsProgress {
  const planned = [
    { title: "Guided first run", horizon: "now" as const },
    { title: "The core workflow", horizon: "now" as const },
    { title: "Pricing experiment", horizon: "later" as const },
  ];
  return {
    stage: done < SECTIONS.length ? "specification" : roadmap.done ? "finishing" : "roadmap",
    author: { agentId: "a0000000-0000-4000-8000-000000000001", name: "Mira", role: "Product lead" },
    sections: SECTIONS.map((section, i) => ({ section, title: i < done ? `About ${section.toLowerCase()}` : null, thesis: `Why ${section.toLowerCase()} matters.`, done: i < done, content: i < done ? pdoc(`About ${section.toLowerCase()}`, `Drafted text for ${section}.`) : null })),
    sectionsDone: done,
    sectionsTotal: SECTIONS.length,
    roadmap: planned.map((r, i) => ({ ...r, written: i < roadmap.written })),
    roadmapWritten: roadmap.written,
    roadmapDone: roadmap.done ?? false,
  };
}
const drafting = (p: FoundationsProgress | null, vision = ready.vision): FoundationsResponse => ({ ...base, vision, progress: p });

describe("foundations while they are drafting (audit P3)", () => {
  it("Vision: the vision shows as soon as it is written; the panel says who writes what and how far it is", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(progress(0)), "department.list": [] } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    expect(status.getAttribute("data-foundations-state")).toBe("drafting");
    expect(status.getAttribute("data-foundations-stage")).toBe("specification");
    expect(within(status).getByRole("status").textContent).toBe("Mira, Product lead, is writing the specification.");
    expect(within(status).getByRole("link", { name: "Mira" })).toBeTruthy();
    expect(within(status).getByText("0 of 5 sections · 0 of 3 roadmap items")).toBeTruthy();
    // The whole vision is on the tab already, while the sections are being written.
    expect(within(screen.getByTestId("vision-record")).getByText(ready.vision!.statement)).toBeTruthy();
    const list = within(status).getByRole("list", { name: "Specification sections" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).getByText("Why problem matters.")).toBeTruthy();

    // Sections appear as they are stored, and the narrative reads them while its blocks are still empty.
    act(() => fake.setResponse("product.foundations.get", drafting(progress(2))));
    expect(within(status).getByText("2 of 5 sections · 0 of 3 roadmap items")).toBeTruthy();
    expect(status.querySelectorAll('[data-done="true"]')).toHaveLength(2);
    expect(within(list).getByText("About problem")).toBeTruthy();
  });

  it("Vision: a narrative block still empty reads the drafted section, marked Drafting", () => {
    const spec = dataResponses["product.spec.get"] as { blocks: { section: string; content: unknown }[] };
    const empty = { ...spec, blocks: spec.blocks.map((b) => (b.section === "Problem" ? { ...b, content: { type: "doc", content: [] } } : b)) };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.spec.get": empty, "product.foundations.get": drafting(progress(1)), "department.list": [] } });
    const { container } = renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const narrative = container.querySelector("[data-vision-narrative]")!;
    const block = narrative.querySelector('[data-drafting="true"]')!;
    expect(block).toBeTruthy();
    expect(block.textContent).toContain("Drafted text for Problem.");
    expect(within(block as HTMLElement).getByText("Drafting")).toBeTruthy();
  });

  it("Specification: each written section's text appears under its title; Roadmap: the items as they arrive", () => {
    const spec = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(progress(3)) } });
    renderScreen(spec, <SpecificationScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    expect(within(status).getByText("Drafted text for Value proposition.")).toBeTruthy();
    expect(within(status).queryByText("Drafted text for Features.")).toBeNull();
    // The vision statement is the Vision tab's and Home's, not the Specification tab's.
    expect(status.querySelector("[data-vision-statement]")).toBeNull();
  });

  it("Roadmap: written items first, planned titles until they are written; the line counts them", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(progress(5, { written: 2 })) } });
    renderScreen(fake, <RoadmapScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    expect(status.getAttribute("data-foundations-stage")).toBe("roadmap");
    expect(within(status).getByRole("status").textContent).toBe("Mira, Product lead, is writing the roadmap.");
    const items = within(status).getByRole("list", { name: "Roadmap items" });
    expect(items.querySelectorAll('[data-roadmap-draft="written"]')).toHaveLength(2);
    expect(items.querySelectorAll('[data-roadmap-draft="planned"]')).toHaveLength(1);
    expect(within(items).getByText("Pricing experiment")).toBeTruthy();
    expect(within(items).getAllByText("Now")).toHaveLength(2);
    expect(within(status).getByText("5 of 5 sections · 2 of 3 roadmap items")).toBeTruthy();
  });

  it("before anything is written it is the plain drafting status; once ready the panel goes", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(null, null), "department.list": [] } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    expect(within(screen.getByTestId("foundations-status")).getByText("Drafting your vision, specification and roadmap…")).toBeTruthy();
    act(() => fake.setResponse("product.foundations.get", drafting(progress(1))));
    expect(screen.getByTestId("foundations-status").getAttribute("data-foundations-stage")).toBe("specification");
    act(() => fake.setResponse("product.foundations.get", ready));
    expect(screen.queryByTestId("foundations-status")).toBeNull();
    expect(screen.getByTestId("vision-record")).toBeTruthy();
  });

  it("the document writing itself: the Product lead's live portrait, the step rail and one segment per part", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(progress(2)), "department.list": [] } });
    renderScreen(fake, <VisionScreen businessId={BID} departmentId="d1" />);
    const status = screen.getByTestId("foundations-status");
    const steps = within(status).getAllByTestId("live-run-step");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "current", "pending", "pending"]);
    expect(steps[1]!.textContent).toContain("2 of 5 written");
    // Five sections and three roadmap items: two written, one being written, the rest to come.
    expect(within(status).getByTestId("live-run-bar").getAttribute("aria-label")).toBe("2 of 8 parts landed, 1 drafting, 5 queued");
    // The section being written streams its thesis on the log line, in the writer's name.
    expect(within(status).getByTestId("live-run-log").textContent).toContain("Mira");
    expect(foundationsSteps({ ...progress(5, { written: 3, done: true }), stage: "finishing" }).map((s) => s.state)).toEqual(["done", "done", "done", "current"]);
    expect(foundationsItems({ ...progress(5, { written: 1 }), stage: "roadmap" }).map((i) => i.state)).toEqual(["landed", "landed", "landed", "landed", "landed", "landed", "drafting", "queued"]);
  });

  it("polls every second without a stream connection, and only as a safety net with one", () => {
    const off = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(progress(1)) }, streamOpen: false });
    const a = renderScreen(off, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(off.intervals["product.foundations.get"]).toBe(FOUNDATIONS_POLL_MS);
    expect(FOUNDATIONS_POLL_MS).toBe(1_000);
    a.unmount();
    const on = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.foundations.get": drafting(progress(1)) }, streamOpen: true });
    renderScreen(on, <RoadmapScreen businessId={BID} departmentId="d1" />);
    expect(on.intervals["product.foundations.get"]).toBe(FOUNDATIONS_STREAM_POLL_MS);
  });

  it("the progress line", () => {
    expect(foundationsProgressLine(progress(4))).toBe("4 of 5 sections · 0 of 3 roadmap items");
    expect(foundationsProgressLine(progress(5, { written: 7, done: true }))).toBe("5 of 5 sections · 7 roadmap items");
    expect(foundationsProgressLine({ ...progress(1), sectionsTotal: 1, sectionsDone: 1, roadmap: [] })).toBe("1 of 1 section");
  });
});

