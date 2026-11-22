import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { ManageBooking } from "./ManageBooking";
import { BOOKING_SLOTS, BOOKING_ZONE, MANAGED_BOOKING } from "./fixtures";

const noop = () => {};

const meta = {
  title: "Public/ManageBooking",
  component: ManageBooking,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "What a customer sees from the link in their confirmation email: the booking in their own zone, then Cancel (with its confirm step on the page) and Pick another time, or the reason it can no longer be changed online." } },
  },
  args: {
    booking: MANAGED_BOOKING,
    timeZone: BOOKING_ZONE,
    slots: BOOKING_SLOTS,
    brandPrimary: "#2f7d6b",
    brandSecondary: "#f4efe6",
    variant: "preview",
    onCancel: noop,
    onReschedule: noop,
    onNeedSlots: noop,
  },
} satisfies Meta<typeof ManageBooking>;
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
export const Confirm390: Story = { name: "390 px · confirm the cancel", decorators: [Phone], args: { initialMode: "cancel" } };
export const Pick390: Story = { name: "390 px · pick another time", decorators: [Phone], args: { initialMode: "pick" } };
export const TooLate390: Story = { name: "390 px · too close to change", decorators: [Phone], args: { booking: { ...MANAGED_BOOKING, canChange: false } } };
export const Canceled390: Story = { name: "390 px · canceled", decorators: [Phone], args: { booking: { ...MANAGED_BOOKING, status: "canceled", canChange: false } } };
export const JustCanceled390: Story = { name: "390 px · just canceled", decorators: [Phone], args: { result: { kind: "canceled" } } };
export const Moved390: Story = { name: "390 px · moved", decorators: [Phone], args: { result: { kind: "rescheduled", startsAt: "2026-11-26T15:00:00Z" } } };
export const Passed390: Story = { name: "390 px · passed", decorators: [Phone], args: { booking: { ...MANAGED_BOOKING, status: "completed", canChange: false } } };
export const Error390: Story = { name: "390 px · that time was just taken", decorators: [Phone], args: { initialMode: "pick", error: "booking_slot_taken" } };
export const NoBrand390: Story = { name: "390 px · no marks, no brand", decorators: [Phone], args: { brandPrimary: undefined, brandSecondary: undefined, mark: "none" } };
