import "./setup";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { PUBLIC_PAGE_WORDS, PublicPageScreen, type PageViewResponse } from "../PublicPageScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";
import type * as LaunchChecklistModule from "@foundmill/shared/launch-checklist";

// Lets one test force every item to "Not yet"; the others use the real checklist.
const forceNotYet = vi.hoisted(() => ({ on: false }));
vi.mock("@foundmill/shared/launch-checklist", async (importOriginal) => {
  const real = await importOriginal<typeof LaunchChecklistModule>();
  return { ...real, launchChecklist: (input: Parameters<typeof real.launchChecklist>[0]) => real.launchChecklist(input).map((i) => (forceNotYet.on ? { ...i, ready: false } : i)) };
});

const draft = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "", stage: "idea" as const, showFounders: false, followForm: false };
const view = (over: Partial<PageViewResponse> = {}): PageViewResponse => ({
  slug: "northwood",
  url: "https://foundmill.example/p/northwood",
  saved: false,
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

const open = async (v: PageViewResponse) => {
  const fake = createFakeSource({ businessId: BID, responses: { "page.get": v }, onMutate: () => ({ outcome: "published", page: v }) });
  renderScreen(fake, <PublicPageScreen businessId={BID} departmentId="d1" />);
  fireEvent.click(screen.getByRole("button", { name: v.live ? PUBLIC_PAGE_WORDS.publishChanges : PUBLIC_PAGE_WORDS.publish }));
  return { fake, dialog: await screen.findByRole("dialog") };
};

describe("PublicPageScreen: before it goes live", () => {
  it("shows the checklist in the first publish dialog; its one action turns on the Follow form in the draft", async () => {
    const { fake, dialog } = await open(view());
    const list = within(dialog).getByRole("region", { name: "Before it goes live" });
    expect(within(list).getAllByRole("img", { name: "Not yet" }).length).toBeGreaterThan(0);
    fireEvent.click(within(list).getByRole("button", { name: "Turn on the Follow form" }));
    await act(async () => fireEvent.click(within(dialog).getByTestId("page-confirm-publish")));
    expect(fake.mutations).toEqual([{ path: "page.publish", input: { content: { ...draft, followForm: true } } }]);
  });

  it("never blocks: with every item Not yet, Publish is enabled and publishes in one press", async () => {
    forceNotYet.on = true;
    try {
      const { fake, dialog } = await open(view());
      const list = within(dialog).getByRole("region", { name: "Before it goes live" });
      expect(within(list).queryAllByRole("img", { name: "Ready" })).toHaveLength(0);
      const approve = within(dialog).getByTestId("page-confirm-publish") as HTMLButtonElement;
      expect(approve.disabled).toBe(false);
      await act(async () => fireEvent.click(approve));
      expect(fake.mutations).toEqual([{ path: "page.publish", input: { content: draft } }]);
    } finally {
      forceNotYet.on = false;
    }
  });

  it("is not shown once the page has been public", async () => {
    const { dialog } = await open(view({ live: false, publishedAt: "2026-11-01T12:00:00.000Z", unpublishedAt: "2026-11-02T12:00:00.000Z" }));
    expect(within(dialog).queryByRole("region", { name: "Before it goes live" })).toBeNull();
  });
});
