import { describe, expect, it } from "vitest";
import { ValidationError } from "@foundmill/shared";
import { userStreamKey } from "../keys";
import { fieldsToObject } from "../redis";
import { MemoryRedis } from "../testing/memory-redis";
import { publishUserSignal, readUserSignal, USER_SIGNAL_KINDS, USER_STREAM_MAXLEN } from "../user-stream";

const USER = "0f1e2d3c-0000-4000-8000-0000000000aa";
const THREAD = "0f1e2d3c-0000-4000-8000-0000000000bb";

describe("person stream u:{userId} (audit #65)", () => {
  it("publishes a content-free signal with fields kind/json on the person's own key", async () => {
    const redis = new MemoryRedis();
    const id = await publishUserSignal(redis, USER, { kind: "message_received", threadId: THREAD });
    expect(userStreamKey(USER)).toBe(`u:${USER}`);
    const entries = await redis.xrange(userStreamKey(USER), "-", "+");
    expect(entries).toHaveLength(1);
    expect(entries[0]![0]).toBe(id);
    const fields = fieldsToObject(entries[0]![1]);
    expect(fields.kind).toBe("message_received");
    const signal = JSON.parse(fields.json!);
    expect(readUserSignal(signal)).toEqual({ type: "live.signal", kind: "message_received", threadId: THREAD, at: expect.any(String) });
    // Nothing but the kind and ids: no names, no text.
    expect(Object.keys(signal).sort()).toEqual(["at", "kind", "threadId", "type"]);
  });

  it("refuses an unknown kind, a bad id or a missing user, and reads anything else off the wire as null", async () => {
    const redis = new MemoryRedis();
    await expect(publishUserSignal(redis, USER, { kind: "gossip" as never })).rejects.toThrow(ValidationError);
    await expect(publishUserSignal(redis, USER, { kind: "message_received", threadId: "not-a-uuid" })).rejects.toThrow(ValidationError);
    await expect(publishUserSignal(redis, "", { kind: "moderation" })).rejects.toThrow(ValidationError);
    expect(readUserSignal({ type: "payment.received" })).toBeNull();
    expect(readUserSignal(null)).toBeNull();
    expect(USER_SIGNAL_KINDS).toContain("connection_requested");
    expect(USER_STREAM_MAXLEN).toBeGreaterThan(0);
  });
});
