// @vitest-environment happy-dom
/** The note body carries the `inbox-note` test id on its wrapper: Dugout's Markdown keeps its own props (the id used to be dropped). */
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { preloadMarkdown } from "@foundmill/dugout";
import { InboxNote } from "../ReadingPane";

describe("InboxNote", () => {
  beforeAll(() => preloadMarkdown());

  it("renders the markdown body inside the inbox-note wrapper", () => {
    render(<InboxNote bodyMd={"**Batch 002** is ready.\n\n- carton proof\n- label copy"} />);
    const note = screen.getByTestId("inbox-note");
    expect(note.textContent).toContain("Batch 002");
    expect(note.querySelector("strong")?.textContent).toBe("Batch 002");
    expect(note.querySelectorAll("li")).toHaveLength(2);
  });
});
