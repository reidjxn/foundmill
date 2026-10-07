import { describe, expect, it } from "vitest";
import { isReplaySpeed, readReplaySpeed, speedStorageKey, writeReplaySpeed, type SpeedStore } from "../speed";

function memory(): SpeedStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("replay speed remembered per founder (BUILD §11.4)", () => {
  it("defaults to the full match, remembers per user id and ignores garbage", () => {
    const store = memory();
    expect(readReplaySpeed("u1", store)).toBe("full");
    writeReplaySpeed("u1", "highlights", store);
    expect(readReplaySpeed("u1", store)).toBe("highlights");
    expect(readReplaySpeed("u2", store)).toBe("full");
    store.map.set(speedStorageKey("u2"), "warp");
    expect(readReplaySpeed("u2", store)).toBe("full");
    expect(isReplaySpeed("instant")).toBe(true);
    expect(isReplaySpeed("fast")).toBe(false);
  });
  it("survives a throwing or missing store", () => {
    const broken: SpeedStore = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    };
    expect(readReplaySpeed("u1", broken)).toBe("full");
    expect(() => writeReplaySpeed("u1", "instant", broken)).not.toThrow();
    expect(readReplaySpeed(null, null)).toBe("full");
  });
});
