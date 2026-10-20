import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { PROVENANCE_SENTENCE, ProvenanceChip } from "../foundation/Chip";
import { GuidanceProvider } from "./GuidanceProvider";
import { FIXTURE_TERMS } from "./fixtures";

describe("ProvenanceChip's explanation (finding D3: a native title became a real tooltip)", () => {
  it("is a focusable word whose meaning opens as a tooltip on focus, without a native title", async () => {
    const user = userEvent.setup();
    render(<ProvenanceChip kind="forecast" />);
    const chip = screen.getByRole("button", { name: "Forecast" });
    expect(chip.getAttribute("title")).toBeNull();
    expect(chip.className).toContain("est-chip");
    await user.tab();
    expect(document.activeElement).toBe(chip);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe(PROVENANCE_SENTENCE.forecast);
  });

  it("opens the definition card with Learn more when the definitions map holds the kind, even with guidance off", async () => {
    const user = userEvent.setup();
    render(
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <ProvenanceChip kind="estimate" appearance="word" />
      </GuidanceProvider>,
    );
    const word = screen.getByRole("button", { name: "Estimate" });
    expect(word.className).toContain("text-tertiary");
    await user.hover(word);
    await screen.findByText(FIXTURE_TERMS.estimate!.short, {}, { timeout: 2000 });
    expect(screen.getByRole("link", { name: "Learn more" }).getAttribute("href")).toBe("/settings/integrations");
  });

  it("renders the chip on the server (the tooltip is the client piece)", () => {
    const html = renderToStaticMarkup(<ProvenanceChip kind="estimate" />);
    expect(html).toContain("est-chip");
    expect(html).toContain("Estimate");
    expect(html).not.toContain("title=");
  });
});
