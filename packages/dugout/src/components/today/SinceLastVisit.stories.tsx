import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { SinceLastVisit } from "./SinceLastVisit";

const meta = {
  title: "Today/SinceLastVisit",
  component: SinceLastVisit,
  parameters: {
    docs: {
      description: {
        component: "“Since you were last here” on Today: what the team did between the founder's previous visit and now, from data. Shown only when something happened; spend says Estimate.",
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
    meta: "Since Tue, Nov 10, 6:42 PM",
    lines: [
      { id: "work", text: "3 rounds of work, 7 tasks done." },
      { id: "wins", text: "1 customer won.", tone: "gold", link: { href: "#inbox", label: "Open" } },
      { id: "decisions", text: "2 new decisions need you.", link: { href: "#needs-you", label: "Answer" } },
      { id: "milestone-0", text: "Milestone: First customer.", tone: "gold", link: { href: "#milestones", label: "See" } },
      { id: "spend", text: "Team spend $0.42 (Estimate)." },
    ],
  },
} satisfies Meta<typeof SinceLastVisit>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BusyNight: Story = {};
export const QuietWork: Story = { args: { lines: [{ id: "work", text: "1 round of work, 2 tasks done." }] } };
export const NothingHappened: Story = { args: { lines: [] } };
