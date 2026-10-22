// @vitest-environment happy-dom
/**
 * The Ideation Studio's example briefs (docs/UX_AUDIT_AND_PLAN.md §6.2 ExampleToggle, §7.5 A7): the chips fill and
 * tag the brief, an edit makes it the founder's, the chosen chip again clears it, nothing drafts by itself, and the
 * generate control says what it will draft from. The deck comes from a fake `idea.list` (empty, so the chips show).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuidanceProvider } from "@foundmill/dugout";
import type { FakeApi } from "../../live/__tests__/fake-trpc";

let api: FakeApi;
const draftMutate = vi.fn();
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("../../live/__tests__/fake-trpc");
  return { useTRPC: () => fakeTrpc(api), useTRPCClient: () => ({ idea: { draft: { mutate: draftMutate } } }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { makeApi, renderWithProviders } from "../../live/__tests__/fake-trpc";
import { DRAFT_FOR_ME, DRAFT_FROM_EXAMPLE, EXAMPLE_BRIEFS, EXAMPLE_BRIEF_LABEL, IdeationStudio, exampleBriefIn, generateLabel } from "../ideate/IdeationStudio";

const SKINCARE = "A subscription for refillable skincare";
const brief = () => screen.getByRole("textbox", { name: "Brief" }) as HTMLTextAreaElement;
const generate = () => screen.getByTestId("generate-button");
const chip = (name: string) => within(screen.getByRole("group", { name: EXAMPLE_BRIEF_LABEL })).getByRole("button", { name });

beforeEach(() => {
  api = makeApi();
  api.handlers["idea.list"] = () => ({ items: [], nextCursor: null });
  draftMutate.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("generateLabel / exampleBriefIn", () => {
  it("says what will be drafted from: nothing, an example, or the founder's own words", () => {
    expect(generateLabel("", false)).toBe(DRAFT_FOR_ME);
    expect(generateLabel("   ", true)).toBe(DRAFT_FOR_ME);
    expect(generateLabel(SKINCARE, true)).toBe(DRAFT_FROM_EXAMPLE);
    expect(generateLabel(SKINCARE, false)).toBe("Draft concepts");
    expect(generateLabel("Pet care", false)).toBe("Draft concepts");
  });

  it("an example is in only while the brief is exactly the chosen sentence", () => {
    expect(exampleBriefIn(SKINCARE, SKINCARE)).toBe(true);
    expect(exampleBriefIn(`${SKINCARE} for gyms`, SKINCARE)).toBe(false);
    expect(exampleBriefIn("", SKINCARE)).toBe(false);
    expect(exampleBriefIn(SKINCARE, null)).toBe(false);
  });
});

describe("IdeationStudio example briefs", () => {
  it("a chip fills and tags the brief, an edit makes it the founder's, the chosen chip again clears it, and nothing drafts by itself", async () => {
    renderWithProviders(<IdeationStudio viewer={{ email: "reid@example.com" }} />);
    const group = await screen.findByTestId("example-briefs");
    expect(group.hasAttribute("data-example-toggle")).toBe(true);
    expect(within(group).getByRole("group", { name: EXAMPLE_BRIEF_LABEL })).toBeTruthy();
    expect(group.textContent).toContain(EXAMPLE_BRIEF_LABEL);
    expect(group.textContent).not.toContain("Try one");
    for (const text of EXAMPLE_BRIEFS) expect(chip(text).getAttribute("aria-pressed")).toBe("false");
    expect(brief().value).toBe("");
    expect(screen.queryByTestId("brief-example")).toBeNull();
    expect(generate().textContent).toContain(DRAFT_FOR_ME);

    fireEvent.click(chip(SKINCARE));
    expect(brief().value).toBe(SKINCARE);
    expect(chip(SKINCARE).getAttribute("aria-pressed")).toBe("true");
    const frame = screen.getByTestId("brief-example");
    expect(frame.className).toContain("border-dashed");
    expect(within(frame).getByText("Example")).toBeTruthy();
    expect(within(frame).getByRole("textbox", { name: "Brief" })).toBeTruthy();
    expect(generate().textContent).toContain(DRAFT_FROM_EXAMPLE);
    // The example never drafts by itself.
    expect(draftMutate).not.toHaveBeenCalled();

    // Another chip swaps the example.
    fireEvent.click(chip(EXAMPLE_BRIEFS[2]!));
    expect(brief().value).toBe(EXAMPLE_BRIEFS[2]);
    expect(chip(SKINCARE).getAttribute("aria-pressed")).toBe("false");
    expect(chip(EXAMPLE_BRIEFS[2]!).getAttribute("aria-pressed")).toBe("true");

    // An edit, however small, makes the brief the founder's: no tag, no pressed chip, the plain label.
    fireEvent.change(brief(), { target: { value: `${EXAMPLE_BRIEFS[2]} on consoles` } });
    expect(screen.queryByTestId("brief-example")).toBeNull();
    for (const text of EXAMPLE_BRIEFS) expect(chip(text).getAttribute("aria-pressed")).toBe("false");
    expect(generate().textContent).toContain("Draft concepts");
    expect(generate().textContent).not.toContain(DRAFT_FROM_EXAMPLE);

    // Pick again, then the chosen chip once more: the brief it filled is cleared.
    fireEvent.click(chip(SKINCARE));
    expect(brief().value).toBe(SKINCARE);
    fireEvent.click(chip(SKINCARE));
    expect(brief().value).toBe("");
    expect(screen.queryByTestId("brief-example")).toBeNull();
    expect(generate().textContent).toContain(DRAFT_FOR_ME);
    expect(draftMutate).not.toHaveBeenCalled();
  });

  it("guidance off: no example briefs, and a brief typed by hand is never tagged", async () => {
    renderWithProviders(
      <GuidanceProvider value={{ guidance: "off" }}>
        <IdeationStudio viewer={{ email: "reid@example.com" }} />
      </GuidanceProvider>,
    );
    await screen.findByTestId("concept-grid");
    expect(screen.queryByTestId("example-briefs")).toBeNull();
    expect(screen.queryByRole("group", { name: EXAMPLE_BRIEF_LABEL })).toBeNull();
    fireEvent.change(brief(), { target: { value: SKINCARE } });
    expect(screen.queryByTestId("brief-example")).toBeNull();
    expect(generate().textContent).toContain("Draft concepts");
  });
});
