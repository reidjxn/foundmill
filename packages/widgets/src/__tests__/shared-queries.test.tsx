/**
 * Home's widgets share their queries with each other and with the shell: one `department.list` (the shell's input,
 * hidden departments filtered here) and one recent, slim, business-wide `journey.ribbon` that every department card
 * reads its own rows from.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetDataProvider } from "../data";
import { getWidget, parseWidgetSettings } from "../registry";
import { SHELL_DEPARTMENTS_INPUT, useDepartments } from "../shared/departments";
import { RECENT_RIBBON_DAYS, departmentRows, recentRibbonInput } from "../shared/ribbon";
import { addDays, lastDays } from "../shared/time";
import type { DepartmentRow, RibbonResponse } from "../shared/types";
import { createFakeSource, type FakeResponse } from "../testing";
import "../widgets";
import { BID, DEPT, TODAY, dataResponses, departments } from "./fixtures";

const HIDDEN: DepartmentRow = { ...departments[2]!, id: "dddddddd-0000-4000-8000-000000000099", name: "Archive room", slug: "archive-room", position: 9, hidden: true };

/** A ribbon where only Development merges tasks (2 a day), so a card that read another department's rows would show more. */
function ribbonWithOneBusyDepartment(): RibbonResponse {
  const rows: RibbonResponse["rows"] = [];
  for (const day of lastDays(RECENT_RIBBON_DAYS + 1, TODAY)) {
    for (const d of departments) rows.push({ day, departmentId: d.id, agentHours: 1, tasksDone: d.id === DEPT.development ? 2 : 5, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0 });
    rows.push({ day, departmentId: null, agentHours: 0, tasksDone: 0, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 1, decisions: 0 });
  }
  return { rows, conversions: [], conversionCount: RECENT_RIBBON_DAYS + 1, milestones: [], chapters: [], kickoff: addDays(TODAY, -90), today: TODAY };
}

function recordingSource() {
  const inputs: Record<string, unknown[]> = {};
  const record = (path: string, answer: FakeResponse): FakeResponse => (input: Record<string, unknown> | undefined) => {
    (inputs[path] ??= []).push(input);
    return typeof answer === "function" ? (answer as (i: unknown) => unknown)(input) : answer;
  };
  const responses = dataResponses();
  responses["department.list"] = record("department.list", [...departments, HIDDEN]);
  responses["journey.ribbon"] = record("journey.ribbon", ribbonWithOneBusyDepartment());
  return { fake: createFakeSource({ businessId: BID, responses }), inputs };
}

function mount(fake: ReturnType<typeof createFakeSource>, widgets: { key: string; settings: Record<string, unknown> }[]) {
  return render(
    <WidgetDataProvider source={fake.source}>
      {widgets.map((w, i) => {
        const def = getWidget(w.key)!;
        const Component = def.Component;
        return <Component key={i} businessId={BID} instanceId={`${w.key}-${i}`} settings={parseWidgetSettings(def, w.settings)} />;
      })}
    </WidgetDataProvider>,
  );
}

describe("queries Home shares", () => {
  it("the status strip, every department card and the milestones cabinet ask for the same ribbon and departments", () => {
    const { fake, inputs } = recordingSource();
    mount(fake, [
      { key: "status_strip", settings: {} },
      { key: "department_card", settings: { slot: 0 } },
      { key: "department_card", settings: { slot: 1 } },
      { key: "department_card", settings: { slot: 2 } },
      { key: "trophy_cabinet", settings: {} },
    ]);
    const distinct = (xs: unknown[] = []) => new Set(xs.map((x) => JSON.stringify(x)));
    expect(distinct(inputs["journey.ribbon"])).toEqual(new Set([JSON.stringify(recentRibbonInput(TODAY))]));
    expect(distinct(inputs["department.list"])).toEqual(new Set([JSON.stringify(SHELL_DEPARTMENTS_INPUT)]));
    expect(recentRibbonInput(TODAY)).toEqual({ from: addDays(TODAY, -RECENT_RIBBON_DAYS), to: TODAY, slim: true });
  });

  it("a department card reads only its own department's rows from the business-wide answer", () => {
    const { fake } = recordingSource();
    mount(fake, [{ key: "department_card", settings: { departmentId: DEPT.development } }]);
    // Seven days × 2 tasks for Development (the other departments merge 5 a day).
    expect(screen.getByText("Tasks merged this week")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
  });

  it("departmentRows picks one department, or the business-wide row with null", () => {
    const r = ribbonWithOneBusyDepartment();
    expect(departmentRows(r, DEPT.development).every((row) => row.departmentId === DEPT.development && row.tasksDone === 2)).toBe(true);
    expect(departmentRows(r, null).every((row) => row.departmentId === null)).toBe(true);
    expect(departmentRows(undefined, null)).toEqual([]);
  });

  it("useDepartments reads the shell's list and leaves hidden departments out", () => {
    const { fake } = recordingSource();
    function Names() {
      const q = useDepartments();
      return <p data-testid="names">{(q.data ?? []).map((d) => d.name).join(",")}</p>;
    }
    render(
      <WidgetDataProvider source={fake.source}>
        <Names />
      </WidgetDataProvider>,
    );
    expect(screen.getByTestId("names").textContent).toBe(departments.map((d) => d.name).join(","));
  });
});
