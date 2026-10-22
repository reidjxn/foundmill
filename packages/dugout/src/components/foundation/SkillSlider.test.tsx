import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RatingBandPill, SKILL_ANCHORS, SKILL_SCALE_LEGEND, SkillAnchors, SkillSlider, skillAnchorOf, skillAnchorRating } from "./SkillSlider";

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

describe("SkillSlider anchors (UX plan §7.3, A2)", () => {
  it("maps every band to a word and every word to the middle of its band", () => {
    expect(SKILL_ANCHORS.map((a) => [a.value, a.label, a.rating])).toEqual([
      ["none", "None", 3],
      ["some", "Some", 8],
      ["solid", "Solid", 13],
      ["expert", "Expert", 18],
    ]);
    expect([1, 5, 6, 10, 11, 15, 16, 20].map(skillAnchorOf)).toEqual(["none", "none", "some", "some", "solid", "solid", "expert", "expert"]);
    expect(skillAnchorRating("solid")).toBe(13);
    expect(SKILL_SCALE_LEGEND).toBe("1–5 never done it · 6–10 could manage with help · 11–15 done it for real · 16–20 done it professionally");
    // The legend and the pickers' titles say the same thing.
    for (const a of SKILL_ANCHORS) expect(SKILL_SCALE_LEGEND).toContain(a.hint.replace(" · ", " "));
  });

  it("with anchors, a four-word picker sits above the cells: a word sets the number and the pressed word follows the slider", async () => {
    const onChange = vi.fn();
    function Both() {
      const [v, setV] = useState(10);
      return (
        <SkillSlider
          aria-label="Sales rating"
          anchors
          className="col-span-6"
          value={v}
          onValueChange={(n) => {
            setV(n);
            onChange(n);
          }}
        />
      );
    }
    render(<Both />);
    const wrapper = document.querySelector("[data-skill-input]") as HTMLElement;
    expect(wrapper.className).toContain("col-span-6");
    const picker = screen.getByRole("group", { name: "Sales rating: level" });
    expect(picker.hasAttribute("data-skill-anchors")).toBe(true);
    expect(wrapper.firstElementChild).toBe(picker);
    expect(screen.getByRole("button", { name: "Some" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Expert" }).getAttribute("title")).toBe("16–20 · done it professionally");
    await userEvent.click(screen.getByRole("button", { name: "Expert" }));
    expect(onChange).toHaveBeenLastCalledWith(18);
    const s = screen.getByRole("slider", { name: "Sales rating" });
    expect(s.getAttribute("aria-valuenow")).toBe("18");
    expect(s.querySelectorAll(".skill-cell")).toHaveLength(20);
    // The slider moves the number out of the band and the word follows.
    s.focus();
    await userEvent.keyboard("{PageDown}");
    expect(s.getAttribute("aria-valuenow")).toBe("13");
    expect(screen.getByRole("button", { name: "Solid" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Expert" }).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: "None" }));
    expect(s.getAttribute("aria-valuenow")).toBe("3");
  });

  it("the picker on its own takes a label and a disabled state", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SkillAnchors aria-label="Design: level" value={16} onValueChange={onChange} />);
    expect(screen.getByRole("button", { name: "Expert" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Solid" }));
    expect(onChange).toHaveBeenCalledWith(13);
    rerender(<SkillAnchors aria-label="Design: level" value={16} onValueChange={onChange} disabled />);
    expect(screen.getByRole("button", { name: "Solid" }).hasAttribute("disabled")).toBe(true);
    // Without anchors nothing wraps the slider.
    rerender(<SkillSlider aria-label="Design rating" defaultValue={4} />);
    expect(document.querySelector("[data-skill-input]")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
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
