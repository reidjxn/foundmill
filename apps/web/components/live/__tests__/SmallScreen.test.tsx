// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type { FakeApi } from "./fake-trpc";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("./fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});

import { LiveViewerProvider } from "../viewer";
import { ConnectionsPanel, type ConnectionRow } from "../ConnectionPanels";
import { MessagesPanel, type Selection, type ThreadRow } from "../MessagesPanel";
import { PeopleList } from "../PeopleList";
import type { People } from "../shared";
import { ids, renderWithProviders } from "./fake-trpc";

const AT = (m: number) => new Date(Date.now() - m * 60_000);
const THREAD = { id: "t-ana", participantIds: [ids.me, ids.ana], kind: "direct", leftIds: [] as string[], muted: false, subject: null, lastMessageAt: AT(5), createdAt: AT(60), updatedAt: AT(5), archivedAt: null, unread: 0 } as unknown as ThreadRow;
const NAMES: Record<string, string> = { [ids.ana]: "Ana Ruiz" };
const people: People = { person: (id) => ({ userId: id, displayName: NAMES[id] ?? null }), business: () => undefined, name: (id) => NAMES[id] ?? "A founder", loading: false };

beforeEach(() => {
  api.calls = [];
  api.handlers = {
    "founder.tableViews.get": () => null,
    "live.messages.list": () => ({ items: [], nextCursor: null }),
    "live.messages.thread": () => ({ thread: THREAD, participants: [{ userId: ids.ana, connected: true, blockedByMe: false }], canSend: true, closedReason: null }),
    "live.summary": () => ({ unreadMessages: 0, requestsWaiting: 0, invitations: 0, moderation: 0, total: 0, adultConfirmed: true }),
    "live.connections.list": () => [],
  };
});
afterEach(cleanup);

function Harness({ narrow }: { narrow: boolean }) {
  const [selection, setSelection] = useState<Selection>(null);
  return <LiveViewerProvider value={{ userId: ids.me, displayName: "Jamie" }}><MessagesPanel viewerId={ids.me} threads={[THREAD]} unreadTotal={0} people={people} selection={selection} onSelect={setSelection} narrow={narrow} /></LiveViewerProvider>;
}

describe("MessagesPanel on a small screen", () => {
  it("shows one pane at a time: the thread list, then the conversation with a Back control", () => {
    renderWithProviders(<Harness narrow />);
    const panel = screen.getByTestId("messages-panel");
    const body = panel.querySelector("[data-pane]")!;
    expect(body.getAttribute("data-pane")).toBe("threads");
    const list = screen.getByRole("complementary", { name: "Message threads" });
    expect(list.className).toContain("w-full");
    expect(screen.queryByTestId("messages-back")).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: /Ana Ruiz/ }));
    expect(body.getAttribute("data-pane")).toBe("conversation");
    expect(list.className).toContain("hidden");
    fireEvent.click(screen.getByTestId("messages-back"));
    expect(body.getAttribute("data-pane")).toBe("threads");
    expect(list.className).not.toContain("hidden");
  });

  it("keeps both panes, at the fixed height, when not narrow", () => {
    renderWithProviders(<Harness narrow={false} />);
    const body = screen.getByTestId("messages-panel").querySelector("div.h-120")!;
    expect(body.getAttribute("data-pane")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ana Ruiz/ }));
    expect(screen.getByRole("complementary", { name: "Message threads" }).className).not.toContain("hidden");
    expect(screen.queryByTestId("messages-back")).toBeNull();
  });
});

describe("a list instead of a table on a small screen", () => {
  const conn = (id: string, status: ConnectionRow["status"]): ConnectionRow => ({ id, fromUser: ids.me, toUser: ids.ana, status, message: null, respondedAt: AT(30), createdAt: AT(30) });

  it("Connections: one row per person, Message as the main action; the table when not narrow", () => {
    const onMessage = vi.fn();
    const props = { rows: [conn("c1", "accepted")], viewerId: ids.me, people, onMessage };
    const { unmount } = renderWithProviders(<TooltipProvider><ConnectionsPanel {...props} narrow /></TooltipProvider>);
    expect(screen.queryByRole("grid")).toBeNull();
    const row = screen.getByTestId("people-list-row");
    expect(row.textContent).toContain("Ana Ruiz");
    expect(row.textContent).toContain("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Message Ana Ruiz" }));
    expect(onMessage).toHaveBeenCalledWith(props.rows[0]);
    unmount();
    renderWithProviders(<TooltipProvider><ConnectionsPanel {...props} /></TooltipProvider>);
    expect(screen.queryByTestId("people-list-row")).toBeNull();
  });

  it("PeopleList: a 44 px main action and the rest in a More menu", () => {
    const open = vi.fn();
    render(<TooltipProvider><PeopleList label="Things" items={[{ id: "1", name: "Ledger club", fact: "12 members", onOpen: open, primary: { label: "Join", onSelect: () => undefined }, more: [{ label: "Report", onSelect: () => undefined }] }]} /></TooltipProvider>);
    expect(screen.getByRole("button", { name: "Join" }).className).toContain("min-h-tap");
    expect(screen.getByRole("button", { name: "More for Ledger club" }).className).toContain("min-h-tap");
    fireEvent.click(screen.getByRole("button", { name: /^Ledger club/ }));
    expect(open).toHaveBeenCalled();
  });
});
