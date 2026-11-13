import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { WeekPlan } from "./WeekPlan";

/** A 390 px phone frame that is its own container, so the panel lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/WeekPlan",
  component: WeekPlan,
  parameters: {
    docs: {
      description: {
        component: "“This week and next” on Today: three to five plain sentences from data (packages/shared today-words.ts), no model call. A planned date carries “(Estimate)”.",
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
    done: ["This week the team finished 6 pieces of work, 4 of them for “Online booking”.", "2 pieces of work are waiting on something before they can go on."],
    next: ["Next: Set up card payments, starting this round.", "“Online booking” is planned for Dec 4 (Estimate).", "The next round starts on its own in a moment."],
  },
} satisfies Meta<typeof WeekPlan>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FullWeek: Story = {};
export const FirstDay: Story = { args: { done: ["Nothing is finished yet: the first round of work starts when you press Continue."], next: ["Nothing is queued yet: the next round of work plans what comes after.", "Press Continue and the team keeps going until nothing is left."] } };
export const Autopilot: Story = { args: { done: ["This week the team finished 3 pieces of work."], next: ["Now: Write the booking page.", "Autopilot starts the next round tomorrow (Estimate)."] } };
export const NoAccess: Story = { args: { done: [], next: [], empty: "Members who can read Development see the week here." } };
export const Loading: Story = { args: { loading: true } };
export const Phone390: Story = { name: "390 px", decorators: [Phone], args: {} };
