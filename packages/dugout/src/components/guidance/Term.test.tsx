import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DefinitionCard } from "./DefinitionCard";
import { GuidanceProvider } from "./GuidanceProvider";
import { LearnLinkProvider, isExternalLearnHref, resolveLearnHref } from "./LearnLink";
import { Term } from "./Term";
import { FIXTURE_TERMS } from "./fixtures";

const RUNWAY_SHORT = FIXTURE_TERMS.runway!.short;

describe("Term", () => {
  it("is the word in its own colour with the dotted learn underline, and opens its definition on hover after the delay", async () => {
    const user = userEvent.setup();
    render(
      <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
        <p className="text-secondary">
          Your <Term id="runway">runway</Term> is 7 months.
        </p>
      </GuidanceProvider>,
    );
    const word = screen.getByRole("button", { name: "runway" });
    expect(word.className).toContain("term-link");
    expect(word.className).not.toContain("dashed");
    expect(word.getAttribute("data-term")).toBe("runway");
    expect(word.getAttribute("aria-expanded")).toBe("false");
    await user.hover(word);
    expect(screen.queryByText(RUNWAY_SHORT)).toBeNull();
    const short = await screen.findByText(RUNWAY_SHORT, {}, { timeout: 2000 });
    const card = short.closest("[data-definition-card]") as HTMLElement;
    expect(card.className).toContain("w-80");
    expect(screen.getByText("Runway").className).toContain("t-display-sm");
    expect(screen.getByText(FIXTURE_TERMS.runway!.long!).className).toContain("t-small");
    const learn = screen.getByRole("link", { name: "Learn more" });
    expect(learn.getAttribute("href")).toBe("/finance/runway");
    expect(learn.getAttribute("target")).toBeNull();
    expect(word.getAttribute("aria-expanded")).toBe("true");
  });

  it("persists on Enter so Learn more is reachable, and Escape closes it and hands focus back to the word", async () => {
    const user = userEvent.setup();
    render(
      <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
        <Term id="runway" fact="£18,400 · 7 months" />
      </GuidanceProvider>,
    );
    const word = screen.getByRole("button", { name: "Runway" });
    word.focus();
    await user.keyboard("{Enter}");
    const learn = await screen.findByRole("link", { name: "Learn more" });
    await waitFor(() => expect(document.activeElement).toBe(learn));
    const card = learn.closest("[data-definition-card]") as HTMLElement;
    expect(card.hasAttribute("data-pinned")).toBe(true);
    expect(card.querySelector("[data-definition-fact]")?.textContent).toContain("In this business");
    expect(card.querySelector("[data-definition-fact]")?.textContent).toContain("£18,400 · 7 months");
    // The pointer leaving does not close a pinned card.
    await user.unhover(word);
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByRole("link", { name: "Learn more" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(RUNWAY_SHORT)).toBeNull());
    expect(document.activeElement).toBe(word);
  });

  it("is plain text with guidance off, unless always", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <Term id="runway">runway</Term>
      </GuidanceProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    const plain = screen.getByText("runway");
    expect(plain.className).not.toContain("term-link");
    expect(plain.getAttribute("data-guided")).toBe("off");
    rerender(
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <Term id="estimate" always />
      </GuidanceProvider>,
    );
    expect(screen.getByRole("button", { name: "Estimate" }).className).toContain("term-link");
  });

  it("renders an unknown id as plain text, never a broken underline, and takes an inline definition", () => {
    const { rerender } = render(<Term id="nope">a word</Term>);
    expect(screen.getByText("a word").tagName).not.toBe("BUTTON");
    rerender(<Term id="nope" />);
    expect(document.body.textContent).toBe("");
    rerender(<Term id="local" definition={{ id: "local", word: "Local", short: "Defined inline." }} />);
    expect(screen.getByRole("button", { name: "Local" }).className).toContain("term-link");
  });
});

describe("DefinitionCard and the Learn more target", () => {
  it("resolves slugs to paths by default, passes URLs through (opening them in a new tab), and takes the app's resolver", async () => {
    expect(resolveLearnHref("finance/runway")).toBe("/finance/runway");
    expect(resolveLearnHref("/settings")).toBe("/settings");
    expect(resolveLearnHref("https://example.com/a")).toBe("https://example.com/a");
    expect(resolveLearnHref("  ")).toBeUndefined();
    expect(isExternalLearnHref("https://example.com/a")).toBe(true);
    expect(isExternalLearnHref("/finance/runway")).toBe(false);

    const user = userEvent.setup();
    const resolve = vi.fn((learn: string) => `/b/northwind/${learn}`);
    render(
      <LearnLinkProvider resolve={resolve}>
        <DefinitionCard word="MRR" short="Monthly recurring revenue." learn="finance/mrr" openDelay={0}>
          <button type="button">MRR</button>
        </DefinitionCard>
      </LearnLinkProvider>,
    );
    await user.hover(screen.getByRole("button", { name: "MRR" }));
    const learn = await screen.findByRole("link", { name: "Learn more" });
    expect(learn.getAttribute("href")).toBe("/b/northwind/finance/mrr");
    expect(resolve).toHaveBeenCalledWith("finance/mrr");
  });

  it("marks an external target and shows no Learn more without one", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <DefinitionCard word="MRR" short="Monthly recurring revenue." learn="https://example.com/mrr" openDelay={0}>
        <button type="button">MRR</button>
      </DefinitionCard>,
    );
    await user.hover(screen.getByRole("button", { name: "MRR" }));
    const learn = await screen.findByRole("link", { name: "Learn more" });
    expect(learn.getAttribute("target")).toBe("_blank");
    expect(learn.getAttribute("rel")).toBe("noreferrer");
    unmount();
    render(
      <DefinitionCard word="Cycle" short="One round of work." openDelay={0}>
        <button type="button">Cycle</button>
      </DefinitionCard>,
    );
    await user.hover(screen.getByRole("button", { name: "Cycle" }));
    await screen.findByText("One round of work.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("pinned without a link, the card itself takes focus and reads the word and its meaning", async () => {
    const user = userEvent.setup();
    render(
      <DefinitionCard word="Cycle" short="One round of work." openDelay={0}>
        <button type="button">Cycle</button>
      </DefinitionCard>,
    );
    const trigger = screen.getByRole("button", { name: "Cycle" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "Cycle" });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card.getAttribute("aria-describedby")).toBe(document.getElementById(card.getAttribute("aria-describedby")!)?.id);
    expect(document.getElementById(card.getAttribute("aria-describedby")!)?.textContent).toBe("One round of work.");
    // A second Enter on the word lets go of the pin.
    trigger.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Cycle" })).toBeNull());
  });
});
