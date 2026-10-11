import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeskPresence } from "./DeskPresence";
import { CERTIFICATION, JUNO, RESEARCH_AGENT } from "./fixtures";

const meta = {
  title: "Conversation/DeskPresence",
  component: DeskPresence,
  parameters: {
    docs: {
      description: {
        component:
          'The agent at their desk: a live portrait on a halo of their color, name, role, the "AI agent" marker, the state line ("Live · typing", "In a session", "Away", "Down · back 2:30 PM") and the Now card with progress.',
      },
    },
  },
  args: { persona: JUNO },
} satisfies Meta<typeof DeskPresence>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Column: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-start gap-gutter">
      {[
        { ...args },
        { ...args, replying: true },
        { ...args, persona: CERTIFICATION },
        { ...args, persona: { ...RESEARCH_AGENT, presence: "away" as const } },
      ].map((p, i) => (
        <div key={i} className="surface-panel w-48">
          <DeskPresence {...p} layout="column" />
        </div>
      ))}
    </div>
  ),
};
export const Band: Story = {
  args: { layout: "band", replying: true },
  decorators: [
    (Story) => (
      <div className="surface-panel max-w-144">
        <Story />
      </div>
    ),
  ],
};
export const Head: Story = {
  args: { layout: "head", persona: CERTIFICATION },
  decorators: [
    (Story) => (
      <div className="surface-panel max-w-112">
        <Story />
      </div>
    ),
  ],
};
