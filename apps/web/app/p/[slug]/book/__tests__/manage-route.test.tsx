// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOKING_ERRORS } from "@foundmill/shared/booking";

const server = vi.hoisted(() => ({ publicManagedBooking: vi.fn(), publicProjectPage: vi.fn() }));
vi.mock("@/lib/public-page.server", () => server);
vi.mock("@/lib/public-mark.server", () => ({ pageMarkFor: async () => ({ mark: "none", markHref: "/" }) }));
vi.mock("@/components/public/PublicManageBooking", () => ({ PublicManageBooking: () => <p>manage</p> }));

import ManageBookingRoute, { metadata } from "../manage/page";

afterEach(cleanup);

describe("the manage booking page", () => {
  it("is a real page with the not-found sentence for a link that is not valid, and for no token", async () => {
    server.publicManagedBooking.mockResolvedValue(null);
    render(await ManageBookingRoute({ searchParams: Promise.resolve({ t: "bad" }) }));
    expect(screen.getByText(BOOKING_ERRORS.booking_not_found)).toBeTruthy();
    cleanup();
    render(await ManageBookingRoute({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("booking-not-found")).toBeTruthy();
    expect(server.publicManagedBooking).toHaveBeenCalledTimes(1);
  });

  it("is never indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("shows the booking for a valid link", async () => {
    server.publicManagedBooking.mockResolvedValue({ slug: "northwind" });
    server.publicProjectPage.mockResolvedValue(null);
    render(await ManageBookingRoute({ searchParams: Promise.resolve({ t: "good" }) }));
    expect(screen.getByText("manage")).toBeTruthy();
  });
});
