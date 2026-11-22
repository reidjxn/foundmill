import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { APP_NAME } from "@foundmill/config";
import { BookingPage } from "./BookingPage";
import { BOOKING_HELD_SLOT, BOOKING_HOLD_ENDS, BOOKING_SERVICES, BOOKING_SLOTS, BOOKING_ZONE } from "./fixtures";

const noop = () => {};

/**
 * The visitor's whole booking flow on a project's public page, from 390 px (founder, Nov 22, 2026). Times are in the
 * visitor's own zone (fixed to Chicago here, so the stories do not change with where they run) and the page says so.
 */
const meta = {
  title: "Public/BookingPage",
  component: BookingPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Foundmill's own booking, as a visitor sees it: pick a service (skipped when there is one), a day and a time in their own zone, then name, email, the service's optional questions and one consent box. The parent places the hold and sends the form; this component owns only the step. Real buttons and labels, 44 px targets.",
      },
    },
  },
  args: {
    projectName: "Northwind Cleaning",
    brandPrimary: "#2f7d6b",
    brandSecondary: "#f4efe6",
    variant: "preview",
    services: BOOKING_SERVICES,
    slots: BOOKING_SLOTS,
    visitorTimeZone: BOOKING_ZONE,
    onSelectService: noop,
    onNeedSlots: noop,
    onPickSlot: noop,
    onSubmit: noop,
  },
} satisfies Meta<typeof BookingPage>;
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

export const ChooseService390: Story = { name: "390 px · choose a service", decorators: [Phone] };
export const Times390: Story = { name: "390 px · pick a time", decorators: [Phone], args: { selectedServiceId: "svc-clean" } };
export const OneService390: Story = { name: "390 px · one service skips the first step", decorators: [Phone], args: { services: [BOOKING_SERVICES[2]!] } };
export const TimesLoading390: Story = { name: "390 px · looking for times", decorators: [Phone], args: { selectedServiceId: "svc-clean", slots: [], slotsLoading: true } };
export const NoTimes390: Story = { name: "390 px · no times open", decorators: [Phone], args: { selectedServiceId: "svc-clean", slots: [] } };
export const SlotTaken390: Story = { name: "390 px · that time was just taken", decorators: [Phone], args: { selectedServiceId: "svc-clean", error: "booking_slot_taken" } };
export const Form390: Story = {
  name: "390 px · your details",
  decorators: [Phone],
  args: { selectedServiceId: "svc-clean", initialPicked: BOOKING_HELD_SLOT, holdExpiresAt: BOOKING_HOLD_ENDS, turnstile: <p className="t-small text-secondary">Bot check</p> },
};
export const FormError390: Story = {
  name: "390 px · your details, with an error",
  decorators: [Phone],
  args: { selectedServiceId: "svc-clean", initialPicked: BOOKING_HELD_SLOT, holdExpiresAt: BOOKING_HOLD_ENDS, error: "booking_email" },
};
export const FormSubmitting390: Story = { name: "390 px · sending", decorators: [Phone], args: { selectedServiceId: "svc-clean", initialPicked: BOOKING_HELD_SLOT, holdExpiresAt: BOOKING_HOLD_ENDS, submitting: true } };
export const Unavailable390: Story = { name: "390 px · booking is not available", decorators: [Phone], args: { selectedServiceId: "svc-clean", initialPicked: BOOKING_HELD_SLOT, error: "unavailable" } };
export const Done390: Story = { name: "390 px · booked", decorators: [Phone], args: { selectedServiceId: "svc-clean", done: { startsAt: BOOKING_HELD_SLOT, email: "ana@example.com" } } };
export const MemberMark390: Story = { name: "390 px · the mark for a signed-in member", decorators: [Phone], args: { selectedServiceId: "svc-clean", mark: "member" } };
export const PaidNoMark390: Story = { name: `390 px · no ${APP_NAME} mark`, decorators: [Phone], args: { selectedServiceId: "svc-clean", mark: "none" } };
export const Times1280: Story = { name: "1280 px · pick a time", decorators: [Desktop], args: { selectedServiceId: "svc-clean" } };
export const Form1280: Story = { name: "1280 px · your details", decorators: [Desktop], args: { selectedServiceId: "svc-clean", initialPicked: BOOKING_HELD_SLOT, holdExpiresAt: BOOKING_HOLD_ENDS } };
export const Berlin390: Story = { name: "390 px · a visitor in Berlin", decorators: [Phone], args: { selectedServiceId: "svc-clean", visitorTimeZone: "Europe/Berlin" } };
