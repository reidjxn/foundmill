import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { StreakStrip } from "./StreakStrip";

const days = ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];
const week = (states: ("visited" | "vacation" | "missed" | "today")[]) => states.map((state, i) => ({ day: `2026-11-${String(6 + i).padStart(2, "0")}`, label: days[i]!, state }));

const meta = {
  title: "Today/StreakStrip",
  component: StreakStrip,
  parameters: {
    docs: {
      description: {
        component: "“Your streak” on Today: days in a row the founder opened the business (packages/shared streak.ts), the last seven days as dots. Vacation days are frozen, never broken. Gold only on a milestone day.",
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
  args: {
    span: 12,
    headline: "5 days in a row",
    line: "Your best yet. Come back tomorrow to keep it going.",
    week: week(["missed", "missed", "visited", "visited", "visited", "visited", "visited"]),
  },
} satisfies Meta<typeof StreakStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Going: Story = {};
export const AtRisk: Story = { args: { headline: "4 days in a row", line: "Open your business today to make it 5 days.", atRisk: true, week: week(["missed", "missed", "visited", "visited", "visited", "visited", "today"]) } };
export const Milestone: Story = { args: { headline: "7 days in a row", line: "You reached 7 days today. Your best yet.", milestone: true, week: week(["visited", "visited", "visited", "visited", "visited", "visited", "visited"]) } };
export const Vacation: Story = { args: { headline: "3 days in a row", line: "Your best is 9 days. Come back tomorrow to keep it going.", week: week(["visited", "vacation", "vacation", "vacation", "visited", "visited", "visited"]) } };
export const Fresh: Story = { args: { headline: "Start a streak today", line: "Open your business each day to build one. Vacation days never break it.", week: week(["missed", "missed", "missed", "missed", "missed", "missed", "today"]) } };
