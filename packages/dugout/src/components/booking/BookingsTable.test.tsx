import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingsTable, type BookingsTableProps } from "./BookingsTable";
import { BOOKING_ZONE, FOUNDER_BOOKINGS, PAST_BOOKINGS } from "./fixtures";

const base = (over: Partial<BookingsTableProps> = {}): BookingsTableProps => ({ bookings: FOUNDER_BOOKINGS, when: "upcoming", onWhenChange: vi.fn(), timeZone: BOOKING_ZONE, onCancel: vi.fn(), onMove: vi.fn(), onNoShow: vi.fn(), ...over });

describe("BookingsTable", () => {
  it("shows the empty sentence", () => {
    render(<BookingsTable {...base({ bookings: [] })} />);
    expect(screen.getByText("No bookings yet. When someone books a time on your page, it shows here.")).toBeTruthy();
  });

  it("lists bookings in the founder's zone, marks a test one, and asks before it cancels", async () => {
    const onCancel = vi.fn();
    render(<BookingsTable {...base({ onCancel })} />);
    expect(screen.getByText("Mon, Nov 23, 2:00 PM")).toBeTruthy();
    expect(screen.getByText("Test")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Standard clean, Ana Lopez" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText(/The customer is told by email\./)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(onCancel).toHaveBeenCalledWith("b1");
  });

  it("has no row menu for a member who may only read", () => {
    render(<BookingsTable {...base({ readOnly: true })} />);
    expect(screen.queryByRole("button", { name: "Actions for Standard clean, Ana Lopez" })).toBeNull();
    expect(screen.getByText("Mon, Nov 23, 2:00 PM")).toBeTruthy();
  });

  it("offers Did not show for a confirmed past booking", async () => {
    const onNoShow = vi.fn();
    render(<BookingsTable {...base({ when: "past", bookings: PAST_BOOKINGS, onNoShow })} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Standard clean, Ana Lopez" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Did not show" }));
    expect(onNoShow).toHaveBeenCalledWith("p1");
  });
});
