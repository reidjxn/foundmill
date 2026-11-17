import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NARROW_WINDOW_WORDS, NarrowWindowNote } from "./NarrowWindowNote";

describe("NarrowWindowNote", () => {
  it("says the window scrolls sideways and is dismissed by its named button", () => {
    const onDismiss = vi.fn();
    render(<NarrowWindowNote onDismiss={onDismiss} />);
    expect(screen.getByRole("status").textContent).toContain(NARROW_WINDOW_WORDS.body);
    fireEvent.click(screen.getByRole("button", { name: NARROW_WINDOW_WORDS.dismiss }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
