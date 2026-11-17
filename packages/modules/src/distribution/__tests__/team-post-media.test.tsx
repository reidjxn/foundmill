/**
 * Creative: a team post's media (packages/shared `post-media.ts`). The card says in one line what the post carries, the
 * share panel shows the preview and "Save", and a simulated video is labeled and never offered as a file. Not
 * connected: text only, and the panel says so.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { POST_MEDIA_WORDS, type PostDraftMedia } from "@foundmill/shared/post-media";
import { teamPostRef, teamPostShareDraft } from "@foundmill/shared/team-posts";
import { CreativeScreen } from "../CreativeScreen";
import type { AssetRow } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { AGENT, BID, dataResponses } from "./fixtures";

const POST_ID = "77777777-7777-4777-8777-777777777777";
const MEDIA_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const TEXT = "Northwind Skincare has a page now. Refillable skincare for sensitive skin.";
const ref = { trigger: "page_published", subject: "page_live", refId: "0b9d1c1e-1111-4222-8333-444455556666" } as const;
const TITLE = "A post about your page going live";
const page = { origin: "https://foundmill.example", slug: "northwind-skincare", projectName: "Northwind Skincare", pitch: "Refillable skincare for sensitive skin" };
const URL_PATH = "/api/post-media/abcdefghijklmnopqrstuvwxyz.0123456789";

const post = (media: PostDraftMedia): AssetRow => ({
  id: POST_ID,
  campaignId: null,
  kind: "post",
  title: TITLE,
  contentRef: teamPostRef(ref),
  body: TEXT,
  approvalState: "draft",
  authoredByAgentId: Object.values(AGENT)[0] ?? null,
  sharePost: { ...teamPostShareDraft({ text: TEXT, ref, page }), media },
  createdAt: "2026-11-12T10:00:00.000Z",
});
const render = (media: PostDraftMedia) => renderScreen(createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.assets.list": [...(dataResponses["distribution.assets.list"] as AssetRow[]), post(media)] } }), <CreativeScreen businessId={BID} departmentId="d1" />);
const card = () => within(screen.getByRole("region", { name: "Posts" })).getByRole("article", { name: TITLE });
const share = async () => {
  fireEvent.click(within(card()).getByRole("button", { name: `Share: ${TITLE}` }));
  return screen.findByRole("dialog", { name: "Share this post" });
};

describe("a team post's media on Creative", () => {
  it("a real video: the card says so, and the panel shows its preview and Save", async () => {
    render({ videoTools: "connected", voiceTools: "not_connected", video: { kind: "video", state: "ready", mediaId: MEDIA_ID, simulated: false, mime: "video/mp4", bytes: 1200, durationSeconds: 5, url: URL_PATH, fileName: "northwind-skincare-video.mp4" } });
    expect(within(card()).getByText(POST_MEDIA_WORDS.card.ready)).toBeTruthy();
    const dialog = await share();
    expect(dialog.querySelector("video")!.getAttribute("src")).toBe(URL_PATH);
    expect((within(dialog).getByRole("link", { name: POST_MEDIA_WORDS.saveVideo }) as HTMLAnchorElement).getAttribute("download")).toBe("northwind-skincare-video.mp4");
    expect(within(dialog).getByText(POST_MEDIA_WORDS.saveNote)).toBeTruthy();
  });

  it("a simulated video is labeled on the card and in the panel, with no preview and nothing to save", async () => {
    render({ videoTools: "connected", voiceTools: "connected", video: { kind: "video", state: "simulated", mediaId: MEDIA_ID, simulated: true, mime: null, bytes: null, durationSeconds: 5 } });
    expect(within(card()).getByText(POST_MEDIA_WORDS.card.simulated)).toBeTruthy();
    expect(card().textContent).not.toContain(POST_MEDIA_WORDS.card.ready);
    const dialog = await share();
    expect(dialog.querySelector("video")).toBeNull();
    expect(within(dialog).queryByRole("link", { name: POST_MEDIA_WORDS.saveVideo })).toBeNull();
    expect(within(dialog).getByText(POST_MEDIA_WORDS.simulated.video)).toBeTruthy();
  });

  it("not connected: the card says nothing about a video, and the panel says the post is text only", async () => {
    render({ videoTools: "not_connected", voiceTools: "not_connected" });
    expect(card().querySelector("[data-asset-media]")).toBeNull();
    const dialog = await share();
    expect(within(dialog).getByText(POST_MEDIA_WORDS.notConnected)).toBeTruthy();
  });
});
