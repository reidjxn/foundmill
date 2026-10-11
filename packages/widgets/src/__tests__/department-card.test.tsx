/** AC-11.2.3: department cards reflect live agent status changes within 2 s of `agent.health_changed` / task events. */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WidgetDataProvider } from "../data";
import { getWidget, parseWidgetSettings } from "../registry";
import { createFakeSource } from "../testing";
import "../widgets";
import { DATE_FORMATS, formatDate } from "@foundmill/dugout";
import { departmentHealth, headlineMetric, metricKeyFor, nowLines, quietLine, toSquad } from "../widgets/department-card";
import { addDays } from "../shared/time";
import type { InboxItemRow } from "../shared/types";
import { AGENT, BID, DEPT, TODAY, dataResponses, departments, inbox, ribbon, tasks } from "./fixtures";
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

  it("shows the team, Now lines with the agent linked, the module metric and Next up", () => {
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

  it("ignores health events for agents outside the team and refetches tasks on task events", () => {
    const { fake } = mountCard({ slot: 0 });
    act(() => {
      fake.emit({ type: "agent.health_changed", payload: { agentId: AGENT.ember, from: "healthy", to: "failing" } });
    });
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(fake.refetches["department.list"]).toBeUndefined();
    act(() => {
      fake.emit({ type: "task.completed", payload: { taskId: "t", kind: "code", title: "Invoice lines", assigneeAgentId: AGENT.beacon } });
    });
    // The department's open tasks and the shared list of finished ones (a quiet card's "Last finished").
    expect(fake.refetches["dev.tasks.list"]).toBe(2);
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

  it("fills a quiet card with the note waiting for the founder, and opens it", () => {
    // Development with nothing in progress: only its finished task is left.
    const responses = { ...dataResponses(), "dev.tasks.list": (input: Record<string, unknown> | undefined) => ({ ...tasks, items: tasks.items.filter((t) => t.status === "done" && (!input?.departmentId || t.departmentId === input.departmentId)) }) };
    const { fake, container } = mountCard({ slot: 0 }, createFakeSource({ businessId: BID, responses }));
    expect(screen.getByText("Quiet", { selector: "[data-now-quiet]" })).toBeTruthy();
    expect(container.querySelector("[data-now-quiet-line]")?.getAttribute("data-now-quiet-line")).toBe("respond");
    screen.getByRole("button", { name: "Waiting for you: Approve the schema change for usage index" }).click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/inbox/${inbox.items[0]!.id}`);
  });

  it("keeps Now lines on a busy card and never calls it quiet", () => {
    const { container } = mountCard({ slot: 0 });
    expect(container.querySelector("[data-now-quiet]")).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")).toBeNull();
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
  it("derives health from the team and blocked tasks", () => {
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

describe("quiet department line", () => {
  const base = { agentIds: new Set([AGENT.atlas, AGENT.beacon, AGENT.cove]), departmentId: DEPT.development, today: TODAY };
  const decision = inbox.items[0]!;
  const update = inbox.items[2]!;

  it("says what waits for the founder first, with how many more", () => {
    expect(quietLine({ ...base, inbox: inbox.items, done: tasks.items })).toEqual({ kind: "respond", label: "Waiting for you", text: decision.subject, detail: undefined, inboxItemId: decision.id });
    const older: InboxItemRow = { ...decision, id: "older", subject: "An older call", createdAt: `${addDays(TODAY, -3)}T08:00:00.000Z` };
    expect(quietLine({ ...base, inbox: [older, ...inbox.items], done: [] })).toMatchObject({ text: decision.subject, detail: "1 more in the Inbox" });
    // Another department's notes and the founder's own never count.
    expect(quietLine({ ...base, agentIds: new Set([AGENT.flint]), inbox: inbox.items, done: [] })).toMatchObject({ kind: "clear" });
  });

  it("then an unread note, then the last task it finished with the day, then all clear", () => {
    const answered = inbox.items.map((n) => (n.id === decision.id ? { ...n, state: "answered" as const } : n.id === update.id ? { ...n, state: "unread" as const } : n));
    expect(quietLine({ ...base, inbox: answered, done: tasks.items })).toMatchObject({ kind: "inbox", label: "New in your Inbox", text: update.subject, inboxItemId: update.id });
    const finished = tasks.items.find((t) => t.status === "done")!;
    expect(quietLine({ ...base, inbox: [], done: tasks.items })).toEqual({ kind: "finished", label: "Last finished", text: finished.title, detail: formatDate(finished.endedAt!, DATE_FORMATS.dayMonth) });
    expect(formatDate(finished.endedAt!, DATE_FORMATS.dayMonth)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/); // "Oct 5": month first, US style
    expect(quietLine({ ...base, inbox: [], done: [] })).toEqual({ kind: "clear", label: "All clear", text: "Nothing in progress, and nothing waiting on you." });
  });

  it("reads timestamps as the API sends them (Dates through superjson) as well as ISO strings", () => {
    const finished = tasks.items.find((t) => t.status === "done")!;
    const asDates = tasks.items.map((t) => ({ ...t, endedAt: t.endedAt ? (new Date(t.endedAt) as unknown as string) : t.endedAt }));
    expect(quietLine({ ...base, inbox: [], done: asDates })).toMatchObject({ kind: "finished", text: finished.title, detail: formatDate(finished.endedAt!, DATE_FORMATS.dayMonth) });
    const older: InboxItemRow = { ...decision, id: "older", subject: "An older call", createdAt: new Date(`${addDays(TODAY, -3)}T08:00:00.000Z`) as unknown as string };
    const newer: InboxItemRow = { ...decision, createdAt: new Date(decision.createdAt) as unknown as string };
    expect(quietLine({ ...base, inbox: [older, newer], done: [] })).toMatchObject({ text: decision.subject, detail: "1 more in the Inbox" });
  });

  it("claims nothing while the Inbox or the finished tasks are not known", () => {
    expect(quietLine({ ...base, inbox: undefined, done: [] })).toBeNull();
    expect(quietLine({ ...base, inbox: [], done: undefined })).toBeNull();
  });
});
