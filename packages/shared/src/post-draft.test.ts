import { describe, expect, it } from "vitest";
import {
  POST_DEFAULT_LIMIT,
  POST_NETWORKS,
  POST_NETWORK_LIMITS,
  POST_TEXT_MAX,
  fitPostDraft,
  fitPostText,
  isPostNetwork,
  isPostUrl,
  postDraftFor,
  postLinkLength,
  postNetworkLimit,
  postTextBudget,
  postTextLength,
  postTextWithLink,
  withPostText,
  type PostDraft,
  type PostNetwork,
} from "./post-draft";
import { PostDraft as PostDraftSchema, PostDraftImage, PostDraftVariant, PostNetwork as PostNetworkSchema, PostUrl } from "./types";

const LINK = "https://foundmill.example/p/maple-bakes?via=p.maple-bakes";
const draft = (text: string, over: Partial<PostDraft> = {}): PostDraft => ({ text, link: LINK, variants: {}, ...over });
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
/** No half of an emoji left behind (a lone surrogate). */
const whole = (s: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
const used = (d: PostDraft, network: PostNetwork) => {
  const post = postDraftFor(d, network);
  return postTextLength(post.text, network) + postLinkLength(post.link, network);
};

describe("the network list", () => {
  it("starts with the eight agreed, in order, and only ever grows at its end", () => {
    expect(POST_NETWORKS.slice(0, 8)).toEqual(["x", "linkedin", "facebook", "threads", "reddit", "bluesky", "instagram", "tiktok"]);
    expect(new Set(POST_NETWORKS).size).toBe(POST_NETWORKS.length);
    expect(isPostNetwork("x")).toBe(true);
    expect(isPostNetwork("pinterest")).toBe(false);
    expect(isPostNetwork(7)).toBe(false);
  });

  it("gives every network of today its own limit, and a network added later the strictest one until it has its own", () => {
    for (const network of POST_NETWORKS.slice(0, 8)) expect(POST_NETWORK_LIMITS[network], network).toBeDefined();
    expect(POST_NETWORK_LIMITS).toMatchObject({
      x: { max: 280, link: "fixed", linkLength: 23, weighted: true },
      linkedin: { max: 3000, link: "full" },
      facebook: { max: 63_206, link: "full" },
      threads: { max: 500, link: "full" },
      reddit: { max: 40_000, link: "apart", titleMax: 300 },
      bluesky: { max: 300, link: "full" },
      instagram: { max: 2200, link: "full" },
      tiktok: { max: 2200, link: "full" },
    });
    // Nothing assumes the list is exactly these: a name not in the table still gets an answer.
    const later = "pinterest" as PostNetwork;
    expect(postNetworkLimit(later)).toBe(POST_DEFAULT_LIMIT);
    expect(Math.min(...POST_NETWORKS.map((n) => postNetworkLimit(n).max))).toBe(POST_DEFAULT_LIMIT.max);
    const fitted = fitPostDraft(draft(words(200)), [later]);
    expect(used(fitted, later)).toBeLessThanOrEqual(POST_DEFAULT_LIMIT.max);
    expect(postDraftFor(fitted, later).link).toBe(LINK);
  });
});

describe("counting", () => {
  it("counts a link as each network counts it", () => {
    // X: 23 whatever the length, and the blank line before it.
    expect(postLinkLength(LINK, "x")).toBe(25);
    expect(postLinkLength("https://a.example/" + "x".repeat(400), "x")).toBe(25);
    // In full on the others.
    expect(postLinkLength(LINK, "bluesky")).toBe(LINK.length + 2);
    expect(postLinkLength(LINK, "threads")).toBe(LINK.length + 2);
    // Reddit's link is its own field.
    expect(postLinkLength(LINK, "reddit")).toBe(0);
    expect(postLinkLength(undefined, "x")).toBe(0);
    expect(postTextBudget(LINK, "x")).toBe(255);
    expect(postTextBudget(undefined, "x")).toBe(280);
    expect(postTextBudget("https://a.example/" + "x".repeat(400), "bluesky")).toBe(0);
  });

  it("counts X's wide characters double and an address in the text as 23", () => {
    expect(postTextLength("hello", "x")).toBe(5);
    expect(postTextLength("héllo, “quoted”", "x")).toBe(15);
    expect(postTextLength("日本語", "x")).toBe(6);
    expect(postTextLength("🎉", "x")).toBe(2);
    expect(postTextLength("see https://example.com/a/very/long/path/that/goes/on/and/on now", "x")).toBe("see  now".length + 23);
    expect(postTextLength("see example.com now", "x")).toBe("see  now".length + 23);
    // An email address is not a link.
    expect(postTextLength("write to maya@example.com", "x")).toBe("write to maya@example.com".length);
    // The others count what is there.
    expect(postTextLength("日本語", "bluesky")).toBe(3);
    expect(postTextLength("see https://example.com now", "threads")).toBe("see https://example.com now".length);
  });
});

describe("fitPostDraft", () => {
  it("leaves a short text as it is on every network, with the link", () => {
    const text = "Maple Bakes: Sourdough, baked each morning.";
    const fitted = fitPostDraft(draft(text));
    for (const network of POST_NETWORKS) {
      const post = postDraftFor(fitted, network);
      expect(post.text, network).toBe(text);
      expect(post.link, network).toBe(LINK);
      expect(used(fitted, network), network).toBeLessThanOrEqual(postNetworkLimit(network).max);
    }
    // Reddit's post has a title.
    expect(fitted.variants.reddit?.title).toBe(text);
    expect(fitted.variants.x?.title).toBeUndefined();
    // The draft's own words are untouched.
    expect(fitted.text).toBe(text);
    expect(fitted.link).toBe(LINK);
  });

  it("shortens a text that is far too long to each network's limit, at a word, with an ellipsis, and never touches the link", () => {
    const long = words(2000);
    expect(long.length).toBeGreaterThan(POST_TEXT_MAX);
    const fitted = fitPostDraft(draft(long));
    for (const network of POST_NETWORKS) {
      const limit = postNetworkLimit(network);
      const post = postDraftFor(fitted, network);
      expect(used(fitted, network), network).toBeLessThanOrEqual(limit.max);
      expect(post.link, network).toBe(LINK);
      if (long.length + postLinkLength(LINK, network) > limit.max) {
        expect(post.text.endsWith("…"), network).toBe(true);
        // Cut at a whole word: what is left, without the ellipsis, is the start of the text and ends on a word.
        const kept = post.text.slice(0, -1);
        expect(long.startsWith(kept), network).toBe(true);
        expect(/^\s/.test(long.slice(kept.length)), network).toBe(true);
        // And it uses the room it has: one more word would not fit.
        const next = long.slice(0, long.indexOf(" ", kept.length + 1));
        expect(postTextLength(`${next}…`, network) + postLinkLength(LINK, network), network).toBeGreaterThan(limit.max);
      } else {
        expect(post.text, network).toBe(long);
      }
    }
    expect(fitted.variants.x!.text.length).toBeLessThanOrEqual(255);
    expect(fitted.variants.bluesky!.text.length).toBeLessThanOrEqual(300 - LINK.length - 2);
    expect(fitted.variants.threads!.text.length).toBeLessThanOrEqual(500 - LINK.length - 2);
    expect(fitted.variants.reddit!.title!.length).toBeLessThanOrEqual(300);
    expect(fitted.variants.reddit!.title!.endsWith("…")).toBe(true);
    expect(fitted.variants.linkedin!.text.length).toBeLessThanOrEqual(3000 - LINK.length - 2);
    expect(fitted.variants.instagram!.text.length).toBeLessThanOrEqual(2200 - LINK.length - 2);
    expect(fitted.variants.tiktok!.text.length).toBeLessThanOrEqual(2200 - LINK.length - 2);
    expect(fitted.variants.facebook!.text).toBe(long);
  });

  it("uses the whole limit when there is no link", () => {
    const long = words(2000);
    const fitted = fitPostDraft({ text: long, variants: {} });
    for (const network of POST_NETWORKS) {
      const post = postDraftFor(fitted, network);
      expect(post.link, network).toBeUndefined();
      expect(postTextLength(post.text, network), network).toBeLessThanOrEqual(postNetworkLimit(network).max);
    }
    expect(postTextLength(fitted.variants.x!.text, "x")).toBeGreaterThan(270);
    expect(fitPostText("Short and done.", undefined, "x")).toBe("Short and done.");
  });

  it("counts characters that need encoding as the network counts them, and never cuts one in half", () => {
    const text = `${"🎉 ".repeat(200)}& "quotes" #tag ?x=1`;
    const fitted = fitPostDraft(draft(text));
    const x = fitted.variants.x!.text;
    expect(postTextLength(x, "x") + postLinkLength(LINK, "x")).toBeLessThanOrEqual(280);
    // Every emoji that is left is whole.
    expect(whole(x)).toBe(true);
    expect(Array.from(x.slice(0, -1).replace(/ /g, "")).every((ch) => ch === "🎉")).toBe(true);
    // One unbroken run with no space is cut inside the run, still on a whole symbol.
    const run = fitPostText("🎉".repeat(400), LINK, "x");
    expect(whole(run)).toBe(true);
    expect(whole("\ud83c")).toBe(false);
    expect(postTextLength(run, "x")).toBeLessThanOrEqual(255);
    expect(run.endsWith("…")).toBe(true);
  });

  it("never cuts an address in the text in half", () => {
    const inText = "https://example.com/a/long/address/inside/the/text";
    const text = `${words(30)} ${inText} ${words(40)}`;
    for (const network of ["x", "bluesky", "threads"] as const) {
      const fittedText = fitPostText(text, LINK, network);
      expect(fittedText.includes("https://") ? fittedText.includes(inText) : true, network).toBe(true);
    }
  });

  it("keeps a link whatever its length: the text gives way, down to nothing", () => {
    const huge = `https://foundmill.example/p/x?${"q".repeat(400)}`;
    const fitted = fitPostDraft(draft("Some words that cannot fit beside this link.", { link: huge }), ["bluesky"]);
    expect(fitted.variants.bluesky).toEqual({ text: "" });
    expect(postDraftFor(fitted, "bluesky").link).toBe(huge);
    expect(postTextWithLink(postDraftFor(fitted, "bluesky"))).toBe(huge);
  });

  it("starts from a variant the draft already carries, and leaves the networks not asked for alone", () => {
    const own = { text: "For X only.", link: "https://foundmill.example/m/1?via=p.maple-bakes", image: { url: "https://foundmill.example/m/1/opengraph-image", alt: "Card" } };
    const d = draft("For everyone.", { variants: { x: own, tiktok: { text: words(2000) } } });
    const fitted = fitPostDraft(d, ["x", "bluesky"]);
    expect(fitted.variants.x).toEqual(own);
    expect(postDraftFor(fitted, "x")).toEqual(own);
    expect(fitted.variants.bluesky).toEqual({ text: "For everyone." });
    expect(fitted.variants.tiktok).toEqual(d.variants.tiktok);
    expect(fitted.variants.linkedin).toBeUndefined();
    // A variant's own title is the start of Reddit's.
    expect(fitPostDraft(draft("Body.", { variants: { reddit: { text: "Body for Reddit.", title: "A title" } } })).variants.reddit).toEqual({ text: "Body for Reddit.", title: "A title" });
  });
});

describe("withPostText", () => {
  it("changes the words everywhere they were the draft's own, and leaves a variant's own words, links and pictures alone", () => {
    const tall = { url: "https://foundmill.example/m/1/story-image", alt: "Card" };
    const d: PostDraft = { text: "Base.", link: LINK, variants: { instagram: { text: "Base.", image: tall }, reddit: { text: "Own words for Reddit.", title: "Own title" } } };
    const changed = withPostText(d, "New words.");
    expect(changed.text).toBe("New words.");
    expect(changed.link).toBe(LINK);
    expect(changed.variants.instagram).toEqual({ text: "New words.", image: tall });
    expect(changed.variants.reddit).toEqual(d.variants.reddit);
    expect(postDraftFor(changed, "x").text).toBe("New words.");
    expect(postDraftFor(changed, "instagram")).toEqual({ text: "New words.", link: LINK, image: tall });
    // The draft handed in is never changed, and the same words give the same draft back.
    expect(d.text).toBe("Base.");
    expect(d.variants.instagram?.text).toBe("Base.");
    expect(withPostText(d, "Base.")).toBe(d);
  });
});

describe("postDraftFor and postTextWithLink", () => {
  it("lays the variant over the draft", () => {
    const image = { url: "https://foundmill.example/p/maple-bakes/opengraph-image", alt: "Maple Bakes" };
    const d: PostDraft = { text: "Base.", link: LINK, image, variants: { reddit: { text: "Own.", title: "Own title" } } };
    expect(postDraftFor(d, "x")).toEqual({ text: "Base.", link: LINK, image });
    expect(postDraftFor(d, "reddit")).toEqual({ text: "Own.", title: "Own title", link: LINK, image });
    expect(postDraftFor({ text: "Base.", variants: {} }, "x")).toEqual({ text: "Base." });
  });

  it("puts the link after a blank line, and stands alone without a text or a link", () => {
    expect(postTextWithLink({ text: " Words. ", link: LINK })).toBe(`Words.\n\n${LINK}`);
    expect(postTextWithLink({ text: "Words." })).toBe("Words.");
    expect(postTextWithLink({ text: "", link: LINK })).toBe(LINK);
  });
});

describe("isPostUrl and the Zod schemas", () => {
  const good = ["https://foundmill.example/p/maple-bakes?via=p.maple-bakes", "https://foundmill.example/m/1/opengraph-image", "HTTPS://Foundmill.example/"];
  const bad: unknown[] = [
    "http://foundmill.example/p/maple-bakes",
    "https://maya:secret@foundmill.example/p/x",
    "https://maya@foundmill.example/p/x",
    "https://@foundmill.example/p/x",
    "not a url",
    "foundmill.example/p/x",
    "/p/maple-bakes",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://foundmill.example/x",
    "https://",
    "https:///p/x",
    "https://foundmill.example/a b",
    "https://foundmill.example\\@evil.example/",
    "https:\\\\foundmill.example/",
    "https://foundmill.example/\nx",
    "",
    null,
    7,
    `https://foundmill.example/${"x".repeat(2100)}`,
  ];

  it("takes an https address with no credentials and nothing else", () => {
    for (const url of good) expect(isPostUrl(url), url).toBe(true);
    for (const url of bad) expect(isPostUrl(url), String(url)).toBe(false);
    // A path or a query may hold an @; only the part before the host is a user name.
    expect(isPostUrl("https://foundmill.example/u/@maya?to=a@b.example")).toBe(true);
  });

  it("refuses a bad link or picture address at parse, on the draft and on every variant", () => {
    const image = { url: good[1]!, alt: "Card" };
    const ok = { text: "Words.", link: good[0], image, variants: { x: { text: "For X.", link: good[0], image }, reddit: { text: "Body.", title: "Title" } } };
    expect(PostDraftSchema.parse(ok)).toEqual(ok);
    // `variants` defaults to none.
    expect(PostDraftSchema.parse({ text: "Words." })).toEqual({ text: "Words.", variants: {} });
    for (const url of bad.filter((u) => u !== null)) {
      expect(PostUrl.safeParse(url).success, String(url)).toBe(false);
      expect(PostDraftSchema.safeParse({ ...ok, link: url }).success, `link ${String(url)}`).toBe(false);
      expect(PostDraftSchema.safeParse({ ...ok, image: { url, alt: "x" } }).success, `image ${String(url)}`).toBe(false);
      expect(PostDraftSchema.safeParse({ ...ok, variants: { x: { text: "t", link: url } } }).success, `variant link ${String(url)}`).toBe(false);
      expect(PostDraftSchema.safeParse({ ...ok, variants: { tiktok: { text: "t", image: { url, alt: "x" } } } }).success, `variant image ${String(url)}`).toBe(false);
      expect(PostDraftVariant.safeParse({ text: "t", link: url }).success).toBe(false);
      expect(PostDraftImage.safeParse({ url, alt: "x" }).success).toBe(false);
    }
  });

  it("holds the rest of the shape: a text, known networks, bounded lengths", () => {
    expect(PostDraftSchema.safeParse({ text: "", variants: {} }).success).toBe(false);
    expect(PostDraftSchema.safeParse({ text: "x".repeat(POST_TEXT_MAX + 1), variants: {} }).success).toBe(false);
    expect(PostDraftSchema.safeParse({ text: "ok", variants: { myspace: { text: "t" } } }).success).toBe(false);
    expect(PostDraftSchema.safeParse({ text: "ok", variants: { reddit: { text: "t", title: "x".repeat(301) } } }).success).toBe(false);
    expect(PostNetworkSchema.options).toEqual([...POST_NETWORKS]);
    // A fitted draft with an https link parses as it is.
    const fitted = fitPostDraft(draft(words(1000)));
    expect(fitted.text.length).toBeLessThan(POST_TEXT_MAX);
    expect(PostDraftSchema.safeParse(fitted).success).toBe(true);
  });
});
