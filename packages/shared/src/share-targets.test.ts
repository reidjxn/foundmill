import { describe, expect, it } from "vitest";
import { POST_NETWORKS, fitPostDraft, postDraftFor, postNetworkLimit, type PostDraft, type PostNetwork } from "./post-draft";
import {
  MESSAGE_APPS,
  MESSAGE_APP_HOSTS,
  SHARE_DESTINATIONS,
  SHARE_KIND_WORDS,
  SHARE_OPEN_TARGETS,
  SHARE_PANEL_WORDS,
  SHARE_SUBJECT_KINDS,
  TAP_POST_NETWORKS,
  encodeShareValue,
  messageTargets,
  postsByTap,
  shareCountWords,
  shareHostOf,
  shareKindOf,
  shareParamsOf,
  shareTargets,
  type ShareTarget,
} from "./share-targets";

const LINK = "https://foundmill.example/m/0b9d1c1e-1111-4222-8333-444455556666?via=p.maple-bakes";
const TEXT = "Maple Bakes reached a milestone: Page live.";
const draft = (text = TEXT, over: Partial<PostDraft> = {}): PostDraft => ({ text, link: LINK, variants: {}, ...over });
const byNetwork = (targets: ShareTarget[]) => Object.fromEntries(targets.map((t) => [t.network, t])) as Record<PostNetwork, ShareTarget>;
/** The query of an address as the network will read it: decoded pairs, in order. */
const query = (href: string): [string, string][] => [...new URL(href).searchParams.entries()];

/** Things a founder may type: every one of them must arrive as text and change nothing else about the address. */
const AWKWARD = `Ben & Jerry's "best" #1? 50% off + more = yes; see https://evil.example/?a=1&b=2#frag\nnew line\ttab 🎉 日本語 <b>bold</b> \\ / @maya ¿qué? &url=https://evil.example &text=x %26 %00`;

describe("the kinds, as checked on Nov 12, 2026", () => {
  it("classifies every network of today into exactly one kind", () => {
    const expected = { x: "tap", linkedin: "link_only", facebook: "link_only", threads: "tap", reddit: "link_only", bluesky: "tap", instagram: "copy", tiktok: "copy" } as const;
    for (const [network, kind] of Object.entries(expected)) expect(shareKindOf(network as PostNetwork), network).toBe(kind);
    // The list only grows at its end, so today's eight are its first eight; a network after them is not judged here.
    expect(POST_NETWORKS.slice(0, 8)).toEqual(Object.keys(expected));
    expect(TAP_POST_NETWORKS.filter((n) => n in expected)).toEqual(["x", "threads", "bluesky"]);
    expect(postsByTap()).toBe(true);
    // A network added to the list later has no target until someone writes one.
    expect(shareKindOf("pinterest" as PostNetwork)).toBeNull();
    expect(shareHostOf("pinterest" as PostNetwork)).toBeNull();
    expect(shareParamsOf("pinterest" as PostNetwork)).toEqual([]);
  });

  it("returns one target per network that has one, in the list's order, and nothing for a network it does not know", () => {
    const known = POST_NETWORKS.filter((n) => shareKindOf(n) !== null);
    expect(known.slice(0, 8)).toEqual(["x", "linkedin", "facebook", "threads", "reddit", "bluesky", "instagram", "tiktok"]);
    const targets = shareTargets(draft());
    expect(targets.map((t) => t.network)).toEqual(known);
    const withStranger = shareTargets(draft(TEXT, { variants: { ["pinterest" as PostNetwork]: { text: "Pinned." } } }));
    expect(withStranger.map((t) => t.network)).toEqual(known);
  });
});

describe("every address", () => {
  const t = byNetwork(shareTargets(draft()));

  it("X opens with the text and the link", () => {
    expect(t.x.kind).toBe("tap");
    expect(t.x.label).toBe("X");
    expect(t.x.href).toBe(`https://x.com/intent/post?text=${encodeShareValue(TEXT)}&url=${encodeShareValue(LINK)}`);
    expect(t.x.href).toBe("https://x.com/intent/post?text=Maple%20Bakes%20reached%20a%20milestone%3A%20Page%20live.&url=https%3A%2F%2Ffoundmill.example%2Fm%2F0b9d1c1e-1111-4222-8333-444455556666%3Fvia%3Dp.maple-bakes");
    expect(query(t.x.href!)).toEqual([["text", TEXT], ["url", LINK]]);
  });

  it("Threads opens with the text and the link", () => {
    expect(t.threads.kind).toBe("tap");
    expect(t.threads.href).toBe(`https://www.threads.com/intent/post?text=${encodeShareValue(TEXT)}&url=${encodeShareValue(LINK)}`);
    expect(query(t.threads.href!)).toEqual([["text", TEXT], ["url", LINK]]);
  });

  it("Bluesky opens with one text that ends in the link", () => {
    expect(t.bluesky.kind).toBe("tap");
    expect(t.bluesky.href).toBe(`https://bsky.app/intent/compose?text=${encodeShareValue(`${TEXT}\n\n${LINK}`)}`);
    expect(query(t.bluesky.href!)).toEqual([["text", `${TEXT}\n\n${LINK}`]]);
  });

  it("LinkedIn and Facebook open with the link and carry no text", () => {
    expect(t.linkedin.kind).toBe("link_only");
    expect(t.linkedin.href).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeShareValue(LINK)}`);
    expect(query(t.linkedin.href!)).toEqual([["url", LINK]]);
    expect(t.facebook.kind).toBe("link_only");
    expect(t.facebook.href).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeShareValue(LINK)}`);
    expect(query(t.facebook.href!)).toEqual([["u", LINK]]);
    for (const network of ["linkedin", "facebook"] as const) expect(t[network].href, network).not.toContain(encodeShareValue("Maple"));
    expect(SHARE_KIND_WORDS.link_only.note).toBe("Opens with your link; the text is not carried.");
  });

  it("Reddit opens with the link and a title, and says the community is the founder's to choose", () => {
    expect(t.reddit.kind).toBe("link_only");
    expect(t.reddit.href).toBe(`https://www.reddit.com/submit?url=${encodeShareValue(LINK)}&title=${encodeShareValue(TEXT)}`);
    expect(query(t.reddit.href!)).toEqual([["url", LINK], ["title", TEXT]]);
    expect(t.reddit.note).toBe("Opens with your title and link. You choose the community there.");
  });

  it("Instagram and TikTok have no address: the text is copied", () => {
    for (const network of ["instagram", "tiktok"] as const) {
      expect(t[network].kind).toBe("copy");
      expect(t[network].href).toBeUndefined();
      expect(t[network].copyText).toBe(`${TEXT}\n\n${LINK}`);
    }
    expect(t.instagram.label).toBe("Instagram");
    expect(t.tiktok.label).toBe("TikTok");
  });

  it("is https to the network's own host, with only that network's parameters, whatever the founder typed", () => {
    for (const text of [AWKWARD, AWKWARD.repeat(40), "x", "@evil.example/path", "//evil.example", "https://evil.example", "?text=other&url=https://evil.example#x"]) {
      const d = draft(text);
      const fitted = fitPostDraft(d);
      for (const target of shareTargets(d)) {
        if (!target.href) continue;
        const url = new URL(target.href);
        const where = `${target.network}: ${text.slice(0, 30)}`;
        expect(url.protocol, where).toBe("https:");
        expect(url.host, where).toBe(shareHostOf(target.network));
        expect(url.username + url.password + url.port + url.hash, where).toBe("");
        expect(target.href.startsWith(`https://${shareHostOf(target.network)}/`), where).toBe(true);
        // Only the parameters this network takes, each once.
        const keys = [...url.searchParams.keys()];
        expect(new Set(keys).size, where).toBe(keys.length);
        for (const key of keys) expect(shareParamsOf(target.network), where).toContain(key);
        // Nothing raw in the address: every value is letters, digits, -._~ and percent escapes.
        const raw = target.href.slice(target.href.indexOf("?") + 1);
        for (const pair of raw.split("&")) expect(pair, where).toMatch(/^[a-z]+=(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})+$/);
        // The values are the fitted variant's and nothing else.
        const post = postDraftFor(fitted, target.network);
        const values = Object.fromEntries(url.searchParams.entries());
        if (target.network === "bluesky") expect(values.text, where).toBe(`${post.text}\n\n${post.link}`);
        else if (target.network === "reddit") expect(values, where).toEqual({ url: post.link, title: post.title });
        else if (target.kind === "tap") expect(values, where).toEqual({ text: post.text, url: post.link });
        else expect(Object.values(values), where).toEqual([post.link]);
      }
    }
  });

  it("builds from the fitted variant: a text too long for a network arrives shortened, with the whole link", () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const targets = byNetwork(shareTargets(draft(long)));
    for (const network of TAP_POST_NETWORKS) {
      const target = targets[network];
      expect(target.shortened, network).toBe(true);
      expect(target.used, network).toBeLessThanOrEqual(target.max);
      expect(target.max, network).toBe(postNetworkLimit(network).max);
      expect(target.text.endsWith("…"), network).toBe(true);
      expect(target.href, network).toContain(encodeShareValue(LINK));
      expect(target.link, network).toBe(LINK);
    }
    expect(query(targets.x.href!)[0]![1]).toBe(targets.x.text);
    // Reddit's title is cut to its own limit.
    expect(query(targets.reddit.href!)[1]![1].length).toBeLessThanOrEqual(300);
    // A network with room keeps every word.
    expect(targets.facebook.shortened).toBe(false);
    expect(byNetwork(shareTargets(draft())).x.shortened).toBe(false);
  });

  it("a draft with no link still opens the networks that take text; a link-only window has nothing to open, so its text is copied", () => {
    const targets = byNetwork(shareTargets({ text: TEXT, variants: {} }));
    expect(targets.x.href).toBe(`https://x.com/intent/post?text=${encodeShareValue(TEXT)}`);
    expect(targets.threads.href).toBe(`https://www.threads.com/intent/post?text=${encodeShareValue(TEXT)}`);
    expect(targets.bluesky.href).toBe(`https://bsky.app/intent/compose?text=${encodeShareValue(TEXT)}`);
    for (const network of ["linkedin", "facebook", "reddit"] as const) {
      expect(targets[network].kind, network).toBe("copy");
      expect(targets[network].href, network).toBeUndefined();
      expect(targets[network].note, network).toBeUndefined();
      expect(targets[network].copyText, network).toBe(TEXT);
    }
  });

  it("carries each network's own picture and link where the draft has them", () => {
    const wide = { url: "https://foundmill.example/m/1/opengraph-image", alt: "Card" };
    const tall = { url: "https://foundmill.example/m/1/story-image", alt: "Card" };
    const targets = byNetwork(shareTargets(draft(TEXT, { image: wide, variants: { instagram: { text: TEXT, image: tall } } })));
    expect(targets.x.image).toEqual(wide);
    expect(targets.instagram.image).toEqual(tall);
    expect(targets.tiktok.image).toEqual(wide);
  });
});

describe("encodeShareValue", () => {
  it("encodes everything but letters, digits and -._~, and never throws on half an emoji", () => {
    expect(encodeShareValue("a b&c=d?e#f/g:h'i\"j(k)l*m!n+o%p")).toBe("a%20b%26c%3Dd%3Fe%23f%2Fg%3Ah%27i%22j%28k%29l%2Am%21n%2Bo%25p");
    expect(encodeShareValue("line\nbreak")).toBe("line%0Abreak");
    expect(encodeShareValue("🎉")).toBe("%F0%9F%8E%89");
    expect(encodeShareValue("A-Z_a.z~09")).toBe("A-Z_a.z~09");
    expect(encodeShareValue("\ud83c")).toBe("%EF%BF%BD");
    expect(encodeShareValue("x\udf89y")).toBe("x%EF%BF%BDy");
    expect(decodeURIComponent(encodeShareValue(AWKWARD))).toBe(AWKWARD);
  });
});

describe("sending to someone", () => {
  it("WhatsApp takes one text that ends in the link; Telegram takes the link and the text", () => {
    const [whatsapp, telegram] = messageTargets(draft());
    expect(whatsapp).toEqual({ app: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${encodeShareValue(`${TEXT}\n\n${LINK}`)}` });
    expect(telegram).toEqual({ app: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${encodeShareValue(LINK)}&text=${encodeShareValue(TEXT)}` });
    expect(query(whatsapp!.href)).toEqual([["text", `${TEXT}\n\n${LINK}`]]);
    expect(query(telegram!.href)).toEqual([["url", LINK], ["text", TEXT]]);
  });

  it("is https to the app's own host whatever was typed, keeps a long message readable, and leaves Telegram out with no link", () => {
    for (const text of [AWKWARD, AWKWARD.repeat(40)]) {
      for (const target of messageTargets(draft(text))) {
        const url = new URL(target.href);
        expect(url.protocol).toBe("https:");
        expect(url.host).toBe(MESSAGE_APP_HOSTS[target.app]);
        expect([...url.searchParams.keys()]).toEqual(target.app === "whatsapp" ? ["text"] : ["url", "text"]);
        const said = url.searchParams.get("text")!;
        expect(Array.from(said.replace(`\n\n${LINK}`, "")).length).toBeLessThanOrEqual(1000);
        if (target.app === "telegram") expect(url.searchParams.get("url")).toBe(LINK);
        else expect(said.endsWith(LINK)).toBe(true);
      }
    }
    expect(messageTargets({ text: TEXT }).map((m) => m.app)).toEqual(["whatsapp"]);
    expect(messageTargets({ text: TEXT })[0]!.href).toBe(`https://wa.me/?text=${encodeShareValue(TEXT)}`);
  });

  it("is never one of the networks", () => {
    expect(MESSAGE_APPS).toEqual(["whatsapp", "telegram"]);
    for (const app of MESSAGE_APPS) expect((POST_NETWORKS as readonly string[]).includes(app)).toBe(false);
    expect(shareTargets(draft()).some((t) => (MESSAGE_APPS as readonly string[]).includes(t.network))).toBe(false);
  });
});

describe("the words and the record", () => {
  it("never says a press posted anything", () => {
    const said = [...Object.values(SHARE_KIND_WORDS).flatMap((w) => [w.title, w.note]), SHARE_PANEL_WORDS.honest("Foundmill"), SHARE_PANEL_WORDS.textHint, ...shareTargets(draft()).map((t) => t.note ?? "")].join(" ");
    expect(said).not.toMatch(/\b(posted|published|sent)\b/i);
    expect(SHARE_PANEL_WORDS.honest("Foundmill")).toBe("Foundmill posts nothing for you. Each button opens that network's own window, and you press Post there.");
    expect(SHARE_KIND_WORDS.tap.title).toBe("Opens ready to post");
    expect(SHARE_KIND_WORDS.link_only.title).toBe("Opens with your link");
    expect(SHARE_KIND_WORDS.copy.title).toBe("Copy and post in the app");
    expect(shareCountWords(212, 280)).toBe("212 of 280");
    expect(shareCountWords(1200, 63206)).toBe("1,200 of 63,206");
  });

  it("names what a share event may carry", () => {
    expect(SHARE_SUBJECT_KINDS).toEqual(["milestone", "page", "draft"]);
    expect(SHARE_OPEN_TARGETS).toEqual(["tap", "link_only", "copy", "message", "device"]);
    expect(SHARE_DESTINATIONS).toEqual([...POST_NETWORKS, ...MESSAGE_APPS]);
  });
});
