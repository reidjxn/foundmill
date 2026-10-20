import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "./GuidanceProvider";
import { InfoTip } from "./InfoTip";

describe("InfoTip", () => {
  it("is a 24 px Info button named About <label> that shows its sentence as a tooltip on focus", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="Cash and runway">How long the money lasts at today's spending.</InfoTip>);
    const button = screen.getByRole("button", { name: "About Cash and runway" });
    expect(button.className).toContain("size-target");
    expect(button.className).toContain("text-tertiary");
    expect(button.getAttribute("data-info-tip")).toBe("tip");
    expect(button.querySelector("svg")?.getAttribute("width")).toBe("14");
    await user.tab();
    expect(document.activeElement).toBe(button);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain("How long the money lasts");
  });

  it("becomes a definition card with a reachable Learn more when given somewhere to go", async () => {
    const user = userEvent.setup();
    render(
      <InfoTip label="Runway" learn="finance/runway" kind="why">
        We ask so the runway tile can say how long the money lasts.
      </InfoTip>,
    );
    const button = screen.getByRole("button", { name: "About Runway" });
    expect(button.getAttribute("data-info-tip")).toBe("why");
    button.focus();
    await user.keyboard("{Enter}");
    const learn = await screen.findByRole("link", { name: "Learn more" });
    expect(learn.getAttribute("href")).toBe("/finance/runway");
    expect(screen.getByText("Runway").className).toContain("t-display-sm");
  });

  it("hides when guidance is off, unless always", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <InfoTip label="Cash">Sentence.</InfoTip>
      </GuidanceProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <GuidanceProvider value={{ guidance: "off" }}>
        <InfoTip label="Cash" always>
          Sentence.
        </InfoTip>
      </GuidanceProvider>,
    );
    expect(screen.getByRole("button", { name: "About Cash" })).toBeTruthy();
  });
});
