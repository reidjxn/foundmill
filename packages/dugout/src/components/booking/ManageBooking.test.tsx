import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BOOKING_ERRORS } from "@foundmill/shared/booking";
import { ManageBooking } from "./ManageBooking";
import { BOOKING_SLOTS, BOOKING_ZONE, MANAGED_BOOKING } from "./fixtures";

const props = { booking: MANAGED_BOOKING, timeZone: BOOKING_ZONE, slots: BOOKING_SLOTS, onCancel: vi.fn(), onReschedule: vi.fn() };

describe("ManageBooking", () => {
  it("shows the facts in the customer's zone and both actions while it can change", () => {
    render(<ManageBooking {...props} />);
    expect(screen.getByText(/Tue, Nov 24, 3:00 PM CST/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel this booking" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pick another time" })).toBeTruthy();
  });

  it("hides the actions and says why when it can no longer change", () => {
    render(<ManageBooking {...props} booking={{ ...MANAGED_BOOKING, canChange: false }} />);
    expect(screen.queryByRole("button", { name: "Cancel this booking" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pick another time" })).toBeNull();
    expect(screen.getByText(BOOKING_ERRORS.booking_too_late)).toBeTruthy();
  });

  it("asks on the page before it cancels", async () => {
    const onCancel = vi.fn();
    render(<ManageBooking {...props} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers the open times and reports the one picked", async () => {
    const onReschedule = vi.fn();
    render(<ManageBooking {...props} onReschedule={onReschedule} />);
    await userEvent.click(screen.getByRole("button", { name: "Pick another time" }));
    await userEvent.click(screen.getByRole("button", { name: "9:00 AM" }));
    expect(onReschedule).toHaveBeenCalledWith("2026-11-23T15:00:00Z");
  });

  it("says a canceled booking is canceled and offers nothing", () => {
    render(<ManageBooking {...props} booking={{ ...MANAGED_BOOKING, status: "canceled", canChange: false }} />);
    expect(screen.getByText("This booking is canceled.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pick another time" })).toBeNull();
  });
});
