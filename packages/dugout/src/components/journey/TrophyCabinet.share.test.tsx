import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { TrophyCabinet } from "./TrophyCabinet";

/** Tap-to-post (docs/DESIGN.md §9g): "Share" beside "Copy card link" on a milestone that is on the page, and nowhere else. */
const early = [
  { key: "page_live", label: "Page live", description: "Your project's public page went live.", achievedAt: "2026-11-12T09:00:00.000Z", page: "shown" as const },
  { key: "first_follower", label: "First follower", description: "The first person confirmed that they follow your project.", achievedAt: "2026-11-14T08:00:00.000Z", page: "hidden" as const },
  { key: "customer_1", label: "First customer", description: "The first paying customer.", achievedAt: "2026-11-19T10:00:00.000Z", page: "waiting" as const },
  { key: "customer_10", label: "10th customer", description: "10 paying customers.", achievedAt: null, page: "hidden" as const },
];

describe("TrophyCabinet: Share on a milestone that is on the page", () => {
  it("sits beside Copy card link on a shown milestone only, and says which milestone it shares", () => {
    const onSharePost = vi.fn();
    const { container } = render(<TrophyCabinet trophies={early} onHideFromPage={() => {}} onCopyCardLink={() => {}} onSharePost={onSharePost} />);
    const cell = (key: string) => container.querySelector(`[data-trophy='${key}']`) as HTMLElement;
    const shown = cell("page_live").querySelector("[data-trophy-on-page='shown']") as HTMLElement;
    const copy = within(shown).getByRole("button", { name: "Copy card link: Page live" });
    const share = within(shown).getByRole("button", { name: "Share: Page live" });
    expect(share.textContent).toBe("Share");
    expect(share.hasAttribute("data-trophy-share-post")).toBe(true);
    // After "Copy card link", in the same quiet row.
    expect(copy.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(share.querySelector("svg")).not.toBeNull();
    fireEvent.click(share);
    expect(onSharePost).toHaveBeenCalledWith("page_live");
    // Not on a milestone that is hidden, waiting for the page, or not reached.
    expect(container.querySelectorAll("[data-trophy-share-post]")).toHaveLength(1);
    for (const key of ["first_follower", "customer_1", "customer_10"]) expect(cell(key).querySelector("[data-trophy-share-post]"), key).toBeNull();
  });

  it("is left out without a handler (the page is not live, or the screen does not offer it)", () => {
    const { container } = render(<TrophyCabinet trophies={early} onHideFromPage={() => {}} onCopyCardLink={() => {}} />);
    expect(container.querySelector("[data-trophy-share-post]")).toBeNull();
  });

  it("is not the LIVE share card: both can be offered, each under its own name", () => {
    const onShare = vi.fn();
    const onSharePost = vi.fn();
    const both = [{ ...early[0]!, shareable: true }];
    const { container } = render(<TrophyCabinet trophies={both} onShare={onShare} onSharePost={onSharePost} onCopyCardLink={() => {}} />);
    const cell = container.querySelector("[data-trophy='page_live']") as HTMLElement;
    fireEvent.click(within(cell).getByRole("button", { name: "Share Page live" }));
    fireEvent.click(within(cell).getByRole("button", { name: "Share: Page live" }));
    expect(onShare).toHaveBeenCalledWith("page_live");
    expect(onSharePost).toHaveBeenCalledWith("page_live");
    expect(cell.querySelectorAll("[data-trophy-share]")).toHaveLength(1);
  });
});
