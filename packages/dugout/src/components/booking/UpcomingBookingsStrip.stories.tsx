import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { BOOKING_ZONE, FOUNDER_BOOKINGS } from "./fixtures";
import { UpcomingBookingsStrip } from "./UpcomingBookingsStrip";

const Desktop: Decorator = (Story) => (
  <div className="w-96 bg-canvas p-6">
    <Story />
  </div>
);

const meta = {
  title: "Console/UpcomingBookingsStrip",
  component: UpcomingBookingsStrip,
  decorators: [Desktop],
  parameters: { docs: { description: { component: "Today's bookings, up to three, with a link to all of them. Draws nothing when there are none." } } },
  args: { bookings: FOUNDER_BOOKINGS.slice(0, 2), timeZone: BOOKING_ZONE, href: "#bookings" },
} satisfies Meta<typeof UpcomingBookingsStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Today1280: Story = { name: "1280 px · two today" };
export const ThreeOrMore1280: Story = { name: "1280 px · only three show", args: { bookings: [...FOUNDER_BOOKINGS, { ...FOUNDER_BOOKINGS[0]!, id: "b9" }] } };
export const None1280: Story = { name: "1280 px · none (nothing is drawn)", args: { bookings: [] } };
