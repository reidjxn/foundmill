import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { MilestoneCard } from "./MilestoneCard";

/**
 * A milestone's card at the two widths it is checked at: 390 px (a phone, the smallest the outer product supports) and
 * 1280 px. The frame sets the width; the card lays itself out from its own width (a container query).
 */
const meta = {
  title: "Public/MilestoneCard",
  component: MilestoneCard,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A milestone's card at `/m/<id>` (docs/NETWORK.md F3): the project's logo and name, the milestone's words as the headline, the day it was reached, “Verified by Foundmill” (an icon and the words) with one sentence saying what that means, “See ‹name›” to the project's page, the project's story, and, for a project on the free plan, one small line with “Start your own”. A milestone about a customer never names the customer. Nothing is counted. Server-safe.",
      },
    },
  },
  args: {
    name: "Northwind Skincare",
    label: "First follower",
    milestoneKey: "first_follower",
    achievedAt: new Date(2026, 10, 14, 8),
    brandPrimary: "#2f7d6b",
    brandSecondary: "#f4efe6",
    logo: null,
    pageHref: "#",
    storyHref: "#",
    startHref: "#",
    variant: "preview",
  },
} satisfies Meta<typeof MilestoneCard>;
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
export const PageLive390: Story = { name: "390 px · page live", decorators: [Phone], args: { label: "Page live", milestoneKey: "page_live", achievedAt: new Date(2026, 10, 12, 9) } };
export const Customer1280: Story = { name: "1280 px · a customer milestone (the words and the date only)", decorators: [Desktop], args: { label: "First customer", milestoneKey: "customer_1", achievedAt: new Date(2026, 10, 19, 10) } };
export const MarkForMember390: Story = { name: "390 px · the foot for a signed-in member (the sentence, no link)", decorators: [Phone], args: { mark: "member" } };
export const PaidPlanNoMark390: Story = { name: "390 px · a paid plan (verified stays, no foot)", decorators: [Phone], args: { mark: "none" } };
export const LongWords390: Story = {
  name: "390 px · long words wrap",
  decorators: [Phone],
  args: { name: "Supercalifragilisticexpialidocious Studio", label: "First $100K monthly revenue", milestoneKey: "mrr_100k" },
};
