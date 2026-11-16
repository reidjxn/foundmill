import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RATING_KEY_WORDS, RatingKey } from "./RatingKey";

describe("RatingKey (WP-10 T9)", () => {
  it("each swatch has its word and range", () => {
    const { container } = render(<RatingKey />);
    const bands = [...container.querySelectorAll("[data-rating-band]")];
    expect(bands.map((b) => b.textContent)).toEqual(["1–5 Poor", "6–10 Average", "11–15 Good", "16–20 Excellent"]);
    for (const b of bands) expect(b.querySelector("[aria-hidden]")?.className).toMatch(/bg-rating-[1-4]/);
    expect(container.querySelector("[data-rating-key]")?.textContent).toBe(RATING_KEY_WORDS.replaceAll(" · ", ""));
  });
});
