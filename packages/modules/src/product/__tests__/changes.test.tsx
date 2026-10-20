import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { ChangesScreen } from "../ChangesScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, HUNK, PROPOSAL, dataResponses, emptyResponses, proposalAnnual, proposals } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }] }];
const responses = { ...dataResponses, "department.list": departments };

describe("ChangesScreen", () => {
  it("lists proposals in the Open view and shows the selected one with rationale, evidence, impact estimates and hunks", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ChangesScreen businessId={BID} departmentId="d1" />);
    const table = screen.getByRole("grid", { name: "Change proposals" });
    expect(within(table).getByText("Offer an annual plan")).toBeTruthy();
    expect(within(table).queryByText("Drop SSO from Next")).toBeNull(); // Open view filters rejected
    expect(fake.queried.get("product.proposals.get")).toEqual({ proposalId: PROPOSAL.annual });
    expect(screen.getByRole("heading", { name: "Offer an annual plan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Atlas/ })).toBeTruthy(); // entity markup in the rationale
    const evidence = screen.getByRole("region", { name: "Evidence" });
    expect(within(evidence).getByText(/Customer interview 7/)).toBeTruthy();
    expect(within(evidence).getByText("Invoicely")).toBeTruthy();
    const impact = screen.getByRole("region", { name: "Impact" });
    expect(within(impact).getAllByText("Estimate").length).toBeGreaterThan(0);
    expect(within(impact).getByText("+4 days")).toBeTruthy();
    expect(within(impact).getByText("2 tasks")).toBeTruthy();
    expect(screen.getByText("1 of 3 changes decided")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Change 1: Pricing/ })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /^Change 1:/ })).getByText("Pinned")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /^Change 3:/ })).getByText("Accepted")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /^Change 3:/ })).queryByRole("button", { name: "Accept change" })).toBeNull();
  });

  it("accepts and rejects a hunk through product.proposals.decideHunk, and saves staged line edits as edited content", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ChangesScreen businessId={BID} departmentId="d1" />);
    const hunk1 = screen.getByRole("region", { name: /^Change 1:/ });
    await act(async () => {
      fireEvent.click(within(hunk1).getByRole("button", { name: "Accept change" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "product.proposals.decideHunk", input: { hunkId: HUNK.pricing1, decision: "accepted" } });
    expect(fake.refetches["product.proposals.get"]).toBe(1);
    const hunk2 = screen.getByRole("region", { name: /^Change 2:/ });
    await act(async () => {
      fireEvent.click(within(hunk2).getByRole("button", { name: "Reject change" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "product.proposals.decideHunk", input: { hunkId: HUNK.features, decision: "rejected" } });

    // Stage a line-level decision inside the diff, then save the merged result as an edit.
    const save = within(hunk2).getByRole("button", { name: "Save as edited" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(hunk2).getByRole("button", { name: "Accept" })); // DiffView's own line-hunk control
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    const last = fake.mutations.at(-1)!;
    expect(last.path).toBe("product.proposals.decideHunk");
    expect(last.input).toMatchObject({ hunkId: HUNK.features, decision: "edited" });
    const edited = last.input.edited as { type: string; content: { type: string }[] };
    expect(edited.type).toBe("doc");
    expect(JSON.stringify(edited)).toContain("yearly statement");
  });

  it("a pending hunk whose block changed since it was drafted is decided against the block as it reads now", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ChangesScreen businessId={BID} departmentId="d1" />);
    // The Features block gained an acceptance line after the proposal; the Pricing hunk's "ours" is the live block.
    const features = screen.getByRole("region", { name: /^Change 2:/ });
    expect(within(features).getByText(/This paragraph changed after the proposal was drafted/)).toBeTruthy();
    expect(within(features).getAllByText(/Acceptance: a reminder is sent 3 days after due date/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("region", { name: /^Change 1:/ })).queryByText(/This paragraph changed after/)).toBeNull();
  });

  it("accepts all or rejects the whole proposal from the header and the right-click verbs", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ChangesScreen businessId={BID} departmentId="d1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "product.proposals.acceptAll", input: { proposalId: PROPOSAL.annual } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "product.proposals.reject", input: { proposalId: PROPOSAL.annual } });
    expect(fake.refetches["product.proposals.list"]).toBe(2);
  });

  it("shows the result and the published version for a settled proposal, with no hunk controls", () => {
    const settled = { ...proposalAnnual, status: "partially_accepted" as const, resolvedAt: "2026-10-04T09:59:30Z", hunks: proposalAnnual.hunks.map((h, i) => ({ ...h, decision: i === 1 ? ("rejected" as const) : ("accepted" as const) })) };
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "product.proposals.list": { items: [{ ...proposals[0]!, status: "partially_accepted" }, proposals[1]!], nextCursor: null }, "product.proposals.get": settled } });
    renderScreen(fake, <ChangesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("2 accepted · 0 edited · 1 rejected.")).toBeTruthy();
    expect(screen.getByText("Version 3")).toBeTruthy();
    expect(screen.getByText(/Accepted annual plan proposal/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save as edited" })).toBeNull();
  });

  it("navigates to the spec block from a hunk title and handles empty, loading and error states", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <ChangesScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(screen.getByRole("region", { name: /^Change 1:/ })).getByRole("button", { name: /Pricing · Pricing/ }));
    expect(fake.navigations[0]).toMatch(/\/d\/product\/specification\?block=/);

    const empty = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "department.list": [] } });
    renderScreen(empty, <ChangesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("No proposals yet")).toBeTruthy();
    expect(screen.getByText(/Pick a proposal/)).toBeTruthy();
    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "product.proposals.list": new Error("list down") } });
    renderScreen(failing, <ChangesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("list down")).toBeTruthy();
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <ChangesScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
