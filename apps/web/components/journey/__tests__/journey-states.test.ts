import { describe, expect, it } from "vitest";
import { loadFailed, refreshFailed } from "@/components/shell/QueryStates";

/** JourneyScreen's choice between the error panel and the replay (WP-10 T12, audit A2-25). */
describe("Customer Update load states", () => {
  const row = { id: "j1", conversionId: "c1" };
  it("a failed background refetch keeps the loaded replay and says it may be out of date", () => {
    const q = { error: new Error("network"), data: row };
    expect(loadFailed(q)).toBe(false);
    expect(refreshFailed(q)).toBe(true);
  });
  it("a first load that failed shows the error panel", () => {
    expect(loadFailed({ error: new Error("network"), data: undefined })).toBe(true);
  });
});
