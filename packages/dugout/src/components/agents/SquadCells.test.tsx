import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockSquadRows } from "./mock";
import { FormCells, ModelChip, RATING_COLUMN_LABEL, RatingCell, SQUAD_VIEWS, StatusCell, ToolIcons, WAGE_COLUMN_LABEL, WageCell, formKey, formScore, squadColumns } from "./SquadCells";
import { ModelPicker } from "./ModelPicker";
import { mockModelOptions } from "./mock";

describe("team cells", () => {
  it("FormCells carries the key in words and pads to five", () => {
    render(<FormCells form={["success", "partial", "failure"]} name="Juno form" />);
    const list = screen.getByRole("list", { name: "Juno form: Last 3 tasks: 1 went well, 1 partly, 1 failed" });
    expect(list.querySelectorAll("li")).toHaveLength(5);
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.getAttribute("data-result"))).toEqual(["none", "none", "success", "partial", "failure"]);
    expect(formScore(["success", "partial", "failure", "success"])).toBe(2.5);
    // The key is the guidance group's FormKey sentence, over the last five results.
    expect(formKey(["success", "success", "partial", "success", "success", "failure"])).toBe("Last 5 tasks: 3 went well, 1 partly, 1 failed");
    expect(formKey([])).toBe("No tasks yet");
  });

  it("FormCells shows the FormKey sentence on hover, so the five cells always have their words", async () => {
    const user = userEvent.setup();
    render(<FormCells form={["success", "failure", "success", "success", "partial"]} name="Juno form" />);
    await user.hover(screen.getByRole("list", { name: /Juno form/ }));
    const key = await screen.findAllByText("Last 5 tasks: 3 went well, 1 partly, 1 failed");
    expect(key.some((el) => el.hasAttribute("data-form-key"))).toBe(true);
  });

  it("RatingCell is the 1–20 mean in display-sm in the ramp colour, one decimal, with the band word (ScaleLabel, compact) beside it", () => {
    render(<RatingCell value={16.25} />);
    const el = screen.getByLabelText("Rating 16.3 of 20, Excellent");
    expect(el.querySelector(".t-display-sm")?.className).toContain("text-rating-4");
    expect(el.textContent).toBe("16.3Excellent");
    const band = el.querySelector("[data-scale-label]") as HTMLElement;
    expect(band.getAttribute("data-tone")).toBe("rating-4");
    expect(band.getAttribute("data-scale")).toBe("20");
    // Compact for the table's 28 px rows: the word and its dot, no plate.
    expect(band.className).not.toContain("chip-plate");
    expect(band.querySelector(".chip-dot")).not.toBeNull();
    render(<RatingCell value={7} compact />);
    const compact = screen.getByLabelText("Rating 7.0 of 20, Average");
    expect(compact.textContent).toBe("7.0");
    expect(compact.getAttribute("title")).toBe("7.0 of 20 · Average");
    render(<RatingCell value={0} />);
    expect(screen.getByLabelText("Not rated yet").textContent).toBe("—");
  });

  it("the Rating column reads /20 with its tooltip, and the cost column says it is US dollars", () => {
    const cols = squadColumns();
    expect(RATING_COLUMN_LABEL).toBe("Rating /20");
    expect(cols.find((c) => c.id === "rating")?.meta?.label).toBe("Rating /20");
    expect(cols.find((c) => c.id === "wage")?.header).toBe(WAGE_COLUMN_LABEL);
    expect(WAGE_COLUMN_LABEL).toBe("AI cost (USD)");
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
    // The money row is the cost per month, never a "wage" (UX plan C14).
    expect(screen.getAllByText("Cost per month").length).toBe(3);
    expect(screen.queryByText("Wage")).toBeNull();
  });

  it("disables locked options and explains why", () => {
    render(<ModelPicker options={mockModelOptions("opus", { lockedToOpus: true })} value="opus" onChange={vi.fn()} />);
    expect((screen.getByRole("radio", { name: /Haiku/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/locked to Opus/).length).toBe(2);
  });
});
