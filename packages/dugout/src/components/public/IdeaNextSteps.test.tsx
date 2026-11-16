import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDEA_NEXT_WORDS, IdeaNextSteps } from "./IdeaNextSteps";

afterEach(cleanup);

const base = { name: "Billkeep", studioHref: "/studio-link", buildHref: "/build-link", redrawsLeft: 2 as number | null };

describe("IdeaNextSteps", () => {
  it("offers both choices as links", () => {
    render(<IdeaNextSteps {...base} onRedraw={() => {}} />);
    expect(screen.getByRole("heading", { name: IDEA_NEXT_WORDS.title("Billkeep") })).toBeTruthy();
    expect(screen.getByRole("link", { name: IDEA_NEXT_WORDS.studio }).getAttribute("href")).toBe("/studio-link");
    expect(screen.getByRole("link", { name: IDEA_NEXT_WORDS.build }).getAttribute("href")).toBe("/build-link");
    expect(screen.queryByText(IDEA_NEXT_WORDS.studioOnComputer, { exact: false })).toBeNull();
  });

  it("warns before it discards the idea, and only the confirm runs the redraw", () => {
    const onRedraw = vi.fn();
    render(<IdeaNextSteps {...base} onRedraw={onRedraw} />);
    expect(screen.getByText(IDEA_NEXT_WORDS.left(2))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: IDEA_NEXT_WORDS.tryAnother }));
    expect(onRedraw).not.toHaveBeenCalled();
    const panel = screen.getByRole("group", { name: IDEA_NEXT_WORDS.confirmTitle });
    expect(panel.textContent).toContain(IDEA_NEXT_WORDS.confirmBody("Billkeep"));
    expect(document.activeElement).toBe(panel);
    // Keep it: the button comes back, focused, and nothing ran.
    fireEvent.click(screen.getByRole("button", { name: IDEA_NEXT_WORDS.cancel("Billkeep") }));
    expect(onRedraw).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: IDEA_NEXT_WORDS.tryAnother }));
    // Escape closes it too.
    fireEvent.click(screen.getByRole("button", { name: IDEA_NEXT_WORDS.tryAnother }));
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: IDEA_NEXT_WORDS.tryAnother }));
    fireEvent.click(screen.getByRole("button", { name: IDEA_NEXT_WORDS.confirm }));
    expect(onRedraw).toHaveBeenCalledTimes(1);
  });

  it("says plainly when no redraw is left today, with no button", () => {
    render(<IdeaNextSteps {...base} redrawsLeft={0} onRedraw={() => {}} />);
    expect(screen.queryByRole("button", { name: IDEA_NEXT_WORDS.tryAnother })).toBeNull();
    expect(screen.getByText(IDEA_NEXT_WORDS.noneLeft)).toBeTruthy();
  });

  it("shows the button without a count when the count is unknown, and the Studio note on a small screen", () => {
    render(<IdeaNextSteps {...base} redrawsLeft={null} studioOnComputer onRedraw={() => {}} />);
    expect(screen.getByRole("button", { name: IDEA_NEXT_WORDS.tryAnother })).toBeTruthy();
    expect(screen.queryByText(/more today/)).toBeNull();
    expect(screen.getByText(IDEA_NEXT_WORDS.studioOnComputer, { exact: false })).toBeTruthy();
  });
});
