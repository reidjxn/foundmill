import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Lock, Medal, ShieldCheck } from "lucide-react";
import { contrastRatio } from "../../lib/colour";
import { AssuranceList } from "./AssuranceList";
import { DAY_LIST_WORDS, DayList } from "./DayList";
import { LandingSection } from "./LandingSection";
import { QuestionList } from "./QuestionList";
import { SCREEN_FRAME_WORDS, ScreenFrame } from "./ScreenFrame";

describe("ScreenFrame", () => {
  it("labels the real screen it holds as an example, as a figure caption", () => {
    render(
      <ScreenFrame>
        <p>The real card</p>
      </ScreenFrame>,
    );
    const figure = screen.getByRole("figure", { name: SCREEN_FRAME_WORDS.label });
    expect(figure.textContent).toContain("The real card");
  });
  it("takes another label", () => {
    render(<ScreenFrame label="Example project">x</ScreenFrame>);
    expect(screen.getByRole("figure", { name: "Example project" })).toBeTruthy();
  });
});

describe("LandingSection", () => {
  it("is a region named by its h2, whose id is <id>-title and can take focus from script", () => {
    render(
      <LandingSection id="people" title="On your own, or with people" lede="You can build all of it by yourself.">
        <p>Words</p>
      </LandingSection>,
    );
    const region = screen.getByRole("region", { name: "On your own, or with people" });
    expect(region.id).toBe("people");
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.id).toBe("people-title");
    expect(h2.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText("You can build all of it by yourself.")).toBeTruthy();
  });
  it("puts a screen beside the words only when given one", () => {
    const { container, rerender } = render(<LandingSection id="a" title="A" />);
    expect(container.querySelector(".landing-split")).toBeNull();
    rerender(<LandingSection id="a" title="A" screen={<ScreenFrame>s</ScreenFrame>} />);
    expect(container.querySelector(".landing-split [data-screen-frame]")).toBeTruthy();
  });
});

describe("DayList", () => {
  it("lists the days in order and names a milestone in words, not by color alone", () => {
    render(
      <DayList
        days={[
          { day: "Day 1", text: "The idea is shaped." },
          { day: "Day 5", text: "Page live.", milestone: true },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["Day 1The idea is shaped.", `Day 5Page live.${DAY_LIST_WORDS.milestone}`]);
  });
});

describe("AssuranceList", () => {
  it("prints every assurance, three of three", () => {
    const items = [
      { icon: Medal, text: "Your first card is free and needs no sign-up" },
      { icon: Lock, text: "Your idea stays private until you choose to share it" },
      { icon: ShieldCheck, text: "Nothing spends money or signs in your name without you" },
    ];
    render(<AssuranceList items={items} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(items.map((i) => i.text));
  });
});

describe("QuestionList", () => {
  const items = [
    { id: "cost", question: "Does it cost anything?", answer: "Starting is free." },
    { id: "solo", question: "Can I do this on my own?", answer: "Yes, all of it." },
  ];
  it("renders native details, closed, with the answer in the server's HTML", () => {
    const html = renderToStaticMarkup(<QuestionList items={items} />);
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toContain(" open");
    expect(html).toContain("Yes, all of it.");
  });
});

describe("landing tokens (DESIGN §9a)", () => {
  const tokens = readFileSync(join(__dirname, "../../tokens.css"), "utf8");
  const value = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
  const blend = (alpha: number, fg: [number, number, number], bg: [number, number, number]) =>
    "#" + fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("");
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

  it("keeps the body at 16 px, the size an iPhone does not zoom a field at", () => {
    expect(value("--fs-landing-body")).toBe("16px");
  });
  it("gives a field's edge 3 : 1 against the canvas (WCAG 1.4.11)", () => {
    const alpha = Number(/rgba\(255, 255, 255, ([\d.]+)\)/.exec(value("--line-control")!)![1]);
    const canvas = value("--canvas")!;
    expect(contrastRatio(blend(alpha, [255, 255, 255], rgb(canvas)), canvas)).toBeGreaterThanOrEqual(3);
  });
  it("puts the filled idea button's label at 4.5 : 1 and its fill at 3 : 1 against the canvas", () => {
    const primary = value("--kit-primary")!;
    expect(contrastRatio(value("--kit-on-primary")!, primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primary, value("--canvas")!)).toBeGreaterThanOrEqual(3);
  });
});
