import { describe, expect, it } from "vitest";
import { CONNECTION_GRACE_MS, connectionNotice } from "../stream-status";

describe("connectionNotice (audit RES-11: nothing on screen said the live connection was down)", () => {
  it("says nothing while the business's channel is live", () => {
    expect(connectionNotice({ live: true, status: "open", downForMs: 60_000 })).toBeNull();
  });

  it("says nothing for a blip: only after the grace has run out", () => {
    expect(connectionNotice({ live: false, status: "reconnecting", downForMs: CONNECTION_GRACE_MS - 1 })).toBeNull();
    expect(connectionNotice({ live: false, status: "reconnecting", downForMs: CONNECTION_GRACE_MS })).toBe("reconnecting");
  });

  it("reads 'reconnecting' while the socket is trying again, and 'paused' when it is closed or the channel was refused", () => {
    expect(connectionNotice({ live: false, status: "connecting", downForMs: 10_000 })).toBe("reconnecting");
    expect(connectionNotice({ live: false, status: "closed", downForMs: 10_000 })).toBe("paused");
    // An open socket that does not carry this business's channel (refused by the server): paused, not reconnecting.
    expect(connectionNotice({ live: false, status: "open", downForMs: 10_000 })).toBe("paused");
  });
});
