import type { Meta, StoryObj } from "@storybook/react-vite";
import { Briefcase, Clock, Hourglass, Moon } from "lucide-react";
import { RadioCard, RadioGroup, RadioGroupItem, RadioOption } from "./RadioGroup";

const meta = {
  title: "Foundation/RadioGroup",
  component: RadioGroup,
} satisfies Meta<typeof RadioGroup>;
export default meta;

type Story = StoryObj<typeof meta>;

export const ApplyScope: Story = {
  render: () => (
    <RadioGroup defaultValue="one" aria-label="Apply to">
      <RadioOption id="one" value="one" label="This agent only" />
      <RadioOption id="type" value="type" label="Apply to all worker agents" description="12 agents in this business" />
      <RadioOption id="all" value="all" label="Apply to all agents" description="Includes the Chief of Staff" />
      <RadioOption id="off" value="off" label="Not available in Augmented mode" disabled />
    </RadioGroup>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <RadioGroup defaultValue="assisted" aria-label="Business mode" className="grid-flow-col">
      {["augmented", "assisted", "automated"].map((m) => (
        <label key={m} className="flex items-center gap-2 text-body capitalize">
          <RadioGroupItem value={m} /> {m}
        </label>
      ))}
    </RadioGroup>
  ),
};

/**
 * Radio cards: the whole card is the target. Selected: an accent fill, a 55% ring with a halo and glow, and the
 * filled radio with its ink center, so shape and color both carry the state.
 */
export const Cards: Story = {
  render: () => (
    <RadioGroup defaultValue="full_time" aria-label="Time commitment" className="w-full grid-cols-4">
      <RadioCard value="full_time" label="Full time" description="40 hours a week or more" icon={Briefcase} />
      <RadioCard value="part_time" label="Part time" description="15 to 30 hours a week" icon={Clock} />
      <RadioCard value="evenings" label="Evenings and weekends" description="Around 10 hours a week" icon={Moon} />
      <RadioCard value="few_hours" label="A few hours a week" description="The team does most of the work" icon={Hourglass} />
    </RadioGroup>
  ),
};
