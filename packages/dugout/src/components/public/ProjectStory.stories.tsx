import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { ProjectStory } from "./ProjectStory";

/**
 * A project's story at the two widths it is checked at: 390 px (a phone, the smallest the outer product supports) and
 * 1280 px. The frame sets the width; the page lays itself out from its own width (a container query).
 */
const meta = {
  title: "Public/ProjectStory",
  component: ProjectStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A project's story at `/p/<slug>/story` (docs/NETWORK.md F2): the logo and name linking back to the project's page, “How ‹name› was built”, one sentence saying what verified means, then the milestones the founders chose to show, oldest first, each a date, its words and “Verified by Foundmill” (an icon and the words). It ends with a link back to the page and, for a project on the free plan, one small line with “Start your own”. Nothing is counted. Brand colors are accents only. Server-safe.",
      },
    },
  },
  args: {
    name: "Northwind Skincare",
    brandPrimary: "#2f7d6b",
    brandSecondary: "#f4efe6",
    logo: null,
    pageHref: "#",
    startHref: "#",
    variant: "preview",
    milestones: [
      { id: "m1", key: "page_live", label: "Page live", achievedAt: new Date(2026, 10, 12, 9) },
      { id: "m2", key: "first_follower", label: "First follower", achievedAt: new Date(2026, 10, 14, 8) },
      { id: "m3", key: "customer_1", label: "First customer", achievedAt: new Date(2026, 10, 19, 10) },
    ],
  },
} satisfies Meta<typeof ProjectStory>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="w-phone border-x border-line">
    <Story />
  </div>
);
const Desktop: Decorator = (Story) => (
  <div className="w-desktop">
    <Story />
  </div>
);

export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Desktop1280: Story = { name: "1280 px", decorators: [Desktop] };
export const OneMilestone390: Story = {
  name: "390 px · the first milestone only",
  decorators: [Phone],
  args: { milestones: [{ id: "m1", key: "page_live", label: "Page live", achievedAt: new Date(2026, 10, 12, 9) }] },
};
export const MarkForMember390: Story = {
  name: "390 px · the foot for a signed-in member (the sentence, no link)",
  decorators: [Phone],
  args: { mark: "member" },
};
export const PaidPlanNoMark390: Story = {
  name: "390 px · a paid plan (verified stays, no foot)",
  decorators: [Phone],
  args: { mark: "none" },
};
export const LongWords1280: Story = {
  name: "1280 px · long words wrap",
  decorators: [Desktop],
  args: {
    name: "Supercalifragilisticexpialidocious Studio",
    milestones: [
      { id: "m1", key: "page_live", label: "Page live", achievedAt: new Date(2026, 9, 7, 9) },
      { id: "m2", key: "mrr_1k", label: "First $1K monthly revenue", achievedAt: new Date(2027, 1, 1, 0) },
      { id: "m3", key: "first_enterprise_contract", label: "First enterprise contract", achievedAt: new Date(2027, 2, 3, 12) },
    ],
  },
};
