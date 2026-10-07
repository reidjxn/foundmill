import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mockSquadRows } from "./mock";
import { FormCells, ModelChip, RatingCell, SQUAD_VIEWS, StatusCell, ToolIcons, WageCell, formScore, squadColumns } from "./SquadCells";
import { ModelPicker } from "./ModelPicker";
import { mockModelOptions } from "./mock";

describe("squad cells", () => {
  it("FormCells carries words and pads to five", () => {
    render(<FormCells form={["success", "partial", "failure"]} name="Juno form" />);
    const list = screen.getByRole("list", { name: "Juno form, last five: none, none, success, partial, failure" });
    expect(list.querySelectorAll("li")).toHaveLength(5);
    expect(formScore(["success", "partial", "failure", "success"])).toBe(2.5);
  });

  it("RatingCell is display-sm in the ramp colour with one decimal", () => {
    render(<RatingCell value={8.25} />);
    const el = screen.getByLabelText("Rating 8.3 of 10");
    expect(el.className).toContain("text-rating-4");
    expect(el.className).toContain("t-display-sm");
  });

  it("ModelChip is mono and clickable", () => {
    const onClick = vi.fn();
    render(<ModelChip model="sonnet" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Sonnet/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it("ToolIcons lists every tool in the name and shows +N", () => {
    render(<ToolIcons tools={["github", "e2b", "gmail", "stripe", "shopify", "notion", "unknown_tool"]} max={5} />);
    expect(screen.getByRole("img", { name: "Tools: GitHub, Sandbox, Gmail, Stripe, Shopify, Notion, unknown_tool" })).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("StatusCell shows the expected return for agents that are down", () => {
    render(<StatusCell status="injured" expectedReturnAt="2026-10-07T12:00:00Z" now={new Date("2026-10-07T09:00:00Z")} />);
    expect(screen.getByText("Down")).toBeTruthy();
    expect(screen.getByText(/back in 3 hr/)).toBeTruthy();
  });

  it("WageCell formats money per month", () => {
    render(<WageCell wage={{ amountMinor: 750000, currency: "EUR" }} />);
    expect(screen.getByText(/7,500/)).toBeTruthy();
    expect(screen.getByText("/mo")).toBeTruthy();
  });

  it("squadColumns cover the BUILD §11.9 columns and every saved view references real columns", () => {
    const cols = squadColumns();
    const ids = cols.map((c) => c.id);
    expect(ids).toEqual(["name", "role", "departments", "status", "currentTask", "form", "rating", "tools", "model", "wage", "latestUpdate"]);
    expect(SQUAD_VIEWS.map((v) => v.name)).toEqual(["General", "Health", "Tools", "Cost", "Performance"]);
    for (const v of SQUAD_VIEWS) for (const c of v.columns) expect(ids).toContain(c);
    const rows = mockSquadRows(14);
    expect(rows.some((r) => r.status === "injured" && r.expectedReturnAt)).toBe(true);
  });
});

describe("ModelPicker", () => {
  it("offers three models with deltas, locks and warns", () => {
    const onChange = vi.fn();
    render(<ModelPicker options={mockModelOptions("sonnet", { chiefOfStaff: true })} value="sonnet" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    fireEvent.click(screen.getByRole("radio", { name: /Opus/ }));
    expect(onChange).toHaveBeenCalledWith("opus");
    expect(screen.getByText(/Downgrading the Chief of Staff/)).toBeTruthy();
    expect(screen.getAllByText("Estimate").length).toBe(2);
    expect(screen.getByText("▲ 2.5")).toBeTruthy();
  });

  it("disables locked options and explains why", () => {
    render(<ModelPicker options={mockModelOptions("opus", { lockedToOpus: true })} value="opus" onChange={vi.fn()} />);
    expect((screen.getByRole("radio", { name: /Haiku/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/locked to Opus/).length).toBe(2);
  });
});
