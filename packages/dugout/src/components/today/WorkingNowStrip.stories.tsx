import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { WorkingNowStrip } from "./WorkingNowStrip";

/** A 390 px phone frame that is its own container, so the strip lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/WorkingNowStrip",
  component: WorkingNowStrip,
  parameters: {
    docs: {
      description: {
        component: "A quiet strip on Today while the team is working: one line for each agent with what it is doing in the founder's words. No panel, no progress, no cost. With nobody working it renders nothing.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="@container">
        <PageGrid>
          <Story />
        </PageGrid>
      </div>
    ),
  ],
  args: {
    span: 12,
    href: "#working-now",
    lines: [
      { id: "a1", agent: "Rhea Stone", doing: "Set up card payments" },
      { id: "a2", agent: "Page Designer", doing: "Draft the pricing page" },
      { id: "a3", agent: "Product Researcher", doing: "Read what five competitors charge" },
    ],
  },
} satisfies Meta<typeof WorkingNowStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const OneAgent: Story = { name: "One agent", args: { lines: [{ id: "a1", agent: "Rhea Stone", doing: "Set up card payments" }] } };
export const NobodyWorking: Story = { name: "Nobody working (renders nothing)", args: { lines: [] } };
export const Phone390: Story = { name: "390 px", decorators: [Phone] };
