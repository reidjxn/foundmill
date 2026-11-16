/**
 * Product › Public page on any screen (WP-04 T6): the tab renders in the shell's phone layout, so its grid stacks in one
 * column; after Publish on a narrow screen the share panel opens in place with a message asking whether people would use
 * it; on a desktop the buttons stay and "Copy message" copies the same words. While the team's draft has not arrived, one
 * line says the fields hold a first draft from the founder's own words.
 */
import "./setup";
import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { PUBLIC_PAGE_WORDS, PublicPageScreen, pageAskDraft, type PageViewResponse } from "../PublicPageScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const draft = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand.", forWhom: "", stage: "idea" as const, showFounders: false, followForm: true };
const view = (over: Partial<PageViewResponse> = {}): PageViewResponse => ({
  slug: "northwood",
  url: "https://foundmill.example/p/northwood",
  saved: true,
  draft,
  published: null,
  live: false,
  publishedAt: null,
  unpublishedAt: null,
  changed: false,
  canEdit: true,
  canPublish: true,
  isSample: false,
  preview: { name: "Northwood", brandPrimary: "#2f7d6b", brandSecondary: "#ffffff", founderNames: ["Maya"] },
  ...over,
});
const live = view({ live: true, published: draft, publishedAt: "2026-10-07T12:00:00.000Z" });
const LINK = "https://foundmill.example/p/northwood?via=p.northwood";
const ASK = "I'm starting Northwood. Candles that smell like a walk in the woods. Would you use this?";

const original = window.innerWidth;
function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}
afterEach(() => setWidth(original));

function renderPublishing(start: PageViewResponse) {
  const fake = createFakeSource({ businessId: BID, responses: { "page.get": start } });
  fake.source.mutate = (async (path: string, input: Record<string, unknown>) => {
    fake.mutations.push({ path, input });
    if (path === "page.publish") {
      fake.setResponse("page.get", live);
      return { outcome: "published", page: live };
    }
    return {};
  }) as typeof fake.source.mutate;
  renderScreen(fake, <PublicPageScreen businessId={BID} departmentId="d1" />);
  return fake;
}

async function publish() {
  fireEvent.click(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.publish }));
  const confirm = await screen.findByRole("dialog");
  await act(async () => fireEvent.click(within(confirm).getByTestId("page-confirm-publish")));
}

describe("pageAskDraft", () => {
  it("asks in the founder's own voice, with the live pitch and the page's address with via", () => {
    expect(pageAskDraft({ origin: "https://foundmill.example", slug: "northwood", projectName: "Northwood", pitch: draft.pitch })).toMatchObject({ text: ASK, link: LINK });
    // A pitch that is only the name, or already ends a sentence, is not repeated or given a second stop.
    expect(pageAskDraft({ origin: "https://foundmill.example", slug: "northwood", projectName: "Northwood", pitch: "Northwood" }).text).toBe("I'm starting Northwood. Would you use this?");
    expect(pageAskDraft({ origin: "https://foundmill.example", slug: "northwood", projectName: "Northwood", pitch: "Candles for you!" }).text).toBe("I'm starting Northwood. Candles for you! Would you use this?");
  });
});

describe("PublicPageScreen on a phone (WP-04 T6)", () => {
  it("stacks the form and the preview in one column, the preview under the form, with finger-sized actions", () => {
    setWidth(390);
    renderPublishing(view());
    const grid = document.querySelector("[data-module-screen='product/public-page']") as HTMLElement;
    expect(grid.dataset.stack).toBe("true");
    const editor = screen.getByTestId("public-page-editor");
    const preview = screen.getByTestId("public-page-preview");
    expect(editor.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const publishButton = screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.publish });
    expect(publishButton.className).toContain("min-h-tap");
    expect(publishButton.className).toContain("@max-page-wide:w-full");
  });

  it("after Publish on a narrow screen, the share panel opens in place with the ask and the link", async () => {
    setWidth(390);
    const fake = renderPublishing(view());
    await publish();
    const panel = await screen.findByRole("dialog", { name: PUBLIC_PAGE_WORDS.askTitle });
    expect((within(panel).getByLabelText("Text") as HTMLTextAreaElement).value).toBe(ASK);
    expect(panel.querySelector("[data-share-link]")!.textContent).toBe(LINK);
    expect(fake.mutations.map((m) => m.path)).toEqual(["page.publish"]);
  });

  it("a page that is held does not open the share panel", async () => {
    setWidth(390);
    const fake = createFakeSource({ businessId: BID, responses: { "page.get": view() } });
    fake.source.mutate = (async () => ({ outcome: "held", reason: "unsafe", message: "Held for a look.", page: view() })) as typeof fake.source.mutate;
    renderScreen(fake, <PublicPageScreen businessId={BID} departmentId="d1" />);
    await publish();
    expect(screen.getByTestId("page-held").textContent).toBe("Held for a look.");
    expect(screen.queryByRole("dialog", { name: PUBLIC_PAGE_WORDS.askTitle })).toBeNull();
  });

  it("on a desktop, Publish keeps today's buttons and opens nothing; Copy message copies the ask with the link", async () => {
    setWidth(1440);
    renderPublishing(view());
    await publish();
    expect(screen.queryByRole("dialog")).toBeNull();
    const address = screen.getByTestId("page-address");
    expect(within(address).getByRole("button", { name: PUBLIC_PAGE_WORDS.copyLink })).toBeTruthy();
    expect(within(address).getByRole("button", { name: "Share your page" })).toBeTruthy();
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (s: string) => void written.push(s) }, configurable: true });
    await act(async () => fireEvent.click(within(address).getByRole("button", { name: PUBLIC_PAGE_WORDS.copyMessage })));
    expect(written).toEqual([`${ASK}\n\n${LINK}`]);
    expect(within(address).getByRole("button", { name: PUBLIC_PAGE_WORDS.messageCopied })).toBeTruthy();
  });
});

describe("PublicPageScreen before the team's draft (WP-04 T6)", () => {
  it("says the fields hold a first draft from the founder's own words while no draft is saved, and not after", () => {
    renderPublishing(view({ saved: false }));
    expect(screen.getByTestId("page-starter-note").textContent).toBe(PUBLIC_PAGE_WORDS.starterNote);
  });

  it("no line once a draft is saved, or for someone who cannot edit", () => {
    renderPublishing(view({ saved: true }));
    expect(screen.queryByTestId("page-starter-note")).toBeNull();
  });

  it("no line for a reader", () => {
    renderPublishing(view({ saved: false, canEdit: false, canPublish: false }));
    expect(screen.queryByTestId("page-starter-note")).toBeNull();
  });
});
