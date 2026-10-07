import { describe, expect, it } from "vitest";
import { aggregateDaily, emptyDailyRow, fillDays, mergeDaily, rollupDaily, sumDaily, trailingSum } from "../daily";
import { addDaysKey, dayKeyUtc, daysBetween, eachDayKey, isoWeekdayUtc, quarterEnd, quarterOf, quarterStart } from "../time";
import { JourneyDailyRow } from "../types";
import { fid, makeConversion } from "./fixtures";

const D1 = fid("d", 1);
const D2 = fid("d", 2);

describe("time helpers (UTC)", () => {
  it("buckets by UTC day and walks days and quarters", () => {
    expect(dayKeyUtc("2025-03-04T23:59:59.999Z")).toBe("2025-03-04");
    expect(dayKeyUtc("2025-03-04T00:00:00.000Z")).toBe("2025-03-04");
    expect(dayKeyUtc("2025-03-05T00:30:00.000+01:00")).toBe("2025-03-04");
    expect(addDaysKey("2024-02-28", 2)).toBe("2024-03-01");
    expect(daysBetween("2024-01-01", "2024-12-31")).toBe(365);
    expect(eachDayKey("2025-01-30", "2025-02-02")).toEqual(["2025-01-30", "2025-01-31", "2025-02-01", "2025-02-02"]);
    expect(eachDayKey("2025-02-02", "2025-01-30")).toEqual([]);
    expect(isoWeekdayUtc("2025-10-06")).toBe(1); // Monday
    expect(isoWeekdayUtc("2025-10-05")).toBe(7); // Sunday
    expect(quarterOf("2025-08-15")).toEqual({ year: 2025, quarter: 3 });
    expect(quarterStart(2025, 3)).toBe("2025-07-01");
    expect(quarterEnd(2025, 3)).toBe("2025-09-30");
    expect(quarterEnd(2024, 1)).toBe("2024-03-31");
  });
});

describe("aggregateDaily", () => {
  it("mirrors the journey_daily materialised view: department rows for agent work, the business row for everything else", () => {
    const rows = aggregateDaily({
      businessId: fid("b", 1),
      sessions: [
        { startedAt: "2025-03-04T08:00:00Z", endedAt: "2025-03-04T09:30:00Z", costMinor: 120.4, departmentId: D1 },
        { startedAt: "2025-03-04T22:00:00Z", endedAt: "2025-03-05T01:00:00Z", costMinor: 80, departmentId: D1 },
        { startedAt: "2025-03-04T10:00:00Z", endedAt: null, costMinor: 10, departmentId: D2 },
      ],
      tasks: [
        { endedAt: "2025-03-04T11:00:00Z", status: "done", departmentId: D1 },
        { endedAt: "2025-03-04T11:00:00Z", status: "failed", departmentId: D1 },
        { endedAt: null, status: "done", departmentId: D1 },
        { endedAt: "2025-03-05T11:00:00Z", status: "done", departmentId: null },
      ],
      channelSpend: [{ day: "2025-03-04", spendMinor: 2_500 }],
      conversions: [
        makeConversion({ kind: "signup", amountMinor: 0, occurredAt: "2025-03-04T12:00:00Z" }),
        makeConversion({ kind: "activation", amountMinor: 0, occurredAt: "2025-03-04T12:00:00Z" }),
        makeConversion({ kind: "payment", amountMinor: 4_900, occurredAt: "2025-03-04T12:00:00Z" }),
        makeConversion({ kind: "payment", amountMinor: 100, occurredAt: "2025-03-05T00:00:00Z" }),
      ],
      decisions: [{ decidedAt: "2025-03-04T15:00:00Z" }, { decidedAt: new Date("2025-03-04T16:00:00Z") }],
    });
    for (const r of rows) expect(JourneyDailyRow.parse(r)).toEqual(r);
    expect(rows.map((r) => `${r.day}|${r.departmentId ?? "business"}`)).toEqual([`2025-03-04|business`, `2025-03-04|${D1}`, `2025-03-04|${D2}`, `2025-03-05|business`]);
    expect(rows[1]).toMatchObject({ businessId: fid("b", 1), agentHours: 4.5, tasksDone: 1, spendMinor: 200, revenueMinor: 0, signups: 0 });
    expect(rows[2]).toMatchObject({ agentHours: 0, spendMinor: 10 });
    expect(rows[0]).toMatchObject({ agentHours: 0, tasksDone: 0, spendMinor: 2_500, revenueMinor: 4_900, signups: 1, activations: 1, payments: 1, decisions: 2 });
    expect(rows[3]).toMatchObject({ tasksDone: 1, revenueMinor: 100, payments: 1 });
  });

  it("returns no rows for no input", () => {
    expect(aggregateDaily({})).toEqual([]);
  });
});

describe("merge, rollup, fill, sum, trailing", () => {
  const rows: JourneyDailyRow[] = [
    { ...emptyDailyRow("2025-03-04", D1), agentHours: 2.5, tasksDone: 1, spendMinor: 100 },
    { ...emptyDailyRow("2025-03-04", D2), agentHours: 1.5, tasksDone: 2, spendMinor: 50 },
    { ...emptyDailyRow("2025-03-04", null), revenueMinor: 900, payments: 1, signups: 3 },
    { ...emptyDailyRow("2025-03-06", D1), agentHours: 1, revenueMinor: 100 },
  ];

  it("mergeDaily sums duplicates of day + department", () => {
    const merged = mergeDaily([...rows, { ...emptyDailyRow("2025-03-04", D1), agentHours: 0.5, tasksDone: 4 }]);
    expect(merged).toHaveLength(4);
    expect(merged.find((r) => r.day === "2025-03-04" && r.departmentId === D1)).toMatchObject({ agentHours: 3, tasksDone: 5, spendMinor: 100 });
  });

  it("rollupDaily gives one business-wide row per day", () => {
    const rolled = rollupDaily(rows);
    expect(rolled.map((r) => r.day)).toEqual(["2025-03-04", "2025-03-06"]);
    expect(rolled[0]).toMatchObject({ departmentId: null, agentHours: 4, tasksDone: 3, spendMinor: 150, revenueMinor: 900, payments: 1, signups: 3 });
    expect(rolled[1]).toMatchObject({ departmentId: null, agentHours: 1, revenueMinor: 100 });
  });

  it("fillDays produces a dense day × department grid and keeps unknown departments", () => {
    const filled = fillDays(rows, { from: "2025-03-03", to: "2025-03-06", departmentIds: [D1] });
    // 4 days × (D1 + business) + the D2 row that is outside the list.
    expect(filled).toHaveLength(9);
    expect(filled.filter((r) => r.day === "2025-03-05")).toHaveLength(2);
    expect(filled.filter((r) => r.day === "2025-03-05").every((r) => r.agentHours === 0 && r.signups === 0)).toBe(true);
    expect(filled.find((r) => r.day === "2025-03-04" && r.departmentId === D1)?.agentHours).toBe(2.5);
    expect(filled.some((r) => r.departmentId === D2)).toBe(true);
    const noBusiness = fillDays(rows, { from: "2025-03-05", to: "2025-03-05", departmentIds: [D1, D2], includeBusinessRow: false });
    expect(noBusiness).toHaveLength(2);
  });

  it("sumDaily and trailingSum total the fields", () => {
    const t = sumDaily(rows);
    expect(t).toEqual({ days: 2, agentHours: 5, tasksDone: 3, spendMinor: 150, revenueMinor: 1_000, signups: 3, activations: 0, payments: 1, decisions: 0 });
    const business = rollupDaily(rows);
    expect(trailingSum(business, "2025-03-06", 3, "revenueMinor")).toBe(1_000);
    expect(trailingSum(business, "2025-03-06", 2, "revenueMinor")).toBe(100);
    expect(trailingSum(business, "2025-03-06", 1, "agentHours")).toBe(1);
  });
});
