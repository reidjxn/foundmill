import { describe, expect, it } from "vitest";
import { POST_NETWORKS, postDraftFor } from "./post-draft";
import { SHARE_OPEN_WORDS, milestonePostDraft, pagePostDraft, writtenPostDraft } from "./share-drafts";
import { TAP_POST_NETWORKS, shareTargets } from "./share-targets";
import { PostDraft as PostDraftSchema } from "./types";
import { parseVia, VIA_PARAM } from "./via";

const ORIGIN = "https://foundmill.example";
const ID = "0b9d1c1e-1111-4222-8333-444455556666";
const milestone = (over: Partial<Parameters<typeof milestonePostDraft>[0]> = {}) => milestonePostDraft({ origin: ORIGIN, slug: "maple-bakes", projectName: "Maple Bakes", milestoneId: ID, label: "Page live", ...over });
const page = (over: Partial<Parameters<typeof pagePostDraft>[0]> = {}) => pagePostDraft({ origin: ORIGIN, slug: "maple-bakes", projectName: "Maple Bakes", pitch: "Sourdough, baked each morning", ...over });

/** Nothing a founder would not say in their own voice: no "we", no praise, no hashtag, no emoji, no number. */
const plain = (text: string) => {
  expect(text).not.toMatch(/\b(we|our|us)\b/i);
  expect(text).not.toMatch(/#|!|\bexcited\b|\bthrilled\b|\bproud\b|\bamazing\b|\bhuge\b/i);
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(text).not.toMatch(/\d/);
};

describe("milestonePostDraft", () => {
  it("says the project's name and the milestone's public words, and links to the card with the page's via", () => {
    const d = milestone();
    expect(d.text).toBe("Maple Bakes reached a milestone: Page live.");
    expect(d.link).toBe(`${ORIGIN}/m/${ID}?via=p.maple-bakes`);
    expect(parseVia(new URL(d.link!).searchParams.get(VIA_PARAM))).toEqual({ kind: "project_page", ref: "maple-bakes" });
    expect(d.image).toEqual({ url: `${ORIGIN}/m/${ID}/opengraph-image`, alt: "Page live: Maple Bakes" });
    // The networks that take a tall picture get the tall one.
    const tall = { url: `${ORIGIN}/m/${ID}/story-image`, alt: "Page live: Maple Bakes" };
    expect(postDraftFor(d, "instagram").image).toEqual(tall);
    expect(postDraftFor(d, "tiktok").image).toEqual(tall);
    expect(postDraftFor(d, "x").image).toEqual(d.image);
    plain(d.text);
    plain(milestone({ label: "First follower" }).text);
    expect(milestone({ label: "First follower" }).text).toBe("Maple Bakes reached a milestone: First follower.");
    expect(PostDraftSchema.safeParse(d).success).toBe(true);
  });

  it("tidies the name and the origin, and stays the same draft however often it is built", () => {
    const d = milestone({ origin: `${ORIGIN}//`, projectName: "  Maple \n Bakes  " });
    expect(d).toEqual(milestone());
    expect(milestone()).toEqual(milestone());
  });

  it("opens every tap network with the text and the card's address", () => {
    const targets = shareTargets(milestone());
    for (const network of TAP_POST_NETWORKS) {
      const target = targets.find((t) => t.network === network)!;
      expect(target.kind, network).toBe("tap");
      expect(target.shortened, network).toBe(false);
      expect(decodeURIComponent(target.href!), network).toContain("Maple Bakes reached a milestone: Page live.");
      expect(decodeURIComponent(target.href!), network).toContain(`${ORIGIN}/m/${ID}?via=p.maple-bakes`);
    }
  });
});

describe("pagePostDraft", () => {
  it("says the name and the one-line pitch, and links to the page with its via", () => {
    const d = page();
    expect(d.text).toBe("Maple Bakes: Sourdough, baked each morning.");
    expect(d.link).toBe(`${ORIGIN}/p/maple-bakes?via=p.maple-bakes`);
    expect(d.image).toEqual({ url: `${ORIGIN}/p/maple-bakes/opengraph-image`, alt: "Maple Bakes: Sourdough, baked each morning" });
    expect(d.variants).toEqual({});
    plain(d.text);
    expect(PostDraftSchema.safeParse(d).success).toBe(true);
  });

  it("does not repeat a pitch that is the name, add a second full stop, or change the founder's own words", () => {
    expect(page({ pitch: "maple bakes" }).text).toBe("Maple Bakes.");
    expect(page({ pitch: "" }).text).toBe("Maple Bakes.");
    expect(page({ pitch: "Bread you can trust." }).text).toBe("Maple Bakes: Bread you can trust.");
    expect(page({ pitch: "Ready when you are?" }).text).toBe("Maple Bakes: Ready when you are?");
    // A pitch that is too long for a network is fitted there, never here.
    const long = page({ pitch: "word ".repeat(28).trim() });
    expect(long.text.length).toBeGreaterThan(140);
    const x = shareTargets(long).find((t) => t.network === "x")!;
    expect(x.used).toBeLessThanOrEqual(280);
  });

  it("on a development stack the link is the local address (the share panel only; a connector's draft must be https)", () => {
    const d = page({ origin: "http://localhost:3000" });
    expect(d.link).toBe("http://localhost:3000/p/maple-bakes?via=p.maple-bakes");
    expect(PostDraftSchema.safeParse(d).success).toBe(false);
  });
});

describe("writtenPostDraft", () => {
  it("keeps the post's own words, and points at the project's page only while it is published", () => {
    const text = "  Fresh loaves out at seven.\nCome early.  ";
    expect(writtenPostDraft({ text })).toEqual({ text: "Fresh loaves out at seven.\nCome early.", variants: {} });
    expect(writtenPostDraft({ text, page: null })).toEqual({ text: "Fresh loaves out at seven.\nCome early.", variants: {} });
    const withPage = writtenPostDraft({ text, page: { origin: ORIGIN, slug: "maple-bakes", projectName: "Maple Bakes", pitch: "Sourdough, baked each morning" } });
    expect(withPage).toEqual({ text: "Fresh loaves out at seven.\nCome early.", link: `${ORIGIN}/p/maple-bakes?via=p.maple-bakes`, image: page().image, variants: {} });
    // With no link, the networks that take text still open; nothing is invented for the rest.
    const noLink = shareTargets(writtenPostDraft({ text }));
    expect(noLink.filter((t) => t.kind === "tap").map((t) => t.network)).toEqual(TAP_POST_NETWORKS);
    expect(noLink.every((t) => t.link === undefined)).toBe(true);
  });
});

describe("every draft", () => {
  it("has a target on every network that has one, and the words on its controls are plain", () => {
    for (const d of [milestone(), page(), writtenPostDraft({ text: "A post." })]) {
      expect(shareTargets(d).length).toBeGreaterThan(0);
      for (const network of POST_NETWORKS) expect(postDraftFor(d, network).text.length, network).toBeGreaterThan(0);
    }
    expect(SHARE_OPEN_WORDS.share).toBe("Share");
    expect(SHARE_OPEN_WORDS.sharePage).toBe("Share your page");
    expect(SHARE_OPEN_WORDS.milestoneTitle(" Page  live ")).toBe("Share “Page live”");
    expect(Object.values(SHARE_OPEN_WORDS).map((w) => (typeof w === "string" ? w : w("Page live"))).join(" ")).not.toMatch(/\b(posted|published)\b/i);
  });
});
