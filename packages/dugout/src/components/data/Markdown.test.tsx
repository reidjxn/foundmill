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

  it("renders a link the parser will not follow as plain text, not an anchor with an empty href", async () => {
    vi.resetModules();
    const { Markdown, preloadMarkdown } = await import("./Markdown");
    await preloadMarkdown();
    const { container } = render(
      <Markdown variant="body" entities={false} images={false}>
        {"[js link](javascript:alert(4)) [data link](data:text/html,hi) [site](https://example.com) [here](/b/x/inbox)"}
      </Markdown>,
    );
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual(["https://example.com", "/b/x/inbox"]);
    expect(screen.getByText("js link").tagName).toBe("SPAN");
    expect(screen.getByText("data link").tagName).toBe("SPAN");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(anchors[1]?.getAttribute("target")).toBeNull();
  });

  it("with webLinksOnly, only http(s) addresses are links: a path, mailto or tel inside the app stays text", async () => {
    vi.resetModules();
    const { Markdown, preloadMarkdown } = await import("./Markdown");
    await preloadMarkdown();
    const { container } = render(
      <Markdown variant="body" images={false} webLinksOnly>
        {"[site](https://example.com) [plain](http://example.org) [settings](/b/x/settings) [mail](mailto:a@b.example) [call](tel:123) <https://auto.example>"}
      </Markdown>,
    );
    expect(Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["https://example.com", "http://example.org", "https://auto.example"]);
    for (const text of ["settings", "mail", "call"]) expect(screen.getByText(text).tagName).toBe("SPAN");
  });

  it("renders formatted at once when the parser is already in", async () => {
    vi.resetModules();
    const { Markdown, preloadMarkdown } = await import("./Markdown");
    await preloadMarkdown();
    render(<Markdown variant="body">{"- one\n- two"}</Markdown>);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("defined terms in a note (docs/UX_AUDIT_AND_PLAN.md §6.2 Term, Markdown rule)", () => {
  const TERMS = {
    runway: { id: "runway", word: "Runway", short: "How many months your cash lasts at today's spending." },
    net_burn: { id: "net_burn", word: "Net burn", short: "What the business spends in a month minus what it earns." },
    burn: { id: "burn", word: "Burn", short: "How much cash the business uses up each month." },
    cycle: { id: "cycle", word: "Cycle", short: "One round of work." },
    mrr: { id: "mrr", word: "MRR", short: "Monthly recurring revenue." },
  };

  it("marks the first whole-word occurrence of each term once, case-insensitively, never inside code, links or mentions", async () => {
    const { markTerms, unmarkTerms } = await import("./Markdown");
    const text = `The runway is 7 months; runway again. Net burn fell, so burn is lower. \`runway\` and [runway](/x) and [[ent:${ID}|Runway Ltd]] stay. MRRX is not MRR. Rounds of work end.`;
    const marked = markTerms(text, TERMS);
    const marks = [...marked.matchAll(/([^]*)([^]*)/g)].map((m) => [m[1], m[2]]);
    expect(marks).toEqual([
      ["runway", "runway"],
      ["net_burn", "Net burn"],
      ["burn", "burn"],
      ["mrr", "MRR"],
      ["cycle", "Cycles"],
    ]);
    // The words stay where they were; only markers were added, and they strip back to the source.
    expect(unmarkTerms(marked)).toBe(text);
    expect(markTerms("No defined words here.", TERMS)).toBe("No defined words here.");
    expect(markTerms("", TERMS)).toBe("");
    // Inside a fenced block, an autolink, a bare URL or an HTML tag: never (the words between tags are text, and count).
    expect(markTerms("```\nrunway\n```\n<https://runway.example> https://www.runway.example/mrr <runway>", TERMS)).not.toMatch(//);
    expect(markTerms("<b>cycle</b>", TERMS)).toBe("<b>cyclecycle</b>");
  });

  it("compiles a terms map's expressions once and reuses them on every later marking", async () => {
    const { compiledTerms, markTerms } = await import("./Markdown");
    const first = compiledTerms(TERMS);
    expect(first.map((t) => t.id)).toEqual(["net_burn", "runway", "cycle", "burn", "mrr"]);
    expect(compiledTerms(TERMS)).toBe(first);
    expect(compiledTerms({ ...TERMS })).not.toBe(first);
    // A cached expression is never left advanced: the same text marks the same way every time.
    const text = "The runway is 7 months; net burn fell.";
    const once = markTerms(text, TERMS);
    expect(markTerms(text, TERMS)).toBe(once);
    expect(compiledTerms(TERMS)).toBe(first);
    expect(first.every((t) => t.re.lastIndex === 0)).toBe(true);
  });

  it("renders a marked term as a Term with its definition, once per term, and nothing when guidance is off or terms are off", async () => {
    vi.resetModules();
    const { Markdown, preloadMarkdown } = await import("./Markdown");
    const { GuidanceProvider } = await import("../guidance/GuidanceProvider");
    await preloadMarkdown();
    const text = `**Runway** is 7 months. The runway page: [runway](/x). Round of work 3 ran for [[ent:${ID}|Runway Ltd]].`;
    const on = render(
      <GuidanceProvider value={{ guidance: "on", terms: TERMS }}>
        <Markdown variant="body" terms>
          {text}
        </Markdown>
      </GuidanceProvider>,
    );
    const terms = Array.from(on.container.querySelectorAll("[data-term]"));
    expect(terms.map((t) => [t.getAttribute("data-term"), t.textContent])).toEqual([
      ["runway", "Runway"],
      ["cycle", "Cycle"],
    ]);
    // The first "Runway" sits inside the strong, as a button with the term-link look; the link and the mention are untouched.
    expect(terms[0]!.tagName).toBe("BUTTON");
    expect(terms[0]!.closest("strong")).not.toBeNull();
    expect(on.container.querySelector("a[href='/x']")?.textContent).toBe("runway");
    expect(on.container.querySelector("[data-entity-id]")?.textContent).toBe("Runway Ltd");
    expect(on.container.textContent).toBe("Runway is 7 months. The runway page: runway. Round of work 3 ran for Runway Ltd.");
    expect(on.container.querySelector("[data-markdown]")?.getAttribute("data-terms")).toBe("true");
    on.unmount();

    const off = render(
      <GuidanceProvider value={{ guidance: "off", terms: TERMS }}>
        <Markdown variant="body" terms>
          {text}
        </Markdown>
      </GuidanceProvider>,
    );
    expect(off.container.querySelector("[data-term]")).toBeNull();
    expect(off.container.querySelector("[data-markdown]")?.getAttribute("data-terms")).toBeNull();
    off.unmount();

    const plain = render(
      <GuidanceProvider value={{ guidance: "on", terms: TERMS }}>
        <Markdown variant="body">{text}</Markdown>
      </GuidanceProvider>,
    );
    expect(plain.container.querySelector("[data-term]")).toBeNull();
  });

  it("shows the words plain, without markers, while the parser loads", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.resetModules();
    vi.doMock("./MarkdownEngine", async () => {
      await gate;
      return vi.importActual<typeof EngineModule>("./MarkdownEngine");
    });
    const { Markdown } = await import("./Markdown");
    const { GuidanceProvider } = await import("../guidance/GuidanceProvider");
    const { container } = render(
      <GuidanceProvider value={{ guidance: "on", terms: TERMS }}>
        <Markdown variant="body" terms>
          {"Runway is 7 months."}
        </Markdown>
      </GuidanceProvider>,
    );
    expect(container.querySelector("[data-markdown]")?.textContent).toBe("Runway is 7 months.");
    expect(container.textContent).not.toMatch(/[-]/);
    release();
    await waitFor(() => expect(container.querySelector("[data-term='runway']")).not.toBeNull(), { timeout: 15_000 });
  });
});
