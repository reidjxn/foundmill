import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as EngineModule from "./MarkdownEngine";

const ID = "11111111-1111-4111-8111-111111111111";

describe("Markdown parser loading", () => {
  afterEach(() => {
    vi.doUnmock("./MarkdownEngine");
    vi.resetModules();
  });

  it("shows the text plain while the parser chunk loads, then formatted; plain text never fetches or links", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.resetModules();
    vi.doMock("./MarkdownEngine", async () => {
      await gate;
      return vi.importActual<typeof EngineModule>("./MarkdownEngine");
    });
    const { Markdown } = await import("./Markdown");

    const text = `**Batch 002** for [[ent:${ID}|Acme Ltd]] ![pixel](https://stranger.example/p.png)`;
    const { container } = render(<Markdown variant="body">{text}</Markdown>);
    const box = container.querySelector("[data-markdown]")!;
    expect(box.textContent).toBe("**Batch 002** for Acme Ltd ![pixel](https://stranger.example/p.png)");
    expect(box.querySelector("img, a, strong")).toBeNull();

    release();
    // The real parser chunk transforms on first import; give a loaded CI runner time.
    await waitFor(() => expect(screen.getByText("Batch 002").tagName).toBe("STRONG"), { timeout: 15_000 });
    expect(container.querySelector("[data-entity-id]")).not.toBeNull();
  });

  it("keeps a mention literal in the fallback when entities are off", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.resetModules();
    vi.doMock("./MarkdownEngine", async () => {
      await gate;
      return vi.importActual<typeof EngineModule>("./MarkdownEngine");
    });
    const { Markdown } = await import("./Markdown");
    const text = `Plain [[ent:${ID}|Acme Ltd]] mention`;
    const { container } = render(
      <Markdown variant="body" entities={false}>
        {text}
      </Markdown>,
    );
    expect(container.querySelector("[data-markdown]")?.textContent).toBe(text);
    release();
    await waitFor(() => expect(container.querySelector("[data-markdown] p:not(.whitespace-pre-wrap)")).not.toBeNull(), { timeout: 15_000 });
    expect(container.querySelector("[data-markdown]")?.textContent).toBe(text);
    expect(container.querySelector("[data-entity-id]")).toBeNull();
  });

  it("renders formatted at once when the parser is already in", async () => {
    vi.resetModules();
    const { Markdown, preloadMarkdown } = await import("./Markdown");
    await preloadMarkdown();
    render(<Markdown variant="body">{"- one\n- two"}</Markdown>);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
