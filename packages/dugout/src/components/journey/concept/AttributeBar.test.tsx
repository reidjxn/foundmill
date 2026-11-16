// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AttributeLabel } from "./AttributeBar";

describe("AttributeLabel", () => {
  it("makes a defined label a 24 px target: it stands alone in its row, so WCAG 2.5.8's inline exception does not apply", () => {
    const { container } = render(<AttributeLabel label="Market pull" hint="How much people already want this." attributeKey="market_pull" />);
    const term = container.querySelector("[data-term]")!;
    expect(term.tagName).toBe("BUTTON");
    expect(term.className).toContain("min-h-target");
  });
});
