/**
 * Showcase videos (docs/THESIS_REVIEW.md §13 item 15): who may be asked, what the answers come to (any ONE founder's
 * No, Withdraw or departure overrides the others' yes), and every refusal of the share gate.
 */
import { describe, expect, it } from "vitest";
import {
  SHOWCASE_APPROVAL_TTL_MS,
  SHOWCASE_DECLINE_MS,
  SHOWCASE_RECENT_MS,
  settleShowcase,
  showcaseDraftCanonical,
  showcaseEligibility,
  showcaseLink,
  showcasePreviewCanonical,
  showcaseShareRefusal,
  showcaseWords,
  type ShowcaseConsentFacts,
  type ShowcaseEligibilityFacts,
  type ShowcasePreview,
  type ShowcaseShareFacts,
} from "./showcase";

const now = new Date("2026-11-14T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const later = (ms: number) => new Date(now.getTime() + ms);

const eligible: ShowcaseEligibilityFacts = { pagePublic: true, shownMilestones: [{ key: "page_live", simulated: false }], isSample: false, isHouse: false, openRequest: false, lastRequestAt: null, lastDeclinedAt: null, mayAsk: true };
const reason = (over: Partial<ShowcaseEligibilityFacts>) => {
  const r = showcaseEligibility({ ...eligible, ...over }, now);
  return r.eligible ? null : r.reason;
};

describe("showcaseEligibility", () => {
  it("a public project with a real page-live or first-follower milestone may be asked, solo or not (the people are never a fact)", () => {
    expect(showcaseEligibility(eligible, now)).toEqual({ eligible: true });
    expect(showcaseEligibility({ ...eligible, shownMilestones: [{ key: "first_follower", simulated: false }] }, now)).toEqual({ eligible: true });
  });

  it("refuses a simulated milestone, a sample or demo, a hidden milestone and the house", () => {
    expect(reason({ shownMilestones: [{ key: "page_live", simulated: true }] })).toBe("no_real_milestone");
    expect(reason({ isSample: true })).toBe("sample");
    expect(reason({ shownMilestones: [] })).toBe("no_real_milestone");
    expect(reason({ shownMilestones: [{ key: "first_customer", simulated: false }] })).toBe("no_real_milestone");
    expect(reason({ isHouse: true })).toBe("house");
    expect(reason({ pagePublic: false })).toBe("page_private");
  });

  it("refuses a recent ask, an open one and a recent no", () => {
    expect(reason({ openRequest: true })).toBe("open_request");
    expect(reason({ lastRequestAt: ago(SHOWCASE_RECENT_MS - 1) })).toBe("recent_request");
    expect(reason({ lastRequestAt: ago(SHOWCASE_RECENT_MS + 1) })).toBeNull();
    expect(reason({ lastRequestAt: ago(SHOWCASE_RECENT_MS + 1), lastDeclinedAt: ago(SHOWCASE_DECLINE_MS - 1) })).toBe("recent_no");
    expect(reason({ lastRequestAt: ago(SHOWCASE_DECLINE_MS + 1), lastDeclinedAt: ago(SHOWCASE_DECLINE_MS + 1) })).toBeNull();
  });

  it("refuses a project whose founders switched the setting off", () => {
    expect(reason({ mayAsk: false })).toBe("setting_off");
  });

  it("refuses a name only when it is unsafe to post, never for its words", () => {
    expect(reason({ nameSafe: false })).toBe("name_unsafe");
    expect(reason({ nameSafe: true })).toBeNull();
  });
});

const consent = (userId: string, answer: ShowcaseConsentFacts["answer"], over: Partial<ShowcaseConsentFacts> = {}): ShowcaseConsentFacts => ({ userId, answer, withdrawnAt: null, expiresAt: later(1000), ...over });

describe("settleShowcase: one founder's no, withdrawal or departure overrides the others' yes", () => {
  it("a solo founder's yes approves; nobody else is needed", () => {
    expect(settleShowcase([consent("a", "yes")], ["a"], now)).toEqual({ state: "approved" });
  });

  it("every current founder's yes approves; one still to answer keeps it asking", () => {
    expect(settleShowcase([consent("a", "yes"), consent("b", "yes")], ["a", "b"], now)).toEqual({ state: "approved" });
    expect(settleShowcase([consent("a", "yes"), consent("b", null)], ["a", "b"], now)).toEqual({ state: "asking", missing: [] });
  });

  it("one no declines, whatever the others said", () => {
    expect(settleShowcase([consent("a", "yes"), consent("b", "no"), consent("c", "yes")], ["a", "b", "c"], now)).toEqual({ state: "declined", reason: "declined" });
  });

  it("one withdrawal withdraws, whatever the others said", () => {
    expect(settleShowcase([consent("a", "yes", { withdrawnAt: now }), consent("b", "yes")], ["a", "b"], now)).toEqual({ state: "withdrawn", reason: "founder_withdrew" });
  });

  it("a founder who left withdraws it; a new founder who was never asked is asked on the same request", () => {
    expect(settleShowcase([consent("a", "yes"), consent("b", "yes")], ["a"], now)).toEqual({ state: "withdrawn", reason: "founders_changed" });
    expect(settleShowcase([consent("a", "yes")], [], now)).toEqual({ state: "withdrawn", reason: "founders_changed" });
    // Review finding 9: a new cofounder is asked too, and the others' yes keeps until they answer.
    expect(settleShowcase([consent("a", "yes")], ["a", "new"], now)).toEqual({ state: "asking", missing: ["new"] });
    expect(settleShowcase([consent("a", "yes"), consent("new", null)], ["a", "new"], now)).toEqual({ state: "asking", missing: [] });
  });

  it("an ask nobody finished in time expires", () => {
    expect(settleShowcase([consent("a", "yes"), consent("b", null, { expiresAt: ago(1) })], ["a", "b"], now)).toEqual({ state: "expired", reason: "expired" });
  });
});

const preview: ShowcasePreview = {
  slug: "maple-bakes",
  projectName: "Maple Bakes",
  brandPrimary: "#1b4fd8",
  brandSecondary: "#f5c400",
  shots: [{ milestoneId: "m1", key: "page_live", label: "Page live", on: "Nov 12, 2026", imageUrl: "https://foundmill.test/m/m1/story-image", caption: "Nov 12: page live" }],
  postText: "How Maple Bakes was built. Page live on Nov 12, 2026.",
  link: showcaseLink("https://foundmill.test", "maple-bakes"),
  networks: ["instagram", "tiktok"],
  video: { clips: [{ milestoneId: "m1", taskId: "t1", url: "https://cdn.test/a.mp4" }] },
};

describe("the preview and its link", () => {
  it("links the story with the project's own via, so the project gets the sign-up credit", () => {
    expect(showcaseLink("https://foundmill.test/", "maple-bakes")).toBe("https://foundmill.test/p/maple-bakes/story?via=p.maple-bakes");
  });

  it("hashes what a founder approves, not where a clip is served from today; any edit of the words changes it", () => {
    const moved = { ...preview, video: { clips: [{ ...preview.video!.clips[0]!, url: "https://cdn.test/b.mp4" }] } };
    expect(showcasePreviewCanonical(moved)).toBe(showcasePreviewCanonical(preview));
    expect(showcaseDraftCanonical(preview, preview.postText)).toBe(showcasePreviewCanonical(preview));
    expect(showcaseDraftCanonical(preview, `${preview.postText} More.`)).not.toBe(showcasePreviewCanonical(preview));
    expect(showcasePreviewCanonical({ ...preview, networks: ["x"] })).not.toBe(showcasePreviewCanonical(preview));
  });
});

const gate: ShowcaseShareFacts = { state: "approved", approvedUntil: later(SHOWCASE_APPROVAL_TTL_MS), previewHash: "h", draftHash: "h", yesUserIds: ["a", "b"], currentOwnerIds: ["b", "a"], pagePublic: true, milestonesShown: true, videoFinal: true };
const refusal = (over: Partial<ShowcaseShareFacts>) => showcaseShareRefusal({ ...gate, ...over }, now);

describe("showcaseShareRefusal: every refusal of the share gate", () => {
  it("shares an approved, in-date, unchanged post whose founders and page are as they said yes", () => {
    expect(showcaseShareRefusal(gate, now)).toBeNull();
  });

  it("refuses each broken condition", () => {
    expect(refusal({ state: "asking" })).toBe("not_approved");
    expect(refusal({ state: "withdrawn" })).toBe("not_approved");
    expect(refusal({ approvedUntil: ago(1) })).toBe("approval_lapsed");
    expect(refusal({ approvedUntil: null })).toBe("approval_lapsed");
    expect(refusal({ videoFinal: false })).toBe("no_video");
    expect(refusal({ draftHash: "edited" })).toBe("draft_changed");
    expect(refusal({ currentOwnerIds: ["a", "b", "new"] })).toBe("founders_changed");
    expect(refusal({ currentOwnerIds: ["a"] })).toBe("founders_changed");
    expect(refusal({ pagePublic: false })).toBe("page_private");
    expect(refusal({ milestonesShown: false })).toBe("milestone_hidden");
  });
});

describe("the words", () => {
  it("say plainly that a posted video cannot be pulled back, and that every founder is asked", () => {
    const w = showcaseWords("Foundmill");
    expect(w.recall).toBe("You can withdraw any time before it's posted. Once Foundmill posts it, it can't be pulled back from those networks.");
    expect(w.subject("Maple  Bakes")).toBe("Foundmill would like to feature Maple Bakes in a short video");
  });
});
