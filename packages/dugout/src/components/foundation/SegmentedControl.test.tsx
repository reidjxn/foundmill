import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

const ZOOM = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "all", label: "All time", disabled: true },
];

describe("SegmentedControl", () => {
  it("is a labelled group of toggle buttons with the current one pressed", () => {
    render(<SegmentedControl aria-label="Zoom" options={ZOOM} defaultValue="month" />);
    expect(screen.getByRole("group", { name: "Zoom" }).className).toContain("seg-track");
    expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "All time" }).hasAttribute("disabled")).toBe(true);
  });

  it("places the sliding plate once mounted (and marks the track ready)", () => {
    render(<SegmentedControl aria-label="Zoom" options={ZOOM} defaultValue="week" />);
    const track = screen.getByRole("group");
    expect(track.hasAttribute("data-ready")).toBe(true);
    expect(track.style.getPropertyValue("--indicator-w")).toMatch(/px$/);
    expect(track.querySelector(".slide-plate")).not.toBeNull();
  });

  it("chooses on click and moves with the arrow keys, skipping disabled options", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Zoom" options={ZOOM} defaultValue="week" onValueChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    expect(onChange).toHaveBeenLastCalledWith("quarter");
    expect(screen.getByRole("button", { name: "Quarter" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("week");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Week" }));
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("quarter");
  });

  it("follows a controlled value", () => {
    const { rerender } = render(<SegmentedControl aria-label="Zoom" options={ZOOM} value="week" />);
    rerender(<SegmentedControl aria-label="Zoom" options={ZOOM} value="quarter" />);
    expect(screen.getByRole("button", { name: "Quarter" }).getAttribute("aria-pressed")).toBe("true");
  });
});
