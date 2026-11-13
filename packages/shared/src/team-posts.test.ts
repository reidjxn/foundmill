import { describe, expect, it } from "vitest";
import { postDraftFor, postTextBudget } from "./post-draft";
import { TAP_POST_NETWORKS, shareTargets } from "./share-targets";
import {
  TEAM_POST_CAPS,
  TEAM_POST_CODE_FOR_LENGTH,
  TEAM_POST_DAY_MS,
  TEAM_POST_REF_PREFIX,
  TEAM_POST_SUBJECTS,
  TEAM_POST_SUBJECT_LABELS,
  TEAM_POST_TEXT_MAX,
  TEAM_POST_TRIGGERS,
  TEAM_POST_WEEK_MS,
  TEAM_POST_WORDS,
  isTeamPost,
  parseTeamPostRef,
  teamPostFits,
  teamPostRef,
  teamPostShareDraft,
  teamPostTextBudget,
  teamPostTitle,
} from "./team-posts";
import { parseVia, VIA_PARAM } from "./via";

const ORIGIN = "https://foundmill.example";
const PAGE_ID = "0b9d1c1e-1111-4222-8333-444455556666";
const MILESTONE_ID = "1c2d3e4f-aaaa-4bbb-8ccc-ddddeeeeffff";
const page = { origin: ORIGIN, slug: "maple-bakes", projectName: "Maple Bakes", pitch: "Sourdough, baked each morning" };

describe("the caps", () => {
  it("are small, live in one place and are counted over a day and a week", () => {
    // Pinned: a higher cap spends more of a founder's credits, so changing one is a decision.
    expect(TEAM_POST_CAPS).toEqual({ perDay: 2, perWeek: 5 });
    expect(TEAM_POST_CAPS.perDay).toBeLessThanOrEqual(TEAM_POST_CAPS.perWeek);
    expect(TEAM_POST_DAY_MS).toBe(86_400_000);
    expect(TEAM_POST_WEEK_MS).toBe(7 * 86_400_000);
  });
});

describe("the reference a team post carries", () => {
  it("names the trigger, the subject and the row, and reads back the same", () => {
    const ref = { trigger: "page_published", subject: "page_live", refId: PAGE_ID } as const;
    expect(teamPostRef(ref)).toBe(`post-draft:page_published:page_live:${PAGE_ID}`);
    expect(parseTeamPostRef(teamPostRef(ref))).toEqual(ref);
    expect(parseTeamPostRef(teamPostRef({ trigger: "milestone_shown", subject: "first_follower", refId: MILESTONE_ID.toUpperCase() }))).toEqual({ trigger: "milestone_shown", subject: "first_follower", refId: MILESTONE_ID });
    for (const trigger of TEAM_POST_TRIGGERS) for (const subject of TEAM_POST_SUBJECTS) expect(parseTeamPostRef(teamPostRef({ trigger, subject, refId: PAGE_ID }))).toEqual({ trigger, subject, refId: PAGE_ID });
  });

  it("is nothing else: an address, a file name, another prefix, an unknown trigger or subject, an id that is not one", () => {
    for (const bad of [null, undefined, 7, "", "https://example.com/x.png", "creative/post-1.md", `${TEAM_POST_REF_PREFIX}page_published:page_live`, `${TEAM_POST_REF_PREFIX}page_published:page_live:not-an-id`, `${TEAM_POST_REF_PREFIX}launched:page_live:${PAGE_ID}`, `${TEAM_POST_REF_PREFIX}page_published:customer_1:${PAGE_ID}`, `${TEAM_POST_REF_PREFIX}page_published:page_live:${PAGE_ID}:extra`, `draft:page_published:page_live:${PAGE_ID}`])
      expect(parseTeamPostRef(bad), String(bad)).toBeNull();
    expect(isTeamPost({ kind: "post", contentRef: teamPostRef({ trigger: "first_follower", subject: "first_follower", refId: MILESTONE_ID }) })).toBe(true);
    expect(isTeamPost({ kind: "email", contentRef: teamPostRef({ trigger: "first_follower", subject: "first_follower", refId: MILESTONE_ID }) })).toBe(false);
    expect(isTeamPost({ kind: "post", contentRef: null })).toBe(false);
    expect(isTeamPost({ kind: "post", contentRef: "https://example.com/preview" })).toBe(false);
  });

  it("is only ever about a real result recorded from one event: never a customer, a count or money", () => {
    expect([...TEAM_POST_SUBJECTS]).toEqual(["page_live", "first_follower"]);
    expect(TEAM_POST_SUBJECT_LABELS).toEqual({ page_live: "Page live", first_follower: "First follower" });
    expect([...TEAM_POST_TRIGGERS]).toEqual(["page_published", "milestone_shown", "first_follower"]);
  });

  it("gives the asset a title written by code", () => {
    expect(teamPostTitle({ trigger: "page_published", subject: "page_live" })).toBe("A post about your page going live");
    expect(teamPostTitle({ trigger: "first_follower", subject: "first_follower" })).toBe("A post about your first follower");
    expect(teamPostTitle({ trigger: "milestone_shown", subject: "page_live" })).toBe("A post about your milestone: Page live");
  });
});

describe("teamPostShareDraft", () => {
  const text = "We put Maple Bakes online. Sourdough, baked each morning.";

  it("attaches the page's address with its via and the page's share image; the words are the team's", () => {
    const d = teamPostShareDraft({ text: `  ${text} `, ref: { trigger: "page_published", subject: "page_live", refId: PAGE_ID }, page });
    expect(d.text).toBe(text);
    expect(d.link).toBe(`${ORIGIN}/p/maple-bakes?via=p.maple-bakes`);
    expect(parseVia(new URL(d.link!).searchParams.get(VIA_PARAM))).toEqual({ kind: "project_page", ref: "maple-bakes" });
    expect(d.image?.url).toBe(`${ORIGIN}/p/maple-bakes/opengraph-image`);
    expect(d.variants).toEqual({});
    // The first follower's post points to the page too: that is where the next person follows.
    expect(teamPostShareDraft({ text, ref: { trigger: "first_follower", subject: "first_follower", refId: MILESTONE_ID }, page }).link).toBe(d.link);
  });

  it("points a post about a shown milestone to its card while the card is up, and to the page when it is not", () => {
    const ref = { trigger: "milestone_shown", subject: "page_live", refId: MILESTONE_ID } as const;
    const shown = teamPostShareDraft({ text, ref, page, cardShown: true });
    expect(shown.text).toBe(text);
    expect(shown.link).toBe(`${ORIGIN}/m/${MILESTONE_ID}?via=p.maple-bakes`);
    expect(shown.image?.url).toBe(`${ORIGIN}/m/${MILESTONE_ID}/opengraph-image`);
    // The networks that take a tall picture get the card's tall one, with the team's words.
    expect(postDraftFor(shown, "instagram")).toMatchObject({ text, image: { url: `${ORIGIN}/m/${MILESTONE_ID}/story-image` } });
    const hidden = teamPostShareDraft({ text, ref, page, cardShown: false });
    expect(hidden.link).toBe(`${ORIGIN}/p/maple-bakes?via=p.maple-bakes`);
  });

  it("with the post's codes, every network's link carries its own code and the copied link the general one, one via each", () => {
    const networks = { x: "xxxxxxxxx2", linkedin: "lllllllll2", facebook: "fffffffff2", threads: "ttttttttt2", reddit: "rrrrrrrrr2", bluesky: "bbbbbbbbb2", instagram: "iiiiiiiii2", tiktok: "kkkkkkkkk2" } as const;
    const codes = { link: "ggggggggg2", networks };
    const viaOf = (link: string | undefined) => new URL(link!).searchParams.getAll(VIA_PARAM);
    const d = teamPostShareDraft({ text, ref: { trigger: "page_published", subject: "page_live", refId: PAGE_ID }, page, codes });
    expect(d.link).toBe(`${ORIGIN}/p/maple-bakes?via=s.ggggggggg2`);
    for (const t of shareTargets(d)) {
      expect(viaOf(t.link), t.network).toEqual([`s.${networks[t.network as keyof typeof networks]}`]);
      if (t.href) expect(decodeURIComponent(t.href), t.network).not.toContain("via=p.");
      if (t.kind === "tap") expect(t.shortened, t.network).toBe(false);
    }
    // A card post keeps its tall picture and gets the codes too.
    const card = teamPostShareDraft({ text, ref: { trigger: "milestone_shown", subject: "page_live", refId: MILESTONE_ID }, page, cardShown: true, codes });
    expect(postDraftFor(card, "instagram")).toMatchObject({ link: `${ORIGIN}/m/${MILESTONE_ID}?via=s.iiiiiiiii2`, image: { url: `${ORIGIN}/m/${MILESTONE_ID}/story-image` } });
    expect(viaOf(card.link)).toEqual(["s.ggggggggg2"]);
    // A code that is not one changes nothing; no codes (a sample business) keeps the page's via.
    expect(teamPostShareDraft({ text, ref: { trigger: "page_published", subject: "page_live", refId: PAGE_ID }, page, codes: { link: "Not-A-Code", networks: {} } }).link).toBe(`${ORIGIN}/p/maple-bakes?via=p.maple-bakes`);
    expect(teamPostShareDraft({ text, ref: { trigger: "page_published", subject: "page_live", refId: PAGE_ID }, page, codes: null }).link).toBe(`${ORIGIN}/p/maple-bakes?via=p.maple-bakes`);
  });

  it("works out the post's length with a code of the right length", () => {
    expect(TEAM_POST_CODE_FOR_LENGTH).toMatch(/^[a-z2-7]{10}$/);
  });

  it("carries no link while the page is down, and still opens ready to post", () => {
    const d = teamPostShareDraft({ text, ref: { trigger: "page_published", subject: "page_live", refId: PAGE_ID }, page: null });
    expect(d).toEqual({ text, variants: {} });
    const taps = shareTargets(d).filter((t) => t.kind === "tap");
    expect(taps.map((t) => t.network)).toEqual([...TAP_POST_NETWORKS]);
  });

  it("every network that opens ready to post gets the whole text and the link, and a change to the words reaches them all", () => {
    const d = teamPostShareDraft({ text, ref: { trigger: "page_published", subject: "page_live", refId: PAGE_ID }, page });
    for (const t of shareTargets(d).filter((t) => t.kind === "tap")) {
      expect(t.shortened, t.network).toBe(false);
      expect(decodeURIComponent(t.href!), t.network).toContain(text);
      expect(decodeURIComponent(t.href!), t.network).toContain("via=p.maple-bakes");
    }
    for (const t of shareTargets({ ...d, text: "Changed by the founder." }).filter((t) => t.kind === "tap")) expect(decodeURIComponent(t.href!), t.network).toContain("Changed by the founder.");
  });
});

describe("how long a post may be", () => {
  const link = `${ORIGIN}/m/${MILESTONE_ID}?via=p.${"a".repeat(40)}`;

  it("is what the tightest network that opens ready to post takes beside the link, and never more than the ceiling", () => {
    expect(teamPostTextBudget(undefined)).toBe(TEAM_POST_TEXT_MAX);
    expect(teamPostTextBudget(link)).toBe(Math.min(TEAM_POST_TEXT_MAX, ...TAP_POST_NETWORKS.map((n) => postTextBudget(link, n))));
    expect(teamPostTextBudget(link)).toBeLessThan(TEAM_POST_TEXT_MAX);
    expect(teamPostTextBudget(link)).toBeGreaterThan(120);
  });

  it("a post fits when no such network has to shorten it", () => {
    const budget = teamPostTextBudget(link);
    const fits = "Maple Bakes has a page now.";
    expect(teamPostFits(fits, link)).toBe(true);
    for (const t of shareTargets({ text: fits, link, variants: {} }).filter((t) => t.kind === "tap")) expect(t.shortened).toBe(false);
    const long = `${"word ".repeat(Math.ceil(budget / 5))}more words than fit`;
    expect(long.length).toBeGreaterThan(budget);
    expect(teamPostFits(long, link)).toBe(false);
    expect(teamPostFits("Too short", link)).toBe(false);
    expect(teamPostFits("   ", link)).toBe(false);
  });
});

describe("the words", () => {
  it("say one quiet line on Today, and never that anything was posted", () => {
    expect(TEAM_POST_WORDS.today(1)).toBe("A post is ready to share");
    expect(TEAM_POST_WORDS.today(2)).toBe("2 posts are ready to share");
    expect(TEAM_POST_WORDS.dismiss).toBe("Not this one");
    expect(TEAM_POST_WORDS.states.draft).toBe("Not shared yet");
    const all = JSON.stringify({ ...TEAM_POST_WORDS, today: [TEAM_POST_WORDS.today(1), TEAM_POST_WORDS.today(3)] });
    expect(all).not.toMatch(/\bposted\b|\bpublished\b/i);
  });
});
