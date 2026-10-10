// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { META_KIND, type IdeaLike } from "../ideate/concepts";
import { AskDialog, askHistory, type AskExchange } from "../ideate/dialogs";

const idea: IdeaLike = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Patchwise",
  pitch: "Patch-test kits by post.",
  archetype: null,
  current: {
    id: "v2",
    version: 2,
    title: "Patchwise",
    pitch: "Patch-test kits by post.",
    attributes: { market_size: { value: 12 } },
    starsCurrent: 3,
    starsPotential: 4,
    research: { citations: [{ kind: META_KIND, qa: [{ question: "Biggest risk?", answer: "Regulation.\n\nPharmacies are slow.", bubbles: ["Regulation.", "Pharmacies are slow."] }] }] },
    parentVersionId: "v1",
    action: "edited",
    createdAt: "2026-10-09T10:00:00Z",
  },
};
const persona = { name: "Research agent", role: "Research analyst", avatarSeed: "research-agent", voice: { greeting: "What do you want to know?", thinking: [], ack: [] }, thinkingLine: "Checking Patchwise…" };
const starters = [
  { id: "biggest_risk", label: "Biggest risk?", say: "What's the biggest risk with this concept?", kind: "ask" as const, option_id: null, recommended: false },
  { id: "who_pays_first", label: "Who pays first?", say: "Who would pay for this first?", kind: "ask" as const, option_id: null, recommended: false },
];

function renderSheet(over: Partial<Parameters<typeof AskDialog>[0]> = {}) {
  const onAsk = vi.fn(async () => undefined);
  const r = render(
    <TooltipProvider>
      <AskDialog idea={idea} open onOpenChange={() => undefined} persona={persona} starters={starters} exchanges={[]} onAsk={onAsk} {...over} />
    </TooltipProvider>,
  );
  return { ...r, onAsk };
}

describe("Ask on a concept (the Research agent's sheet)", () => {
  it("reads the card's stored answers as the thread, each answer once", () => {
    expect(askHistory(idea).map((m) => [m.author, m.bubbles.join(" | ")])).toEqual([
      ["founder", "Biggest risk?"],
      ["agent", "Regulation. | Pharmacies are slow."],
    ]);
    renderSheet();
    const sheet = screen.getByTestId("ask-dialog");
    expect(within(sheet).getByTestId("desk-presence").textContent).toContain("Research agent");
    expect(within(sheet).getByTestId("desk-presence").textContent).toContain("AI agent");
    expect(within(sheet).getAllByTestId("agent-bubble").map((b) => b.textContent?.replace("Research agent: ", ""))).toEqual(["Regulation.", "Pharmacies are slow."]);
  });

  it("sends a starter by its id with the founder's words, and shows the version the answer saved", async () => {
    const { onAsk, rerender } = renderSheet();
    const sheet = screen.getByTestId("ask-dialog");
    // The last stored answer carries no quick replies, so the founder still gets two to press.
    const chips = within(sheet).getAllByRole("button").filter((b) => b.hasAttribute("data-quick-reply") && b.getAttribute("data-quick-reply") !== "write");
    expect(chips.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: /Biggest risk\?/ }));
    });
    expect(onAsk).toHaveBeenCalledWith({ quickReplyId: "biggest_risk", say: "What's the biggest risk with this concept?" });
    const exchange: AskExchange = { id: "v3", question: "What's the biggest risk with this concept?", bubbles: ["Market pull is rated 15."], quickReplies: starters, at: new Date(), version: 3, changes: [{ key: "market_size", label: "Market size", from: 12, to: 14 }] };
    rerender(
      <TooltipProvider>
        <AskDialog idea={idea} open onOpenChange={() => undefined} persona={persona} starters={starters} exchanges={[exchange]} onAsk={onAsk} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("ask-version").textContent).toContain("Saved as version 3");
    expect(screen.getByTestId("ask-version").textContent).toContain("Market size 12 → 14");
    expect(screen.getAllByText("Market pull is rated 15.")).toHaveLength(1);
  });

  it("typing is optional: Write sends the words, then the field clears and closes", async () => {
    const { onAsk } = renderSheet();
    const sheet = screen.getByTestId("ask-dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Write" }));
    const field = within(sheet).getByRole("textbox", { name: /Reply to Research agent/ });
    fireEvent.change(field, { target: { value: "How big is the market?" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(onAsk).toHaveBeenCalledWith({ question: "How big is the market?" });
    await waitFor(() => expect(within(sheet).queryByTestId("quick-reply-write")).toBeNull());
  });

  it("an answer that does not come back keeps the question; the Research agent says so and Try again resends it as it was", async () => {
    let fail = true;
    const onAsk = vi.fn(async () => {
      if (fail) throw Object.assign(new Error("The model did not answer"), { data: { code: "BAD_GATEWAY" } });
    });
    renderSheet({ onAsk });
    const sheet = screen.getByTestId("ask-dialog");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: /Who pays first\?/ }));
    });
    await waitFor(() => expect(within(sheet).getAllByTestId("read-receipt").at(-1)!.textContent).toContain("Not sent"));
    expect(within(sheet).getAllByTestId("founder-bubble").at(-1)!.textContent).toContain("Who would pay for this first?");
    expect(within(sheet).getAllByTestId("agent-bubble").map((b) => b.textContent).join(" ")).toContain("I couldn't put a reply together just then.");
    const chips = within(sheet).getAllByRole("button").filter((b) => b.hasAttribute("data-quick-reply") && b.getAttribute("data-quick-reply") !== "write");
    expect(chips[0]!.getAttribute("data-quick-reply")).toBe("local-retry");
    // The question that failed is not offered again as a separate chip; Try again resends it by its id.
    expect(chips.map((c) => c.getAttribute("data-quick-reply"))).not.toContain("who_pays_first");
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.length).toBeLessThanOrEqual(4);
    fail = false;
    await act(async () => {
      fireEvent.click(chips[0]!);
    });
    expect(onAsk).toHaveBeenCalledTimes(2);
    expect(onAsk).toHaveBeenLastCalledWith({ quickReplyId: "who_pays_first", say: "Who would pay for this first?" });
    await waitFor(() => expect(within(sheet).queryByText("I couldn't put a reply together just then.")).toBeNull());
  });
});
