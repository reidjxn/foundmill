import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RatingBandPill, SkillSlider } from "./SkillSlider";

function Controlled({ initial = 10, onChange }: { initial?: number; onChange?: (v: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <SkillSlider
      aria-label="Sales rating"
      value={v}
      onValueChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
    />
  );
}

describe("SkillSlider", () => {
  it("is one slider whose 20 cells are the track, lit up to the value in the ramp colour", () => {
    render(<Controlled initial={13} />);
    const s = screen.getByRole("slider", { name: "Sales rating" });
    expect(s.getAttribute("aria-valuemin")).toBe("1");
    expect(s.getAttribute("aria-valuemax")).toBe("20");
    expect(s.getAttribute("aria-valuenow")).toBe("13");
    expect(s.getAttribute("aria-valuetext")).toBe("13, Good");
    expect(s.querySelectorAll(".skill-cell")).toHaveLength(20);
    expect(s.querySelectorAll(".skill-cell[data-on]")).toHaveLength(13);
    expect(s.className).toContain("tone-rating-3");
    expect(s.style.getPropertyValue("--skill-pos")).toBe("13");
    expect(Array.from(s.querySelectorAll(".skill-ticks > *")).map((t) => t.textContent)).toEqual(["1", "5", "10", "15", "20"]);
  });

  it("steps with the keyboard: arrows ±1, Page Up/Down ±5, Home and End", async () => {
    const onChange = vi.fn();
    render(<Controlled initial={10} onChange={onChange} />);
    const s = screen.getByRole("slider");
    s.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(s.getAttribute("aria-valuenow")).toBe("11");
    await userEvent.keyboard("{PageUp}");
    expect(s.getAttribute("aria-valuenow")).toBe("16");
    expect(s.className).toContain("tone-rating-4");
    await userEvent.keyboard("{ArrowDown}{ArrowLeft}");
    expect(s.getAttribute("aria-valuenow")).toBe("14");
    await userEvent.keyboard("{End}");
    expect(s.getAttribute("aria-valuenow")).toBe("20");
    await userEvent.keyboard("{ArrowRight}");
    expect(s.getAttribute("aria-valuenow")).toBe("20");
    await userEvent.keyboard("{Home}");
    expect(s.getAttribute("aria-valuenow")).toBe("1");
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([11, 16, 15, 14, 20, 1]);
  });

  it("picks the cell under the pointer", () => {
    render(<Controlled initial={10} />);
    const s = screen.getByRole("slider");
    s.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, right: 500, bottom: 36, height: 36, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(s, { clientX: 100 + 400 * (2.5 / 20), button: 0, pointerId: 1 });
    expect(s.getAttribute("aria-valuenow")).toBe("3");
    fireEvent.pointerMove(s, { clientX: 100 + 400 * (17.2 / 20), pointerId: 1 });
    expect(s.getAttribute("aria-valuenow")).toBe("18");
    fireEvent.pointerUp(s, { pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 110, pointerId: 1 });
    expect(s.getAttribute("aria-valuenow")).toBe("18");
  });

  it("does nothing while disabled, and stays put when a controlled parent ignores the change", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SkillSlider aria-label="Design rating" value={7} onValueChange={onChange} disabled />);
    const s = screen.getByRole("slider");
    expect(s.getAttribute("tabindex")).toBe("-1");
    expect(s.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<SkillSlider aria-label="Design rating" value={7} onValueChange={onChange} />);
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(8);
    expect(s.getAttribute("aria-valuenow")).toBe("7");
  });

  it("works uncontrolled and can drop the ticks and hint", () => {
    render(<SkillSlider aria-label="Finance rating" defaultValue={4} ticks={false} hint={false} />);
    const s = screen.getByRole("slider");
    fireEvent.keyDown(s, { key: "ArrowUp" });
    expect(s.getAttribute("aria-valuenow")).toBe("5");
    expect(s.querySelector(".skill-ticks")).toBeNull();
    expect(s.querySelector(".skill-hint")).toBeNull();
  });
});

describe("RatingBandPill", () => {
  it.each([
    [3, "Poor", "tone-rating-1"],
    [9, "Average", "tone-rating-2"],
    [13, "Good", "tone-rating-3"],
    [18, "Excellent", "tone-rating-4"],
  ] as const)("%i reads %s with a dot in the ramp colour", (v, word, tone) => {
    render(<RatingBandPill value={v} />);
    const pill = screen.getByText(word);
    expect(pill.className).toContain(tone);
    expect(pill.querySelector(".chip-dot")).not.toBeNull();
  });
});
