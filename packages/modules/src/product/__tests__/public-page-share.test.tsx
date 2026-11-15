/**
 * Product › Public page, tap-to-post (docs/NETWORK.md F3): once the page is live, "Share your page" opens the share
 * panel with a plain draft built from what the live page says. A press is recorded as a share that was opened.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { encodeShareValue } from "@foundmill/shared/share-targets";
import { PUBLIC_PAGE_WORDS, PublicPageScreen, type PageViewResponse } from "../PublicPageScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const published = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand.", forWhom: "", stage: "idea" as const, showFounders: false, followForm: true };
const view = (over: Partial<PageViewResponse> = {}): PageViewResponse => ({
  slug: "northwood",
  url: "https://foundmill.example/p/northwood",
  saved: true,
  draft: published,
  published,
  live: true,
  publishedAt: new Date(2026, 9, 7, 12),
  unpublishedAt: null,
  changed: false,
  canEdit: true,
  canPublish: true,
  isSample: false,
  preview: { name: "Northwood", brandPrimary: "#2f7d6b", brandSecondary: "#ffffff", founderNames: ["Maya"] },
  ...over,
});
const render = (v: PageViewResponse, onMutate?: (path: string, input: Record<string, unknown>) => unknown) => {
  const fake = createFakeSource({ businessId: BID, responses: { "page.get": v }, onMutate });
  renderScreen(fake, <PublicPageScreen businessId={BID} departmentId="d1" />);
  return fake;
};
const LINK = "https://foundmill.example/p/northwood?via=p.northwood";
const TEXT = "Northwood: Candles that smell like a walk in the woods.";
const open = (network: string) => document.querySelector(`a[data-share-open="${network}"]`) as HTMLAnchorElement;

describe("PublicPageScreen: Share your page", () => {
  it("is offered only once the page is live", () => {
    render(view({ live: false, published: null, publishedAt: null }));
    expect(screen.queryByRole("button", { name: PUBLIC_PAGE_WORDS.share })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sits beside Copy link and Open, and opens the panel with the project's name, its pitch and the page's address with via", async () => {
    render(view());
    const address = screen.getByTestId("page-address");
    expect(within(address).getByRole("button", { name: PUBLIC_PAGE_WORDS.copyLink })).toBeTruthy();
    expect(within(address).getByRole("link", { name: PUBLIC_PAGE_WORDS.open })).toBeTruthy();
    fireEvent.click(within(address).getByRole("button", { name: "Share your page" }));
    const dialog = await screen.findByRole("dialog", { name: "Share your page" });
    expect((within(dialog).getByLabelText("Text") as HTMLTextAreaElement).value).toBe(TEXT);
    expect(dialog.querySelector("[data-share-link]")!.textContent).toBe(LINK);
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue(TEXT)}&url=${encodeShareValue(LINK)}`);
    expect(open("threads").getAttribute("href")).toBe(`https://www.threads.com/intent/post?text=${encodeShareValue(TEXT)}&url=${encodeShareValue(LINK)}`);
    expect(open("bluesky").getAttribute("href")).toBe(`https://bsky.app/intent/compose?text=${encodeShareValue(`${TEXT}\n\n${LINK}`)}`);
    expect(open("linkedin").getAttribute("href")).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeShareValue(LINK)}`);
    // The picture is the page's own share image.
    expect((dialog.querySelector('a[data-share-image="instagram"]') as HTMLAnchorElement).getAttribute("href")).toBe("https://foundmill.example/p/northwood/opengraph-image");
  });

  it("says what the live page says, never what is still being written", async () => {
    render(view({ draft: { ...published, pitch: "Candles, now in three sizes" }, changed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Share your page" }));
    const dialog = await screen.findByRole("dialog", { name: "Share your page" });
    expect((within(dialog).getByLabelText("Text") as HTMLTextAreaElement).value).toBe(TEXT);
  });

  it("the text can be changed in the panel and every link follows; the page's own fields are untouched", async () => {
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "Share your page" }));
    const dialog = await screen.findByRole("dialog", { name: "Share your page" });
    fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "Northwood is open: come & see." } });
    expect(new URL(open("x").href).searchParams.get("text")).toBe("Northwood is open: come & see.");
    expect(new URL(open("x").href).searchParams.get("url")).toBe(LINK);
    expect(screen.getByLabelText(/One-line pitch/)).toHaveProperty("value", published.pitch);
  });

  it("records a press as a share that was opened: the control, never the words; a failure is silent", async () => {
    const calls: { path: string; input: Record<string, unknown> }[] = [];
    const fake = render(view(), (path, input) => {
      calls.push({ path, input });
      throw new Error("offline");
    });
    fireEvent.click(screen.getByRole("button", { name: "Share your page" }));
    await screen.findByRole("dialog", { name: "Share your page" });
    await act(async () => {
      fireEvent.click(open("bluesky"));
      fireEvent.click(open("facebook"));
    });
    expect(fake.mutations).toEqual([
      { path: "share.opened", input: { kind: "page", network: "bluesky", target: "tap" } },
      { path: "share.opened", input: { kind: "page", network: "facebook", target: "link_only" } },
    ]);
    expect(JSON.stringify(calls)).not.toContain("Candles");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Share your page" })).toBeTruthy();
  });

  it("a reader who cannot publish can still share a live page", () => {
    render(view({ canEdit: false, canPublish: false }));
    expect(screen.getByRole("button", { name: "Share your page" })).toBeTruthy();
  });
});
