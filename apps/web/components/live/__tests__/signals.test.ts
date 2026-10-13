import { describe, expect, it } from "vitest";
import { isLiveSignal, userChannel } from "../signals";

describe("LIVE signals on the founder's own stream channel (audit #65)", () => {
  it("subscribes to u:<userId> and recognises only live.signal frames", () => {
    expect(userChannel("00000000-0000-4000-8000-0000000000aa")).toBe("u:00000000-0000-4000-8000-0000000000aa");
    expect(isLiveSignal({ type: "live.signal", kind: "message_received", threadId: "t1", at: "2026-10-12T10:00:00.000Z" })).toBe(true);
    expect(isLiveSignal({ type: "live.signal" })).toBe(false);
    expect(isLiveSignal({ type: "inbox.item_created", kind: "x" })).toBe(false);
    expect(isLiveSignal(null)).toBe(false);
    expect(isLiveSignal("live.signal")).toBe(false);
  });
});
