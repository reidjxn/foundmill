import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { cn } from "../../lib/cn";
import { ratingClass } from "../../lib/rating";
import { RatingBandPill, SkillSlider } from "./SkillSlider";

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
 * adjust". The figure and the band word carry the value with the colour.
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

export const Disabled: Story = { args: { disabled: true }, render: (args) => <div className="w-96"><SkillSlider {...args} /></div> };
