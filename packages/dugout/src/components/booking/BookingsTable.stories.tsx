import { useState, type ComponentProps } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { BookingsTable, type BookingsWhen } from "./BookingsTable";
import { BOOKING_ZONE, FOUNDER_BOOKINGS, PAST_BOOKINGS } from "./fixtures";

const noop = () => {};

const Desktop: Decorator = (Story) => (
  <div className="w-desktop bg-canvas p-6">
    <Story />
  </div>
);

const meta = {
  title: "Console/BookingsTable",
  component: BookingsTable,
  decorators: [Desktop],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Upcoming and past bookings in a DataTable with saved views and the row menu. A booking's answers open under it as the customer's own words. Cancel asks first and says the customer is told by email. A test booking is marked and not counted." } },
  },
  args: { bookings: FOUNDER_BOOKINGS, when: "upcoming", onWhenChange: noop, timeZone: BOOKING_ZONE, onCancel: noop, onMove: noop, onNoShow: noop },
} satisfies Meta<typeof BookingsTable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Upcoming1280: Story = { name: "1280 px · upcoming" };
export const Past1280: Story = { name: "1280 px · past", args: { when: "past", bookings: PAST_BOOKINGS } };
export const ReadOnly1280: Story = { name: "1280 px · a member who may only read", args: { readOnly: true } };
export const Empty1280: Story = { name: "1280 px · no bookings yet", args: { bookings: [] } };
export const Loading1280: Story = { name: "1280 px · loading", args: { loading: true, bookings: [] } };
function Switching(args: ComponentProps<typeof BookingsTable>) {
  const [when, setWhen] = useState<BookingsWhen>("upcoming");
  return <BookingsTable {...args} when={when} onWhenChange={setWhen} bookings={when === "upcoming" ? FOUNDER_BOOKINGS : PAST_BOOKINGS} />;
}
export const Switching1280: Story = { name: "1280 px · switching between the two", render: (args) => <Switching {...args} /> };
