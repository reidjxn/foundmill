/**
 * Builder view (docs/DESIGN.md "Builder view"): the gate reads off outside a provider, and each engine detail the design
 * system draws (tokens, ETA, test counts, ratings out of 20, Builder view columns and views) is gone while it is off.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { BuilderOnly, BuilderViewProvider, useBuilderView } from "./BuilderView";
import { DataTable, builderViewTable, type DataTableColumn } from "../data/DataTable";
import type { SavedView } from "../data/types";
import { RatingBar } from "../data/RatingBar";
import { SkillGrid } from "../data/SkillGrid";
import { RatingCell, SQUAD_VIEWS, squadColumns } from "../agents/SquadCells";
import { mockSquadRows, mockSessionSeed, generateMockSessionEvents, mockTrainingResults, MOCK_COACH_EXPLANATION } from "../agents/mock";
import { reduceSessionEvents } from "../agents/progress";
import { TileFrame } from "../agents/TileFrame";
import { PlanView } from "../agents/PlanView";
import { TrainingResults } from "../agents/TrainingResults";
import { scrubberMarkers } from "../agents/SessionScrubber";
import { LiveRun } from "../conversation/LiveRun";
import { RUN_ITEMS, RUN_STEPS } from "../conversation/fixtures";
import { cycleRunningLine, nextStepsFor } from "../firstrun/nextSteps";

const on = ({ children }: { children: ReactNode }) => <BuilderViewProvider on>{children}</BuilderViewProvider>;

function Probe() {
  return <span data-testid="probe">{useBuilderView() ? "on" : "off"}</span>;
}

describe("BuilderView", () => {
  it("reads off outside a provider, and follows the provider", () => {
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("off");
    unmount();
    render(
      <BuilderViewProvider on>
        <Probe />
        <BuilderViewProvider>
          <span data-testid="inner">
            <Probe />
          </span>
        </BuilderViewProvider>
      </BuilderViewProvider>,
    );
    expect(screen.getAllByTestId("probe").map((n) => n.textContent)).toEqual(["on", "off"]);
  });

  it("BuilderOnly renders its children only while on, else its fallback (nothing by default)", () => {
    const { rerender } = render(<BuilderOnly fallback={<span>founder</span>}>engine</BuilderOnly>);
    expect(document.body.textContent).toBe("founder");
    rerender(<BuilderOnly>engine</BuilderOnly>);
    expect(document.body.textContent).toBe("");
    rerender(
      <BuilderViewProvider on>
        <BuilderOnly fallback="founder">engine</BuilderOnly>
      </BuilderViewProvider>,
    );
    expect(document.body.textContent).toBe("engine");
  });
});

type Row = { id: string; name: string; tokens: number; cost: number };
const rows: Row[] = [
  { id: "a", name: "Juno", tokens: 4812, cost: 3 },
  { id: "b", name: "Ari", tokens: 120, cost: 9 },
];
const columns: DataTableColumn<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "tokens", header: "Tokens", meta: { numeric: true, builderOnly: true } },
  { accessorKey: "cost", header: "Cost", meta: { numeric: true } },
];
const views: SavedView[] = [
  { id: "usage", name: "Usage", builtIn: true, builderOnly: true, columns: ["name", "tokens"], sort: [{ id: "tokens", desc: true }], filters: [] },
  { id: "all", name: "All", builtIn: true, columns: ["name", "tokens", "cost"], sort: [{ id: "tokens", desc: true }], filters: [{ id: "f", field: "tokens", op: "gt", value: 0 }] },
];

describe("DataTable and Builder view", () => {
  it("off: a builderOnly column has no head and no cells; on: it is back", () => {
    const { unmount } = render(<DataTable data={rows} columns={columns} aria-label="Usage" />);
    expect(screen.queryByRole("columnheader", { name: /Tokens/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Cost/ })).toBeTruthy();
    expect(screen.getByRole("grid").textContent).not.toContain("4812");
    unmount();
    render(<DataTable data={rows} columns={columns} aria-label="Usage" />, { wrapper: on });
    expect(screen.getByRole("columnheader", { name: /Tokens/ })).toBeTruthy();
  });

  it("off: a builderOnly view is not offered, a view chosen while on opens as the first other view, and its sort and filters skip hidden columns", () => {
    render(<DataTable data={rows} columns={columns} views={views} activeViewId="usage" aria-label="Usage" />);
    // The view switcher names the open view: "All", since "Usage" is Builder view's.
    expect(screen.getByRole("button", { name: /View: All/ })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /Tokens/ })).toBeNull();
    // The filter on tokens is skipped, so both rows show.
    expect(within(screen.getByRole("grid")).getAllByRole("row")).toHaveLength(3);
  });

  it("builderViewTable: drops columns and views while off and puts hidden views back into a saved list in their places", () => {
    const off = builderViewTable(columns, views, false);
    expect(off.columns.map((c) => (c as { accessorKey?: string }).accessorKey)).toEqual(["name", "cost"]);
    expect(off.views?.map((v) => v.id)).toEqual(["all"]);
    expect([...off.hiddenColumnIds]).toEqual(["tokens"]);
    const mine: SavedView = { id: "mine", name: "Mine", columns: ["name"], sort: [], filters: [] };
    expect(off.restoreViews([{ ...views[1]!, name: "Everything" }, mine]).map((v) => [v.id, v.name])).toEqual([["usage", "Usage"], ["all", "Everything"], ["mine", "Mine"]]);
    // A view deleted while off is gone; the hidden one stays.
    expect(off.restoreViews([]).map((v) => v.id)).toEqual(["usage"]);
    const onT = builderViewTable(columns, views, true);
    expect(onT.columns).toBe(columns);
    expect(onT.views).toBe(views);
  });

  it("the team table marks Form, Rating, Tools and Model, and the Health, Tools and Performance views", () => {
    // The team table's own wiring marks Form, Rating, Tools and Model, and the Health, Tools and Performance views.
    expect(squadColumns().filter((c) => c.meta?.builderOnly).map((c) => c.id)).toEqual(["form", "rating", "tools", "model"]);
    expect(SQUAD_VIEWS.filter((v) => v.builderOnly).map((v) => v.id)).toEqual(["health", "tools", "performance"]);
    expect(builderViewTable(squadColumns(), SQUAD_VIEWS, false).views?.map((v) => v.id)).toEqual(["general", "cost"]);
  });
});

describe("ratings with Builder view off", () => {
  it("RatingCell shows the band word only, never the figure out of 20", () => {
    render(<RatingCell value={16.25} />);
    const el = screen.getByLabelText("Rating Excellent");
    expect(el.textContent).toBe("Excellent");
    expect(document.body.textContent).not.toMatch(/16|20/);
  });

  it("RatingBar is the band word alone: no cells", () => {
    render(<RatingBar value={14} name="Planning" />);
    const word = screen.getByRole("img", { name: "Planning: Good" });
    expect(word.textContent).toBe("Good");
    expect(word.querySelectorAll(".cell-lit, .cell-empty")).toHaveLength(0);
  });

  it("SkillGrid shows each skill's figure out of 20 and its band word, and no cells (founder decision 5, WP-10 T9)", () => {
    render(<SkillGrid skills={[{ id: "comm", name: "Communication", group: "craft", value: 15 }]} />);
    expect(document.querySelector("[data-rating-figure]")?.textContent).toContain("15");
    expect(document.querySelector("[data-skill-band]")?.textContent).toBe("Good");
    expect(document.querySelector("[data-skill-band]")?.getAttribute("aria-label")).toBe("Communication: 15 of 20 · Good");
    expect(document.querySelector("[data-rating]")).toBeNull();
  });

  it("the team rows still render (the gated columns are simply absent)", () => {
    render(<DataTable data={mockSquadRows()} columns={squadColumns()} views={SQUAD_VIEWS} aria-label="Agents" />);
    expect(screen.queryByRole("columnheader", { name: /Rating/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Form/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Model/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Status/ })).toBeTruthy();
  });
});

const START = "2026-10-07T09:00:00Z";
const NOW = new Date("2026-10-07T09:12:00Z");
const session = { ...reduceSessionEvents(mockSessionSeed(0, START), generateMockSessionEvents(0, START, { outcome: "running" })), etaAt: "2026-10-07T09:20:00Z", tokens: 48_120 };
const tile = () => (
  <TileFrame session={session} views={[{ id: "terminal", label: "Terminal", icon: Terminal }]} view="terminal" onViewChange={() => undefined} now={NOW}>
    <div />
  </TileFrame>
);

describe("engine details with Builder view off", () => {
  it("a tile's footer keeps elapsed and the cost Estimate, without tokens or ETA", () => {
    const { unmount } = render(tile());
    const footer = screen.getByTestId("tile-footer");
    expect(footer.textContent).toContain("12m 00s");
    expect(footer.textContent).toContain("Estimate");
    expect(footer.textContent).not.toMatch(/tokens|ETA/);
    unmount();
    render(tile(), { wrapper: on });
    expect(screen.getByTestId("tile-footer").textContent).toMatch(/tokens/);
    expect(screen.getByTestId("tile-footer").textContent).toMatch(/ETA/);
  });

  it("LiveRun's meter has no token count", () => {
    render(<LiveRun steps={RUN_STEPS} items={RUN_ITEMS} meter={{ tokens: 4812, elapsedMs: 19_000 }} />);
    expect(screen.getByTestId("live-run-meter").textContent).not.toContain("tokens");
  });

  it("PlanView has no acceptance line, TrainingResults no test counts, and the scrubber's test markers no counts", () => {
    render(<PlanView plan={[{ id: "s1", text: "Write the picker", state: "done" }]} tests={{ passed: 105, failed: 0, skipped: 0, acceptance: { passed: 3, failed: 1, failures: ["checkout"] }, lastAt: null }} />);
    expect(document.querySelector("[data-plan-tests]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/passing/);
    render(<TrainingResults results={mockTrainingResults()} coachExplanation={MOCK_COACH_EXPLANATION} candidateVersion={5} liveVersion={4} cost={{ amountMinor: 184, currency: "EUR" }} durationMs={214_000} onPromote={() => undefined} onDiscard={() => undefined} />);
    expect(document.body.textContent).not.toMatch(/tests passed/);
    const events = [{ kind: "test_result" as const, at: "2026-10-07T09:05:00Z", passed: 105, failed: 0, suite: "unit" }];
    expect(scrubberMarkers(events as never, START, false)[0]?.label).toBe("unit");
    expect(scrubberMarkers(events as never, START, true)[0]?.label).toBe("unit, 105 passed, 0 failed");
  });

  it("the first-week checklist says the team is working, without a round of work number", () => {
    expect(cycleRunningLine(null, 4)).toBe("The team is working · 4 agents at work");
    expect(cycleRunningLine(3, 0)).toBe("Round of work 3 is running");
    const steps = nextStepsFor({ foundationsStatus: "ready", blockingNotes: 0, unreadNotes: 0, cycleRunning: true, cycleNumber: null, agentsWorking: 2, distributionStarted: true, firstCycleDone: true }, { vision: "/v", inboxRespond: "/i", board: "/b" });
    expect(steps[0]?.label).toBe("The team is working · 2 agents at work");
  });
});
