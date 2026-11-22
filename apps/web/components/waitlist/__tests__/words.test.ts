import { describe, expect, it } from "vitest";
import { WAITLIST_PAGE_WORDS, waitlistBatchLine } from "../words";

/** WP-14 T15: the public waitlist page's sentence, with the API's real numbers and US dates. */
describe("waitlistBatchLine", () => {
  it("is the founder's sentence before the batch's day", () => {
    expect(waitlistBatchLine({ number: 3, opensOn: "2026-11-24", placesLeft: 50, open: false })).toBe("Batch 3 opens Nov 24, 2026. 50 places.");
    expect(waitlistBatchLine({ number: 12, opensOn: "2027-01-05", placesLeft: 1000, open: false })).toBe("Batch 12 opens Jan 5, 2027. 1,000 places.");
  });
  it("says what is left once the batch has opened, and one place is one place", () => {
    expect(waitlistBatchLine({ number: 3, opensOn: "2026-11-24", placesLeft: 12, open: true })).toBe("Batch 3 opened Nov 24, 2026. 12 places left.");
    expect(waitlistBatchLine({ number: 3, opensOn: "2026-11-24", placesLeft: 1, open: true })).toBe("Batch 3 opened Nov 24, 2026. 1 place left.");
  });
  it("with no batch the page says so and shows no number", () => {
    expect(WAITLIST_PAGE_WORDS.none).not.toMatch(/\d/);
    expect(WAITLIST_PAGE_WORDS.title).toBe("Foundmill opens in batches");
  });
});
