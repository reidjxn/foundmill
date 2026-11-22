import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BOOKING_ERRORS, bookingConsentText } from "@foundmill/shared/booking";
import { BookingPage, type BookingPageProps } from "./BookingPage";
import { BOOKING_HELD_SLOT, BOOKING_HOLD_ENDS, BOOKING_SERVICES, BOOKING_SLOTS } from "./fixtures";

const base = (over: Partial<BookingPageProps> = {}): BookingPageProps => ({
  projectName: "Northwind Cleaning",
  brandPrimary: "#2f7d6b",
  brandSecondary: "#f4efe6",
  services: [BOOKING_SERVICES[0]!],
  slots: BOOKING_SLOTS,
  visitorTimeZone: "America/Chicago",
  onSelectService: vi.fn(),
  onNeedSlots: vi.fn(),
  onPickSlot: vi.fn(),
  onSubmit: vi.fn(),
  ...over,
});

describe("BookingPage", () => {
  it("groups slots by the visitor's own calendar day", () => {
    const slots = ["2026-11-24T02:00:00Z"];
    const { unmount } = render(<BookingPage {...base({ slots })} />);
    expect(screen.getByRole("button", { name: "Mon, Nov 23" })).toBeTruthy();
    expect(screen.getByText("8:00 PM")).toBeTruthy();
    expect(screen.getByText("Times shown in Chicago time (CST)")).toBeTruthy();
    unmount();
    render(<BookingPage {...base({ slots, visitorTimeZone: "Europe/Berlin" })} />);
    expect(screen.getByRole("button", { name: "Tue, Nov 24" })).toBeTruthy();
    expect(screen.getByText("3:00 AM")).toBeTruthy();
  });

  it("skips the service step for one service and asks for one when there are several", async () => {
    const onSelectService = vi.fn();
    const { unmount } = render(<BookingPage {...base()} />);
    expect(screen.queryByRole("heading", { name: "Choose a service" })).toBeNull();
    unmount();
    render(<BookingPage {...base({ services: BOOKING_SERVICES, onSelectService })} />);
    await userEvent.click(screen.getByRole("button", { name: /Deep clean/ }));
    expect(onSelectService).toHaveBeenCalledWith("svc-deep");
    expect(screen.getByRole("heading", { name: "Pick a time" })).toBeTruthy();
  });

  it("says so when nothing is open and asks the parent for later dates", async () => {
    const onNeedSlots = vi.fn();
    render(<BookingPage {...base({ slots: [], onNeedSlots, rangeEnd: "2026-12-01T00:00:00Z" })} />);
    expect(screen.getByText("No times are open in the next few weeks.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show later dates" }));
    expect(onNeedSlots).toHaveBeenCalledWith({ from: "2026-12-01T00:00:00.000Z", to: "2026-12-15T00:00:00.000Z" });
  });

  it("holds the picked time, submits the form's values and keeps the trap field", async () => {
    const onPickSlot = vi.fn();
    const onSubmit = vi.fn();
    render(<BookingPage {...base({ onPickSlot, onSubmit, holdExpiresAt: BOOKING_HOLD_ENDS })} />);
    await userEvent.click(screen.getByRole("button", { name: "Tue, Nov 24" }));
    await userEvent.click(screen.getByRole("button", { name: "3:00 PM" }));
    expect(onPickSlot).toHaveBeenCalledWith(BOOKING_HELD_SLOT);
    expect(screen.getByText("We are holding this time for you until 3:55 PM.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Your name"), "Ana Lopez");
    await userEvent.type(screen.getByLabelText("Your email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText(/Do you have pets/), "One cat");
    await userEvent.click(screen.getByRole("checkbox", { name: bookingConsentText("Northwind Cleaning") }));
    expect(document.querySelector('input[name="website"]')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Book this time" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ana Lopez",
      email: "ana@example.com",
      answers: [{ question: "Do you have pets?", answer: "One cat" }],
      consent: true,
      website: "",
      visitorTimeZone: "America/Chicago",
    });
  });

  it("returns to the times with the sentence when the time was just taken", () => {
    const { rerender } = render(<BookingPage {...base({ initialPicked: BOOKING_HELD_SLOT })} />);
    expect(screen.getByRole("button", { name: "Book this time" })).toBeTruthy();
    rerender(<BookingPage {...base({ initialPicked: BOOKING_HELD_SLOT, error: "booking_slot_taken" })} />);
    expect(screen.getByRole("heading", { name: "Pick a time" })).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText(BOOKING_ERRORS.booking_slot_taken)).toBeTruthy();
  });

  it("ends with the confirmation in the visitor's zone", () => {
    render(<BookingPage {...base({ done: { startsAt: BOOKING_HELD_SLOT, email: "ana@example.com" } })} />);
    expect(screen.getByText("You are booked.")).toBeTruthy();
    expect(screen.getByText(/Tue, Nov 24, 3:00 PM CST/)).toBeTruthy();
    expect(screen.getByText("We sent a confirmation to ana@example.com with links to cancel or change it.")).toBeTruthy();
  });
});
