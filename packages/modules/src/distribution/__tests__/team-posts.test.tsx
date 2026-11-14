/**
 * Creative: a post the team wrote for the founder to share by tap (docs/NETWORK.md F3, F7; docs/DESIGN.md §9g). It is
 * an offer, not a decision: it says who wrote it and that it is not shared yet, carries Share and "Not this one" in
 * place of Approve and Reject, opens the share panel with the link the api attached (with `via`), tells the api which
 * post a share was for, and is set aside by "Not this one". Nothing says it was posted.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { encodeShareValue } from "@foundmill/shared/share-targets";
import { TEAM_POST_WORDS, teamPostRef, teamPostShareDraft } from "@foundmill/shared/team-posts";
import { CreativeScreen, assetSharedByTap, teamPostOf } from "../CreativeScreen";
import type { AssetRow } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { AGENT, BID, dataResponses } from "./fixtures";

const PAGE_ID = "0b9d1c1e-1111-4222-8333-444455556666";
const POST_ID = "77777777-7777-4777-8777-777777777777";
const TEXT = "Northwind Skincare has a page now. Refillable skincare for sensitive skin.";
const LINK = "https://foundmill.example/p/northwind-skincare?via=p.northwind-skincare";
const ref = { trigger: "page_published", subject: "page_live", refId: PAGE_ID } as const;
const TITLE = "A post about your page going live";
const page = { origin: "https://foundmill.example", slug: "northwind-skincare", projectName: "Northwind Skincare", pitch: "Refillable skincare for sensitive skin" };

const teamPost = (over: Partial<AssetRow> = {}): AssetRow => ({
  id: POST_ID,
  campaignId: null,
  kind: "post",
  title: TITLE,
  contentRef: teamPostRef(ref),
  body: TEXT,
  approvalState: "draft",
  authoredByAgentId: Object.values(AGENT)[0] ?? null,
  sharePost: teamPostShareDraft({ text: TEXT, ref, page }),
  createdAt: "2026-11-12T10:00:00.000Z",
  ...over,
});
const withPost = (post: AssetRow | null) => ({ ...dataResponses, "distribution.assets.list": [...(dataResponses["distribution.assets.list"] as AssetRow[]), ...(post ? [post] : [])] });
const open = (network: string) => document.querySelector(`a[data-share-open="${network}"]`) as HTMLAnchorElement;
const card = () => within(screen.getByRole("region", { name: "Posts" })).getByRole("article", { name: TITLE });

describe("a post the team wrote to be shared", () => {
  it("is told apart from a campaign's creative by its reference and the share draft the api attached", () => {
    expect(teamPostOf(teamPost())).toBe(true);
    expect(teamPostOf(teamPost({ sharePost: null }))).toBe(false);
    expect(teamPostOf(teamPost({ contentRef: "https://example.com/preview.png" }))).toBe(false);
    expect(teamPostOf(teamPost({ kind: "email" }))).toBe(false);
    // It needs no campaign and no channel row to be shared; set aside, it is not.
    expect(assetSharedByTap(teamPost(), [], new Set())).toBe(true);
    expect(assetSharedByTap(teamPost({ approvalState: "approved" }), [], new Set())).toBe(true);
    expect(assetSharedByTap(teamPost({ approvalState: "rejected" }), [], new Set())).toBe(false);
    expect(assetSharedByTap(teamPost({ body: " " }), [], new Set())).toBe(false);
  });

  it("reads as an offer: who wrote it, that it is not shared yet, Share and \"Not this one\", and no Approve or Reject", () => {
    const fake = createFakeSource({ businessId: BID, responses: withPost(teamPost()) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    const c = card();
    expect(c.hasAttribute("data-team-post")).toBe(true);
    expect(within(c).getByText(TEAM_POST_WORDS.source)).toBeTruthy();
    expect(within(c).getByText("Written by your team for you to share")).toBeTruthy();
    expect(within(c).getByText("Not shared yet")).toBeTruthy();
    expect(within(c).getByTestId("asset-body").textContent).toBe(TEXT);
    expect(within(c).getByRole("button", { name: `Share: ${TITLE}` })).toBeTruthy();
    expect(within(c).getByRole("button", { name: `Not this one: ${TITLE}` })).toBeTruthy();
    expect(within(c).queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(within(c).queryByRole("button", { name: /^Reject/ })).toBeNull();
    // Its reference is plumbing: never shown. And it is not something awaiting the founder's approval.
    expect(c.textContent).not.toContain("post-draft:");
    expect(c.textContent).not.toMatch(/No campaign|Draft\b|\bposted\b|\bpublished\b/i);
    const pending = (dataResponses["distribution.assets.list"] as AssetRow[]).filter((a) => a.approvalState === "pending").length;
    expect(screen.getByText(new RegExp(`· ${pending} awaiting approval`))).toBeTruthy();
  });

  it("opens the share panel with the team's words and the link the api attached, and tells the api which post was shared", async () => {
    const fake = createFakeSource({ businessId: BID, responses: withPost(teamPost()) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(card()).getByRole("button", { name: `Share: ${TITLE}` }));
    const dialog = await screen.findByRole("dialog", { name: "Share this post" });
    expect((within(dialog).getByLabelText("Text") as HTMLTextAreaElement).value).toBe(TEXT);
    expect(dialog.querySelector("[data-share-link]")!.textContent).toBe(LINK);
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue(TEXT)}&url=${encodeShareValue(LINK)}`);
    expect(new URL(open("bluesky").href).searchParams.get("text")).toBe(`${TEXT}\n\n${LINK}`);
    expect(new URL(open("threads").href).searchParams.get("url")).toBe(LINK);
    // The founder may change the words; every network follows.
    fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "Our page is up." } });
    expect(new URL(open("x").href).searchParams.get("text")).toBe("Our page is up.");
    expect(new URL(open("bluesky").href).searchParams.get("text")).toBe(`Our page is up.\n\n${LINK}`);
    await act(async () => {
      fireEvent.click(open("x"));
    });
    // Recorded as a share that was opened, naming the post, never its words; nothing approves, launches or posts it here.
    expect(fake.mutations).toEqual([{ path: "share.opened", input: { kind: "draft", refId: POST_ID, network: "x", target: "tap" } }]);
    expect(JSON.stringify(fake.mutations)).not.toMatch(/Northwind|Our page/);
  });

  it("\"Not this one\" sets it aside through the asset's own route", async () => {
    const fake = createFakeSource({ businessId: BID, responses: withPost(teamPost()) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: `Not this one: ${TITLE}` }));
    });
    await waitFor(() => expect(fake.mutations).toEqual([{ path: "distribution.assets.reject", input: { assetId: POST_ID } }]));
  });

  it("once a share was opened it says so and is still there to share again; it is never called posted", () => {
    const fake = createFakeSource({ businessId: BID, responses: withPost(teamPost({ approvalState: "approved" })) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    const c = card();
    expect(within(c).getByText("Share opened")).toBeTruthy();
    expect(within(c).getByRole("button", { name: `Share: ${TITLE}` })).toBeTruthy();
    expect(within(c).queryByRole("button", { name: /^Not this one/ })).toBeNull();
    expect(c.textContent).not.toMatch(/\bposted\b|\bpublished\b|Approved/i);
  });

  it("with the page down the post has no link, and the networks that take text still open", async () => {
    const fake = createFakeSource({ businessId: BID, responses: withPost(teamPost({ sharePost: teamPostShareDraft({ text: TEXT, ref, page: null }) })) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(card()).getByRole("button", { name: `Share: ${TITLE}` }));
    const dialog = await screen.findByRole("dialog", { name: "Share this post" });
    expect(dialog.querySelector("[data-share-link]")).toBeNull();
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue(TEXT)}`);
  });
});
