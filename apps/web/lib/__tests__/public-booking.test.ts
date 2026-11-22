import { describe, expect, it } from "vitest";
import { BOOKING_ERRORS } from "@foundmill/shared/booking";
import { TRPCClientError } from "@trpc/client";
import { bookingResult } from "../public-booking";

describe("bookingResult", () => {
  it("answers the value", async () => {
    expect(await bookingResult(async () => 1)).toEqual({ ok: true, data: 1 });
  });
  it("answers a code the booking pages have a sentence for", async () => {
    for (const code of Object.keys(BOOKING_ERRORS)) {
      const err = new TRPCClientError("x", { result: { error: { data: { appCode: code } } } as never });
      expect(await bookingResult(async () => Promise.reject(err))).toEqual({ ok: false, code });
    }
  });
});
