import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { StreakStrip } from "./StreakStrip";

const days = ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];
/** The days of the week the founder opened the business: `true` for each one (only those are drawn). */
const opened = (flags: boolean[]) => flags.flatMap((on, i) => (on ? [{ day: `2026-11-${String(6 + i).padStart(2, "0")}`, label: days[i]! }] : []));

/** A 390 px phone frame that is its own container, so the panel lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/StreakStrip",
  component: StreakStrip,
  parameters: {
    docs: {
      description: {
        component: "“Your streak” on Today, from the project's second day: one quiet line with the days in a row the founder opened the business (packages/shared streak.ts) and a dot for each day of the last seven they came. Days missed are not drawn and nothing warns that it may end (WP-04 D5). Gold only on a milestone day.",
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
    headline: "5 days in a row",
    line: "Your best yet. Come back tomorrow to keep it going.",
    opened: opened([false, false, true, true, true, true, true]),
  },
} satisfies Meta<typeof StreakStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Going: Story = {};
export const SecondDay: Story = { name: "Second day", args: { headline: "2 days in a row", line: "Your best yet. Come back tomorrow to keep it going.", opened: opened([false, false, false, false, false, true, true]) } };
export const Milestone: Story = { args: { headline: "7 days in a row", line: "You reached 7 days today. Your best yet.", milestone: true, opened: opened([true, true, true, true, true, true, true]) } };
export const Vacation: Story = { args: { headline: "3 days in a row", line: "Your best is 9 days. Come back tomorrow to keep it going.", opened: opened([true, false, false, false, true, true, true]) } };
export const Phone390: Story = { name: "390 px", decorators: [Phone], args: {} };
