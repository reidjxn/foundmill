import "./setup";
import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { ResearchPlanPanel, researchPlanState, resetResearchEnsured } from "../research/ResearchPlanPanel";
import { ResearchScreen } from "../ResearchScreen";
import type { ResearchResponse } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { openExplainer } from "../../explainer.testing";
import { AGENT, BID, BLOCK, dataResponses } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }] }];
const uuid = (n: number) => `${"a".repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ready: ResearchResponse = {
  status: "ready",
  attempt: 1,
  icp: "Solo consultants in the EU billing 3 to 12 clients a month",
  error: null,
  summary: {
    assumptions: [
      { assumption: "Consultants lose a week a quarter chasing invoices.", fromSection: "Problem", whyItMatters: "Sizes the value.", testKind: "interview_plan" },
      { assumption: "The consultant decides alone.", fromSection: "Customers", whyItMatters: "Decides who the page addresses.", testKind: "survey" },
    ],
    firstStepTaskIds: [uuid(1), uuid(2), uuid(3)],
  },
  artifacts: [
    { id: uuid(11), kind: "interview_plan", title: "Discovery interviews with solo consultants", summary: "Six conversations.", bodyMd: "## Who\n6 consultants (Estimate).\n\n1. Walk me through your last invoice.", status: "draft", specBlockIds: [], taskId: null, createdByAgentId: AGENT.atlas, createdAt: "2026-10-05T08:00:00Z", updatedAt: "2026-10-05T08:00:00Z" },
    { id: uuid(12), kind: "smoke_test", title: "Smoke test: one page", summary: "One measured action.", bodyMd: "## Threshold\n5% (Estimate).", status: "ready", specBlockIds: [], taskId: null, createdByAgentId: AGENT.atlas, createdAt: "2026-10-05T08:00:00Z", updatedAt: "2026-10-05T08:00:00Z" },
  ],
  agent: { id: AGENT.atlas, name: "Noor" },
  startedAt: "2026-10-05T07:58:00Z",
  finishedAt: "2026-10-05T08:00:00Z",
  stale: false,
};

const pending: ResearchResponse = { ...ready, status: "pending", attempt: 0, artifacts: [], summary: {}, agent: null, startedAt: null, finishedAt: null };

afterEach(() => resetResearchEnsured());

describe("researchPlanState", () => {
  it("waits for the foundations, starts once they are ready, and reads a stale draft as failed", () => {
    expect(researchPlanState(undefined, "ready")).toBe("waiting");
    expect(researchPlanState(pending, "drafting")).toBe("waiting");
    expect(researchPlanState(pending, "ready")).toBe("pending");
    expect(researchPlanState({ ...pending, status: "drafting" }, "ready")).toBe("drafting");
    expect(researchPlanState({ ...pending, status: "drafting", stale: true }, "ready")).toBe("failed");
    expect(researchPlanState({ ...pending, status: "failed" }, "ready")).toBe("failed");
    expect(researchPlanState(ready, "ready")).toBe("ready");
    expect(researchPlanState({ ...ready, status: "none" }, "none")).toBe("none");
  });
});

describe("ResearchPlanPanel", () => {
  it("ready: the ICP in the title, the assumptions with their sections, artifact cards with their status, and the way to the tasks", () => {
    const fake = createFakeSource({ businessId: BID, responses: { "product.research.get": ready, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    renderScreen(fake, <ResearchPlanPanel businessId={BID} blocks={dataResponses["product.spec.get"].blocks} onOpenBlock={(id) => void fake.navigations.push(id)} />, { canWrite: () => true });
    const panel = screen.getByTestId("research-plan");
    expect(panel.getAttribute("data-research-state")).toBe("ready");
    expect(within(panel).getByText(/Testing the specification with Solo consultants/)).toBeTruthy();
    const assumptions = within(panel).getByRole("list", { name: "Riskiest assumptions" });
    expect(within(assumptions).getAllByRole("listitem")).toHaveLength(2);
    // A section chip opens the specification block of that section.
    fireEvent.click(within(assumptions).getByRole("button", { name: "Problem" }));
    expect(fake.navigations[0]).toBe(BLOCK.problem);
    const cards = within(panel).getByRole("list", { name: "Research artifacts" });
    expect(within(cards).getAllByRole("listitem")).toHaveLength(2);
    expect(within(cards).getByText("Interview plan")).toBeTruthy();
    expect(within(cards).getByText("Draft")).toBeTruthy();
    expect(within(cards).getByText("Ready")).toBeTruthy();
    expect(within(panel).getByText(/3 research tasks for the next rounds of work/)).toBeTruthy();
    // Ready plans ask the api for nothing.
    expect(fake.mutations).toHaveLength(0);
  });

  it("guidance on: the intro says what the plan is for, in the panel's body (UX plan §7.11)", () => {
    const fake = createFakeSource({ businessId: BID, responses: { "product.research.get": ready, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    renderScreen(fake, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => true }, { guidance: "on" });
    const panel = screen.getByTestId("research-plan");
    expect(panel.querySelector("[data-explainer='product/research']")).toBeTruthy();
    const explainer = openExplainer("product/research");
    expect(within(explainer).getByText("Who we will talk to and what we will ask, before building more.")).toBeTruthy();
    expect(within(explainer).getByText(/Nothing is sent to anyone without your approval/)).toBeTruthy();
  });

  it("guidance off: no intro", () => {
    const fake = createFakeSource({ businessId: BID, responses: { "product.research.get": ready, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    renderScreen(fake, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => true });
    expect(document.querySelector("[data-explainer]")).toBeNull();
  });

  it("reads an artifact in a dialog and marks it ready; a reader without write sees no such buttons", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { "product.research.get": ready, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    renderScreen(fake, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => true });
    fireEvent.click(screen.getAllByRole("button", { name: "Read" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discovery interviews with solo consultants")).toBeTruthy();
    expect(dialog.querySelector("[data-research-artifact-body]")?.textContent).toMatch(/Walk me through your last invoice/);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Mark ready" }));
    });
    expect(fake.mutations[0]).toEqual({ path: "product.research.artifacts.update", input: { artifactId: uuid(11), status: "ready" } });

    const viewer = createFakeSource({ businessId: BID, responses: { "product.research.get": ready, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    renderScreen(viewer, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => false });
    expect(screen.queryAllByRole("button", { name: /Mark ready|Mark shared/ }).filter((b) => b.closest("[data-testid=research-plan]") === screen.getAllByTestId("research-plan")[1])).toHaveLength(0);
  });

  it("asks the api to start the plan once the foundations are ready, once per business, and polls while it drafts", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { "product.research.get": pending, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    await act(async () => {
      renderScreen(fake, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => true });
    });
    expect(fake.mutations).toEqual([{ path: "product.research.ensure", input: {} }]);
    expect(screen.getByTestId("research-plan").getAttribute("data-research-state")).toBe("pending");
    expect(fake.intervals["product.research.get"]).toBe(2_000);
    // A second mount in the same session asks nothing more.
    renderScreen(fake, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => true });
    expect(fake.mutations).toHaveLength(1);
  });

  it("waits while the foundations draft, shows a failure with Try again, and the Research tab carries the panel first", async () => {
    const waiting = createFakeSource({ businessId: BID, responses: { "product.research.get": pending, "business.get": { foundationsStatus: "drafting" }, "department.list": departments } });
    renderScreen(waiting, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />);
    expect(screen.getByTestId("research-plan").getAttribute("data-research-state")).toBe("waiting");
    expect(screen.getByText(/Starts when the specification is drafted/)).toBeTruthy();
    expect(waiting.mutations).toHaveLength(0);

    const failed = createFakeSource({ businessId: BID, responses: { "product.research.get": { ...pending, status: "failed", attempt: 1, error: "The model service did not answer. Try again in a few minutes." }, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    const { unmount } = renderScreen(failed, <ResearchPlanPanel businessId={BID} blocks={[]} onOpenBlock={() => undefined} />, { canWrite: () => true });
    const panel = screen.getAllByTestId("research-plan")[1]!;
    expect(panel.getAttribute("data-research-state")).toBe("failed");
    expect(within(panel).getByText(/model service did not answer/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(panel).getByTestId("research-retry"));
    });
    expect(failed.mutations).toEqual([{ path: "product.research.retry", input: {} }]);
    unmount();

    const tab = createFakeSource({ businessId: BID, responses: { ...dataResponses, "product.research.get": ready, "business.get": { foundationsStatus: "ready" }, "department.list": departments } });
    renderScreen(tab, <ResearchScreen businessId={BID} departmentId="d1" />);
    const screenEl = document.querySelector("[data-module-screen='product/research']")!;
    expect(screenEl.querySelector("[data-testid=research-plan]")?.getAttribute("data-research-state")).toBe("ready");
    expect(within(screenEl as HTMLElement).getByRole("list", { name: "Research notes" })).toBeTruthy();
  });
});
