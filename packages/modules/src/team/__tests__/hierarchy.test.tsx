import "./setup";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FOUNDER_NODE_ID, HierarchyScreen, hierarchyKind, toHierarchyNodes } from "../HierarchyScreen";
import { readMe } from "../shared";
import { AGENT_COS, AGENT_JUNO, AGENT_LINK, AGENT_MARA, AGENT_PIKE, BID, DEPT_TEAM, agents, dataResponses, departments, emptyResponses, humans, me } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("hierarchy nodes", () => {
  it("wires founder → Chief of Staff → leads → workers, falling back to the department lead or the Chief of Staff", () => {
    const nodes = toHierarchyNodes(agents, { departments, founderName: "Reid" });
    const parent = Object.fromEntries(nodes.map((n) => [n.id, n.parentId]));
    expect(parent[FOUNDER_NODE_ID]).toBeNull();
    expect(parent[AGENT_COS]).toBe(FOUNDER_NODE_ID);
    expect(parent[AGENT_PIKE]).toBe(AGENT_COS); // explicit line manager
    expect(parent[AGENT_JUNO]).toBe(AGENT_PIKE); // explicit line manager
    expect(parent[AGENT_MARA]).toBe(AGENT_COS); // Distribution has no lead → Chief of Staff
    expect(parent[AGENT_LINK]).toBe(AGENT_COS); // utility
    expect(nodes.map((n) => n.kind)).toEqual(["founder", "assistant", "worker", "lead", "worker", "utility"]);
    expect(hierarchyKind({ id: "x", name: "x", status: "idle", modelKey: "haiku", agentType: "finance_lead" })).toBe("lead");
    const withStaff = toHierarchyNodes(agents, { departments, founderName: "Reid", staff: humans, me: readMe(me, BID) });
    expect(withStaff.filter((n) => n.kind === "human").map((n) => [n.name, n.parentId])).toEqual([
      ["ada@northwind.example", FOUNDER_NODE_ID],
      ["Ben Okafor", FOUNDER_NODE_ID],
    ]);
    // A worker whose department lead is missing and no Chief of Staff exists reports to the founder.
    const lone = toHierarchyNodes([agents.find((a) => a.id === AGENT_MARA)!], { founderName: "Reid" });
    expect(lone.find((n) => n.id === AGENT_MARA)!.parentId).toBe(FOUNDER_NODE_ID);
  });
});

describe("HierarchyScreen", () => {
  it("renders the org chart with the founder on top and opens a detail panel on selection", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <HierarchyScreen {...props} />);
    const tree = await screen.findByRole("tree", { name: "Team hierarchy" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items).toHaveLength(agents.length + 1);
    expect(items[0]!.getAttribute("aria-label")).toBe("Reid, Founder, Founder");
    expect(within(tree).getByRole("treeitem", { name: /Orla, Chief of Staff, Team, Chief of Staff/ })).toBeTruthy();
    expect(screen.getByTestId("hierarchy-summary").textContent).toBe("5 agents · 1 leads · 2 workers");
    await user.click(within(tree).getByRole("treeitem", { name: /Pike/ }));
    const detail = await screen.findByTestId("hierarchy-detail");
    expect(within(detail).getByRole("link", { name: "Pike" })).toBeTruthy();
    expect(within(detail).getByText("Degraded")).toBeTruthy();
    expect(within(detail).getByText("Orla")).toBeTruthy(); // reports to
    expect(within(detail).getByText("1")).toBeTruthy(); // direct reports: Juno
    expect(within(detail).getByText("Estimate")).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "Open profile" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/agents/${AGENT_PIKE}/overview`);
  });

  it("walks the tree with the arrow keys and toggles staff into the chart", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <HierarchyScreen {...props} />);
    const tree = await screen.findByRole("tree", { name: "Team hierarchy" });
    const founder = within(tree).getAllByRole("treeitem")[0]!;
    founder.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Orla/);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^(Pike|Mara|Linker)/);
    await user.click(screen.getByRole("switch", { name: "Show staff" }));
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(agents.length + 1 + 2);
    expect(within(tree).getByRole("treeitem", { name: /Ben Okafor, Advisor, Staff/ })).toBeTruthy();
  });

  it("shows the empty state, loading and an error with retry", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <HierarchyScreen {...props} />);
    expect(await screen.findByText("Just you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Recruitment" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/team/recruitment`);
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: { "founder.profile.get": me } });
    const r2 = renderScreen(loading, <HierarchyScreen {...props} />);
    expect(screen.queryByRole("tree")).toBeNull();
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.agents.list": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <HierarchyScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.agents.list"]).toBe(1);
  });
});
