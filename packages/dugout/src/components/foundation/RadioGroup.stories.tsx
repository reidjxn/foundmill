import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioGroup, RadioGroupItem, RadioOption } from "./RadioGroup";

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
