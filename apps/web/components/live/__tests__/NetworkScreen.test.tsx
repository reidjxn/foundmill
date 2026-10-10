// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeApi } from "./fake-trpc";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("./fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: "b1", data: { business: { name: "Ledgerly", gameMode: "live" } } }) }));
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

import { NetworkScreen } from "../NetworkScreen";
import { LiveViewerProvider } from "../viewer";
import { callsTo, ids, renderWithProviders } from "./fake-trpc";

const AT = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const THREAD_ANA = { id: "t-ana", participantIds: [ids.me, ids.ana], subject: "Fintech ops intro", lastMessageAt: AT(5), createdAt: AT(60), updatedAt: AT(5), archivedAt: null, unread: 2 };
const THREAD_BEN = { id: "t-ben", participantIds: [ids.me, ids.ben], subject: null, lastMessageAt: AT(90), createdAt: AT(120), updatedAt: AT(90), archivedAt: null, unread: 0 };
const message = (id: string, from: string, body: string, minutesAgo: number) => ({ id, threadId: "t-ana", fromUser: from, body, readBy: [from], createdAt: AT(minutesAgo), updatedAt: AT(minutesAgo) });
const connection = (id: string, from: string, to: string, status: "requested" | "accepted" | "blocked", note: string | null = null) => ({ id, fromUser: from, toUser: to, status, message: note, respondedAt: status === "requested" ? null : AT(30), createdAt: AT(30), updatedAt: AT(30) });
const NAMES: Record<string, string> = { [ids.ana]: "Ana Ruiz", [ids.ben]: "Ben Okoye", [ids.cal]: "Cal Dunne" };

function seed(over: Partial<FakeApi["handlers"]> = {}) {
  api.handlers = {
    "live.connections.list": () => [connection("c1", ids.cal, ids.me, "requested", "Fellow founder."), connection("c2", ids.me, ids.ana, "accepted"), connection("c3", ids.ben, ids.me, "accepted"), connection("c4", ids.me, ids.cal, "blocked")].slice(0, 3),
    "live.messages.threads": () => ({ items: [THREAD_ANA, THREAD_BEN], nextCursor: null }),
    "live.messages.unread": () => 2,
    "live.messages.list": () => ({ items: [message("m3", ids.ana, "Thursday at 3?", 2), message("m2", ids.me, "Sounds good", 20), message("m1", ids.ana, "Hi Jamie, great to connect.", 40)], nextCursor: null }),
    "live.messages.send": (v) => ({ ...message("m-new", ids.me, (v as { body: string }).body, 0), threadId: (v as { threadId?: string }).threadId ?? "t-new" }),
    "live.people.lookup": (v) => ({ users: ((v as { userIds: string[] }).userIds ?? []).map((userId) => ({ userId, displayName: NAMES[userId] ?? null })), businesses: [] }),
    "live.profile.visibility.get": () => ({ visibility: "private", publicProfile: null }),
    "live.profile.visibility.set": () => ({}),
    "live.connections.respond": (v) => ({ ...(v as object) }),
    "live.connections.remove": () => ({ removed: true }),
    ...over,
  };
  api.calls = [];
}

function mount() {
  return renderWithProviders(
    <LiveViewerProvider value={{ userId: ids.me, displayName: "Jamie Reyes" }}>
      <NetworkScreen />
    </LiveViewerProvider>,
  );
}

beforeEach(() => seed());
afterEach(cleanup);

describe("/network", () => {
  it("shows the unread count and the threads with their own unread counts, and opens nothing by itself", async () => {
    mount();
    const strip = await screen.findByTestId("network-strip");
    const tiles = within(strip).getAllByRole("listitem");
    await waitFor(() => expect(tiles[0]!.textContent).toMatch(/Unread messages\s*2/));
    expect(tiles[1]!.textContent).toMatch(/Requests waiting\s*1/);
    expect(tiles[2]!.textContent).toMatch(/Connections\s*2/);
    const panel = await screen.findByTestId("messages-panel");
    const rows = await within(panel).findAllByRole("button", { name: /Fintech ops intro|Ben Okoye/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("2 new");
    expect(rows[1]!.textContent).not.toContain("new");
    expect(within(panel).getByText("2 unread")).toBeTruthy();
    expect(within(panel).getByText("Pick a conversation to read it and reply.")).toBeTruthy();
    expect(callsTo(api, "live.messages.list")).toHaveLength(0);
    expect(within(panel).getByText(/only your own Send sends it/)).toBeTruthy();
  });

  it("opens a thread: messages oldest first, the counts refreshed once it is read, and Send replies in that thread", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    const log = await screen.findByRole("log", { name: "Conversation with Fintech ops intro" });
    await waitFor(() => expect(within(log).getAllByRole("listitem")).toHaveLength(3));
    const bodies = within(log).getAllByRole("listitem").map((li) => li.querySelector("p")!.textContent);
    expect(bodies).toEqual(["Hi Jamie, great to connect.", "Sounds good", "Thursday at 3?"]);
    expect(callsTo(api, "live.messages.list")[0]).toMatchObject({ threadId: "t-ana" });
    // Reading it marks it read on the server; the screen asks for the thread list and the unread count again.
    await waitFor(() => expect(callsTo(api, "live.messages.unread").length).toBeGreaterThan(1));

    const field = screen.getByLabelText("Message: Conversation with Fintech ops intro");
    fireEvent.change(field, { target: { value: "Works for me." } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsTo(api, "live.messages.send")).toEqual([{ threadId: "t-ana", body: "Works for me." }]));
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));
  });

  it("Accept and Block answer the request that was pressed", async () => {
    mount();
    const requests = await screen.findByTestId("requests-panel");
    fireEvent.click(await within(requests).findByRole("button", { name: "Accept Cal Dunne" }));
    await waitFor(() => expect(callsTo(api, "live.connections.respond")).toEqual([{ connectionId: "c1", status: "accepted" }]));
    fireEvent.click(within(requests).getByRole("button", { name: "Block Cal Dunne" }));
    await waitFor(() => expect(callsTo(api, "live.connections.respond")[1]).toEqual({ connectionId: "c1", status: "blocked" }));
  });

  it("Message on a connection with no thread starts one: the first Send addresses the person, not a thread", async () => {
    mount();
    const grid = await screen.findByRole("grid", { name: "Connections" });
    const benRow = await within(grid).findByText("Ben Okoye");
    fireEvent.contextMenu(benRow.closest("[role=row]")!);
    // Ben already has a direct thread, so Message opens it rather than starting another.
    fireEvent.click(screen.getByRole("menuitem", { name: /Message/ }));
    await screen.findByRole("log", { name: "Conversation with Ben Okoye" });
    expect(callsTo(api, "live.messages.list")[0]).toMatchObject({ threadId: "t-ben" });
  });

  it("starts a new thread for a connection that has none", async () => {
    seed({ "live.messages.threads": () => ({ items: [THREAD_BEN], nextCursor: null }) });
    mount();
    const grid = await screen.findByRole("grid", { name: "Connections" });
    fireEvent.contextMenu((await within(grid).findByText("Ana Ruiz")).closest("[role=row]")!);
    fireEvent.click(screen.getByRole("menuitem", { name: /Message/ }));
    const log = await screen.findByRole("log", { name: "New message to Ana Ruiz" });
    expect(within(log).getByText(/Nothing sent to Ana Ruiz yet/)).toBeTruthy();
    const field = screen.getByLabelText("Message: New message to Ana Ruiz");
    fireEvent.change(field, { target: { value: "Hello Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(callsTo(api, "live.messages.send")).toEqual([{ toUserIds: [ids.ana], body: "Hello Ana" }]));
    // The answer carries the new thread's id, and the conversation moves to it.
    await screen.findByRole("log", { name: /Conversation with/ });
    expect(callsTo(api, "live.messages.list").at(-1)).toMatchObject({ threadId: "t-new" });
  });

  it("saves the profile visibility the founder picks, and starts from what the API says", async () => {
    mount();
    const panel = await screen.findByTestId("visibility-panel");
    await waitFor(() => expect((within(panel).getByRole("radio", { name: /Private/ }) as HTMLElement).getAttribute("data-state")).toBe("checked"));
    expect(within(panel).getAllByRole("radio").map((r) => r.getAttribute("id"))).toEqual(["visibility-public", "visibility-connections", "visibility-community", "visibility-private"]);
    fireEvent.click(within(panel).getByRole("radio", { name: /Connections/ }));
    await waitFor(() => expect(callsTo(api, "live.profile.visibility.set")).toEqual([{ visibility: "connections" }]));
  });

  it("has an empty state for every list when nothing has happened yet", async () => {
    seed({
      "live.connections.list": () => [],
      "live.messages.threads": () => ({ items: [], nextCursor: null }),
      "live.messages.unread": () => 0,
    });
    mount();
    expect(await screen.findByText(/No requests waiting/)).toBeTruthy();
    expect(screen.getByText(/Requests you send wait here/)).toBeTruthy();
    expect(screen.getByText(/No conversations yet/)).toBeTruthy();
    expect(screen.getByText(/No connections yet/)).toBeTruthy();
    // One way on from an empty network, not one per panel.
    expect(screen.getAllByRole("button", { name: "Browse communities" })).toHaveLength(1);
    const strip = screen.getByTestId("network-strip");
    expect(within(strip).getByText("All read")).toBeTruthy();
    expect(within(strip).getByText("Nobody is waiting on you")).toBeTruthy();
  });

  it("shows a failed load with a retry instead of an empty list", async () => {
    seed({
      "live.connections.list": () => {
        throw new Error("The API did not answer.");
      },
    });
    mount();
    expect((await screen.findAllByText("The API did not answer.")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });
});
