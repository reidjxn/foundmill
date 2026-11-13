import { describe, expect, it } from "vitest";
import { NO_POST_OUTCOMES, POST_OUTCOME_SECTION, postOutcomeLine, postOutcomePlace, postQuote, postWeekLine, viaPostWords, wallPostOutcomes } from "./post-outcomes";

describe("what a post led to", () => {
  it("says the outcomes only, in plain words, and nothing for a quiet post", () => {
    expect(postOutcomeLine({ follow: 2, reply: 1, payment: 0 })).toBe("Led to 2 follows and 1 reply");
    expect(postOutcomeLine({ follow: 1, reply: 0, payment: 0 })).toBe("Led to 1 follow");
    expect(postOutcomeLine({ follow: 3, reply: 2, payment: 1 })).toBe("Led to 3 follows, 2 replies and 1 payment");
    expect(postOutcomeLine(NO_POST_OUTCOMES)).toBeNull();
  });

  it("keeps follows and replies behind the CRM and payments behind Finance", () => {
    expect(POST_OUTCOME_SECTION).toEqual({ follow: "crm", reply: "crm", payment: "finance" });
    const counts = { follow: 2, reply: 1, payment: 1 };
    expect(wallPostOutcomes(counts, (s) => s !== "finance")).toEqual({ follow: 2, reply: 1, payment: 0 });
    expect(wallPostOutcomes(counts, (s) => s !== "crm")).toEqual({ follow: 0, reply: 0, payment: 1 });
    expect(postOutcomeLine(wallPostOutcomes(counts, () => false))).toBeNull();
  });

  it("writes one learning line per post and place, labeled as counted, and none for a quiet week", () => {
    expect(postWeekLine({ week: 3, text: "Maple Bakes is online: sourdough, baked each morning.", network: "x", counts: { follow: 2, reply: 1, payment: 0 } })).toBe(
      'w3: post "Maple Bakes is online: sourdough, baked…" (X): 2 follows, 1 reply (Counted, real people)',
    );
    expect(postWeekLine({ week: 1, text: "Short one", network: null, counts: { follow: 1, reply: 0, payment: 0 } })).toBe('w1: post "Short one" (a copied or sent link): 1 follow (Counted, real people)');
    expect(postWeekLine({ week: 2, text: "Anything", network: "x", counts: NO_POST_OUTCOMES })).toBeNull();
    expect(postOutcomePlace("linkedin")).toBe("LinkedIn");
    expect(Array.from(postQuote("a ".repeat(60))).length).toBeLessThanOrEqual(40);
  });

  it("gives the weekly brief's outcome its source in US words (the seam for #112's viaPost)", () => {
    expect(viaPostWords({ network: "x", sharedAt: new Date("2026-11-12T15:00:00Z") })).toBe("from your post on X, Nov 12");
    expect(viaPostWords({ network: null, sharedAt: new Date("2026-11-12T15:00:00Z") })).toBe("from a link to your post, Nov 12");
    // The business's own day: 03:00 UTC on Nov 13 is still Nov 12 in Los Angeles.
    expect(viaPostWords({ network: "linkedin", sharedAt: new Date("2026-11-13T03:00:00Z"), timeZone: "America/Los_Angeles" })).toBe("from your post on LinkedIn, Nov 12");
  });
});
