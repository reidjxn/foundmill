import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DraftingByline,
  DraftingCardFrame,
  DraftingLockedNote,
  DraftingSkeleton,
  JustInTag,
  landedCardClass,
} from "./DraftingCard";
import { MARLOW, PIKE, TEODOR } from "./fixtures";

describe("DraftingCardFrame", () => {
  it("drafting: busy, lit in the drafter's colour, with the travelling light", () => {
    render(<DraftingCardFrame state="drafting" drafter={MARLOW} name="Shelfproof" />);
    const frame = screen.getByTestId("drafting-card-frame");
    expect(frame.getAttribute("data-state")).toBe("drafting");
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(frame.getAttribute("aria-label")).toBe("Shelfproof: Marlow is drafting");
    expect(frame.className).toContain("tone-dept-7");
    expect(frame.querySelector(".draft-scan")).not.toBeNull();
  });

  it('landed: rises with a lit edge; "Just in" keeps it lit', () => {
    const { rerender } = render(<DraftingCardFrame state="landed" drafter={PIKE} justIn />);
    const frame = screen.getByTestId("drafting-card-frame");
    expect(frame.className).toContain("draft-landed");
    expect(frame.className).toContain("draft-just-in");
    expect(frame.hasAttribute("aria-busy")).toBe(false);
    expect(frame.querySelector(".draft-scan")).toBeNull();
    rerender(<DraftingCardFrame state="landed" drafter={PIKE} />);
    expect(screen.getByTestId("drafting-card-frame").className).not.toContain("draft-just-in");
  });

  it("falls back to kit-lift without a drafter colour", () => {
    render(
      <DraftingCardFrame
        state="drafting"
        drafter={{ name: "Ideation agent", avatarSeed: "ideation" }}
      />,
    );
    expect(screen.getByTestId("drafting-card-frame").className).toContain("tone-kit-lift");
  });

  it("gives cards that bring their own panel the same landing", () => {
    expect(landedCardClass()).toBe("draft-landed");
    expect(landedCardClass({ justIn: true })).toBe("draft-landed draft-just-in");
  });
});

describe("drafting pieces", () => {
  it("bylines say who: queued, drafting, drafted", () => {
    // The words, without the portrait's title.
    const words = () =>
      [...screen.getByTestId("drafting-byline").querySelectorAll(":scope > span:not([role])")]
        .map((s) => s.textContent)
        .join(" | ");
    const { rerender } = render(
      <DraftingByline state="queued" drafter={TEODOR} meta="next · #4" />,
    );
    expect(words()).toBe("Queued for Teodor | next · #4");
    rerender(<DraftingByline state="drafting" drafter={MARLOW} meta="5 of 10 · 384 tokens" />);
    expect(words()).toBe("Marlow is drafting |  | 5 of 10 · 384 tokens");
    rerender(<DraftingByline state="landed" drafter={PIKE} />);
    expect(words()).toBe("Drafted by Pike");
  });

  it("locks actions until the card lands, tags it Just in, and sketches a queued card", () => {
    render(
      <>
        <DraftingLockedNote />
        <JustInTag />
        <DraftingSkeleton attributes={4} />
      </>,
    );
    expect(screen.getByText("Actions unlock when it lands")).toBeTruthy();
    expect(screen.getByTestId("just-in").textContent).toBe("Just in");
    expect(document.querySelectorAll(".draft-cells")).toHaveLength(4);
  });
});
