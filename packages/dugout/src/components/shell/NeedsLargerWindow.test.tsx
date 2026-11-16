import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NEEDS_LARGER_WINDOW_WORDS, NeedsLargerWindow } from "./NeedsLargerWindow";

describe("NeedsLargerWindow (WP-03 T3: the wall has exits)", () => {
  it("says what the part is and what to do, without the pixels by default", () => {
    render(<NeedsLargerWindow width={390} />);
    const note = screen.getByTestId("needs-larger-window");
    expect(screen.getByRole("heading", { name: NEEDS_LARGER_WINDOW_WORDS.title })).toBeTruthy();
    expect(note.textContent).toContain(NEEDS_LARGER_WINDOW_WORDS.body);
    expect(note.textContent).not.toContain("390 px");
    expect(note.textContent).not.toContain("1280");
  });

  it("shows the width line only with showWidth", () => {
    render(<NeedsLargerWindow width={1279} showWidth />);
    expect(screen.getByText("1279 px")).toBeTruthy();
    expect(screen.getByTestId("needs-larger-window").textContent).toContain("1280 px");
  });

  it("takes its own title, body and the actions the page passes", () => {
    render(<NeedsLargerWindow title="T" body="B" actions={<a href="/home">Go to your home</a>} />);
    expect(screen.getByRole("heading", { name: "T" })).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to your home" }).getAttribute("href")).toBe("/home");
  });

  it("renders on the server with its actions (a slot, no browser API)", () => {
    expect(renderToStaticMarkup(<NeedsLargerWindow actions={<button type="button">Email me a link</button>} />)).toContain("Email me a link");
  });
});
