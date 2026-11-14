/**
 * The house's Creative tab and a showcase post (0103; security review finding 1): a share window opens the moment a
 * control is pressed and is only reported afterwards, so the tab awaits `showcase.shareCheck` BEFORE it opens anything.
 * On a refusal nothing opens and the reason is said; on a yes the panel offers only the networks the founders approved,
 * with the words fixed and no share without a network.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { teamPostRef } from "@foundmill/shared/team-posts";
import { CreativeScreen, showcasePostOf } from "../CreativeScreen";
import type { AssetRow } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { AGENT, BID, dataResponses } from "./fixtures";

const REQUEST_ID = "5ca5e000-0000-4000-8000-000000000001";
const POST_ID = "5ca5e000-0000-4000-8000-000000000009";
const TEXT = "How Maple Bakes was built. Page live on Nov 12, 2026.";
const LINK = "https://foundmill.example/p/maple-bakes/story?via=p.maple-bakes";
const TITLE = "A showcase video every founder of the project approved";
const ref = { trigger: "showcase_approved", subject: "page_live", refId: REQUEST_ID } as const;

const post: AssetRow = {
  id: POST_ID,
  campaignId: null,
  kind: "post",
  title: TITLE,
  contentRef: teamPostRef(ref),
  body: TEXT,
  approvalState: "draft",
  authoredByAgentId: Object.values(AGENT)[0] ?? null,
  sharePost: { text: TEXT, link: LINK, variants: {} },
  createdAt: "2026-11-14T10:00:00.000Z",
};
const responses = { ...dataResponses, "distribution.assets.list": [...(dataResponses["distribution.assets.list"] as AssetRow[]), post] };
const card = () => within(screen.getByRole("region", { name: "Posts" })).getByRole("article", { name: TITLE });

describe("a showcase post on the house's Creative tab", () => {
  it("is told apart by its trigger", () => {
    expect(showcasePostOf(post)).toBe(true);
    expect(showcasePostOf({ contentRef: teamPostRef({ trigger: "page_published", subject: "page_live", refId: REQUEST_ID }) })).toBe(false);
  });

  it("asks the api first; on a refusal it opens nothing and says why", async () => {
    const fake = createFakeSource({ businessId: BID, responses, onMutate: async (path) => (path === "showcase.shareCheck" ? { showcase: true, ok: false, message: "This video is not approved by every founder, so it cannot be shared.", networks: [] } : {}) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(card()).getByRole("button", { name: `Share: ${TITLE}` }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not approved by every founder/));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fake.mutations).toEqual([{ path: "showcase.shareCheck", input: { assetId: POST_ID } }]);
  });

  it("on a yes, offers only the approved networks, the words fixed, and nothing without a network", async () => {
    const fake = createFakeSource({ businessId: BID, responses, onMutate: async (path) => (path === "showcase.shareCheck" ? { showcase: true, ok: true, message: null, networks: ["x", "linkedin"] } : {}) });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(card()).getByRole("button", { name: `Share: ${TITLE}` }));
    const dialog = await screen.findByRole("dialog");
    const offered = [...dialog.querySelectorAll("[data-share-network]")].map((el) => el.getAttribute("data-share-network"));
    expect(new Set(offered)).toEqual(new Set(["x", "linkedin"]));
    expect(dialog.querySelector("[data-share-device]")).toBeNull();
    expect(dialog.querySelector("[data-share-copy-link]")).toBeNull();
    expect(dialog.querySelector("[data-share-message]")).toBeNull();
    expect((within(dialog).getByLabelText("Text") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(fake.mutations[0]).toEqual({ path: "showcase.shareCheck", input: { assetId: POST_ID } });
  });
});
