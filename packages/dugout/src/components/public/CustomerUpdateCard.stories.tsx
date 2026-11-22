import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { CustomerUpdateCard } from "./CustomerUpdateCard";

/**
 * A shared Customer Update at the two widths it is checked at: 390 px (a phone, the smallest the outer product
 * supports) and 1280 px. The frame sets the width; the card lays itself out from its own width (a container query).
 */
const meta = {
  title: "Public/CustomerUpdateCard",
  component: CustomerUpdateCard,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A Customer Update a founder shared, at `/m/update/<id>` (WP-14 T9; DESIGN §9f): the project's logo and name, the day, what happened as the headline, “Verified by Foundmill” with what it means, the lead channel and the standout agent (always labeled an AI agent), and the founders' own line when they wrote one. It has no prop for the customer, the amount or a count. Server-safe.",
      },
    },
  },
  args: {
    name: "Northwind Skincare",
    headline: "new_customer",
    occurredOn: "2026-11-12",
    leadChannelKey: "seo",
    standoutAgent: "Search Writer",
    verified: true,
    note: null,
    brandPrimary: "#2f7d6b",
    brandSecondary: "#f4efe6",
    logo: null,
    pageHref: "#",
    startHref: "#",
    variant: "preview",
  },
} satisfies Meta<typeof CustomerUpdateCard>;
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
export const WithNote390: Story = { name: "390 px · with the founders' own line", decorators: [Phone], args: { note: "Our first order from outside our own town. Thank you." } };
export const Returning1280: Story = { name: "1280 px · a customer who came back", decorators: [Desktop], args: { headline: "returning_customer", leadChannelKey: "email_automation", standoutAgent: "Email Marketer" } };
export const NoTouches390: Story = { name: "390 px · no measured touch (the day and the headline only)", decorators: [Phone], args: { leadChannelKey: null, standoutAgent: null } };
export const MarkForMember390: Story = { name: "390 px · the foot for a signed-in member (the sentence, no link)", decorators: [Phone], args: { mark: "member" } };
export const Recorded390: Story = { name: "390 px · recorded, not verified (a pasted Stripe key)", decorators: [Phone], args: { verified: false } };
export const NoMark390: Story = { name: "390 px · no mark (verified stays, no foot)", decorators: [Phone], args: { mark: "none" } };
export const LongWords390: Story = {
  name: "390 px · long words wrap",
  decorators: [Phone],
  args: { name: "Supercalifragilisticexpialidocious Studio", standoutAgent: "Lifecycle and Retention Email Marketing Specialist", note: "Thankyouthankyouthankyouthankyouthankyouthankyouthankyouthankyou for the order" },
};
