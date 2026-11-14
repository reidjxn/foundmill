import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { APP_NAME } from "@foundmill/config";
import { POST_MEDIA_WORDS, type PostDraftMediaItem } from "@foundmill/shared/post-media";
import { pagePostDraft } from "@foundmill/shared/share-drafts";
import { PostMediaPreview } from "./PostMediaPreview";
import { SharePost } from "./SharePost";

const ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const URL_PATH = "/api/post-media/abcdefghijklmnopqrstuvwxyz.0123456789";
const video: PostDraftMediaItem = { kind: "video", state: "ready", mediaId: ID, simulated: false, mime: "video/mp4", bytes: 1200, durationSeconds: 5, url: URL_PATH, fileName: "maple-bakes-video.mp4" };
const voiceover: PostDraftMediaItem = { kind: "voiceover", state: "ready", mediaId: ID, simulated: false, mime: "audio/mpeg", bytes: 900, durationSeconds: 4, url: `${URL_PATH}x`, fileName: "maple-bakes-voiceover.mp3" };
const simulated: PostDraftMediaItem = { kind: "video", state: "simulated", mediaId: ID, simulated: true, mime: null, bytes: null, durationSeconds: 5 };
const connected = { videoTools: "connected", voiceTools: "connected" } as const;
const page = pagePostDraft({ origin: "https://foundmill.example", slug: "maple-bakes", projectName: "Maple Bakes", pitch: "Sourdough, baked each morning" });

afterEach(() => vi.unstubAllGlobals());

describe("PostMediaPreview", () => {
  it("shows a real video and voiceover with a preview and a Save link each, and says they are two files", () => {
    render(<PostMediaPreview media={{ ...connected, video, voiceover }} />);
    const player = document.querySelector("video[data-media-preview='video']") as HTMLVideoElement;
    expect(player.getAttribute("src")).toBe(URL_PATH);
    expect(player.hasAttribute("controls")).toBe(true);
    expect(player.hasAttribute("autoplay")).toBe(false);
    expect(document.querySelector("audio[data-media-preview='voiceover']")).toBeTruthy();
    const save = screen.getByRole("link", { name: POST_MEDIA_WORDS.saveVideo }) as HTMLAnchorElement;
    expect(save.getAttribute("href")).toBe(URL_PATH);
    expect(save.getAttribute("download")).toBe("maple-bakes-video.mp4");
    expect(screen.getByRole("link", { name: POST_MEDIA_WORDS.saveVoiceover })).toBeTruthy();
    expect(screen.getByText("Short video, 5 seconds")).toBeTruthy();
    expect(screen.getByText(POST_MEDIA_WORDS.twoFiles)).toBeTruthy();
  });

  it("a simulated video has no preview and no Save, and says nothing was made", () => {
    render(<PostMediaPreview media={{ ...connected, video: simulated }} />);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(POST_MEDIA_WORDS.simulated.video)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Short video/);
  });

  it("even a simulated item that claims to be ready with an address is never shown as a file", () => {
    render(<PostMediaPreview media={{ ...connected, video: { ...video, simulated: true } }} />);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toMatch(/^VideoSimulated/);
  });

  it("not connected: text only, and where to connect", () => {
    render(<PostMediaPreview media={{ videoTools: "not_connected", voiceTools: "not_connected" }} />);
    expect(document.querySelector("[data-share-media='not-connected']")!.textContent).toBe(POST_MEDIA_WORDS.notConnected);
    expect(POST_MEDIA_WORDS.notConnected).toMatch(/text only/);
    expect(POST_MEDIA_WORDS.notConnected).toMatch(/Settings › Integrations/);
  });

  it("waiting for the founder's OK, or declined: words only", () => {
    const { rerender } = render(<PostMediaPreview media={{ ...connected, video: { ...video, state: "asking", url: undefined } }} />);
    expect(screen.getByText(POST_MEDIA_WORDS.asking.video)).toBeTruthy();
    rerender(<PostMediaPreview media={{ ...connected, video: { ...video, state: "declined", url: undefined } }} />);
    expect(screen.getByText(POST_MEDIA_WORDS.declined.video)).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });
});

describe("SharePost with media", () => {
  it("shows the draft's media under its link, and a draft without media shows none", () => {
    const { unmount } = render(<SharePost open onOpenChange={() => undefined} title="Share this post" draft={{ ...page, media: { ...connected, video } }} appName={APP_NAME} />);
    expect(document.querySelector("[data-share-media-panel]")).toBeTruthy();
    unmount();
    render(<SharePost open onOpenChange={() => undefined} title="Share this post" draft={page} appName={APP_NAME} />);
    expect(document.querySelector("[data-share-media-panel]")).toBeNull();
  });

  it("hands the device's share sheet the video file with the words, where it takes files", async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share, canShare: () => true, clipboard: navigator.clipboard });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } })));
    const onShare = vi.fn();
    render(<SharePost open onOpenChange={() => undefined} title="Share this post" draft={{ ...page, media: { ...connected, video } }} appName={APP_NAME} onShare={onShare} />);
    const button = await screen.findByRole("button", { name: POST_MEDIA_WORDS.shareVideo });
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = (share.mock.calls[0] as unknown as [{ files: File[]; text: string }])[0];
    expect(arg.files[0]!.name).toBe("maple-bakes-video.mp4");
    expect(arg.files[0]!.type).toBe("video/mp4");
    expect(arg.text).toContain(page.link!);
    expect(onShare).toHaveBeenCalledWith({ network: null, target: "device" });
  });

  it("never offers a simulated video to the share sheet", async () => {
    vi.stubGlobal("navigator", { ...navigator, share: vi.fn(), canShare: () => true });
    render(<SharePost open onOpenChange={() => undefined} title="Share this post" draft={{ ...page, media: { ...connected, video: simulated } }} appName={APP_NAME} />);
    await screen.findByRole("button", { name: "Share…" });
    expect(screen.queryByRole("button", { name: POST_MEDIA_WORDS.shareVideo })).toBeNull();
  });
});
