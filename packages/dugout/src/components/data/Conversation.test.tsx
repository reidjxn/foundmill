import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "./Composer";
import { Conversation, type ConversationMessage } from "./Conversation";
import { FeedPost } from "./FeedPost";

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe("Composer", () => {
  it("sends the trimmed text on Ctrl+Enter or Cmd+Enter and clears once the promise resolves", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<Composer aria-label="Write a message" onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Write a message") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "  Hello there  " } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    });
    expect(onSubmit).toHaveBeenCalledWith("Hello there");
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "Again" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    });
    expect(onSubmit).toHaveBeenLastCalledWith("Again");
  });

  it("treats plain Enter as a new line, never sends an empty field, and ignores a second press while sending", async () => {
    let resolve: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<Composer aria-label="Write a post" label="Post" onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Write a post");
    const button = screen.getByRole("button", { name: "Post" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "One" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Post" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => resolve());
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the text when the send fails", async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error("Offline")));
    render(<Composer aria-label="Write a message" onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Write a message") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Keep me" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSubmit).toHaveBeenCalled();
    expect(field.value).toBe("Keep me");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("is inert when disabled and names its shortcut", () => {
    render(<Composer aria-label="Write a post" disabled onSubmit={() => undefined} note="Join to post." />);
    expect((screen.getByLabelText("Write a post") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByLabelText("Write a post").getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
    expect(screen.getByText("Join to post.")).toBeTruthy();
  });
});

describe("Conversation", () => {
  const messages: ConversationMessage[] = [
    { id: "a", author: "Priya Nair", body: "Hello\nthere", at: iso(30) },
    { id: "b", author: "Jamie Reyes", self: true, body: "Hi Priya", at: iso(5) },
  ];

  it("renders a labelled live log in order, marks your own messages and keeps line breaks", () => {
    render(<Conversation label="Conversation with Priya Nair" messages={messages} onSend={() => undefined} />);
    const log = screen.getByRole("log", { name: "Conversation with Priya Nair" });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.tabIndex).toBe(0);
    const items = log.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Priya Nair");
    expect(items[0]!.querySelector("p")!.className).toContain("whitespace-pre-wrap");
    expect(items[1]!.getAttribute("data-self")).toBe("true");
    expect(items[1]!.textContent).toContain("You");
    expect(items[1]!.textContent).not.toContain("Jamie Reyes");
    expect(items[1]!.querySelector("time")!.getAttribute("datetime")).toBe(messages[1]!.at);
  });

  it("offers 'Load earlier messages' only when older ones exist, and older messages arriving on top keep what is being read where it is", () => {
    const onLoadEarlier = vi.fn();
    const { rerender } = render(<Conversation label="Conversation" messages={messages} onSend={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
    rerender(<Conversation label="Conversation" messages={messages} onSend={() => undefined} hasEarlier onLoadEarlier={onLoadEarlier} />);
    // The control is the first item of the log; the messages keep their order after it.
    const log = screen.getByRole("log", { name: "Conversation" }) as HTMLDivElement;
    expect(Array.from(log.querySelectorAll("li p")).map((p) => p.textContent)).toEqual(["Hello\nthere", "Hi Priya"]);

    // The log is 600 px tall and the reader is at its top when they ask for earlier messages.
    let height = 600;
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => height });
    log.scrollTop = 0;
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);

    // They arrive above (the log grows by 400 px): the reader stays on the message they were reading, not at the bottom.
    height = 1000;
    const older: ConversationMessage = { id: "z", author: "Priya Nair", body: "Earlier", at: iso(300) };
    rerender(<Conversation label="Conversation" messages={[older, ...messages]} onSend={() => undefined} hasEarlier onLoadEarlier={onLoadEarlier} />);
    expect(log.scrollTop).toBe(400);
    expect(Array.from(log.querySelectorAll("li p")).map((p) => p.textContent)).toEqual(["Earlier", "Hello\nthere", "Hi Priya"]);

    // A new newest message does scroll to the bottom.
    rerender(<Conversation label="Conversation" messages={[older, ...messages, { id: "n", author: "Priya Nair", body: "Now", at: iso(0) }]} onSend={() => undefined} />);
    expect(log.scrollTop).toBe(1000);
  });

  it("sends through the composer and shows empty, loading and error states instead of the log", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Conversation label="Conversation" messages={[]} empty="Say hello." onSend={onSend} />);
    expect(screen.getByText("Say hello.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message: Conversation"), { target: { value: "Hi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSend).toHaveBeenCalledWith("Hi");
    rerender(<Conversation label="Conversation" messages={messages} loading onSend={onSend} />);
    expect(document.querySelector("[data-conversation] ol")).toBeNull();
    const onRetry = vi.fn();
    rerender(<Conversation label="Conversation" messages={messages} error="Could not load." onRetry={onRetry} onSend={onSend} />);
    expect(screen.getByText("Could not load.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("FeedPost", () => {
  it("shows author, badge, time and text; the toggle is a disclosure and Reply is a button", () => {
    const onReply = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(
      <FeedPost author="Jamie Reyes" at={iso(95)} badge={<span>Ledgerly</span>} replyCount={2} onReply={onReply} onToggleReplies={onToggle} repliesOpen={false}>
        First touch halved.
      </FeedPost>,
    );
    expect(screen.getByText("Jamie Reyes")).toBeTruthy();
    expect(screen.getByText("Ledgerly")).toBeTruthy();
    expect(screen.getByText("First touch halved.")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "2 replies" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledTimes(1);
    rerender(
      <FeedPost author="Jamie Reyes" at={iso(95)} replyCount={1} onToggleReplies={onToggle} repliesOpen thread={<p>A reply</p>}>
        First touch halved.
      </FeedPost>,
    );
    expect(screen.getByRole("button", { name: "1 reply" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("A reply")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("a reply carries no actions", () => {
    render(<FeedPost author="Priya Nair" at={iso(3)}>Which countries?</FeedPost>);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
