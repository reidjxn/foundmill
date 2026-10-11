/**
 * Every design-system component that prints a date or a time follows the signed-in person's choice (Settings ›
 * Preferences): one case per component in day-first or ISO dates on a 24-hour clock (ARCHITECTURE §20, rule 5). Client
 * components read it from DateFormatProvider; the server-safe ones (DevelopmentChart, FeedPost, ReadReceipt, LiveRun)
 * take it as `datePrefs` from their caller. Times are local, so expectations that depend on the time zone are built
 * with the same helpers; the fixed parts ("Wednesday 2026-10-07", "15:00") are spelled out.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { DateFormatPrefs } from "../lib/date-preferences";
import { formatDate, formatDateTime, formatTime } from "../lib/format";
import { DateFormatProvider } from "./foundation/DateFormatProvider";
import { DevelopmentChart } from "./agents/DevelopmentChart";
import { InstructionsEditor } from "./agents/InstructionsEditor";
import { mockDevelopmentSeries, mockInstructions, mockSpecialistData } from "./agents/mock";
import { SampleTracker, ShipmentList } from "./agents/SpecialistTile";
import { AgentDesk } from "./conversation/AgentDesk";
import { DECISION_STARTERS, JUNO, JUNO_MESSAGES, RUN_ITEMS, RUN_STEPS } from "./conversation/fixtures";
import { LiveRun, formatLogTime } from "./conversation/LiveRun";
import { ReadReceipt, receiptWords } from "./conversation/ReadReceipt";
import { Conversation } from "./data/Conversation";
import { FeedPost } from "./data/FeedPost";
import { FilterChips } from "./data/FilterChips";
import { describeFilter, type FilterField } from "./data/filters";
import { Timeline } from "./data/Lists";
import { MetricTile } from "./data/MetricTile";
import { AreaChart } from "./journey/charts/AreaChart";
import { LineChart } from "./journey/charts/LineChart";
import { DayDigest } from "./journey/DayDigest";
import { generateJourneyFixture, matchDayFixture, NORTHWIND_KIT, RIBBON_DEPARTMENTS, squadPulseFixture, trophyFixtures } from "./journey/fixtures";
import { MatchdayRoundupTable, type RoundupRow } from "./journey/MatchdayRoundupTable";
import { indexDailyRows, summariseDay } from "./journey/ribbon/geometry";
import { SquadPulse } from "./journey/SquadPulse";
import { JourneyStage } from "./journey/stage/JourneyStage";
import { TrophyCabinet } from "./journey/TrophyCabinet";

const DAY_FIRST: DateFormatPrefs = { date: "day_first", time: "24h" };
const ISO: DateFormatPrefs = { date: "iso", time: "24h" };
/** 12-hour output always carries one of these; a 24-hour clock never does. */
const MERIDIEM = /\b(AM|PM)\b/;

function inFormat(prefs: DateFormatPrefs, ui: ReactNode) {
  return render(<DateFormatProvider value={prefs}>{ui}</DateFormatProvider>);
}

/** A local moment, so its clock time is the same in every time zone the tests run in. */
const local = (h: number, m: number, d = 7) => new Date(2026, 9, d, h, m);

describe("journey components follow the person's date format", () => {
  it("TrophyCabinet dates each reached milestone in it", () => {
    const trophies = trophyFixtures();
    const enterprise = trophies.find((t) => t.key === "first_enterprise_contract")!;
    inFormat(ISO, <TrophyCabinet trophies={trophies} onOpen={() => {}} />);
    const iso = formatDate(enterprise.achievedAt!, "date", ISO);
    expect(iso).toMatch(/^2026-(09-30|10-0[12])$/);
    expect(screen.getByRole("button", { name: `First enterprise contract, reached ${iso}` })).toBeTruthy();
    expect(screen.getAllByText(iso).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Oct \d+, 2026/);
  });

  it("SquadPulse labels the hours on a 24-hour clock and names each cell's day", () => {
    const { cells, days } = squadPulseFixture();
    const { container } = inFormat(DAY_FIRST, <SquadPulse departments={RIBBON_DEPARTMENTS} days={days} cells={cells} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(0, 4)).toEqual(["00:00", "01:00", "02:00", "03:00"]);
    expect(headers).toContain("15:00");
    expect(headers.join(" ")).not.toMatch(MERIDIEM);
    // The last row is FIXTURE_TODAY: Wednesday, October 7, 2026.
    expect(container.querySelector("[data-pulse-cell='6:15']")?.getAttribute("aria-label")).toMatch(/^Wed 7 Oct, 15:00 — /);
  });

  it("MatchdayRoundupTable heads the day and times each win in it", () => {
    const rows: RoundupRow[] = [
      { conversionId: "c1", kind: "payment", level: "cup", customerName: "Alma Botanics", channelKey: "paid_ads", amountMinor: 5900, currency: "EUR", occurredAt: local(15, 45).toISOString(), touchCount: 7 },
      { conversionId: "c2", kind: "signup", level: "friendly", customerName: "Linnea Haug", channelKey: "seo", amountMinor: 0, currency: "EUR", occurredAt: local(9, 5).toISOString(), touchCount: 3 },
    ];
    const { container } = inFormat(ISO, <MatchdayRoundupTable rows={rows} day="2026-10-07" onOpenReplay={() => {}} />);
    expect(screen.getByText("Customer update round-up · 2026-10-07")).toBeTruthy();
    expect(within(container.querySelector("[data-roundup-row='c1']") as HTMLElement).getByText("15:45")).toBeTruthy();
    expect(within(container.querySelector("[data-roundup-row='c2']") as HTMLElement).getByText("09:05")).toBeTruthy();
  });

  it("DayDigest heads the day with the long date and times the wins", () => {
    const data = generateJourneyFixture({ days: 40, seed: "digest" });
    const index = indexDailyRows(data.rows, RIBBON_DEPARTMENTS);
    const win = data.conversions.find((c) => c.kind === "payment")!;
    const day = win.occurredAt.slice(0, 10);
    const summary = summariseDay(day, { index, departments: RIBBON_DEPARTMENTS, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
    inFormat(ISO, <DayDigest summary={summary} />);
    expect(screen.getByRole("region", { name: `Day digest, ${day}` })).toBeTruthy();
    expect(screen.getByRole("heading").textContent).toContain(formatDate(day, "longDate", ISO));
    expect(formatDate(day, "longDate", ISO)).toMatch(/^[A-Z][a-z]+day \d{4}-\d{2}-\d{2}$/);
    expect(screen.getAllByText(formatTime(win.occurredAt, ISO)).length).toBeGreaterThan(0);
    expect(screen.getByRole("region").textContent).not.toMatch(MERIDIEM);
  });

  it("JourneyStage dates first touch and conversion, and times each touch from first touch", async () => {
    const user = userEvent.setup();
    const fx = matchDayFixture();
    const { container } = inFormat(DAY_FIRST, <JourneyStage journey={fx.journey} touches={fx.touches} customer={fx.customer} agents={fx.agents} kit={NORTHWIND_KIT} autoplay={false} overlay="none" />);
    await user.click(screen.getByRole("button", { name: "First touch" }));
    const converted = formatDateTime(fx.journey.convertedAt, DAY_FIRST);
    expect(converted).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
    expect(container.querySelector("[data-stage-panel='kick_off']")?.textContent).toContain(`to ${converted}`);
    await user.click(screen.getByRole("button", { name: "Touches" }));
    const firstRow = container.querySelector("[data-touch-row]") as HTMLElement;
    expect(firstRow.textContent).toMatch(/Day \d+ · \d{2}:\d{2}/);
    expect(firstRow.textContent).not.toMatch(MERIDIEM);
    await user.click(screen.getByRole("button", { name: "Debrief" }));
    expect(container.textContent).toContain(converted);
  });

  it("LineChart and AreaChart label a time axis in it by default", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ x: new Date(2026, 8, 1 + i), y: 100 + i * 7 }));
    const { container } = inFormat(
      ISO,
      <>
        <LineChart label="Revenue" width={600} height={160} series={[{ id: "r", label: "Revenue", tone: "kit", data: days }]} />
        <AreaChart label="Hours" width={600} height={160} series={[{ id: "h", label: "Hours", tone: "kit", data: days }]} />
      </>,
    );
    const ticks = [...container.querySelectorAll("svg text")].map((t) => t.textContent ?? "").filter((t) => /\d{4}-\d{2}-\d{2}/.test(t));
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.some((t) => t.startsWith("2026-09-0"))).toBe(true);
    expect(container.textContent).not.toMatch(/Sep \d+, 2026/);
  });
});

describe("data components follow the person's date format", () => {
  it("Timeline prints absolute moments, and every hover title, in it (relative times stay)", () => {
    const now = local(16, 0);
    const events = [{ id: "a", at: local(15, 45), title: "Sara replied" }];
    const { rerender } = inFormat(DAY_FIRST, <Timeline events={events} now={now} absolute />);
    expect(screen.getByText("7 Oct 2026, 15:45")).toBeTruthy();
    rerender(
      <DateFormatProvider value={DAY_FIRST}>
        <Timeline events={events} now={now} />
      </DateFormatProvider>,
    );
    expect(screen.getByText("15 min ago").getAttribute("title")).toBe("7 Oct 2026, 15:45");
  });

  it("Conversation's message times carry the full moment in it", () => {
    inFormat(ISO, <Conversation label="Thread" messages={[{ id: "m1", author: "Juno", body: "Done.", at: local(15, 45) }]} onSend={() => {}} />);
    expect(document.querySelector("time")?.getAttribute("title")).toBe("2026-10-07 15:45");
  });

  it("FeedPost's time carries the full moment in the format its caller passes", () => {
    render(
      <FeedPost author="Jamie Reyes" at={local(15, 45)} datePrefs={DAY_FIRST}>
        First touch halved.
      </FeedPost>,
    );
    expect(document.querySelector("time")?.getAttribute("title")).toBe("7 Oct 2026, 15:45");
  });

  it("MetricTile's source note dates the figure in it", async () => {
    inFormat(ISO, <MetricTile label="MRR" value={1200} provenance={{ source: "Stripe", asOf: local(15, 45).toISOString() }} />);
    await act(async () => {
      fireEvent.focus(screen.getByRole("button", { name: "Where this number comes from: Stripe" }));
    });
    expect((await screen.findAllByText("As of 2026-10-07 15:45")).length).toBeGreaterThan(0);
  });

  it("a date filter chip reads its value in it (the chip keeps the machine value)", () => {
    const fields: FilterField[] = [{ id: "due", label: "Due", kind: "date" }];
    const chip = { id: "f1", field: "due", op: "between" as const, value: ["2026-10-07", "2026-10-21"] };
    expect(describeFilter(chip, fields).value).toBe("Oct 7, 2026 and Oct 21, 2026");
    expect(describeFilter(chip, fields, DAY_FIRST).value).toBe("7 Oct 2026 and 21 Oct 2026");
    expect(describeFilter({ id: "f2", field: "due", op: "after", value: "not a date" }, fields, ISO).value).toBe("not a date");
    inFormat(ISO, <FilterChips fields={fields} chips={[{ id: "f3", field: "due", op: "after", value: "2026-10-07" }]} onChange={() => {}} readOnly />);
    expect(screen.getByText("2026-10-07")).toBeTruthy();
  });
});

describe("agent components follow the person's date format", () => {
  it("InstructionsEditor dates each comment in it", () => {
    inFormat(DAY_FIRST, <InstructionsEditor value={mockInstructions()} onChange={() => {}} onComment={() => {}} comments={[{ id: "c1", author: "Coach", at: local(15, 45).toISOString(), text: "Tests first lifted Testing by 6." }]} />);
    expect(screen.getByText("7 Oct 2026, 15:45")).toBeTruthy();
  });

  it("SampleTracker and ShipmentList give each ETA in it", () => {
    const data = mockSpecialistData();
    inFormat(
      ISO,
      <>
        <SampleTracker samples={data.samples} />
        <ShipmentList shipments={data.shipments} />
      </>,
    );
    expect(screen.getByText(`ETA ${formatDate(data.samples[1]!.etaAt!, "date", ISO)}`)).toBeTruthy();
    expect(screen.getByText(`ETA ${formatDate(data.shipments[0]!.etaAt!, "date", ISO)}`)).toBeTruthy();
    expect(document.body.textContent).toMatch(/ETA 2026-10-\d{2}/);
  });

  it("DevelopmentChart labels its axis and data table in the format its caller passes", () => {
    const { series, sessions } = mockDevelopmentSeries();
    const { container } = render(<DevelopmentChart series={series} sessions={sessions} dept="dept-2" datePrefs={ISO} />);
    const ticks = [...container.querySelectorAll("text.chart-tick")].map((t) => t.textContent ?? "").filter((t) => t.includes("-"));
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => /^\d{2}-\d{2}$/.test(t))).toBe(true);
    const firstCell = screen.getByRole("table").querySelector("tbody tr td:nth-child(2)")?.textContent;
    expect(firstCell).toBe(formatDate(series[0]!.points[0]!.at, "date", ISO));
    expect(firstCell).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("conversation components follow the person's time format", () => {
  it("ReadReceipt reads the time on the clock its caller passes", () => {
    render(<ReadReceipt state="seen" readAt={local(14, 2)} datePrefs={ISO} />);
    expect(screen.getByTestId("read-receipt").textContent).toBe("Read 14:02");
    expect(receiptWords("read", local(14, 2))).toBe("Read 2:02 PM");
  });

  it("AgentDesk hands the person's choice to its read receipt", () => {
    inFormat(DAY_FIRST, <AgentDesk persona={JUNO} messages={JUNO_MESSAGES} starters={DECISION_STARTERS} label="Conversation with Juno" onQuickReply={() => {}} onSend={() => {}} />);
    expect(screen.getByTestId("read-receipt").textContent).toBe("Read 14:02");
  });

  it("LiveRun's log clock reads the format its caller passes", () => {
    expect(formatLogTime(local(14, 6), ISO)).toBe("14:06:00");
    expect(formatLogTime(local(14, 6))).toBe("2:06:00 PM");
    render(<LiveRun steps={RUN_STEPS} items={RUN_ITEMS} log={{ text: "Capital intensity", at: local(14, 6) }} datePrefs={DAY_FIRST} />);
    expect(screen.getByText("14:06:00")).toBeTruthy();
  });
});
