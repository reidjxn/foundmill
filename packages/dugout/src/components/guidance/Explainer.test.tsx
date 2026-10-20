import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EXPLAINER_LABELS, Explainer } from "./Explainer";
import { GuidanceProvider } from "./GuidanceProvider";

const props = {
  screenId: "home",
  purpose: "Your business at a glance: what the team did and what it needs from you.",
  action: "Read the notes in the Inbox, then press Continue to run a cycle.",
  watchFor: "The runway tile turning amber.",
};

describe("Explainer", () => {
  it("is a surface-2 strip with the three labels, a body line each, Got it and Show me an example", async () => {
    const user = userEvent.setup();
    const onExample = vi.fn();
    render(<Explainer {...props} onExample={onExample} />);
    const strip = screen.getByRole("region", { name: EXPLAINER_LABELS.purpose });
    expect(strip.className).toContain("bg-surface-2");
    expect(strip.className).toContain("rounded-md");
    expect(strip.getAttribute("data-explainer")).toBe("home");
    expect(strip.getAttribute("data-state")).toBe("open");
    expect(strip.querySelector("svg")?.getAttribute("class")).toContain("text-kit-lift");
    for (const label of Object.values(EXPLAINER_LABELS)) expect(screen.getByText(label).className).toContain("t-data");
    expect(screen.getByText(props.action).className).toContain("text-body");
    expect(screen.getByRole("button", { name: "Got it" }).getAttribute("data-variant")).toBe("ghost");
    await user.click(screen.getByRole("button", { name: "Show me an example" }));
    expect(onExample).toHaveBeenCalledTimes(1);
  });

  it("collapses to one line with a chevron after Got it, remembers the screen, and opens again from the chevron", async () => {
    const user = userEvent.setup();
    const markExplainerSeen = vi.fn();
    render(
      <GuidanceProvider actions={{ markExplainerSeen }}>
        <Explainer {...props} />
      </GuidanceProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(markExplainerSeen).toHaveBeenCalledWith("home");
    const strip = screen.getByRole("region", { name: EXPLAINER_LABELS.purpose });
    expect(strip.getAttribute("data-state")).toBe("collapsed");
    expect(screen.queryByText(EXPLAINER_LABELS.action)).toBeNull();
    expect(screen.getByText(props.purpose)).toBeTruthy();
    const more = screen.getByRole("button", { name: "Show more about this screen" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    expect(screen.getByRole("region", { name: EXPLAINER_LABELS.purpose }).getAttribute("data-state")).toBe("open");
    expect(screen.getByText(props.watchFor)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show less about this screen" }));
    expect(screen.getByRole("region", { name: EXPLAINER_LABELS.purpose }).getAttribute("data-state")).toBe("collapsed");
  });

  it("starts collapsed for a screen already seen, and is not rendered when guidance is off", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ explainersSeen: { home: true } }}>
        <Explainer {...props} />
      </GuidanceProvider>,
    );
    expect(screen.getByRole("region", { name: EXPLAINER_LABELS.purpose }).getAttribute("data-state")).toBe("collapsed");
    rerender(
      <GuidanceProvider value={{ guidance: "off" }}>
        <Explainer {...props} />
      </GuidanceProvider>,
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("never clips: the strip is in flow, not floating", () => {
    render(<Explainer {...props} />);
    const strip = screen.getByRole("region", { name: EXPLAINER_LABELS.purpose });
    expect(strip.className).not.toMatch(/\b(absolute|fixed|sticky)\b/);
    expect(strip.className).not.toMatch(/truncate|line-clamp/);
  });
});
