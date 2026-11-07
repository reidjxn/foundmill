import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { GoalPanel, type GoalPanelGoal, type GoalPanelProposal } from "./GoalPanel";

const proposal: GoalPanelProposal = { id: "g2", sentence: "Get the first 10 paying customers by Dec 19", proposedBy: "Ines Park", because: "Recommended because the first customers tell us what to build next." };
const active: GoalPanelGoal = { id: "g1", sentence: "Get the first 10 paying customers by Dec 19", state: "on_pace", progress: { current: 4, target: 10, valueText: "4 of 10 paying customers", pace: "4 of 10 so far, 38 days left: on pace (Forecast)." } };
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 600));

const meta = {
  title: "Today/GoalPanel",
  component: GoalPanel,
  parameters: {
    docs: {
      description: {
        component:
          "“Your goal” on Today: waiting for the Chief of Staff's proposal, a proposal with Approve this goal (one tap) and Change it (“What should change?”), or the active goal with its progress bar, a pace pill and the pace sentence. A new proposal while a goal is active sits under it. Every sentence comes from packages/shared goals.ts.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageGrid>
        <Story />
      </PageGrid>
    ),
  ],
  args: { active: null, proposed: null, canDecide: true, span: 6, onApprove: () => {}, onRequestChange: wait },
} satisfies Meta<typeof GoalPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before the first round of work after the sign-offs: the Chief of Staff has not proposed yet. */
export const Waiting: Story = {};
/** The Chief of Staff's proposal: one tap to approve, or Change it in the founder's words. */
export const Proposed: Story = { args: { proposed: proposal } };
export const OnPace: Story = { args: { active } };
export const Behind: Story = { args: { active: { ...active, state: "behind", progress: { ...active.progress!, current: 2, valueText: "2 of 10 paying customers", pace: "2 of 10 so far, 38 days left: at this pace about 6 by Dec 19 (Forecast)." } } } };
/** The date passed: the old goal stays while the Chief of Staff proposes a new date under it. */
export const DatePassed: Story = {
  args: {
    active: { ...active, state: "overdue", progress: { ...active.progress!, current: 7, valueText: "7 of 10 paying customers", pace: "Dec 19 passed at 7 of 10." } },
    proposed: { ...proposal, id: "g3", sentence: "Get the first 10 paying customers by Jan 30", because: "Recommended because a goal with a date ahead keeps every round of work pointed the same way." },
  },
};
export const Achieved: Story = { args: { active: { ...active, state: "reached", progress: { ...active.progress!, current: 10, valueText: "10 of 10 paying customers", pace: "Reached on Dec 2, 17 days early." } } } };
/** A viewer or advisor: the proposal, without the answers. */
export const ReadOnly: Story = { args: { proposed: proposal, canDecide: false } };
export const Loading: Story = { args: { loading: true } };
