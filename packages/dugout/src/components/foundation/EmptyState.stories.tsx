import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEPT_COLOUR_TOKENS } from "@foundmill/shared";
import { FileText, Inbox, Plus, Users } from "lucide-react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Foundation/EmptyState",
  component: EmptyState,
  parameters: {
    docs: {
      description: {
        component:
          "A 20 px icon on a soft disc of department light, one line saying what will appear and how, and one small button or an action slot (a generate control when the team can fill the panel). Server-safe.",
      },
    },
  },
  args: { icon: Inbox, children: "Inbox items appear here after the first round of work. Press Space to continue." },
  argTypes: { icon: { control: false }, tone: { control: "select", options: ["neutral", "kit", ...DEPT_COLOUR_TOKENS] } },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithAction: Story = {
  args: {
    icon: Users,
    tone: "dept-1",
    title: "No agents yet",
    children: "Hire your first agent and the Chief of Staff will plan the first round of work.",
    action: { label: "Hire agent", icon: Plus },
  },
};
/** The team can fill this panel: the action slot holds a generate control named for the agent who will draft. */
export const DraftWithAgent: Story = {
  args: {
    icon: FileText,
    tone: "dept-3",
    children: "No pitch for Boots UK yet. Juno can draft one from the trial model.",
    actions: (
      <Button size="sm" variant="generate">
        Draft with Juno
      </Button>
    ),
  },
};
export const Tones: Story = {
  render: () => (
    <div className="grid grid-cols-5 gap-3">
      {(["neutral", "kit", ...DEPT_COLOUR_TOKENS] as const).map((tone) => (
        <div key={tone} className="surface-panel">
          <EmptyState icon={Inbox} tone={tone} compact>
            {tone}
          </EmptyState>
        </div>
      ))}
    </div>
  ),
};
export const InPanel: Story = {
  render: (args) => (
    <div className="surface-panel w-96">
      <div className="flex h-panel-header items-center px-3 rule-fade">
        <span className="t-title">Inbox preview</span>
      </div>
      <EmptyState {...args} />
    </div>
  ),
};
