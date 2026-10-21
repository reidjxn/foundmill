// @vitest-environment happy-dom
/**
 * The note body carries the `inbox-note` test id on its wrapper: Dugout's Markdown keeps its own props (the id used to
 * be dropped). With guidance on, the first mention of each defined term in the body is a Term (UX plan §6.2, §7.9).
 */
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { GuidanceProvider, TooltipProvider, preloadMarkdown } from "@foundmill/dugout";
import { termsWithGlossary } from "@foundmill/shared/terms";
import { HoldsContinueChip, InboxNote } from "../ReadingPane";
import { HOLDS_CONTINUE_HINT } from "../logic";

describe("HoldsContinueChip", () => {
  it("takes focus and carries its consequence as its accessible description, whatever the guidance setting", () => {
    for (const guidance of ["on", "off"] as const) {
      const r = render(
        <TooltipProvider>
          <GuidanceProvider value={{ guidance, terms: termsWithGlossary(null) }}>
            <HoldsContinueChip />
          </GuidanceProvider>
        </TooltipProvider>,
      );
      const chip = r.getByTestId("holds-continue");
      expect(chip.textContent).toBe("Holds Continue");
      expect(chip.getAttribute("tabindex")).toBe("0");
      chip.focus();
      expect(document.activeElement).toBe(chip);
      const describedBy = chip.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent).toBe(HOLDS_CONTINUE_HINT);
      // One tab stop and no button: not a pressable chip, and no "About …" button (the e2e guidance-off check counts those).
      expect(r.container.querySelector("button")).toBeNull();
      expect(r.container.querySelectorAll("[tabindex]")).toHaveLength(1);
      r.unmount();
    }
  });
});

describe("InboxNote", () => {
  it("is memoized: a parent re-render with the same body does not re-render the note", () => {
    expect((InboxNote as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  beforeAll(() => preloadMarkdown());

  it("renders the markdown body inside the inbox-note wrapper", () => {
    render(<InboxNote bodyMd={"**Batch 002** is ready.\n\n- carton proof\n- label copy"} />);
    const note = screen.getByTestId("inbox-note");
    expect(note.textContent).toContain("Batch 002");
    expect(note.querySelector("strong")?.textContent).toBe("Batch 002");
    expect(note.querySelectorAll("li")).toHaveLength(2);
  });

  it("gives the first mention of each defined term its definition while guidance is on, and none when it is off", () => {
    const body = "Runway is 7 months at today's net burn, an estimate until the bank is connected. The runway page has the detail; MRR is £4,200.";
    const on = render(
      <TooltipProvider>
        <GuidanceProvider value={{ guidance: "on", terms: termsWithGlossary(null) }}>
          <InboxNote bodyMd={body} />
        </GuidanceProvider>
      </TooltipProvider>,
    );
    const terms = Array.from(on.getByTestId("inbox-note").querySelectorAll("[data-term]")).map((t) => [t.getAttribute("data-term"), t.textContent]);
    expect(terms).toEqual([
      ["runway", "Runway"],
      ["net_burn", "net burn"],
      ["estimate", "estimate"],
      ["mrr", "MRR"],
    ]);
    // The words read as they were written; only the first "runway" is a term.
    expect(on.getByTestId("inbox-note").textContent).toBe(body);
    on.unmount();

    const off = render(
      <TooltipProvider>
        <GuidanceProvider value={{ guidance: "off", terms: termsWithGlossary(null) }}>
          <InboxNote bodyMd={body} />
        </GuidanceProvider>
      </TooltipProvider>,
    );
    expect(off.getByTestId("inbox-note").querySelector("[data-term]")).toBeNull();
    expect(off.getByTestId("inbox-note").textContent).toBe(body);
  });

  it("reads the business's own words: a glossary that says clients defines the client term's display word", () => {
    const r = render(
      <TooltipProvider>
        <GuidanceProvider value={{ guidance: "on", terms: termsWithGlossary({ customer: "client" }) }}>
          <InboxNote bodyMd="Two new clients this week; the Customer Update for each is in the Inbox." />
        </GuidanceProvider>
      </TooltipProvider>,
    );
    const ids = Array.from(r.getByTestId("inbox-note").querySelectorAll("[data-term]")).map((t) => t.getAttribute("data-term"));
    // "Customer Update" is renamed to "Client Update" by the glossary, so the note's "Customer Update" is not it.
    expect(ids).not.toContain("customer_update");
  });
});
