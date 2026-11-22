import { describe, expect, it } from "vitest";
import { DEV_BOOKING_LINK_SECRET, bookingLinkSecret, bookingManageToken, bookingManageUrl, readBookingManageToken } from "./booking";
import { followConfirmToken } from "./confirm";

const SECRET = "a-secret-of-at-least-sixteen-characters";
const ID = "0a1b2c3d-1111-4222-8333-444455556666";

describe("a booking's manage link", () => {
  it("names the booking and verifies only under the secret that signed it", () => {
    const token = bookingManageToken(SECRET, ID.toUpperCase());
    expect(readBookingManageToken(SECRET, token)).toBe(ID);
    expect(readBookingManageToken("another-secret-of-sixteen-chars", token)).toBeNull();
  });

  it("refuses a changed id, a changed signature and anything that is not its shape", () => {
    const token = bookingManageToken(SECRET, ID);
    const other = "0a1b2c3d-1111-4222-8333-444455557777";
    expect(readBookingManageToken(SECRET, token.replace(ID, other))).toBeNull();
    expect(readBookingManageToken(SECRET, `${token}x`)).toBeNull();
    expect(readBookingManageToken(SECRET, "b1.not-an-id.sig")).toBeNull();
    expect(readBookingManageToken(SECRET, "")).toBeNull();
  });

  it("never accepts a token signed for something else with the same secret", () => {
    const follow = followConfirmToken(SECRET, { businessId: ID, consentId: ID, emailHash: "a".repeat(64), expiresAt: 4_000_000_000, nonce: "n".repeat(32) });
    expect(readBookingManageToken(SECRET, follow)).toBeNull();
  });

  it("uses the shared secret where set, the development constant only on a development or test stack, and nothing elsewhere", () => {
    expect(bookingLinkSecret({ SESSION_TOKEN_SECRET: SECRET, APP_ENV: "production" })).toBe(SECRET);
    expect(bookingLinkSecret({ APP_ENV: "test" })).toBe(DEV_BOOKING_LINK_SECRET);
    expect(bookingLinkSecret({ SESSION_TOKEN_SECRET: "short", APP_ENV: "production" })).toBeNull();
    expect(bookingLinkSecret({ APP_ENV: "staging" })).toBeNull();
  });

  it("opens on the project's booking page", () => {
    expect(bookingManageUrl("https://foundmill.test/", "brightside", "b1.x.y")).toBe("https://foundmill.test/p/brightside/book/manage?t=b1.x.y");
  });
});
