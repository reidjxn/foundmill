import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { FirstWeekTimeline, type FirstWeekTimelineStep } from "./FirstWeekTimeline";

const steps = (states: [FirstWeekTimelineStep["state"], FirstWeekTimelineStep["state"], FirstWeekTimelineStep["state"]]): FirstWeekTimelineStep[] => [
  { id: "day1", label: "Day 1", state: states[0], when: states[0] === "done" ? "Done Oct 7" : "Oct 7 (Estimate)", team: "Your team drafts the specification and the roadmap.", asks: "You are asked to sign off the specification and the roadmap." },
  { id: "days2to3", label: "Days 2–3", state: states[1], when: states[1] === "done" ? "Done Oct 9" : "Oct 8 – 9 (Estimate)", team: "Your team builds the first pieces of work and plans the channels for finding customers.", asks: "You are asked to approve your first goal, once your Chief of Staff proposes it, and the first changes going live." },
  { id: "week1", label: "Week 1", state: states[2], when: "Oct 10 – 13 (Estimate)", team: "Your team starts approaching the first customers.", asks: "You are asked “Ready to start selling?” and about any spend over your limit." },
];

/** A 390 px phone frame that is its own container, so the panel lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/FirstWeekTimeline",
  component: FirstWeekTimeline,
  parameters: { docs: { description: { component: "“Your first week” on Today: Day 1, Days 2–3 and Week 1, each with its state, its date (real when done, an Estimate otherwise), what the team does and what the founder will be asked. Words from packages/shared first-week.ts." } } },
  decorators: [
    (Story) => (
      <div className="@container">
        <PageGrid>
          <Story />
        </PageGrid>
      </div>
    ),
  ],
  args: { span: 12, steps: steps(["now", "next", "next"]) },
} satisfies Meta<typeof FirstWeekTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DayOne: Story = {};
export const MidWeek: Story = { args: { steps: steps(["done", "done", "now"]) } };
export const Paused: Story = { args: { paused: "The team is stopped, so nothing moves on until you resume it." } };
export const Phone390: Story = { name: "390 px", decorators: [Phone], args: {} };
