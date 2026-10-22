import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { cn } from "../../lib/cn";
import { ratingClass } from "../../lib/rating";
import { ScaleLabel } from "../guidance/ScaleLabel";
import { RatingBandPill, SKILL_SCALE_LEGEND, SkillSlider } from "./SkillSlider";

const meta = {
  title: "Foundation/SkillSlider",
  component: SkillSlider,
  args: { defaultValue: 13, "aria-label": "Sales rating" },
} satisfies Meta<typeof SkillSlider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div className="w-96"><SkillSlider {...args} /></div> };

const SKILLS = [
  ["Engineering", "Can you ship, review and maintain software?", 9],
  ["Sales", "Can you find, pitch and close customers?", 13],
  ["Design", "Product, brand and interface taste.", 11],
  ["Finance", "Cash, pricing, forecasts and fundraising.", 10],
  ["Domain", "How deep is your knowledge of the market?", 16],
] as const;

function Row({ name, hint, initial }: { name: string; hint: string; initial: number }) {
  const [v, setV] = useState(initial);
  return (
    <div className="grid grid-cols-4 items-center gap-4">
      <div>
        <div className="font-medium">{name}</div>
        <div className="text-small text-tertiary">{hint}</div>
      </div>
      <SkillSlider value={v} onValueChange={setV} aria-label={`${name} rating`} className="col-span-2" />
      <div className="flex items-center gap-3">
        <span className={cn("t-display-md w-8 text-right", ratingClass(v))}>{v}</span>
        <RatingBandPill value={v} />
      </div>
    </div>
  );
}

/**
 * The founder profile's skills: the 20 cells are the track; the thumb springs cell to cell; focus shows "← → to
 * adjust". The figure and the band word carry the value with the color.
 */
export const ProfileSkills: Story = {
  render: () => (
    <div className="surface-panel flex w-full flex-col gap-3 p-4 text-body">
      {SKILLS.map(([n, h, v]) => (
        <Row key={n} name={n} hint={h} initial={v} />
      ))}
    </div>
  ),
};

function AnchoredRow({ name, hint, initial }: { name: string; hint: string; initial: number }) {
  const [v, setV] = useState(initial);
  return (
    <div className="grid grid-cols-12 items-end gap-4">
      <div className="col-span-3 min-w-0">
        <div className="font-medium">{name}</div>
        <div className="text-small text-tertiary">{hint}</div>
      </div>
      <SkillSlider value={v} onValueChange={setV} anchors aria-label={`${name} rating`} anchorsLabel={`${name}: level`} className="col-span-6" />
      <span className={cn("col-span-1 t-display-md pb-2 text-right", ratingClass(v))}>{v}</span>
      <div className="col-span-2 flex items-center pb-2">
        <ScaleLabel value={v} />
      </div>
    </div>
  );
}

/**
 * With `anchors` (UX plan §7.3, A2): the legend once above the rows, then a four-word picker over every bar. A word
 * sets the number (None 3, Some 8, Solid 13, Expert 18); moving the slider keeps the word in step; the band word
 * (ScaleLabel) carries the meaning beside the figure.
 */
export const WithAnchors: Story = {
  name: "With anchors (the founder profile)",
  render: () => (
    <div className="surface-panel flex w-full flex-col gap-4 p-4 text-body">
      <div className="flex flex-col gap-1">
        <p className="text-small text-secondary">{SKILL_SCALE_LEGEND}</p>
        <p className="text-small text-secondary">Be honest: the team hires to cover what you don't have.</p>
      </div>
      {SKILLS.map(([n, h, v]) => (
        <AnchoredRow key={n} name={n} hint={h} initial={v} />
      ))}
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true }, render: (args) => <div className="w-96"><SkillSlider {...args} /></div> };
