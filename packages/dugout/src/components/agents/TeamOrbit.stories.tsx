import type { Meta, StoryObj } from "@storybook/react-vite";
import { TeamOrbit } from "./TeamOrbit";

const meta = {
  title: "Agents/Team orbit",
  component: TeamOrbit,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TeamOrbit>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The landing-page hero: the founder at the centre, the Chief of Staff, six department leads and their agents. */
export const Default: Story = { render: (args) => <div className="w-[560px] bg-base p-6"><TeamOrbit {...args} /></div> };
export const Faster: Story = { args: { periodSeconds: 20 }, render: (args) => <div className="w-[560px] bg-base p-6"><TeamOrbit {...args} /></div> };
