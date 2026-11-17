import { describe, expect, it } from "vitest";
import { fitColumns, fitToGrow, humanise, plural } from "./fit";

describe("fitColumns", () => {
  const specs = { name: { min: 160, grow: 3 }, role: { min: 120, grow: 1 }, wage: { min: 100 }, hidden: { min: 200, grow: 5 } };

  it("keeps every column at its minimum until the width is measured or when it is too narrow", () => {
    expect(fitColumns(null, specs, ["name", "role", "wage"])).toEqual({ name: 160, role: 120, wage: 100, hidden: 200 });
    expect(fitColumns(300, specs, ["name", "role", "wage"])).toEqual({ name: 160, role: 120, wage: 100, hidden: 200 });
  });

  it("shares the extra width by grow weight among the visible columns, so they fill the table exactly", () => {
    const sizes = fitColumns(781, specs, ["name", "role", "wage"]);
    expect(sizes.name + sizes.role + sizes.wage).toBe(781);
    expect(sizes).toMatchObject({ name: 160 + 300 + 1, role: 120 + 100, wage: 100, hidden: 200 });
  });
});

describe("humanise and plural", () => {
  it("turns keys into sentence-case words with initialisms in capitals", () => {
    expect(humanise("cycle_planning")).toBe("Round of work planning");
    expect(humanise("api_design")).toBe("API design");
    expect(humanise("ci_cd")).toBe("CI/CD");
    expect(humanise("dtc-physical")).toBe("DTC physical");
    expect(humanise("in_transit")).toBe("In transit");
    expect(humanise(null)).toBe("");
  });

  it("counts in words", () => {
    expect(plural(1, "agent")).toBe("1 agent");
    expect(plural(3, "agent")).toBe("3 agents");
    expect(plural(1, "person", "people")).toBe("1 person");
    expect(plural(0, "person", "people")).toBe("0 people");
  });
});

describe("fitToGrow", () => {
  it("sizes columns at their minimum and hands the grow weight to the DataTable", () => {
    const cols = fitToGrow<{ a: string }>(
      [
        { id: "name", header: "Name", size: 999, meta: { locked: true } },
        { accessorKey: "a", header: "A" },
        { id: "other", header: "Other", size: 70 },
      ],
      { name: { min: 180, grow: 2 }, a: { min: 96 } },
    );
    expect(cols.map((c) => [c.size, c.meta?.grow])).toEqual([[180, 2], [96, 0], [70, undefined]]);
    expect(cols[0]?.meta?.locked).toBe(true);
  });
});
