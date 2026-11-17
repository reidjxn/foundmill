import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IDEA_CARD_WORDS, IdeaCard, ideaOverall, lowestRating, type IdeaCardData } from "./IdeaCard";

const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
const full: IdeaCardData = {
  name: "Firstframe",
  pitch: "Restored 35 mm cameras, tested and sold with a roll of film, for people buying their first one.",
  archetype: "dtc_physical",
  stars_current: 3,
  stars_potential: 4,
  attributes: KEYS.map((key, i) => ({ key, value: key === "founder_fit" ? 1 : key === "defensibility" ? 7 : 10 + i, evidence: `Evidence for ${key}.` })),
};

describe("IdeaCard", () => {
  it("shows the name, the kind of business, the stars, the pitch, the overall and ten rows with Founder fit unmeasured", () => {
    render(<IdeaCard card={full} justIn />);
    expect(screen.getByRole("heading", { level: 2, name: "Firstframe" })).toBeTruthy();
    expect(screen.getByText(IDEA_CARD_WORDS.justIn)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Stars: 3 of 5, could reach 4/ })).toBeTruthy();
    expect(document.querySelectorAll("[data-idea-rating]")).toHaveLength(10);
    expect(document.querySelector("[data-idea-rating=founder_fit]")!.hasAttribute("data-unmeasured")).toBe(true);
    // The overall leaves Founder fit out (nothing is known about the visitor yet).
    expect(ideaOverall(full)).toBe(Math.round(full.attributes!.filter((a) => a.key !== "founder_fit").reduce((s, a) => s + a.value, 0) / 9));
    expect(document.querySelector("[data-idea-overall] b")!.textContent).toBe(String(ideaOverall(full)));
    expect(screen.getByText(IDEA_CARD_WORDS.founderFit)).toBeTruthy();
  });

  it("names the lowest measured rating, with its evidence, as what would raise it most", () => {
    render(<IdeaCard card={full} />);
    expect(lowestRating(full)!.key).toBe("defensibility");
    expect(document.querySelector("[data-idea-raise]")!.textContent).toBe("What would raise it most: Defensibility, now 7 of 20. Evidence for defensibility.");
  });

  it("fills in while drafting: skeletons for what has not arrived, no raise line, busy, no Just in", () => {
    render(<IdeaCard card={{ name: "Firstframe", attributes: full.attributes!.slice(0, 2) }} drafting justIn />);
    const card = document.querySelector("[data-idea-card]")!;
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll("[data-idea-rating][data-arrived]")).toHaveLength(2);
    expect(document.querySelector("[data-idea-raise]")).toBeNull();
    expect(screen.queryByText(IDEA_CARD_WORDS.justIn)).toBeNull();
    expect(screen.getByText(IDEA_CARD_WORDS.drafting)).toBeTruthy();
  });

  it("says when the practice model wrote it, and shows Founder fit once it is known", () => {
    render(<IdeaCard card={full} sample founderFitKnown />);
    expect(screen.getByText(IDEA_CARD_WORDS.sample)).toBeTruthy();
    expect(document.querySelector("[data-idea-rating=founder_fit]")!.hasAttribute("data-unmeasured")).toBe(false);
    expect(lowestRating(full, true)!.key).toBe("founder_fit");
  });
});

describe("IdeaCard with a logo of its own", () => {
  it("draws the logo image instead of the initials tile", async () => {
    const { SAMPLE_LOGOS } = await import("../foundation/logo-samples");
    const { container } = render(<IdeaCard card={{ name: "Sole Revival", pitch: "Sneaker cleaning." }} logo={SAMPLE_LOGOS.orbit} />);
    const header = container.querySelector("header")!;
    expect(header.querySelector("img")?.getAttribute("src")).toBe(SAMPLE_LOGOS.orbit);
    expect(header.textContent).not.toContain("SR");
  });

  it("says what a known Founder fit rests on until the long profile is saved (WP-14 T2)", () => {
    const { rerender } = render(<IdeaCard card={full} founderFitKnown fitBasis="quick" />);
    expect(document.querySelector("[data-idea-rating=founder_fit] [data-idea-fit-basis=quick]")!.textContent).toBe("Fit: 1 (quick profile)");
    rerender(<IdeaCard card={full} founderFitKnown fitBasis="full" />);
    expect(document.querySelector("[data-idea-fit-basis]")).toBeNull();
    // Unknown fit says nothing about a basis, whatever is passed.
    rerender(<IdeaCard card={full} fitBasis="quick" />);
    expect(document.querySelector("[data-idea-fit-basis]")).toBeNull();
  });
});
