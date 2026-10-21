import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";
import { Kbd } from "./Kbd";
import { Field } from "./Label";
import { ProgressRing } from "./ProgressRing";
import { RadioCard, RadioGroup, RadioGroupItem } from "./RadioGroup";
import { SelectOptionLabel, SimpleSelect } from "./Select";
import { Separator } from "./Separator";
import { Slider } from "./Slider";
import { Sparkline } from "./Sparkline";
import { StarRating } from "./StarRating";
import { Switch } from "./Switch";
import { Textarea } from "./Textarea";

describe("Checkbox and radios: visible rings, the accent when chosen", () => {
  it("draws a 16 px box that turns accent when checked", async () => {
    render(<Checkbox aria-label="Select row" />);
    const c = screen.getByRole("checkbox", { name: "Select row" });
    expect(c.className).toContain("check-box");
    expect(c.className).toContain("size-check");
    await userEvent.click(c);
    expect(c.getAttribute("data-state")).toBe("checked");
  });
  it("draws a 16 px radio", () => {
    render(
      <RadioGroup aria-label="Mode" defaultValue="a">
        <RadioGroupItem value="a" aria-label="A" />
      </RadioGroup>,
    );
    const r = screen.getByRole("radio", { name: "A" });
    expect(r.className).toContain("radio-dot");
    expect(r.className).toContain("size-check");
    expect(r.querySelector(".radio-centre")).not.toBeNull();
  });
  it("radio cards: the whole card is the radio, named by its label and described by its description", async () => {
    render(
      <RadioGroup aria-label="Time commitment">
        <RadioCard id="t-full" value="full" label="Full time" description="40 hours a week or more" />
        <RadioCard id="t-part" value="part" label="Part time" description="15 to 30 hours a week" />
      </RadioGroup>,
    );
    const full = screen.getByLabelText("Full time");
    expect(full.getAttribute("role")).toBe("radio");
    expect(full.className).toContain("radio-card");
    expect(full.getAttribute("aria-describedby")).toBe("t-full-description");
    expect(screen.getByRole("radio", { name: "Part time" })).toBeTruthy();
    await userEvent.click(full);
    expect(full.getAttribute("aria-checked")).toBe("true");
    expect(full.getAttribute("data-state")).toBe("checked");
    expect(full.querySelector("[data-radio-dot] .radio-centre")).not.toBeNull();
  });
});

describe("Switch, Slider", () => {
  it("switches at the documented sizes", () => {
    const { rerender } = render(<Switch aria-label="Offline tracking" />);
    const s = screen.getByRole("switch");
    expect(s.className).toContain("switch-track");
    expect(s.getAttribute("data-size")).toBe("md");
    rerender(<Switch aria-label="Offline tracking" size="sm" />);
    expect(s.getAttribute("data-size")).toBe("sm");
    expect(s.querySelector(".switch-thumb")).not.toBeNull();
  });
  it("slides in its tone with a pearl thumb", () => {
    const { container } = render(<Slider defaultValue={[40]} max={100} thumbLabels={["Budget"]} tone="warn" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("tone-status-warn");
    expect(screen.getByRole("slider", { name: "Budget" }).className).toContain("slider-thumb");
  });
});

describe("Fields, select codes, key caps, separators", () => {
  it("textarea is the same well, with the warning tone", () => {
    render(<Textarea aria-label="Instruction" tone="warn" />);
    const t = screen.getByRole("textbox", { name: "Instruction" });
    expect(t.className).toContain("field-well");
    expect(t.getAttribute("data-tone")).toBe("warn");
  });
  it("marks required in the accent and gives errors an icon", () => {
    render(
      <Field htmlFor="n" label="Name" required error="Tell the team what to call you.">
        <input id="n" />
      </Field>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Tell the team what to call you.");
    expect(alert.querySelector("svg")).not.toBeNull();
  });
  it("puts an option's code on a chip before its name", () => {
    render(<SelectOptionLabel code="GBP">Pound sterling</SelectOptionLabel>);
    expect(screen.getByText("GBP").className).toContain("code-chip");
    render(<SimpleSelect aria-label="Currency" controlSize="xl" defaultValue="GBP" options={[{ value: "GBP", code: "GBP", label: "Pound sterling" }]} />);
    const trigger = screen.getByRole("combobox", { name: "Currency" });
    expect(trigger.className).toContain("h-field-lg");
    expect(trigger.className).toContain("field-well");
  });
  it("draws key caps at 18 and 20 px", () => {
    render(
      <>
        <Kbd>⌘K</Kbd>
        <Kbd size="md">1</Kbd>
      </>,
    );
    expect(screen.getByText("⌘K").className).toContain("kbd-cap");
    expect(screen.getByText("1").getAttribute("data-size")).toBe("md");
  });
  it("fades a separator out towards its end by default", () => {
    const { container } = render(
      <>
        <Separator />
        <Separator fade="both" />
        <Separator fade="none" />
      </>,
    );
    const [a, b, c] = Array.from(container.children) as HTMLElement[];
    expect(a!.className).toContain("hairline-fade");
    expect(b!.className).toContain("hairline-fade-both");
    expect(c!.className).toContain("bg-line");
  });
});

describe("ProgressRing, Sparkline, StarRating", () => {
  it("rings on a strong hairline track and glows only when asked", () => {
    const { container } = render(<ProgressRing value={0.4} tone="kit" glow />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-valuenow")).toBe("40");
    expect(svg.getAttribute("class")).toContain("progress-glow");
    expect(svg.getAttribute("class")).toContain("text-kit-lift");
    expect(svg.querySelector("circle")?.getAttribute("class")).toContain("stroke-line-strong");
  });
  it("fills a sparkline with a three-stop gradient and halos its end dot", () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} fill dot />);
    expect(container.querySelectorAll("linearGradient stop")).toHaveLength(3);
    expect(container.querySelector("[data-sparkline-halo]")).not.toBeNull();
  });
  it("draws empty stars on the strong hairline and captions now and potential in words", () => {
    const { container } = render(<StarRating value={2} potential={3} showValue label="Ability" />);
    expect(container.querySelectorAll(".text-line-strong").length).toBeGreaterThan(0);
    // The caption carries the scale (`scaleCaption`) and the band word sits beside it (ScaleLabel, UX plan §6.2).
    expect(container.textContent).toContain("Now 2 of 5 · could reach 3");
    expect(container.querySelector("[role=img]")?.getAttribute("title")).toBe("Now 2 of 5 · could reach 3");
    expect(container.querySelector("[data-stars-band]")?.textContent).toBe("Average");
    // The accessible name keeps the scale; a value alone stays a bare figure with its scale.
    expect(container.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Ability: 2 of 5, could reach 3");
    const { container: alone } = render(<StarRating value={4} showValue label="Lead score" />);
    expect(alone.textContent).toContain("4");
    expect(alone.textContent).not.toContain("Now");
  });
});
