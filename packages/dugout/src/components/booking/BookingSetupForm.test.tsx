import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { weeklyHoursProblem } from "@foundmill/shared/booking";
import { BookingSetupForm, type BookingSetupFormProps } from "./BookingSetupForm";
import { BOOKING_SETUP_DRAFT, TIME_ZONES } from "./fixtures";

const base = (over: Partial<BookingSetupFormProps> = {}): BookingSetupFormProps => ({
  draft: BOOKING_SETUP_DRAFT,
  status: "draft",
  timeZones: TIME_ZONES,
  calendarConnected: true,
  pagePublished: true,
  onSave: vi.fn(),
  onSetLive: vi.fn(),
  ...over,
});

describe("BookingSetupForm", () => {
  it("emits a valid draft with what was edited", async () => {
    const onSave = vi.fn();
    render(<BookingSetupForm {...base({ onSave })} />);
    await userEvent.click(screen.getByRole("switch", { name: "Saturday" }));
    await userEvent.type(screen.getByLabelText("Name", { selector: "#" + (document.querySelector('input[value="Intro call"]') as HTMLInputElement).id }), " today");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0]![0];
    expect(weeklyHoursProblem(saved.weeklyHours)).toBeNull();
    expect(saved.weeklyHours["6"]).toBeUndefined();
    expect(saved.services[1].name).toBe("Intro call today");
    expect(saved.services[0].priceMinor).toBe(9000);
  });

  it("blocks an hours window that ends before it starts and says why", () => {
    render(<BookingSetupForm {...base({ draft: { ...BOOKING_SETUP_DRAFT, weeklyHours: { "1": [{ start: 600, end: 600 }] } } })} />);
    expect(screen.getByRole("alert").textContent).toBe("Hours must start before they end, within one day.");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why booking cannot be turned on yet", () => {
    render(<BookingSetupForm {...base({ pagePublished: false })} />);
    expect(screen.getByText("Publish your project's page first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Turn on booking" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the calendar switch with its hint when no calendar is connected", () => {
    render(<BookingSetupForm {...base({ calendarConnected: false })} />);
    expect(screen.getByText("Connect Google Calendar in Settings › Integrations first.")).toBeTruthy();
    expect((screen.getByRole("switch", { name: /Google Calendar is busy/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns booking on and off, and says when it went live", async () => {
    const onSetLive = vi.fn();
    const { unmount } = render(<BookingSetupForm {...base({ onSetLive })} />);
    expect(screen.getByText("Not public yet. Visitors cannot book.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Turn on booking" }));
    expect(onSetLive).toHaveBeenCalledWith(true);
    unmount();
    render(<BookingSetupForm {...base({ onSetLive, status: "live", liveSince: "2026-11-23T18:00:00Z" })} />);
    expect(screen.getByText("Live on your page since Nov 23, 2026")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Turn off booking" }));
    expect(onSetLive).toHaveBeenLastCalledWith(false);
  });
});
