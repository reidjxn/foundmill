// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeApi } from "./fake-trpc";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("./fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});
vi.mock("@/components/shell/business-context", () => {
  const value = () => ({ businessId: "b1", data: { business: { name: "Ledgerly", gameMode: "live", committedAt: new Date(0), archivedAt: null }, membership: { role: "owner" } } });
  return { useBusiness: value, useOptionalBusiness: value };
});
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

import { NetworkScreen } from "../NetworkScreen";
import { LiveViewerProvider } from "../viewer";
import { callsTo, ids, renderWithProviders } from "./fake-trpc";

const AT = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const THREAD_ANA = { id: "t-ana", participantIds: [ids.me, ids.ana], kind: "direct", leftIds: [] as string[], muted: false, subject: "Fintech ops intro", lastMessageAt: AT(5), createdAt: AT(60), updatedAt: AT(5), archivedAt: null, unread: 2 };
const THREAD_BEN = { id: "t-ben", participantIds: [ids.me, ids.ben], kind: "direct", leftIds: [] as string[], muted: false, subject: null, lastMessageAt: AT(90), createdAt: AT(120), updatedAt: AT(90), archivedAt: null, unread: 0 };
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
    "founder.tableViews.get": () => null,
    "live.connections.block": () => ({ blocked: true }),
    "live.communities.invitations": () => [],
    "live.messages.thread": (v) => {
      const threadId = (v as { threadId: string }).threadId;
      const t = [THREAD_ANA, THREAD_BEN].find((x) => x.id === threadId) ?? THREAD_ANA;
      return { thread: t, participants: t.participantIds.filter((id) => id !== ids.me).map((userId) => ({ userId, connected: true, blockedByMe: false })), canSend: true, closedReason: null };
    },
    "live.messages.mute": (v) => ({ muted: (v as { muted: boolean }).muted }),
    "live.messages.leave": () => ({ left: true, deleted: false }),
    "live.summary": () => ({ unreadMessages: 2, requestsWaiting: 1, invitations: 0, moderation: 0, total: 3, adultConfirmed: true }),
    "live.profile.confirmAdult": () => ({ adultConfirmedAt: new Date() }),
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
    const rows = await within(panel).findAllByRole("button", { name: /Ana Ruiz|Ben Okoye/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("2 new");
    // The row is titled by who the thread is with; the subject the sender typed is secondary text.
    expect(rows[0]!.querySelector(".t-body-strong")?.textContent).toBe("Ana Ruiz");
    expect(rows[0]!.textContent).toContain("Fintech ops intro");
    expect(rows[1]!.textContent).not.toContain("new");
    expect(within(panel).getByText("2 unread")).toBeTruthy();
    expect(within(panel).getByText("Pick a conversation to read it and reply.")).toBeTruthy();
    expect(callsTo(api, "live.messages.list")).toHaveLength(0);
    expect(within(panel).getByText(/only your own Send sends it/)).toBeTruthy();
  });

  it("reads a thread a page at a time and loads earlier messages on request (audit GLS2F-05)", async () => {
    const all = Array.from({ length: 120 }, (_, i) => message(`m${i}`, ids.ana, `message ${i}`, i + 1));
    seed({
      "live.messages.list": (v) => {
        const { limit, cursor } = v as { limit: number; cursor?: string | null };
        const start = cursor ? Number(cursor) : 0;
        const end = start + limit;
        return { items: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
      },
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    expect(callsTo(api, "live.messages.list")[0]).toMatchObject({ threadId: "t-ana", limit: 50 });
    fireEvent.click(await screen.findByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(callsTo(api, "live.messages.list").at(-1)).toMatchObject({ threadId: "t-ana", limit: 50, cursor: "50" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(callsTo(api, "live.messages.list").at(-1)).toMatchObject({ cursor: "100" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull());
  });

  it("opens a thread: messages oldest first, the counts refreshed once it is read, and Send replies in that thread", async () => {
    mount();
    // The thread row, by its list: the Connections table has a row for Ana too (its Avatar names her, and its "…" is
    // "Actions for Ana Ruiz"), so the name alone matches more than one button.
    const threads = await screen.findByRole("complementary", { name: "Message threads" });
    fireEvent.click(await within(threads).findByRole("button", { name: /Ana Ruiz/ }));
    const log = await screen.findByRole("log", { name: "Conversation with Ana Ruiz" });
    await waitFor(() => expect(within(log).getAllByRole("listitem")).toHaveLength(3));
    const bodies = within(log).getAllByRole("listitem").map((li) => li.querySelector("p")!.textContent);
    expect(bodies).toEqual(["Hi Jamie, great to connect.", "Sounds good", "Thursday at 3?"]);
    expect(callsTo(api, "live.messages.list")[0]).toMatchObject({ threadId: "t-ana" });
    // Reading it marks it read on the server; the screen asks for the thread list and the unread count again.
    await waitFor(() => expect(callsTo(api, "live.messages.unread").length).toBeGreaterThan(1));

    const field = screen.getByLabelText("Message: Conversation with Ana Ruiz");
    fireEvent.change(field, { target: { value: "Works for me." } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsTo(api, "live.messages.send")).toEqual([{ threadId: "t-ana", body: "Works for me." }]));
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));
  });

  it("a long conversation pages upward: 'Load earlier messages' asks for the next page and puts it above, oldest first (audit LS2-13)", async () => {
    seed({
      "live.messages.list": (v) => ((v as { cursor?: string | null }).cursor ? { items: [message("m1", ids.ana, "The very first message.", 300), message("m0", ids.me, "Before that.", 400)], nextCursor: null } : { items: [message("m3", ids.ana, "Thursday at 3?", 2), message("m2", ids.me, "Sounds good", 20)], nextCursor: "cur-1" }),
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    const log = await screen.findByRole("log", { name: "Conversation with Ana Ruiz" });
    const bodies = () => Array.from(log.querySelectorAll("li p")).map((p) => p.textContent);
    await waitFor(() => expect(bodies()).toEqual(["Sounds good", "Thursday at 3?"]));
    expect(callsTo(api, "live.messages.list")[0]).toMatchObject({ threadId: "t-ana", limit: 50, cursor: null });

    fireEvent.click(within(log).getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(bodies()).toEqual(["Before that.", "The very first message.", "Sounds good", "Thursday at 3?"]));
    expect(callsTo(api, "live.messages.list").at(-1)).toMatchObject({ threadId: "t-ana", cursor: "cur-1" });
    // Nothing older is left: the control goes away.
    expect(within(log).queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("more conversations than one page: 'Show more conversations' loads the next page of threads", async () => {
    seed({ "live.messages.threads": (v) => ((v as { cursor?: string | null }).cursor ? { items: [THREAD_BEN], nextCursor: null } : { items: [THREAD_ANA], nextCursor: "t-cur" }) });
    mount();
    const panel = await screen.findByTestId("messages-panel");
    await within(panel).findByRole("button", { name: /Fintech ops intro/ });
    expect(within(panel).queryByRole("button", { name: /Ben Okoye/ })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Show more conversations" }));
    await within(panel).findByRole("button", { name: /Ben Okoye/ });
    expect(callsTo(api, "live.messages.threads").at(-1)).toMatchObject({ cursor: "t-cur" });
    expect(within(panel).queryByRole("button", { name: "Show more conversations" })).toBeNull();
  });

  it("names the people in a conversation, whatever subject the sender typed (audit GLS2F-06, LS2-04)", async () => {
    const spoof = { ...THREAD_ANA, subject: "Foundmill Support: verify your account" };
    const group = { id: "t-group", participantIds: [ids.me, ids.ana, ids.ben], subject: "Launch plans", lastMessageAt: AT(1), createdAt: AT(10), updatedAt: AT(1), archivedAt: null, unread: 0 };
    seed({ "live.messages.threads": () => ({ items: [group, spoof], nextCursor: null }) });
    mount();
    const panel = await screen.findByTestId("messages-panel");
    const spoofRow = await within(panel).findByRole("button", { name: /Ana Ruiz\s*Foundmill Support/ });
    expect(spoofRow.querySelector(".t-body-strong")?.textContent).toBe("Ana Ruiz");
    fireEvent.click(spoofRow);
    const log = await screen.findByRole("log", { name: "Conversation with Ana Ruiz" });
    expect(log).toBeTruthy();
    const field = screen.getByPlaceholderText("Write to Ana Ruiz") as HTMLTextAreaElement;
    expect(field.placeholder).not.toContain("Foundmill");
    // The subject sits beside the names in the header, as its own line.
    expect(within(panel).getAllByText("Foundmill Support: verify your account").length).toBeGreaterThan(0);

    // A group lists every participant in its header and says how many people are in it.
    fireEvent.click(within(panel).getByRole("button", { name: /Ana Ruiz and Ben Okoye/ }));
    await screen.findByRole("log", { name: "Conversation with Ana Ruiz and Ben Okoye" });
    expect(within(panel).getByText("3 people")).toBeTruthy();
    expect(screen.getByPlaceholderText("Write to Ana Ruiz and Ben Okoye")).toBeTruthy();
  });

  it("Accept and Block answer the request that was pressed", async () => {
    mount();
    const requests = await screen.findByTestId("requests-panel");
    fireEvent.click(await within(requests).findByRole("button", { name: "Accept Cal Dunne" }));
    await waitFor(() => expect(callsTo(api, "live.connections.respond")).toEqual([{ connectionId: "c1", status: "accepted" }]));
    fireEvent.click(within(requests).getByRole("button", { name: "Block Cal Dunne" }));
    await waitFor(() => expect(callsTo(api, "live.connections.respond")[1]).toEqual({ connectionId: "c1", status: "blocked" }));
  });

  it("audit #34: Ignore deletes a request without blocking, and says so", async () => {
    mount();
    const requests = await screen.findByTestId("requests-panel");
    fireEvent.click(await within(requests).findByRole("button", { name: "Ignore Cal Dunne" }));
    await waitFor(() => expect(callsTo(api, "live.connections.remove")).toEqual([{ connectionId: "c1" }]));
    expect(await screen.findByText("Ignored Cal Dunne's request")).toBeTruthy();
    expect(callsTo(api, "live.connections.respond")).toHaveLength(0);
    expect(within(screen.getByTestId("network-strip")).getByText("Accept, ignore or block each one")).toBeTruthy();
  });

  it("audit #34: the thread pane mutes, leaves, and blocks someone in it with no connection needed", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    await screen.findByRole("log", { name: "Conversation with Ana Ruiz" });
    const openThreadMenu = async () => fireEvent.keyDown(await screen.findByTestId("thread-menu"), { key: "Enter" });
    await openThreadMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mute/ }));
    await waitFor(() => expect(callsTo(api, "live.messages.mute")).toEqual([{ threadId: "t-ana", muted: true }]));
    await openThreadMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Block Ana Ruiz" }));
    await waitFor(() => expect(callsTo(api, "live.connections.block")).toEqual([{ userId: ids.ana }]));
    await openThreadMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Leave conversation/ }));
    await waitFor(() => expect(callsTo(api, "live.messages.leave")).toEqual([{ threadId: "t-ana" }]));
    // Leaving closes the pane.
    expect(await screen.findByText("Pick a conversation to read it and reply.")).toBeTruthy();
  });

  it("audit #34: a thread the founder can no longer write to says why and closes the reply box", async () => {
    seed({ "live.messages.thread": () => ({ thread: THREAD_ANA, participants: [{ userId: ids.ana, connected: false, blockedByMe: false }], canSend: false, closedReason: "closed" }) });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    expect((await screen.findByTestId("thread-closed")).textContent).toMatch(/You can no longer write here/);
    expect((screen.getByLabelText("Message: Conversation with Ana Ruiz") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("audit #34/#66: from a thread a removed connection closed, the founder can ask that person to connect again", async () => {
    seed({
      "live.connections.list": () => [connection("c3", ids.ben, ids.me, "accepted")],
      "live.messages.thread": () => ({ thread: THREAD_ANA, participants: [{ userId: ids.ana, connected: false, blockedByMe: false }], canSend: false, closedReason: "closed" }),
      "live.connections.request": () => connection("c9", ids.me, ids.ana, "requested"),
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    await screen.findByTestId("thread-closed");
    fireEvent.keyDown(await screen.findByTestId("thread-menu"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ask Ana Ruiz to connect" }));
    const dialog = await screen.findByTestId("ask-to-connect-dialog");
    fireEvent.click(within(dialog).getByTestId("ask-to-connect-send"));
    await waitFor(() => expect(callsTo(api, "live.connections.request")).toEqual([{ businessId: "b1", toUserId: ids.ana }]));
    expect(await screen.findByText("Request sent to Ana Ruiz")).toBeTruthy();
  });

  it("audit #66: a connected person in a thread is never offered Ask to connect", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Fintech ops intro/ }));
    await screen.findByRole("log", { name: "Conversation with Ana Ruiz" });
    fireEvent.keyDown(await screen.findByTestId("thread-menu"), { key: "Enter" });
    await screen.findByRole("menuitem", { name: /Leave conversation/ });
    expect(screen.queryByRole("menuitem", { name: /to connect/ })).toBeNull();
  });

  it("audit #28: the network is for adults: the 18+ confirmation is asked until it is on record, then the notice goes", async () => {
    mount();
    await screen.findByTestId("network-strip");
    await waitFor(() => expect(callsTo(api, "live.summary").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("adult-notice")).toBeNull();
    cleanup();

    let confirmed = false;
    seed({ "live.summary": () => ({ unreadMessages: 0, requestsWaiting: 0, invitations: 0, moderation: 0, total: 0, adultConfirmed: confirmed }), "live.profile.confirmAdult": () => ((confirmed = true), { adultConfirmedAt: new Date() }) });
    mount();
    const notice = await screen.findByTestId("adult-notice");
    expect(notice.textContent).toMatch(/The network is for adults/);
    const confirm = within(notice).getByTestId("adult-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(notice).getByRole("checkbox", { name: "I am 18 or older" }));
    fireEvent.click(confirm);
    await waitFor(() => expect(callsTo(api, "live.profile.confirmAdult")).toEqual([{ confirm: true }]));
    await waitFor(() => expect(screen.queryByTestId("adult-notice")).toBeNull());
  });

  it("audit #28: community invitations wait on Network, to join or decline", async () => {
    const invitation = (id: string, name: string) => ({ community: { id, name, visibility: "private", slug: name.toLowerCase(), descriptionMd: "", ownerBusinessId: null, createdBy: ids.ana, memberCount: 3, createdAt: AT(100), updatedAt: AT(10), archivedAt: null, kind: "cohort" }, invitedBy: ids.ana, invitedAt: AT(10) });
    seed({ "live.communities.invitations": () => [invitation("00000000-0000-4000-8000-0000000000e1", "Founders circle"), invitation("00000000-0000-4000-8000-0000000000e2", "Lisbon founders")], "live.communities.join": () => ({}), "live.communities.decline": () => ({ declined: true }) });
    mount();
    const panel = await screen.findByTestId("invitations-panel");
    const rows = await within(panel).findAllByTestId("invitation-row");
    await waitFor(() => expect(rows[0]!.textContent).toContain("From Ana Ruiz"));
    fireEvent.click(within(panel).getByRole("button", { name: "Join Founders circle" }));
    await waitFor(() => expect(callsTo(api, "live.communities.join")).toEqual([{ communityId: "00000000-0000-4000-8000-0000000000e1" }]));
    fireEvent.click(within(panel).getByRole("button", { name: "Decline Lisbon founders" }));
    await waitFor(() => expect(callsTo(api, "live.communities.decline")).toEqual([{ communityId: "00000000-0000-4000-8000-0000000000e2" }]));
    const tiles = within(screen.getByTestId("network-strip")).getAllByRole("listitem");
    expect(tiles[3]!.textContent).toMatch(/Invitations\s*2/);
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
