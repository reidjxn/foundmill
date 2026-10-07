/** AC-11.2.3: department cards reflect live agent status changes within 2 s of `agent.health_changed` / task events. */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WidgetDataProvider } from "../data";
import { getWidget, parseWidgetSettings } from "../registry";
import { createFakeSource } from "../testing";
import "../widgets";
import { departmentHealth, headlineMetric, metricKeyFor, nowLines, toSquad } from "../widgets/department-card";
import { AGENT, BID, DEPT, dataResponses, departments, ribbon, tasks } from "./fixtures";
import { lastDays, dayKey } from "../shared/time";

const def = getWidget("department_card")!;

function mountCard(settings: Record<string, unknown>, fake = createFakeSource({ businessId: BID, responses: dataResponses() })) {
  const Component = def.Component;
  const utils = render(
    <WidgetDataProvider source={fake.source}>
      <Component businessId={BID} instanceId="department_card-1" settings={parseWidgetSettings(def, settings)} />
    </WidgetDataProvider>,
  );
  return { fake, ...utils };
}

describe("department card widget", () => {
  it("resolves the department by slot, module or id", () => {
    const { unmount } = mountCard({ slot: 1 });
    expect(screen.getByRole("heading", { name: "Distribution" })).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    unmount();
    const { unmount: u2 } = mountCard({ module: "finance" });
    expect(screen.getByRole("heading", { name: "Finance" })).toBeTruthy();
    expect(screen.getByText("Runway")).toBeTruthy();
    expect(screen.getByText("Estimate")).toBeTruthy();
    u2();
    mountCard({ departmentId: DEPT.development, slot: 2 });
    expect(screen.getByRole("heading", { name: "Development" })).toBeTruthy();
  });

  it("shows the squad, Now lines with the agent linked, the module metric and Next up", () => {
    const { container } = mountCard({ slot: 0 });
    expect(container.querySelectorAll("[data-squad-member]").length).toBe(3);
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Beacon" })).toBeTruthy();
    expect(screen.getByText(/is working on Invoice lines/)).toBeTruthy();
    expect(screen.getByText("Tasks merged this week")).toBeTruthy();
    expect(screen.getByText(/Seat invitations/)).toBeTruthy();
  });

  it("updates an agent's status ring the moment agent.health_changed arrives, then refetches (AC-11.2.3)", () => {
    const { fake } = mountCard({ slot: 0 });
    expect(screen.getByRole("button", { name: /^Beacon, Backend, Healthy/ })).toBeTruthy();
    const started = performance.now();
    act(() => {
      fake.emit({ id: "evt-1", businessId: BID, type: "agent.health_changed", occurredAt: new Date().toISOString(), actor: { kind: "system" }, entityIds: [], payload: { agentId: AGENT.beacon, from: "healthy", to: "failing", reason: "loop detected", signals: {} }, narrated: false });
    });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(screen.getByRole("button", { name: /^Beacon, Backend, Failing/ })).toBeTruthy();
    expect(screen.getByText("Failing")).toBeTruthy();
    expect(fake.refetches["department.list"]).toBe(1);
  });

  it("ignores health events for agents outside the squad and refetches tasks on task events", () => {
    const { fake } = mountCard({ slot: 0 });
    act(() => {
      fake.emit({ type: "agent.health_changed", payload: { agentId: AGENT.ember, from: "healthy", to: "failing" } });
    });
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(fake.refetches["department.list"]).toBeUndefined();
    act(() => {
      fake.emit({ type: "task.completed", payload: { taskId: "t", kind: "code", title: "Invoice lines", assigneeAgentId: AGENT.beacon } });
    });
    expect(fake.refetches["dev.tasks.list"]).toBe(1);
    expect(fake.refetches["journey.ribbon"]).toBe(1);
  });

  it("reads the relay's raw { type, json } frame and the stream's { ch, e } frame", () => {
    const { fake } = mountCard({ slot: 0 });
    act(() => {
      fake.emit({ ch: `ev:${BID}`, e: { type: "agent.health_changed", payload: { agentId: AGENT.atlas, to: "degraded" } } });
    });
    expect(screen.getByRole("button", { name: /^Atlas, Engineering lead, Degraded/ })).toBeTruthy();
    act(() => {
      fake.emit({ id: "1-0", type: "agent.health_changed", json: JSON.stringify({ type: "agent.health_changed", payload: { agentId: AGENT.cove, to: "failing" } }) });
    });
    expect(screen.getByRole("button", { name: /^Cove, Frontend, Failing/ })).toBeTruthy();
  });

  it("opens the agent profile and the department tab", () => {
    const { fake } = mountCard({ slot: 0 });
    screen.getByRole("button", { name: /^Beacon, Backend/ }).click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/agents/${AGENT.beacon}/overview`);
    screen.getByRole("button", { name: "Open" }).click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/d/development/training-ground`);
  });
});

describe("department card logic", () => {
  const dev = departments[0]!;
  it("picks the module's default metric and lets settings override it", () => {
    expect(metricKeyFor({ metric: "auto" }, dev)).toBe("tasks_done");
    expect(metricKeyFor({ metric: "auto" }, departments[1]!)).toBe("blended_cpa");
    expect(metricKeyFor({ metric: "auto" }, departments[2]!)).toBe("runway");
    expect(metricKeyFor({ metric: "squad_health" }, dev)).toBe("squad_health");
    expect(metricKeyFor({ metric: "auto" }, { moduleKeys: ["custom"] })).toBe("tasks_done");
  });
  it("derives health from the squad and blocked tasks", () => {
    const squad = toSquad(dev, {}, tasks.items);
    expect(departmentHealth(squad, [])).toEqual({ health: "good", word: "Healthy" });
    expect(departmentHealth(squad, tasks.items)).toEqual({ health: "warn", word: "Waiting" });
    expect(departmentHealth(toSquad(dev, { [AGENT.cove]: "injured" }, []), [])).toEqual({ health: "bad", word: "Failing" });
    expect(departmentHealth(toSquad(dev, { [AGENT.cove]: "degraded" }, []), [])).toEqual({ health: "warn", word: "Degraded" });
  });
  it("writes Now lines with entity markup and caps them at three", () => {
    const squad = toSquad(dev, {}, tasks.items);
    const lines = nowLines(tasks.items, squad);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(`[[ent:${AGENT.beacon}|Beacon]] is working on Invoice lines`);
    expect(lines[1]).toContain("is in review on Rate-limit");
    expect(lines[2]).toContain("is blocked on Draft the October newsletter");
  });
  it("labels estimates and computes each module metric", () => {
    const today = dayKey();
    const base = { rows: ribbon(14).rows, days: lastDays(14), squad: toSquad(dev, {}, []), currency: "EUR", today };
    expect(headlineMetric({ ...base, key: "tasks_done" }).series.length).toBe(14);
    expect(headlineMetric({ ...base, key: "blended_cpa", channels: dataResponses()["distribution.channels.list"] as never })).toMatchObject({ value: "€131.82", provenance: "estimate" });
    expect(headlineMetric({ ...base, key: "runway", finance: dataResponses()["finance.overview"] as never })).toMatchObject({ value: "8.7 mo", provenance: "estimate" });
    expect(headlineMetric({ ...base, key: "squad_health" }).value).toBe("67%");
    expect(headlineMetric({ ...base, key: "roadmap_on_track", roadmap: dataResponses()["product.roadmap.list"] as never }).value).toBe("2/3");
    expect(headlineMetric({ ...base, key: "next_filing", compliance: dataResponses()["legal.compliance.list"] as never }).value).toBe("19");
  });
});
