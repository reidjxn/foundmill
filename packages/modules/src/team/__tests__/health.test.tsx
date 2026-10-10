import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HealthScreen, groupByHealth, healthDetails, healthReason } from "../HealthScreen";
import { STATUS_DESCRIPTION, agentRoleLine } from "../shared";
import { AGENT_JUNO, AGENT_MARA, BID, DEPT_TEAM, agents, dataResponses, emptyResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("health groups", () => {
  it("groups the team by status, the ones that need the founder first, and reads the health signals", () => {
    const groups = groupByHealth(agents);
    expect(groups.map((g) => [g.word, g.agents.map((a) => a.name)])).toEqual([
      ["Down", ["Mara"]],
      ["Degraded", ["Pike"]],
      ["Idle", ["Linker"]],
      ["Healthy", ["Juno", "Orla"]],
    ]);
    expect(healthDetails(agents.find((a) => a.id === AGENT_MARA)!)).toEqual({ lastHeartbeatAt: "2026-10-06T16:00:00.000Z", errorRate: 0.6, loopDetected: false, expectedReturnAt: "2026-10-07T14:00:00.000Z", reason: "SendGrid credential expired" });
  });
});

describe("card lines", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("says why an agent is in its group without repeating the group or the card's figures", () => {
    expect(healthReason("healthy", { errorRate: 0.01, lastHeartbeatAt: "2026-10-07T11:59:00Z" }, now)).toBe("");
    expect(healthReason("degraded", { errorRate: 0.14 }, now)).toMatch(/^Error rate 14(\.0)? ?% over 24 h$/);
    expect(healthReason("degraded", { errorRate: 0.14, reason: "Error rate 14 % over the last day" }, now)).toBe("Error rate 14 % over the last day");
    expect(healthReason("injured", { expectedReturnAt: "2026-10-07T14:00:00Z", reason: "SendGrid credential expired" }, now)).toBe("Expected back in 2 hr · SendGrid credential expired");
    expect(healthReason("failing", { loopDetected: true, reason: "Loop detected on the last session" }, now)).toBe("Loop detected on the last session");
  });

  it("drops a role that only restates the agent's name", () => {
    expect(agentRoleLine({ name: "Quality Specialist", role: "Quality specialist" })).toBeNull();
    expect(agentRoleLine({ name: "Juno", role: "Frontend engineer" })).toBe("Frontend engineer");
    expect(agentRoleLine({ name: "Ivy", agentType: "qa_engineer" })).toBe("QA engineer");
  });
});

describe("HealthScreen", () => {
  it("renders the counts strip and one panel per health group with Down showing the expected return", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <HealthScreen {...props} />);
    expect(await screen.findByRole("list", { name: "Agents by health" })).toBeTruthy();
    expect(screen.getByTestId("health-summary").textContent).toBe("2 agents need you");
    expect(document.querySelectorAll("[data-health-group]")).toHaveLength(4);
    const down = document.querySelector("[data-health-group='injured']") as HTMLElement;
    expect(within(down).getByRole("heading", { name: "Down" })).toBeTruthy();
    expect(within(down).getByText("1 agent")).toBeTruthy();
    expect(within(down).getByRole("link", { name: "Mara" })).toBeTruthy();
    expect(within(down).getByText(/Expected back in 2 hr · SendGrid credential expired/)).toBeTruthy();
    expect(within(down).queryByText("Injured")).toBeNull();
    const degraded = document.querySelector("[data-health-group='degraded']") as HTMLElement;
    expect(within(degraded).getByText(/Error rate 14/)).toBeTruthy();
    const healthy = document.querySelector("[data-health-group='healthy']") as HTMLElement;
    expect(within(healthy).getByRole("link", { name: "Add a bundle picker to the product page" })).toBeTruthy();
    // The group says what healthy means once, in its header; the cards do not repeat it.
    expect(within(healthy).getAllByText(STATUS_DESCRIPTION.healthy)).toHaveLength(1);
    fireEvent.click(within(healthy).getByRole("button", { name: "Open Juno's profile" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/agents/${AGENT_JUNO}/overview`);
  });

  it("moves an agent between groups the moment agent.health_changed arrives (AC-11.9.1)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <HealthScreen {...props} />);
    await screen.findByRole("list", { name: "Agents by health" });
    expect(document.querySelector("[data-health-group='failing']")).toBeNull();
    act(() => {
      fake.emit({ type: "agent.health_changed", occurredAt: "2026-10-07T12:00:01Z", payload: { agentId: AGENT_JUNO, from: "healthy", to: "failing", reason: "Loop detected on the last session", signals: { loopDetected: true } } });
    });
    const failing = document.querySelector("[data-health-group='failing']") as HTMLElement;
    expect(within(failing).getByRole("link", { name: "Juno" })).toBeTruthy();
    expect(within(failing).getByText(/Loop detected on the last session/)).toBeTruthy();
    expect(screen.getByTestId("health-summary").textContent).toBe("3 agents need you");
    await waitFor(() => expect(fake.refetches["team.agents.list"]).toBe(1));
  });

  it("shows the empty state, loading and an error with retry", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <HealthScreen {...props} />);
    expect(await screen.findByText("No agents to watch")).toBeTruthy();
    expect(screen.getByTestId("health-summary").textContent).toBe("No agents yet");
    fireEvent.click(screen.getByRole("button", { name: "Go to Recruitment" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/team/recruitment`);
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: { "department.list": [] } });
    const r2 = renderScreen(loading, <HealthScreen {...props} />);
    expect(screen.queryByRole("list", { name: "Agents by health" })).toBeNull();
    expect(document.querySelectorAll("[data-health-group]")).toHaveLength(0);
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.agents.list": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <HealthScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.agents.list"]).toBe(1);
  });
});
