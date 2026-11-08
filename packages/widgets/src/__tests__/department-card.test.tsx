/** AC-11.2.3: department cards reflect live agent status changes within 2 s of `agent.health_changed` / task events. */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WidgetDataProvider } from "../data";
import { getWidget, parseWidgetSettings } from "../registry";
import { createFakeSource } from "../testing";
import "../widgets";
import { AgentPersonaProvider, GuidanceProvider, formatDate, type DateFormatPrefs } from "@foundmill/dugout";
import { departmentHealth, doneLast7Days, headlineMetric, metricKeyFor, monthEndCash, nowLines, quietLine, toSquad } from "../widgets/department-card";
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
    // The card's runway metric in words (UX plan B9); the status strip's tile keeps the word "Runway" and defines it.
    expect(screen.getByText("Months of cash left")).toBeTruthy();
    expect(screen.getByText("Estimate")).toBeTruthy();
    u2();
    mountCard({ departmentId: DEPT.development, slot: 2 });
    expect(screen.getByRole("heading", { name: "Development" })).toBeTruthy();
  });

  it("shows the team, Working on now lines with the agent linked, the module metric and Next", () => {
    const { container } = mountCard({ slot: 0 });
    expect(container.querySelectorAll("[data-squad-member]").length).toBe(3);
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Beacon" })).toBeTruthy();
    expect(screen.getByText(/is working on Invoice lines/)).toBeTruthy();
    expect(screen.getByText("Tasks finished this week")).toBeTruthy();
    expect(screen.getByText(/Seat invitations/)).toBeTruthy();
    expect(screen.getByText("Working on now")).toBeTruthy();
    expect(screen.getByText("Next")).toBeTruthy();
    // Beacon (running) and Atlas (review) are on a task; Cove is idle: two of three working (UX plan B19).
    expect(container.querySelector("[data-team-strip-words]")?.textContent).toBe("2 of 3 working");
  });

  it("carries the Home tour's anchor around the card", () => {
    const { container } = mountCard({ slot: 0 });
    const anchor = container.querySelector("[data-coachmark='department-card']");
    expect(anchor).toBeTruthy();
    expect(anchor?.querySelector("[data-squad-member]")).toBeTruthy();
  });

  it("puts the metric in plain words under its figure while guidance is on: the definition for runway, the card's own line for tasks (UX plan §7.8)", () => {
    const terms = { runway: { id: "runway", word: "Runway", short: "How many months your cash lasts at today's spending." } };
    const Component = def.Component;
    const fake = createFakeSource({ businessId: BID, responses: dataResponses() });
    const { container, unmount } = render(
      <GuidanceProvider value={{ terms }}>
        <WidgetDataProvider source={fake.source}>
          <Component businessId={BID} instanceId="department_card-1" settings={parseWidgetSettings(def, { module: "finance" })} />
          <Component businessId={BID} instanceId="department_card-2" settings={parseWidgetSettings(def, { slot: 0 })} />
        </WidgetDataProvider>
      </GuidanceProvider>,
    );
    const lines = [...container.querySelectorAll("[data-department-metric] [data-plain-line]")].map((el) => el.textContent);
    expect(lines).toEqual(["How many months your cash lasts at today's spending.", "Tasks the team finished in the last 7 days."]);
    unmount();
    const { container: off } = render(
      <GuidanceProvider value={{ guidance: "off", terms }}>
        <WidgetDataProvider source={fake.source}>
          <Component businessId={BID} instanceId="department_card-1" settings={parseWidgetSettings(def, { module: "finance" })} />
        </WidgetDataProvider>
      </GuidanceProvider>,
    );
    expect(off.querySelector("[data-plain-line]")).toBeNull();
  });

  it("says what the team is when nobody has a task, instead of '0 of 1 working' (UX plan B19)", () => {
    const responses = { ...dataResponses(), "dev.tasks.list": () => ({ ...tasks, items: [] }) };
    const { container } = mountCard({ module: "finance" }, createFakeSource({ businessId: BID, responses }));
    expect(container.querySelector("[data-team-strip-words]")?.textContent).toBe("1 agent, healthy");
    expect(screen.getByText("Nothing planned yet")).toBeTruthy();
    expect(screen.queryByText("Nothing queued")).toBeNull();
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
    screen.getByRole("button", { name: "Needs your answer: Approve the schema change for usage index" }).click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/inbox/${inbox.items[0]!.id}`);
  });

  it("keeps Now lines on a busy card and never calls it quiet", () => {
    const { container } = mountCard({ slot: 0 });
    expect(container.querySelector("[data-now-quiet]")).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")).toBeNull();
  });

  it("says it could not load the department's work, with a retry, instead of calling it quiet (no Healthy from an empty list)", () => {
    const responses = { ...dataResponses(), "dev.tasks.list": (input: Record<string, unknown> | undefined) => (input?.departmentId ? new Error("tRPC: INTERNAL_SERVER_ERROR") : { ...tasks, items: [] }) };
    const { fake, container } = mountCard({ slot: 1 }, createFakeSource({ businessId: BID, responses }));
    expect(container.querySelector("[data-now-quiet]")).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")?.getAttribute("data-now-quiet-line")).toBe("error");
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
    // Distribution's lead is degraded: the word comes from the team alone.
    expect(screen.getByText("Degraded")).toBeTruthy();
    screen.getByRole("button", { name: /^Couldn't load: What this department is working on could not be loaded/ }).click();
    expect(fake.refetches["dev.tasks.list"]).toBeGreaterThanOrEqual(1);
  });

  it("opens the agent profile and the department tab", () => {
    const { fake } = mountCard({ slot: 0 });
    screen.getByRole("button", { name: /^Beacon, Backend/ }).click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/agents/${AGENT.beacon}/overview`);
    screen.getByRole("button", { name: "Open" }).click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/d/development/training-ground`);
  });

  it("names the lead and the team by the persona when anthropomorphic agents are on, as the Agents tab does (One name everywhere)", () => {
    // Two agents share the stored name "Atlas": the lead is found by its id, never by its name.
    const withPersonas = departments.map((d, i) =>
      i !== 0
        ? d
        : {
            ...d,
            lead: { ...d.lead!, personaKey: "malik" },
            squad: [
              { ...d.squad[0]!, name: "Atlas", id: AGENT.ember, personaKey: "mei", role: "Backend" },
              ...d.squad.map((a) => (a.id === AGENT.atlas ? { ...a, personaKey: "malik" } : a.id === AGENT.beacon ? { ...a, personaKey: "amara" } : { ...a, personaKey: "kofi", layer: "utility" })),
            ],
          },
    );
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses(), "department.list": withPersonas } });
    const Component = def.Component;
    const { container } = render(
      <AgentPersonaProvider anthropomorphic>
        <WidgetDataProvider source={fake.source}>
          <Component businessId={BID} instanceId="department_card-1" settings={parseWidgetSettings(def, { slot: 0 })} />
        </WidgetDataProvider>
      </AgentPersonaProvider>,
    );
    // The lead: its persona name and position, opened by id.
    const lead = screen.getByRole("button", { name: "Malik (Engineering lead), department lead" });
    lead.click();
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/agents/${AGENT.atlas}/overview`);
    // The team strip: the same first names (toSquad keeps the persona key), a background helper keeps its role name.
    const names = [...container.querySelectorAll("[data-squad-member]")].map((b) => b.getAttribute("aria-label")?.split(",")[0]);
    expect(names).toEqual(["Mei", "Malik", "Amara", "Cove"]);
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
    // Team › Health's words: a down agent (injured) is "Down", never "Failing"; a failing one wins over it.
    expect(departmentHealth(toSquad(dev, { [AGENT.cove]: "injured" }, []), [])).toEqual({ health: "bad", word: "Down" });
    expect(departmentHealth(toSquad(dev, { [AGENT.cove]: "injured", [AGENT.beacon]: "failing" }, []), [])).toEqual({ health: "bad", word: "Failing" });
    expect(departmentHealth(toSquad(dev, { [AGENT.cove]: "degraded" }, []), [])).toEqual({ health: "warn", word: "Degraded" });
    // Idle and paused agents are healthy; tasks that failed to load never turn into a health word.
    expect(departmentHealth(toSquad(dev, { [AGENT.atlas]: "idle", [AGENT.beacon]: "paused" }, []), null)).toEqual({ health: "good", word: "Healthy" });
  });
  it("reads work, not only liveness: many blocked tasks and nothing finished this week is Stalled, never Healthy", () => {
    const squad = toSquad(dev, {}, []);
    const blocked = (n: number) => Array.from({ length: n }, (_, i) => ({ ...tasks.items[4]!, id: `blocked-${i}`, departmentId: DEPT.development, status: "blocked" as const }));
    expect(departmentHealth(squad, blocked(5), { doneLast7Days: 0 })).toEqual({ health: "bad", word: "Stalled" });
    expect(departmentHealth(squad, blocked(9), { doneLast7Days: 0 })).toEqual({ health: "bad", word: "Stalled" });
    // Something shipped, or the finished page could not be read: stuck, not stalled.
    expect(departmentHealth(squad, blocked(5), { doneLast7Days: 2 })).toEqual({ health: "warn", word: "Stuck" });
    expect(departmentHealth(squad, blocked(5), null)).toEqual({ health: "warn", word: "Stuck" });
    expect(departmentHealth(squad, blocked(4), { doneLast7Days: 0 })).toEqual({ health: "warn", word: "Waiting" });
    // A down agent still reads first.
    expect(departmentHealth(toSquad(dev, { [AGENT.cove]: "injured" }, []), blocked(5), { doneLast7Days: 0 })).toEqual({ health: "bad", word: "Down" });
    // The finished count comes from the department's own done tasks in the last seven days.
    expect(doneLast7Days(tasks.items, DEPT.development, TODAY)).toBe(1);
    expect(doneLast7Days(tasks.items, DEPT.distribution, TODAY)).toBe(0);
    expect(doneLast7Days(undefined, DEPT.development, TODAY)).toBe(0);
    expect(doneLast7Days([{ ...tasks.items[3]!, endedAt: `${addDays(TODAY, -8)}T11:00:00.000Z` }], DEPT.development, TODAY)).toBe(0);
  });
  it("writes Now lines with entity markup and caps them at three", () => {
    const squad = toSquad(dev, {}, tasks.items);
    const lines = nowLines(tasks.items, squad);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(`[[ent:${AGENT.beacon}|Beacon]] is working on Invoice lines`);
    expect(lines[1]).toContain("is in review on Rate-limit");
    expect(lines[2]).toContain("is blocked on Draft the October newsletter");
    // The founder's title when the Composer has written one (0070); the technical title otherwise.
    const titled = nowLines([{ ...tasks.items[0]!, founderTitle: "Show every invoice line on the bill" }], squad);
    expect(titled[0]).toBe(`[[ent:${AGENT.beacon}|Beacon]] is working on Show every invoice line on the bill`);
  });
  it("labels estimates and computes each module metric", () => {
    const today = dayKey();
    const base = { rows: ribbon(14).rows, days: lastDays(14), squad: toSquad(dev, {}, []), currency: "EUR", today };
    expect(headlineMetric({ ...base, key: "tasks_done" }).series.length).toBe(14);
    expect(headlineMetric({ ...base, key: "blended_cpa", channels: dataResponses()["distribution.channels.list"] as never })).toMatchObject({ value: "€131.82", provenance: "estimate" });
    expect(headlineMetric({ ...base, key: "runway", finance: dataResponses()["finance.overview"] as never })).toMatchObject({ value: "8.7 mo", provenance: "estimate" });
    // Idle agents are healthy (the status strip's definition): Atlas and Beacon on tasks, Cove idle → 100%.
    expect(headlineMetric({ ...base, key: "squad_health" }).value).toBe("100%");
    expect(headlineMetric({ ...base, key: "squad_health", squad: toSquad(dev, { [AGENT.cove]: "degraded" }, []) }).value).toBe("67%");
    expect(headlineMetric({ ...base, key: "roadmap_on_track", roadmap: dataResponses()["product.roadmap.list"] as never }).value).toBe("2/3");
    expect(headlineMetric({ ...base, key: "next_filing", compliance: dataResponses()["legal.compliance.list"] as never }).value).toBe("19");
  });
});

describe("Finance and Legal card lines", () => {
  const base = { rows: ribbon(14).rows, days: lastDays(14), squad: [], currency: "EUR", today: dayKey() };
  it("plots the business's month-end cash under Runway, not the department's (always zero) revenue", () => {
    const finance = { cash: { amountMinor: 100_000, currency: "EUR", accounts: 1, asOf: null, label: "Bank" }, burn: { netBurnMinor: 10_000, grossBurnMinor: 20_000, months: 3, label: "Estimate" }, runway: { months: 10, label: "Estimate", warnings: [], blocksContinue: false }, revenue: { monthly: [{ month: "2026-09", inflowMinor: 5_000, outflowMinor: 20_000, netMinor: -15_000, count: 3 }, { month: "2026-10", inflowMinor: 2_000, outflowMinor: 7_000, netMinor: -5_000, count: 2 }], basis: "cash", label: "Cash basis" }, customers30d: 0, forecasts: {} } as const;
    expect(monthEndCash(finance as never)).toEqual([105_000, 100_000]);
    expect(headlineMetric({ ...base, key: "runway", finance: finance as never })).toMatchObject({ series: [105_000, 100_000], seriesLabel: "Cash at month end, last 2 months", provenance: "estimate" });
    // No bank: no line at all rather than a flat zero.
    expect(monthEndCash({ ...finance, cash: { ...finance.cash, accounts: 0 } } as never)).toEqual([]);
  });
  it("draws no line under Days to next filing (no daily series measures a filing calendar)", () => {
    expect(headlineMetric({ ...base, key: "next_filing", compliance: dataResponses()["legal.compliance.list"] as never }).series).toEqual([]);
  });
});

describe("quiet department line", () => {
  const base = { agentIds: new Set([AGENT.atlas, AGENT.beacon, AGENT.cove]), departmentId: DEPT.development, today: TODAY };
  const decision = inbox.items[0]!;
  const update = inbox.items[2]!;

  it("says what waits for the founder first, with how many more", () => {
    expect(quietLine({ ...base, inbox: inbox.items, done: tasks.items })).toEqual({ kind: "respond", label: "Needs your answer", text: decision.subject, detail: undefined, inboxItemId: decision.id });
    const older: InboxItemRow = { ...decision, id: "older", subject: "An older call", createdAt: `${addDays(TODAY, -3)}T08:00:00.000Z` };
    expect(quietLine({ ...base, inbox: [older, ...inbox.items], done: [] })).toMatchObject({ text: decision.subject, detail: "1 more in the Inbox" });
    // Another department's notes and the founder's own never count.
    expect(quietLine({ ...base, agentIds: new Set([AGENT.flint]), inbox: inbox.items, done: [] })).toMatchObject({ kind: "clear" });
  });

  it("then an unread note, then the last task it finished with the day, then all clear", () => {
    const answered = inbox.items.map((n) => (n.id === decision.id ? { ...n, state: "answered" as const } : n.id === update.id ? { ...n, state: "unread" as const } : n));
    expect(quietLine({ ...base, inbox: answered, done: tasks.items })).toMatchObject({ kind: "inbox", label: "New in your Inbox", text: update.subject, inboxItemId: update.id });
    const finished = tasks.items.find((t) => t.status === "done")!;
    expect(quietLine({ ...base, inbox: [], done: tasks.items })).toEqual({ kind: "finished", label: "Last finished", text: finished.title, detail: formatDate(finished.endedAt!, "dayMonth") });
    expect(formatDate(finished.endedAt!, "dayMonth")).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/); // "Oct 5": month first, US style
    expect(quietLine({ ...base, inbox: [], done: [] })).toEqual({ kind: "clear", label: "All clear", text: "Nothing in progress, and nothing waiting on you." });
  });

  it("dates the finished task in the signed-in person's format", () => {
    const finished = tasks.items.find((t) => t.status === "done")!;
    const dayFirst: DateFormatPrefs = { date: "day_first", time: "24h" };
    const iso: DateFormatPrefs = { date: "iso", time: "24h" };
    expect(quietLine({ ...base, inbox: [], done: tasks.items, datePrefs: dayFirst })?.detail).toBe(formatDate(finished.endedAt!, "dayMonth", dayFirst));
    expect(formatDate(finished.endedAt!, "dayMonth", dayFirst)).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/); // "5 Oct"
    expect(quietLine({ ...base, inbox: [], done: tasks.items, datePrefs: iso })?.detail).toMatch(/^\d{2}-\d{2}$/); // "10-05"
  });

  it("reads timestamps as the API sends them (Dates through superjson) as well as ISO strings", () => {
    const finished = tasks.items.find((t) => t.status === "done")!;
    const asDates = tasks.items.map((t) => ({ ...t, endedAt: t.endedAt ? (new Date(t.endedAt) as unknown as string) : t.endedAt }));
    expect(quietLine({ ...base, inbox: [], done: asDates })).toMatchObject({ kind: "finished", text: finished.title, detail: formatDate(finished.endedAt!, "dayMonth") });
    const older: InboxItemRow = { ...decision, id: "older", subject: "An older call", createdAt: new Date(`${addDays(TODAY, -3)}T08:00:00.000Z`) as unknown as string };
    const newer: InboxItemRow = { ...decision, createdAt: new Date(decision.createdAt) as unknown as string };
    expect(quietLine({ ...base, inbox: [older, newer], done: [] })).toMatchObject({ text: decision.subject, detail: "1 more in the Inbox" });
  });

  it("puts an agent who needs the founder first, as Team › Health does, and never says all clear beside it", () => {
    const failing = toSquad(departments[0]!, { [AGENT.beacon]: "failing" }, []);
    expect(quietLine({ ...base, inbox: inbox.items, done: tasks.items, squad: failing })).toEqual({ kind: "attention", label: "Needs you", text: "Beacon is failing", detail: "Sessions are stopped until you look", agentId: AGENT.beacon });
    const down = toSquad(departments[0]!, { [AGENT.cove]: "injured", [AGENT.atlas]: "degraded" }, []);
    expect(quietLine({ ...base, inbox: [], done: [], squad: down })).toMatchObject({ kind: "attention", text: "Cove is down", detail: "1 more agent needs you", agentId: AGENT.cove });
    // Idle agents need nobody.
    expect(quietLine({ ...base, inbox: [], done: [], squad: toSquad(departments[0]!, { [AGENT.atlas]: "idle" }, []) })).toMatchObject({ kind: "clear" });
  });

  it("says when the department's last task failed instead of naming an older finished one", () => {
    const failed = { ...tasks.items.find((t) => t.status === "done")!, id: "failed-task", title: "Migrate the invoices table", status: "failed" as const, endedAt: `${TODAY}T10:00:00.000Z` };
    expect(quietLine({ ...base, inbox: [], done: [...tasks.items, failed] })).toMatchObject({ kind: "attention", label: "Last task failed", text: "Migrate the invoices table", taskId: "failed-task" });
  });

  it("claims nothing while the Inbox or the finished tasks are not known", () => {
    expect(quietLine({ ...base, inbox: undefined, done: [] })).toBeNull();
    expect(quietLine({ ...base, inbox: [], done: undefined })).toBeNull();
  });
});
