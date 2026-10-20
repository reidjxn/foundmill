import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { AUTOPILOT_GUIDE_LINE, AutopilotChip } from "./AutopilotChip";

describe("AutopilotChip", () => {
  it("says the state in words and shows the next planned cycle with the Estimate tag", () => {
    render(<AutopilotChip state="on" label="On" nextAt="2026-10-14T15:45:00.000Z" />);
    const chip = screen.getByTestId("autopilot-chip");
    expect(chip.getAttribute("data-autopilot-state")).toBe("on");
    expect(chip.textContent).toContain("Autopilot");
    expect(chip.textContent).toContain("On");
    expect(chip.querySelector("[data-autopilot-next]")?.textContent).toContain("Oct 14, 3:45 PM");
    expect(chip.querySelector("[data-provenance='estimate']")).toBeTruthy();
  });

  it("leaves the next cycle out while paused or off (no forecast to show)", () => {
    const { rerender } = render(<AutopilotChip state="paused" label="Paused: credits used up" nextAt="2026-10-14T15:45:00.000Z" />);
    expect(screen.getByTestId("autopilot-chip").querySelector("[data-autopilot-next]")).toBeNull();
    expect(screen.getByTestId("autopilot-chip").textContent).toContain("Paused: credits used up");
    rerender(<AutopilotChip state="off" label="Off" />);
    expect(screen.getByTestId("autopilot-chip").querySelector("[data-autopilot-next]")).toBeNull();
  });

  it("is a labeled group, or a button when it opens Settings", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<AutopilotChip state="waiting" label="Waiting for you" detail="Two Inbox items need your decision." />);
    expect(screen.getByRole("group", { name: "Autopilot: Waiting for you. Two Inbox items need your decision." })).toBeTruthy();
    rerender(<AutopilotChip state="waiting" label="Waiting for you" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Autopilot: Waiting for you" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("says in one sentence what Autopilot does and never does beside the chip, in guided mode only (UX plan B16)", () => {
    const { container, unmount } = render(<AutopilotChip state="on" label="On" guide />);
    const guide = container.querySelector("[data-autopilot-guide]");
    expect(guide?.textContent).toBe(AUTOPILOT_GUIDE_LINE);
    expect(AUTOPILOT_GUIDE_LINE).toBe("Autopilot presses Continue for you on a schedule. It never answers notes for you.");
    // The sentence sits outside the chip, so the chip's name stays its state.
    expect(screen.getByTestId("autopilot-chip").textContent).not.toContain("presses Continue");
    unmount();
    // Without `guide` (Settings › Mode) and with guidance off (an experienced founder) there is no sentence.
    const { container: plain, unmount: unmountPlain } = render(<AutopilotChip state="on" label="On" />);
    expect(plain.querySelector("[data-autopilot-guide]")).toBeNull();
    unmountPlain();
    const { container: off } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <AutopilotChip state="on" label="On" guide />
      </GuidanceProvider>,
    );
    expect(off.querySelector("[data-autopilot-guide]")).toBeNull();
    expect(screen.getByTestId("autopilot-chip")).toBeTruthy();
  });
});
