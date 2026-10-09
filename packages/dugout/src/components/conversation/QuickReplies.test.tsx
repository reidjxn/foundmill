import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickReplies, quickReplyIndexFromKey } from "./QuickReplies";
import { JUNO_MESSAGES } from "./fixtures";
import type { QuickReplyItem } from "./types";

const REPLIES = JUNO_MESSAGES[1]!.quickReplies!;
const numbered = () =>
  screen
    .queryAllByRole("button")
    .filter(
      (b) => b.hasAttribute("data-quick-reply") && b.getAttribute("data-quick-reply") !== "write",
    );

describe("QuickReplies", () => {
  it("shows the replies numbered 1–4, the likeliest tinted, and the write chip as the Write button", () => {
    render(
      <QuickReplies replies={REPLIES} onChoose={() => {}} onSend={() => {}} agentName="Juno" />,
    );
    const buttons = numbered();
    expect(buttons.map((b) => b.textContent)).toEqual([
      "1Yes, ask for 45 days",
      "2Show me December",
      "3What does Boots risk?",
    ]);
    expect(buttons[0]!.hasAttribute("data-likeliest")).toBe(true);
    expect(buttons[0]!.getAttribute("data-variant")).toBe("tinted");
    expect(buttons[1]!.getAttribute("data-variant")).toBe("default");
    expect(screen.getByRole("button", { name: "Write" })!.getAttribute("data-quick-reply")).toBe(
      "write",
    );
  });

  it("sends a reply with its number key, and not while typing in a field", () => {
    const onChoose = vi.fn();
    render(
      <>
        <input aria-label="elsewhere" />
        <QuickReplies replies={REPLIES} onChoose={onChoose} />
      </>,
    );
    fireEvent.keyDown(document, { key: "2", code: "Digit2" });
    expect(onChoose).toHaveBeenCalledWith(REPLIES[1]);
    fireEvent.keyDown(screen.getByLabelText("elsewhere"), { key: "1", code: "Digit1" });
    expect(onChoose).toHaveBeenCalledTimes(1);
    // Alt+2 is not plain 2.
    fireEvent.keyDown(document, { key: "™", code: "Digit2", altKey: true });
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("uses Alt+1–4 where 1–4 are taken, and shows the modifier on the key caps", () => {
    const onChoose = vi.fn();
    render(<QuickReplies replies={REPLIES} onChoose={onChoose} keyModifier="alt" />);
    fireEvent.keyDown(document, { key: "1", code: "Digit1" });
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "¡", code: "Digit1", altKey: true });
    expect(onChoose).toHaveBeenCalledWith(REPLIES[0]);
    expect(numbered()[0]!.getAttribute("aria-keyshortcuts")).toBe("Alt+1");
    expect(numbered()[0]!.querySelector("kbd")!.textContent).toMatch(/^(Alt\+1|⌥1)$/);
  });

  it("ignores number keys when hotkeys are off or the replies are disabled", () => {
    const onChoose = vi.fn();
    const { rerender } = render(
      <QuickReplies replies={REPLIES} onChoose={onChoose} hotkeys={false} />,
    );
    fireEvent.keyDown(document, { key: "1", code: "Digit1" });
    rerender(<QuickReplies replies={REPLIES} onChoose={onChoose} disabled />);
    fireEvent.keyDown(document, { key: "1", code: "Digit1" });
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("Write reveals a one-line field: Enter sends, Escape closes", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onChoose = vi.fn();
    render(<QuickReplies replies={REPLIES} onChoose={onChoose} onSend={onSend} agentName="Juno" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Write" }));
    const field = screen.getByRole("textbox", { name: "Reply to Juno" });
    expect(document.activeElement).toBe(field);
    // Digits typed into the field are text, not replies.
    await user.type(field, "Split it 2 ways{Enter}");
    expect(onChoose).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("Split it 2 ways");
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Write" }));
    await user.type(screen.getByRole("textbox"), "draft{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("offers a plain Write when no write chip is given, and none without onSend", () => {
    const plain: QuickReplyItem[] = [
      { id: "a", label: "Why that one?" },
      { id: "b", label: "What's the risk?" },
    ];
    const { rerender } = render(
      <QuickReplies replies={plain} onChoose={() => {}} onSend={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    rerender(<QuickReplies replies={plain} onChoose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Write" })).toBeNull();
  });

  it("never renders fewer than two replies when any are provided; a fallback is sent as text", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onChoose = vi.fn();
    render(
      <QuickReplies
        replies={[
          {
            id: "go_with",
            label: "Go with: Approve the trial",
            kind: "choose_option",
            recommended: true,
          },
        ]}
        onChoose={onChoose}
        onSend={onSend}
      />,
    );
    const buttons = numbered();
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    expect(onChoose).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("Tell me more");
  });

  it("pads a write-only offer to two and caps at four", () => {
    const { rerender } = render(
      <QuickReplies
        replies={[{ id: "w", label: "Something else…", kind: "write" }]}
        onChoose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(numbered()).toHaveLength(2);
    const six = Array.from({ length: 6 }, (_, i): QuickReplyItem => ({
      id: `r${i}`,
      label: `Reply ${i + 1}`,
    }));
    rerender(<QuickReplies replies={six} onChoose={() => {}} />);
    expect(numbered()).toHaveLength(4);
    rerender(<QuickReplies replies={[]} onChoose={() => {}} />);
    expect(numbered()).toHaveLength(0);
  });

  it("never truncates a label (no truncate or ellipsis classes; labels may wrap)", () => {
    render(
      <QuickReplies
        replies={[
          { id: "a", label: "Go with: Order two SKUs now and the serum later" },
          { id: "b", label: "What would the gap cost us?" },
        ]}
        onChoose={() => {}}
      />,
    );
    for (const b of numbered()) {
      expect(b.className).not.toMatch(/\btruncate\b|text-ellipsis|line-clamp/);
      expect(b.className).toMatch(/whitespace-normal/);
    }
  });

  it("holds the pressed look on the reply being sent and waits on the others", () => {
    const onChoose = vi.fn();
    render(<QuickReplies replies={REPLIES} onChoose={onChoose} pendingId="show_december" />);
    const [first, second] = numbered();
    expect(second!.hasAttribute("data-chosen")).toBe(true);
    expect((first as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "1", code: "Digit1" });
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("quickReplyIndexFromKey", () => {
  const ev = (o: Partial<KeyboardEvent>) => ({
    key: "",
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...o,
  });
  it("maps 1–4 and the numpad, never 5 or chorded keys", () => {
    expect(quickReplyIndexFromKey(ev({ key: "3", code: "Digit3" }), "none")).toBe(2);
    expect(quickReplyIndexFromKey(ev({ key: "4", code: "Numpad4" }), "none")).toBe(3);
    expect(quickReplyIndexFromKey(ev({ key: "5", code: "Digit5" }), "none")).toBeNull();
    expect(
      quickReplyIndexFromKey(ev({ key: "1", code: "Digit1", metaKey: true }), "none"),
    ).toBeNull();
    expect(quickReplyIndexFromKey(ev({ key: "¡", code: "Digit1", altKey: true }), "alt")).toBe(0);
    expect(quickReplyIndexFromKey(ev({ key: "1", code: "Digit1" }), "alt")).toBeNull();
  });
});
