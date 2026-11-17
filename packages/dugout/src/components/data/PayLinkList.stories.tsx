import type { Meta, StoryObj } from "@storybook/react-vite";
import { PayLinkList } from "./PayLinkList";

/** Product › Site › Pay buttons (WP-07 T7): the project's payment links and the buttons that use them. */
const meta = {
  title: "Data/PayLinkList",
  component: PayLinkList,
  parameters: {
    docs: {
      description: {
        component:
          "A founder pastes a payment link from their own Stripe account; the team puts a button for it on the site (`/_fm/pay/<key>`). A simulated link is listed as never shown on the site. Only an owner or an admin adds or removes links.",
      },
    },
  },
  args: {
    items: [],
    canEdit: true,
    onAdd: async () => {},
    onRemove: () => {},
  },
} satisfies Meta<typeof PayLinkList>;
export default meta;
type Story = StoryObj<typeof meta>;

const ITEMS = [
  { id: "l1", key: "starter-kit", label: "Starter kit", source: "pasted" as const, simulated: false },
  { id: "l2", key: "coffee-box", label: "Monthly coffee box", source: "stripe" as const, simulated: false },
];

export const Empty: Story = {};
export const WithPayButtons: Story = { name: "With pay buttons", args: { items: ITEMS } };
export const WithSimulated: Story = { name: "With a simulated link", args: { items: [...ITEMS, { id: "l3", key: "sample", label: "Sample box", source: "stripe", simulated: true }] } };
export const ReadOnly: Story = { name: "Read-only (not an owner or admin)", args: { items: ITEMS, canEdit: false } };
export const WithError: Story = { name: "With an error", args: { items: ITEMS, error: "Only Stripe payment links (buy.stripe.com) can be added for now." } };
