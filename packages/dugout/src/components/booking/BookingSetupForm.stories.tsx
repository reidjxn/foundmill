import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { BookingSetupForm } from "./BookingSetupForm";
import { BOOKING_SETUP_DRAFT, TIME_ZONES } from "./fixtures";

const noop = () => {};

const Desktop: Decorator = (Story) => (
  <div className="w-desktop bg-canvas p-6">
    <Story />
  </div>
);

const meta = {
  title: "Console/BookingSetupForm",
  component: BookingSetupForm,
  decorators: [Desktop],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Booking setup in the console, 1280 px and wider: time zone, weekly hours in 30-minute steps, services (price, length, buffers, notice, questions) and the calendar switch. Turning booking on needs the page published and the changes saved." } },
  },
  args: { draft: BOOKING_SETUP_DRAFT, status: "draft", timeZones: TIME_ZONES, calendarConnected: true, pagePublished: true, onSave: noop, onSetLive: noop },
} satisfies Meta<typeof BookingSetupForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Draft1280: Story = { name: "1280 px · draft" };
export const Live1280: Story = { name: "1280 px · live", args: { status: "live", liveSince: "2026-11-23T18:00:00Z" } };
export const DraftedByTeam1280: Story = { name: "1280 px · drafted by the team", args: { draftedByTeam: true } };
export const CalendarNotConnected1280: Story = { name: "1280 px · calendar not connected", args: { calendarConnected: false } };
export const PageNotPublished1280: Story = { name: "1280 px · page not published", args: { pagePublished: false } };
export const InvalidHours1280: Story = { name: "1280 px · hours that do not work", args: { draft: { ...BOOKING_SETUP_DRAFT, weeklyHours: { "1": [{ start: 600, end: 600 }] } } } };
export const Empty1280: Story = { name: "1280 px · no services yet", args: { draft: { ...BOOKING_SETUP_DRAFT, services: [] } } };
