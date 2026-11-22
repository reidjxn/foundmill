// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKING_ERRORS } from "@foundmill/shared/booking";
import { TRPCClientError } from "@trpc/client";
import { bookingErrorCode } from "@/lib/public-booking";

const actions = vi.hoisted(() => ({ bookingSlots: vi.fn(), holdBookingSlot: vi.fn(), confirmBookingHold: vi.fn() }));
vi.mock("@/app/p/[slug]/book/actions", () => actions);
const manage = vi.hoisted(() => ({ manageSlots: vi.fn(), cancelManagedBooking: vi.fn(), rescheduleManagedBooking: vi.fn() }));
vi.mock("@/app/p/[slug]/book/manage/actions", () => manage);

import { PublicBookingFlow } from "../PublicBookingFlow";
import { PublicManageBooking } from "../PublicManageBooking";

const SERVICE = { id: "11111111-1111-4111-8111-111111111111", name: "Intro call", durationMin: 30, priceMinor: null, currency: "USD", mode: "online" as const, questions: [] };
const SLOT = new Date(Date.now() + 3 * 86_400_000).toISOString();
const flow = () => <PublicBookingFlow slug="northwind" projectName="Northwind" brandPrimary="#2f7d6b" brandSecondary="#f4efe6" services={[SERVICE]} />;
const timeButton = () =>
  waitFor(() => {
    const found = screen.getAllByRole("button").find((b) => /^\d{1,2}:\d{2}\s?[AP]M$/.test(b.textContent ?? ""));
    if (!found) throw new Error("no time yet");
    return found;
  });

beforeEach(() => {
  actions.bookingSlots.mockResolvedValue({ ok: true, data: { slots: [SLOT] } });
  actions.holdBookingSlot.mockResolvedValue({ ok: true, data: { holdToken: "hold-1", expiresAt: new Date(Date.now() + 300_000).toISOString() } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function reachTheForm() {
  render(flow());
  fireEvent.click(await timeButton());
  await waitFor(() => expect(actions.holdBookingSlot).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ana@example.com" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("bookingErrorCode", () => {
  it("keeps a code the page has a sentence for and says unavailable for anything else", () => {
    const refused = (appCode: string) => new TRPCClientError("x", { result: { error: { data: { appCode } } } as never });
    expect(bookingErrorCode(refused("booking_slot_taken"))).toBe("booking_slot_taken");
    expect(bookingErrorCode(refused("booking_unverified"))).toBe("unavailable");
    expect(bookingErrorCode(new Error("boom"))).toBe("unavailable");
  });
});

describe("PublicBookingFlow", () => {
  it("asks for slots only after the browser's zone is known, with the first time held under a bot-check token", async () => {
    render(flow());
    fireEvent.click(await timeButton());
    await waitFor(() => expect(actions.holdBookingSlot).toHaveBeenCalledWith({ slug: "northwind", serviceId: SERVICE.id, start: SLOT, turnstile: "mock-ok", replaces: null }));
  });

  it("sends the visitor back to the times with the sentence when the time was just taken", async () => {
    await reachTheForm();
    actions.confirmBookingHold.mockResolvedValue({ ok: false, code: "booking_slot_taken" });
    await act(async () => fireEvent.submit(screen.getByRole("form", { name: "Your details" })));
    expect(await screen.findByText(BOOKING_ERRORS.booking_slot_taken)).toBeTruthy();
    expect(document.querySelector('[data-booking-step="time"]')).toBeTruthy();
    expect(document.querySelector('[data-booking-step="form"]')).toBeNull();
  });

  it("shows a refused hold as its sentence, and says it is booked after a confirm", async () => {
    actions.holdBookingSlot.mockResolvedValueOnce({ ok: false, code: "booking_slot_gone" });
    render(flow());
    fireEvent.click(await timeButton());
    expect(await screen.findByText(BOOKING_ERRORS.booking_slot_gone)).toBeTruthy();
    cleanup();
    await reachTheForm();
    actions.confirmBookingHold.mockResolvedValue({ ok: true, data: { startsAt: SLOT, serviceName: "Intro call" } });
    await act(async () => fireEvent.submit(screen.getByRole("form", { name: "Your details" })));
    expect(await screen.findByText("You are booked.")).toBeTruthy();
    expect(actions.confirmBookingHold).toHaveBeenCalledWith(expect.objectContaining({ holdToken: "hold-1", email: "ana@example.com", consent: true, answers: [] }));
  });
});

describe("PublicManageBooking", () => {
  const booking = { status: "confirmed" as const, projectName: "Northwind", serviceName: "Intro call", startsAt: SLOT, durationMin: 30, mode: "online" as const, canChange: true };
  const view = () => <PublicManageBooking token="tok" bookHref="/p/northwind/book" booking={booking} brandPrimary="#2f7d6b" brandSecondary="#f4efe6" />;

  it("cancels, says so, and offers the way back to the booking page", async () => {
    manage.manageSlots.mockResolvedValue({ ok: true, data: { slots: [SLOT] } });
    manage.cancelManagedBooking.mockResolvedValue({ ok: true, data: { status: "canceled" } });
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByText("This booking is canceled.")).toBeTruthy();
    expect(screen.getByTestId("book-again").getAttribute("href")).toBe("/p/northwind/book");
  });

  it("shows a refused change as its sentence", async () => {
    manage.manageSlots.mockResolvedValue({ ok: true, data: { slots: [SLOT] } });
    manage.rescheduleManagedBooking.mockResolvedValue({ ok: false, code: "booking_slot_taken" });
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "Pick another time" }));
    fireEvent.click(await timeButton());
    expect(await screen.findByText(BOOKING_ERRORS.booking_slot_taken)).toBeTruthy();
  });
});
