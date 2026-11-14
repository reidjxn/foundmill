import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { APP_NAME } from "@foundmill/config";
import { milestonePostDraft, pagePostDraft, writtenPostDraft } from "@foundmill/shared/share-drafts";
import { SHARE_KIND_WORDS, encodeShareValue, type ShareOpened } from "@foundmill/shared/share-targets";
import { SharePost, type SharePostProps } from "./SharePost";

const ORIGIN = "https://foundmill.example";
const ID = "0b9d1c1e-1111-4222-8333-444455556666";
const milestone = milestonePostDraft({ origin: ORIGIN, slug: "maple-bakes", projectName: "Maple Bakes", milestoneId: ID, label: "Page live" });
const page = pagePostDraft({ origin: ORIGIN, slug: "maple-bakes", projectName: "Maple Bakes", pitch: "Sourdough, baked each morning" });
const CARD = `${ORIGIN}/m/${ID}?via=p.maple-bakes`;

const panel = (over: Partial<SharePostProps> = {}) => render(<SharePost open onOpenChange={() => undefined} title="Share “Page live”" description="Pick where it goes. The text and the link are ready." draft={milestone} appName={APP_NAME} {...over} />);
const row = (network: string) => document.querySelector(`[data-share-network="${network}"]`) as HTMLElement;
const open = (network: string) => document.querySelector(`a[data-share-open="${network}"]`) as HTMLAnchorElement;
const group = (kind: string) => document.querySelector(`[data-share-group="${kind}"]`) as HTMLElement;
const networksIn = (kind: string) => [...group(kind).querySelectorAll("[data-share-network]")].map((el) => el.getAttribute("data-share-network"));
const textarea = () => document.querySelector("[data-share-text]") as HTMLTextAreaElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SharePost", () => {
  it("shows the draft's words in a field that can be changed, and the link", () => {
    panel();
    expect(screen.getByRole("dialog", { name: "Share “Page live”" })).toBeTruthy();
    expect(screen.getByLabelText("Text")).toBe(textarea());
    expect(textarea().value).toBe("Maple Bakes reached a milestone: Page live.");
    expect(document.querySelector("[data-share-link]")!.textContent).toBe(CARD);
  });

  it("groups the networks by what a press really does, each group under its own words", () => {
    panel();
    expect(networksIn("tap")).toEqual(["x", "threads", "bluesky"]);
    expect(networksIn("link_only")).toEqual(["linkedin", "facebook", "reddit"]);
    expect(networksIn("copy")).toEqual(["instagram", "tiktok"]);
    for (const kind of ["tap", "link_only", "copy"] as const) {
      const g = group(kind);
      expect(within(g).getByRole("heading", { level: 3, name: SHARE_KIND_WORDS[kind].title })).toBeTruthy();
      expect(within(g).getByText(SHARE_KIND_WORDS[kind].note)).toBeTruthy();
    }
    expect(within(group("link_only")).getByText("Opens with your link; the text is not carried.")).toBeTruthy();
    expect(within(row("reddit")).getByText("Opens with your title and link. You choose the community there.")).toBeTruthy();
    // Sending to someone is its own group, after the networks.
    expect(within(group("message")).getByRole("heading", { level: 3, name: "Send to someone" })).toBeTruthy();
    const order = [...document.querySelectorAll("[data-share-group]")].map((el) => el.getAttribute("data-share-group"));
    expect(order).toEqual(["tap", "link_only", "copy", "message"]);
  });

  it("makes every control that opens a window a real link: the network's own address in a new tab, safe from the opener", () => {
    panel();
    const text = "Maple Bakes reached a milestone: Page live.";
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue(text)}&url=${encodeShareValue(CARD)}`);
    expect(open("threads").getAttribute("href")).toBe(`https://www.threads.com/intent/post?text=${encodeShareValue(text)}&url=${encodeShareValue(CARD)}`);
    expect(open("bluesky").getAttribute("href")).toBe(`https://bsky.app/intent/compose?text=${encodeShareValue(`${text}\n\n${CARD}`)}`);
    expect(open("linkedin").getAttribute("href")).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeShareValue(CARD)}`);
    expect(open("facebook").getAttribute("href")).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeShareValue(CARD)}`);
    expect(open("reddit").getAttribute("href")).toBe(`https://www.reddit.com/submit?url=${encodeShareValue(CARD)}&title=${encodeShareValue(text)}`);
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-share-open], a[data-share-message]")) {
      expect(a.tagName).toBe("A");
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
      expect(a.getAttribute("href")).toMatch(/^https:\/\//);
      // The button look, a word and an icon: never a logo, never a color alone.
      expect(a.className).toContain("btn-");
      expect(a.querySelector("svg")).not.toBeNull();
      expect(a.querySelector("img")).toBeNull();
      expect(a.textContent!.trim().length).toBeGreaterThan(0);
      expect(a.getAttribute("aria-label")).toContain(a.textContent!.trim());
    }
    expect(open("x").textContent).toBe("X");
    expect(open("instagram")).toBeNull();
    expect((document.querySelector('a[data-share-message="whatsapp"]') as HTMLAnchorElement).getAttribute("href")).toBe(`https://wa.me/?text=${encodeShareValue(`${text}\n\n${CARD}`)}`);
    expect((document.querySelector('a[data-share-message="telegram"]') as HTMLAnchorElement).getAttribute("href")).toBe(`https://t.me/share/url?url=${encodeShareValue(CARD)}&text=${encodeShareValue(text)}`);
  });

  it("says how much of each network's limit the post uses, as words", () => {
    panel();
    const used = "Maple Bakes reached a milestone: Page live.".length;
    expect(document.querySelector('[data-share-count="x"]')!.textContent).toBe(`${used + 25} of 280`);
    expect(document.querySelector('[data-share-count="bluesky"]')!.textContent).toBe(`${used + CARD.length + 2} of 300`);
    expect(document.querySelector('[data-share-count="threads"]')!.textContent).toBe(`${used + CARD.length + 2} of 500`);
    expect(document.querySelector('[data-share-count="instagram"]')!.textContent).toBe(`${used + CARD.length + 2} of 2,200`);
    // A window that carries no text has no count to show.
    expect(document.querySelector('[data-share-count="linkedin"]')).toBeNull();
  });

  it("builds every address again as the founder types, fitted to each network, and saves nothing", () => {
    const { unmount } = panel();
    fireEvent.change(textarea(), { target: { value: "Fresh & new: 50% more #1?" } });
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue("Fresh & new: 50% more #1?")}&url=${encodeShareValue(CARD)}`);
    expect(new URL(open("x").href).searchParams.get("text")).toBe("Fresh & new: 50% more #1?");
    expect(new URL(open("bluesky").href).searchParams.get("text")).toBe(`Fresh & new: 50% more #1?\n\n${CARD}`);
    expect(new URL(open("reddit").href).searchParams.get("title")).toBe("Fresh & new: 50% more #1?");
    // The link is never the founder's to break.
    expect(new URL(open("x").href).searchParams.get("url")).toBe(CARD);
    expect(new URL(open("x").href).host).toBe("x.com");

    // Too long for X and Bluesky: shortened there, said in words, whole where there is room.
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    fireEvent.change(textarea(), { target: { value: long } });
    const xText = new URL(open("x").href).searchParams.get("text")!;
    expect(xText.endsWith("…")).toBe(true);
    expect(xText.length).toBeLessThanOrEqual(255);
    expect(document.querySelector('[data-share-count="x"]')!.textContent).toMatch(/^\d+ of 280, shortened to fit$/);
    expect(document.querySelector('[data-share-count="instagram"]')!.textContent).not.toContain("shortened");
    expect(textarea().value).toBe(long);

    // Opened again, the panel starts from the draft's own words: the change was never kept.
    unmount();
    panel();
    expect(textarea().value).toBe("Maple Bakes reached a milestone: Page live.");
  });

  it("copies the text and the link where a network takes no ready-made post, offers the picture, and says what it did", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const seen: ShareOpened[] = [];
    panel({ onShare: (o) => seen.push(o) });
    fireEvent.click(within(row("instagram")).getByRole("button", { name: "Copy text for Instagram" }));
    await waitFor(() => expect(document.querySelector("[data-share-said]")!.textContent).toBe("Text copied"));
    expect(writeText).toHaveBeenLastCalledWith(`Maple Bakes reached a milestone: Page live.\n\n${CARD}`);
    // The tall picture for a story post, as a real link that downloads.
    const image = document.querySelector('a[data-share-image="instagram"]') as HTMLAnchorElement;
    expect(image.getAttribute("href")).toBe(`${ORIGIN}/m/${ID}/story-image`);
    expect(image.hasAttribute("download")).toBe(true);
    expect(image.textContent).toBe("Download image");
    // The words alone, for the windows that open with the link only.
    fireEvent.click(document.querySelector("[data-share-copy-text]")!);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Maple Bakes reached a milestone: Page live."));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(document.querySelector("[data-share-said]")!.textContent).toBe("Link copied"));
    expect(writeText).toHaveBeenLastCalledWith(CARD);
    expect(seen).toEqual([
      { network: "instagram", target: "copy" },
      { network: null, target: "copy" },
      { network: null, target: "copy" },
    ]);
  });

  it("says so plainly when the browser will not copy", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(document.querySelector("[data-share-said]")!.textContent).toBe("That could not be copied. Select it and copy it yourself."));
  });

  it("tells which control was pressed, never the words, and a failing recorder never stops the share", () => {
    const seen: ShareOpened[] = [];
    panel({ onShare: (o) => seen.push(o) });
    fireEvent.click(open("x"));
    fireEvent.click(open("linkedin"));
    fireEvent.click(open("reddit"));
    fireEvent.click(document.querySelector('a[data-share-message="whatsapp"]')!);
    expect(seen).toEqual([
      { network: "x", target: "tap" },
      { network: "linkedin", target: "link_only" },
      { network: "reddit", target: "link_only" },
      { network: "whatsapp", target: "message" },
    ]);
    expect(JSON.stringify(seen)).not.toContain("Maple");
  });

  it("does not let a recorder that throws get in the way", () => {
    panel({ onShare: () => {
      throw new Error("offline");
    } });
    const link = open("bluesky");
    expect(() => fireEvent.click(link)).not.toThrow();
    // The link is still a link: the browser follows it whatever the recorder did.
    expect(link.getAttribute("href")).toMatch(/^https:\/\/bsky\.app\/intent\/compose\?text=/);
  });

  it("offers the device's own share sheet first where the browser has one, and never as the only way", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    const seen: ShareOpened[] = [];
    panel({ onShare: (o) => seen.push(o) });
    const device = await screen.findByRole("button", { name: "Share…" });
    expect(device.compareDocumentPosition(group("tap")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(device);
    expect(share).toHaveBeenCalledWith({ text: "Maple Bakes reached a milestone: Page live.", url: CARD });
    expect(seen).toEqual([{ network: null, target: "device" }]);
    expect(networksIn("tap").length).toBeGreaterThan(0);
  });

  it("has no device button where the browser has no share sheet, and survives the person closing the sheet", async () => {
    panel();
    expect(document.querySelector("[data-share-device]")).toBeNull();
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    vi.stubGlobal("navigator", { ...navigator, share });
    panel();
    const device = await screen.findByRole("button", { name: "Share…" });
    expect(() => fireEvent.click(device)).not.toThrow();
  });

  it("a draft with no link opens the networks that take text; the rest fall to a copy of the words, and nothing is invented", () => {
    panel({ draft: writtenPostDraft({ text: "Fresh loaves out at seven." }), title: "Share this post" });
    expect(document.querySelector("[data-share-link]")).toBeNull();
    expect(networksIn("tap")).toEqual(["x", "threads", "bluesky"]);
    expect(group("link_only")).toBeNull();
    expect(networksIn("copy")).toEqual(["linkedin", "facebook", "reddit", "instagram", "tiktok"]);
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue("Fresh loaves out at seven.")}`);
    expect(document.querySelector("a[data-share-image]")).toBeNull();
    expect(document.querySelector('a[data-share-message="telegram"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("works for the page's draft, and is honest at the foot: nothing here posts", () => {
    panel({ draft: page, title: "Share your page" });
    expect(textarea().value).toBe("Maple Bakes: Sourdough, baked each morning.");
    expect(new URL(open("x").href).searchParams.get("url")).toBe(`${ORIGIN}/p/maple-bakes?via=p.maple-bakes`);
    expect(document.querySelector("[data-share-honest]")!.textContent).toBe(`${APP_NAME} posts nothing for you. Each button opens that network's own window, and you press Post there.`);
    expect(screen.getByRole("dialog").textContent).not.toMatch(/\b(posted|published)\b/i);
  });

  it("renders nothing while closed, and Close closes it", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<SharePost open={false} onOpenChange={onOpenChange} title="Share your page" draft={page} appName={APP_NAME} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<SharePost open onOpenChange={onOpenChange} title="Share your page" draft={page} appName={APP_NAME} />);
    // The header's corner button and the footer's: both close.
    const close = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(close[close.length - 1]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("only: a showcase video is offered on its approved networks only, with its words fixed and nothing without a network", async () => {
    vi.stubGlobal("navigator", { ...navigator, share: vi.fn().mockResolvedValue(undefined) });
    panel({ draft: page, only: ["x", "linkedin"] });
    await waitFor(() => expect(document.querySelector("[data-share-network]")).toBeTruthy());
    const offered = [...document.querySelectorAll("[data-share-network]")].map((el) => el.getAttribute("data-share-network"));
    expect(new Set(offered)).toEqual(new Set(["x", "linkedin"]));
    // No device sheet, no plain copy of the words or the link, no message apps: each would go somewhere nobody can name.
    expect(document.querySelector("[data-share-device]")).toBeNull();
    expect(document.querySelector("[data-share-copy-text]")).toBeNull();
    expect(document.querySelector("[data-share-copy-link]")).toBeNull();
    expect(document.querySelector("[data-share-message]")).toBeNull();
    expect(textarea().readOnly).toBe(true);
  });
});
