import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { BookingBlock } from "./BookingBlock";
import { BOOKING_SERVICES } from "./fixtures";

const meta = {
  title: "Public/BookingBlock",
  component: BookingBlock,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "The block on a project's public page that leads to booking: a heading, up to three services with their length and price, and one link to the open times. Server-safe." } },
  },
  args: { services: BOOKING_SERVICES, href: "#book" },
} satisfies Meta<typeof BookingBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line bg-canvas p-4">
    <Story />
  </div>
);
const Desktop: Decorator = (Story) => (
  <div className="@container w-desktop bg-canvas p-8">
    <Story />
  </div>
);

export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Desktop1280: Story = { name: "1280 px", decorators: [Desktop] };
export const OneFree390: Story = { name: "390 px · one free service", decorators: [Phone], args: { services: [BOOKING_SERVICES[2]!] } };
export const MoreThanThree390: Story = {
  name: "390 px · more than three services",
  decorators: [Phone],
  args: { services: [...BOOKING_SERVICES, { ...BOOKING_SERVICES[0]!, id: "x", name: "Windows" }, { ...BOOKING_SERVICES[0]!, id: "y", name: "Move-out clean" }] },
};
