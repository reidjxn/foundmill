/**
 * Offline check of `channel_engine.reports_prepared_not_launched` (WP-02 T2): the mock Composer, what mock-mode founders
 * read, never says a prepared offline-tracking campaign launched, went live, was sent or was published.
 */
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { CHANNEL_ENGINE_NOTE_CASES, LAUNCH_CLAIM, runChannelEngineNoteCase } from "../channel-engine-notes";

describe("channel_engine.reports_prepared_not_launched (mock)", () => {
  it("the gate catches a launch claim and passes a prepared one", () => {
    expect(LAUNCH_CLAIM.test("Print is live with the new flyer")).toBe(true);
    expect(LAUNCH_CLAIM.test("We launched the email campaign")).toBe(true);
    expect(LAUNCH_CLAIM.test("The print materials are ready for you to submit yourself")).toBe(false);
  });

  it("every case: no launch claim in the mock note", async () => {
    const client = createModelClient({ mode: "mock" });
    for (const c of CHANNEL_ENGINE_NOTE_CASES) {
      const r = await runChannelEngineNoteCase(c, client);
      expect(r.error, c.id).toBeUndefined();
      expect(r.claims, c.id).toEqual([]);
    }
  });
});
