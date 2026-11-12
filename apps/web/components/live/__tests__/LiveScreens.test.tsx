// @vitest-environment happy-dom
/** /communities and /communities/[id] against canned API answers. */
import { TRPCClientError } from "@trpc/client";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeApi } from "./fake-trpc";
import { format } from "date-fns";
import { DateFormatProvider } from "@foundmill/dugout";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
const ctx = vi.hoisted(() => ({ liveOpen: true, gameMode: "live" as "live" | "personal", role: "owner", sectionPermissions: {} as Record<string, string>, committed: true, push: vi.fn() }));
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("./fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({
    businessId: "b1",
    data: { liveOpen: ctx.liveOpen, business: { name: "Ledgerly", gameMode: ctx.gameMode, committedAt: ctx.committed ? new Date() : null, archivedAt: null }, membership: { role: ctx.role, sectionPermissions: ctx.sectionPermissions } },
  }),
}));
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ctx.push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));

import { CommunitiesScreen } from "../CommunitiesScreen";
import { CommunityScreen } from "../CommunityScreen";
import { LiveViewerProvider } from "../viewer";
import { callsTo, ids, renderWithProviders } from "./fake-trpc";

const AT = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const notFound = () => new TRPCClientError("Not found", { result: { error: { message: "Not found", code: -32004, data: { code: "NOT_FOUND" } } } as never });

const community = (over: Record<string, unknown> = {}) => ({ id: ids.community, name: "Fintech ops founders", slug: "fintech-ops-founders", descriptionMd: "Founders selling to operations teams.", visibility: "public", ownerBusinessId: ids.business, createdBy: ids.me, memberCount: 4, createdAt: AT(1000), updatedAt: AT(10), archivedAt: null, role: "owner", ...over });
const mount = (ui: ReactElement) => renderWithProviders(<LiveViewerProvider value={{ userId: ids.me, displayName: "Jamie Reyes" }}>{ui}</LiveViewerProvider>);
/** Opens a design-system DropdownMenu from its trigger, as the keyboard does. */
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });
const lookup = (v: unknown) => ({
  users: ((v as { userIds: string[] }).userIds ?? []).map((userId) => ({ userId, displayName: ({ [ids.ana]: "Ana Ruiz", [ids.ben]: "Ben Okoye" } as Record<string, string>)[userId] ?? null })),
  businesses: ((v as { businessIds: string[] }).businessIds ?? []).map((businessId) => ({ businessId, name: "Northlight Payments", slug: "northlight", kitPrimary: "#1F6FEB", kitSecondary: "#F5B841", archetype: "b2b_saas", live: true })),
});

beforeEach(() => {
  api.handlers = { "live.people.lookup": lookup, "founder.tableViews.get": () => null };
  api.calls = [];
  ctx.gameMode = "live";
  ctx.role = "owner";
  ctx.sectionPermissions = {};
  ctx.committed = true;
  ctx.push.mockClear();
});
afterEach(cleanup);

describe("/communities", () => {
  const joined = community();
  const open = community({ id: "00000000-0000-4000-8000-0000000000c1", name: "Bootstrapped founders", slug: "bootstrapped", descriptionMd: "No outside funding.", memberCount: 0, role: null, ownerBusinessId: null });

  it("lists the communities with the founder's role, and Join or Leave on every row", async () => {
    api.handlers["live.communities.list"] = () => [joined, open];
    api.handlers["live.communities.join"] = () => ({});
    api.handlers["live.communities.leave"] = () => ({ left: true });
    mount(<CommunitiesScreen />);
    const grid = await screen.findByRole("grid", { name: "Communities" });
    const rows = await within(grid).findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain("Fintech ops founders");
    expect(rows[1]!.textContent).toContain("Owner");
    expect(rows[2]!.textContent).toContain("Not joined");

    fireEvent.click(within(grid).getByRole("button", { name: "Join Bootstrapped founders" }));
    // A person joins as themselves, never as the business.
    await waitFor(() => expect(callsTo(api, "live.communities.join")).toEqual([{ communityId: open.id }]));
    fireEvent.click(within(grid).getByRole("button", { name: "Leave Fintech ops founders" }));
    await waitFor(() => expect(callsTo(api, "live.communities.leave")).toEqual([{ communityId: joined.id }]));
    // Pressing the button must not also open the row.
    expect(ctx.push).not.toHaveBeenCalled();
  });

  it("opens a community with Enter, and offers Open feed and Join in the right-click menu", async () => {
    api.handlers["live.communities.list"] = () => [joined, open];
    mount(<CommunitiesScreen />);
    const grid = await screen.findByRole("grid", { name: "Communities" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(ctx.push).toHaveBeenCalledWith(`/communities/${joined.id}`);
    fireEvent.contextMenu(within(grid).getAllByRole("row")[2]!);
    expect(screen.getByRole("menuitem", { name: /Open feed/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Join/ })).toBeTruthy();
  });

  it("while LIVE is closed the page says so, and does not point at Settings", async () => {
    ctx.gameMode = "personal";
    ctx.liveOpen = false;
    try {
      api.handlers["live.communities.list"] = () => [];
      mount(<CommunitiesScreen />);
      const notice = await screen.findByTestId("personal-notice");
      expect(notice.textContent).toContain("Live is not open yet");
      expect(notice.textContent).not.toContain("Open Settings");
    } finally {
      ctx.liveOpen = true;
    }
  });

  it("a Personal business joins the same way and the page says why it is not listed", async () => {
    ctx.gameMode = "personal";
    api.handlers["live.communities.list"] = () => [open];
    api.handlers["live.communities.join"] = () => ({});
    mount(<CommunitiesScreen />);
    expect((await screen.findByTestId("personal-notice")).textContent).toContain("Ledgerly is a Personal business");
    fireEvent.click(await screen.findByRole("button", { name: "Join Bootstrapped founders" }));
    await waitFor(() => expect(callsTo(api, "live.communities.join")).toEqual([{ communityId: open.id }]));
  });

  it("says what will appear when there are no communities", async () => {
    api.handlers["live.communities.list"] = () => [];
    mount(<CommunitiesScreen />);
    expect(await screen.findByText(/No communities yet/)).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("audit #28: starts a community (public or by invitation, with its kind) and opens it; an invitation shows on its row", async () => {
    api.handlers["live.communities.list"] = () => [joined, community({ id: "00000000-0000-4000-8000-0000000000c2", name: "Founders circle", visibility: "private", role: null, invited: true })];
    api.handlers["live.communities.create"] = (v) => community({ id: "00000000-0000-4000-8000-0000000000c9", ...(v as object) });
    mount(<CommunitiesScreen />);
    const grid = await screen.findByRole("grid", { name: "Communities" });
    expect((await within(grid).findByRole("row", { name: /Founders circle/ })).textContent).toContain("Invited");
    fireEvent.click(screen.getByTestId("community-create"));
    const dialog = await screen.findByTestId("create-community-dialog");
    const save = within(dialog).getByTestId("create-community-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "  Lisbon founders " } });
    fireEvent.change(within(dialog).getByLabelText(/What it is for/), { target: { value: "Meetups in Lisbon." } });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Geography/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /By invitation/ }));
    fireEvent.click(save);
    await waitFor(() => expect(callsTo(api, "live.communities.create")).toEqual([{ name: "Lisbon founders", descriptionMd: "Meetups in Lisbon.", kind: "geography", visibility: "private" }]));
    await waitFor(() => expect(ctx.push).toHaveBeenCalledWith("/communities/00000000-0000-4000-8000-0000000000c9"));
  });
});

describe("/communities/[id]", () => {
  const post = (id: string, author: string, body: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({ id, communityId: ids.community, authorUserId: author, businessId: null, parentPostId: null, bodyMd: body, entityIds: [], status: "visible", createdAt: AT(minutesAgo), updatedAt: AT(minutesAgo), archivedAt: null, replyCount: 0, ...extra });
  const member = { id: "m1", communityId: ids.community, userId: ids.me, businessId: ids.business, role: "owner", status: "active", joinedAt: AT(900), createdAt: AT(900), updatedAt: AT(900) };

  function memberView(over: Record<string, unknown> = {}) {
    api.handlers["live.communities.get"] = () => ({ community: community(), members: [member, { ...member, id: "m2", userId: ids.ana, businessId: null, role: "member" }], isMember: true, invited: false, canPost: true, canModerate: true, role: "owner", status: "active", ...over });
    api.handlers["live.communities.moderation"] = () => ({ items: [], restricted: [] });
    api.handlers["live.connections.list"] = () => [];
    api.handlers["live.communities.posts"] = (v) =>
      (v as { parentPostId?: string }).parentPostId
        ? { items: [post("r1", ids.ben, "We tried that too.", 3, { parentPostId: "p1" })], nextCursor: null }
        : { items: [post("p1", ids.ana, "Open Banking refresh drop-off is 12%.", 30, { businessId: ids.business, replyCount: 1 }), post("p2", ids.ben, "Look ![pixel](https://tracker.example/p.png) at [[ent:11111111-1111-4111-8111-111111111111|Acme Ltd]]", 50)], nextCursor: null };
    api.handlers["live.communities.post"] = (v) => post("new", ids.me, (v as { bodyMd: string }).bodyMd, 0);
  }

  it("shows the feed: authors by name, the business a post was written for, replies on demand, and a post box", async () => {
    memberView();
    mount(<CommunityScreen communityId={ids.community} />);
    expect(await screen.findByRole("heading", { name: "Fintech ops founders" })).toBeTruthy();
    const feed = await screen.findByTestId("community-feed");
    const posts = await within(feed).findAllByTestId("feed-post");
    expect(posts).toHaveLength(2);
    expect(posts[0]!.textContent).toContain("Ana Ruiz");
    expect(posts[0]!.textContent).toContain("Northlight Payments");
    expect(posts[0]!.textContent).toContain("Open Banking refresh drop-off is 12%.");
    // Someone else's text: no image is loaded and an entity mention is never linked (it stays the text it was typed as).
    expect(feed.querySelector("img")).toBeNull();
    expect(posts[1]!.textContent).toContain("pixel");
    expect(posts[1]!.textContent).toContain("Acme Ltd");
    expect(posts[1]!.querySelector("[data-entity-id]")).toBeNull();
    expect(within(posts[1]!).queryAllByRole("link")).toHaveLength(0);

    fireEvent.click(within(posts[0]!).getByRole("button", { name: "1 reply" }));
    const thread = await within(posts[0]!).findByTestId("reply-thread");
    expect(await within(thread).findByText("We tried that too.")).toBeTruthy();
    expect(callsTo(api, "live.communities.posts").at(-1)).toMatchObject({ communityId: ids.community, parentPostId: "p1" });
    expect(await within(thread).findByText("Ben Okoye")).toBeTruthy();
  });

  it("dates the community in the person's own format (Settings › Preferences: ISO)", async () => {
    memberView();
    mount(
      <DateFormatProvider value={{ date: "iso", time: "24h" }}>
        <CommunityScreen communityId={ids.community} />
      </DateFormatProvider>,
    );
    await screen.findByRole("heading", { name: "Fintech ops founders" });
    const iso = AT(1000).toISOString().slice(0, 10);
    const local = format(AT(1000), "yyyy-MM-dd");
    expect(screen.getByText(new RegExp(`^(${iso}|${local})$`))).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}/);
    // Each post's moment on hover, on a 24-hour clock.
    const post = (await within(await screen.findByTestId("community-feed")).findAllByTestId("feed-post"))[0]!;
    expect(post.querySelector("time")!.getAttribute("title")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("posts as the person by default, and replies under the post they belong to", async () => {
    memberView();
    mount(<CommunityScreen communityId={ids.community} />);
    const box = await screen.findByLabelText("Write a post");
    expect(screen.getByText(/Posting as yourself/)).toBeTruthy();
    fireEvent.change(box, { target: { value: "Thanks all." } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(callsTo(api, "live.communities.post")).toEqual([{ communityId: ids.community, bodyMd: "Thanks all.", parentPostId: null, businessId: null }]));

    const posts = await screen.findAllByTestId("feed-post");
    fireEvent.click(within(posts[0]!).getByRole("button", { name: "Reply" }));
    const thread = await within(posts[0]!).findByTestId("reply-thread");
    const reply = within(thread).getByLabelText("Write a reply");
    fireEvent.change(reply, { target: { value: "Same here." } });
    fireEvent.click(within(thread).getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(callsTo(api, "live.communities.post").at(-1)).toMatchObject({ bodyMd: "Same here.", parentPostId: "p1", businessId: null }));
  });

  it("offers posting as the business only to someone who may speak for it, and only when they choose it", async () => {
    memberView();
    const { unmount } = mount(<CommunityScreen communityId={ids.community} />);
    const toggle = await screen.findByRole("switch", { name: "Post as Ledgerly" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText(/Posting as Ledgerly/)).toBeTruthy();
    const box = screen.getByLabelText("Write a post");
    fireEvent.change(box, { target: { value: "Official word." } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsTo(api, "live.communities.post")).toEqual([{ communityId: ids.community, bodyMd: "Official word.", parentPostId: null, businessId: "b1" }]));
    unmount();

    // A viewer, a member held back on the live section, a Personal business and an uncommitted one never see the choice.
    for (const [label, set] of [
      ["viewer", () => (ctx.role = "viewer")],
      ["restricted member", () => ((ctx.role = "member"), (ctx.sectionPermissions = { live: "read" }))],
      ["personal business", () => (ctx.gameMode = "personal")],
      ["uncommitted business", () => (ctx.committed = false)],
    ] as const) {
      ctx.role = "owner";
      ctx.sectionPermissions = {};
      ctx.gameMode = "live";
      ctx.committed = true;
      set();
      const view = mount(<CommunityScreen communityId={ids.community} />);
      await screen.findByLabelText("Write a post");
      expect(screen.queryByRole("switch"), label).toBeNull();
      expect(screen.getByText(/Posting as yourself/), label).toBeTruthy();
      view.unmount();
    }
  });

  it("audit #28: a held post shows to its author as held; own posts can be edited and deleted, others' reported", async () => {
    memberView();
    api.handlers["live.communities.posts"] = () => ({
      items: [post("mine", ids.me, "You are all wrong", 2, { status: "pending_review", screening: { decision: "hold", flags: ["harassment"], rationale: "x", mode: "mock" } }), post("theirs", ids.ana, "Buy my course", 10, { editedAt: AT(5) })],
      nextCursor: null,
    });
    api.handlers["live.posts.delete"] = () => ({ postId: "mine", status: "removed" });
    api.handlers["live.posts.report"] = () => ({ reported: true, held: false });
    api.handlers["live.posts.edit"] = () => ({ ...post("mine", ids.me, "Edited", 2), held: false });
    mount(<CommunityScreen communityId={ids.community} />);
    const posts = await within(await screen.findByTestId("community-feed")).findAllByTestId("feed-post");
    expect(within(posts[0]!).getByTestId("post-status").textContent).toBe("Held for review");
    expect(posts[0]!.getAttribute("data-status")).toBe("pending_review");
    // A held post takes no replies until a moderator approves it.
    expect(within(posts[0]!).queryByRole("button", { name: "Reply" })).toBeNull();
    expect(posts[1]!.textContent).toContain("Edited");

    openMenu(within(posts[0]!).getByRole("button", { name: /More for the post by/ }));
    expect(screen.getByRole("menuitem", { name: /Edit/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    await waitFor(() => expect(callsTo(api, "live.posts.delete")).toEqual([{ postId: "mine" }]));

    openMenu(within(posts[1]!).getByRole("button", { name: "More for the post by Ana Ruiz" }));
    expect(screen.queryByRole("menuitem", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Ask Ana Ruiz to connect" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Report/ }));
    const dialog = await screen.findByTestId("report-dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Harassment or abuse" }));
    fireEvent.change(within(dialog).getByLabelText(/Anything the moderators should know/), { target: { value: "Third time" } });
    fireEvent.click(within(dialog).getByTestId("report-send"));
    await waitFor(() => expect(callsTo(api, "live.posts.report")).toEqual([{ postId: "theirs", reason: "harassment", note: "Third time" }]));
  });

  it("audit #28: owners and moderators review held and reported posts, and mute, ban or restore members", async () => {
    memberView();
    api.handlers["live.communities.moderation"] = () => ({
      items: [{ post: { ...post("held", ids.ben, "Call me on 415 555 0100", 5, { status: "pending_review", screening: { decision: "hold", flags: ["personal_data"], rationale: "x", mode: "mock" } }), authorName: "Ben Okoye" }, openReports: 2, reasons: ["spam"] }],
      restricted: [{ userId: ids.cal, status: "banned", role: "member", name: null }],
    });
    api.handlers["live.posts.moderate"] = (v) => ({ ...post("held", ids.ben, "x", 5), status: (v as { action: string }).action === "restore" ? "visible" : "hidden" });
    api.handlers["live.communities.moderateMember"] = (v) => ({ userId: (v as { userId: string }).userId, status: "muted", role: "member" });
    mount(<CommunityScreen communityId={ids.community} />);
    const panel = await screen.findByTestId("moderation-panel");
    const item = await within(panel).findByTestId("moderation-item");
    expect(item.textContent).toContain("2 reports");
    expect(item.textContent).toMatch(/Held by moderation: personal data/);
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(callsTo(api, "live.posts.moderate")).toEqual([{ postId: "held", action: "restore" }]));
    fireEvent.click(within(item).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(callsTo(api, "live.posts.moderate").at(-1)).toEqual({ postId: "held", action: "remove" }));
    fireEvent.click(within(within(panel).getByTestId("restricted-member")).getByRole("button", { name: "Lift ban" }));
    await waitFor(() => expect(callsTo(api, "live.communities.moderateMember")).toEqual([{ communityId: ids.community, userId: ids.cal, action: "restore" }]));

    // The owner moderates a member from the member list (never themselves).
    const members = within(screen.getByTestId("community-members")).getAllByTestId("community-member");
    expect(within(members[0]!).queryByTestId("member-menu")).toBeNull();
    openMenu(within(members[1]!).getByRole("button", { name: "Moderate Ana Ruiz" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Mute/ }));
    await waitFor(() => expect(callsTo(api, "live.communities.moderateMember").at(-1)).toEqual({ communityId: ids.community, userId: ids.ana, action: "mute" }));
    // Only the owner makes moderators.
    openMenu(within(members[1]!).getByRole("button", { name: "Moderate Ana Ruiz" }));
    expect(await screen.findByRole("menuitem", { name: /Make a moderator/ })).toBeTruthy();
  });

  it("audit #28: a muted member reads the feed but the post box is closed, and nobody else is offered moderation", async () => {
    memberView({ canPost: false, canModerate: false, role: "member", status: "muted" });
    mount(<CommunityScreen communityId={ids.community} />);
    const box = await screen.findByLabelText("Write a post");
    expect((box as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/A moderator muted you here/)).toBeTruthy();
    expect(screen.queryByTestId("moderation-panel")).toBeNull();
    expect(callsTo(api, "live.communities.moderation")).toHaveLength(0);
    expect(screen.queryByTestId("community-invite")).toBeNull();
  });

  it("audit #28: an invited founder sees the community and accepts or declines the invitation", async () => {
    api.handlers["live.communities.get"] = () => ({ community: community({ role: null, visibility: "private" }), members: [], isMember: false, invited: true, canPost: false, canModerate: false, role: null, status: "invited" });
    api.handlers["live.communities.join"] = () => ({});
    api.handlers["live.communities.decline"] = () => ({ declined: true });
    mount(<CommunityScreen communityId={ids.community} />);
    expect(await screen.findByText(/You are invited/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("community-join"));
    await waitFor(() => expect(callsTo(api, "live.communities.join")).toEqual([{ communityId: ids.community }]));
    fireEvent.click(screen.getByTestId("community-decline"));
    await waitFor(() => expect(callsTo(api, "live.communities.decline")).toEqual([{ communityId: ids.community }]));
  });

  it("audit #66: a member row offers Ask to connect, sent from the current business with an optional note", async () => {
    memberView();
    api.handlers["live.connections.request"] = () => ({ id: "c-new", status: "requested" });
    mount(<CommunityScreen communityId={ids.community} />);
    const members = await within(await screen.findByTestId("community-members")).findAllByTestId("community-member");
    expect(within(members[0]!).queryByTestId("ask-to-connect")).toBeNull();
    fireEvent.click(within(members[1]!).getByRole("button", { name: "Ask Ana Ruiz to connect" }));
    const dialog = await screen.findByTestId("ask-to-connect-dialog");
    fireEvent.change(within(dialog).getByLabelText(/A note with the request/), { target: { value: "Loved your post on refresh rates." } });
    fireEvent.click(within(dialog).getByTestId("ask-to-connect-send"));
    await waitFor(() => expect(callsTo(api, "live.connections.request")).toEqual([{ businessId: "b1", toUserId: ids.ana, message: "Loved your post on refresh rates." }]));
  });

  it("audit #66: connected and requested people show their state instead of the button; a Personal business cannot ask", async () => {
    memberView({ members: [member, { ...member, id: "m2", userId: ids.ana, businessId: null, role: "member" }, { ...member, id: "m3", userId: ids.ben, businessId: null, role: "member" }, { ...member, id: "m4", userId: ids.cal, businessId: null, role: "member" }] });
    api.handlers["live.connections.list"] = () => [
      { id: "c1", fromUser: ids.me, toUser: ids.ana, status: "accepted", message: null, respondedAt: AT(5), createdAt: AT(9), updatedAt: AT(5) },
      { id: "c2", fromUser: ids.me, toUser: ids.ben, status: "requested", message: null, respondedAt: null, createdAt: AT(9), updatedAt: AT(9) },
    ];
    ctx.gameMode = "personal";
    mount(<CommunityScreen communityId={ids.community} />);
    const members = await within(await screen.findByTestId("community-members")).findAllByTestId("community-member");
    await waitFor(() => expect(members[1]!.textContent).toContain("Connected"));
    expect(members[2]!.textContent).toContain("Requested");
    const ask = within(members[3]!).getByRole("button", { name: /Ask .* to connect/ }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    expect(ask.getAttribute("title")).toMatch(/sent from a LIVE business/);
  });

  it("after leaving, the feed asks to join again instead of showing the API's refusal as an error (audit MLSL-31)", async () => {
    memberView();
    let joined = true;
    const forbidden = () => new TRPCClientError("Join the community to read its feed", { result: { error: { message: "Join the community to read its feed", code: -32003, data: { code: "FORBIDDEN" } } } as never });
    const feed = api.handlers["live.communities.posts"]!;
    api.handlers["live.communities.get"] = () => ({ community: community({ role: joined ? "owner" : null }), members: joined ? [member] : [], isMember: joined, role: joined ? "owner" : null });
    api.handlers["live.communities.posts"] = (v) => {
      if (!joined) throw forbidden();
      return feed(v);
    };
    api.handlers["live.communities.leave"] = () => ((joined = false), {});
    mount(<CommunityScreen communityId={ids.community} />);
    expect(await screen.findAllByTestId("feed-post")).toHaveLength(2);
    const postsBefore = callsTo(api, "live.communities.posts").length;
    fireEvent.click(screen.getByTestId("community-leave"));
    expect(await screen.findByText("Join this community to read its feed and post.")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("community-screen").getAttribute("data-member")).toBe("false"));
    const feedPanel = screen.getByTestId("community-feed");
    expect(feedPanel.textContent).not.toMatch(/Join the community to read its feed|Try again/);
    expect(within(feedPanel).queryByRole("alert")).toBeNull();
    // The feed is not asked for again once the person has left.
    expect(callsTo(api, "live.communities.posts").length).toBe(postsBefore);
  });

  it("a reply box says who the reply goes out as, following the Post as switch", async () => {
    memberView();
    mount(<CommunityScreen communityId={ids.community} />);
    const posts = await screen.findAllByTestId("feed-post");
    fireEvent.click(within(posts[0]!).getByRole("button", { name: "Reply" }));
    const thread = await within(posts[0]!).findByTestId("reply-thread");
    expect(within(thread).getByText(/Replying as yourself/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Post as Ledgerly" }));
    expect(within(thread).getByText(/Replying as Ledgerly/)).toBeTruthy();
    const reply = within(thread).getByLabelText("Write a reply");
    fireEvent.change(reply, { target: { value: "For the company." } });
    fireEvent.click(within(thread).getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(callsTo(api, "live.communities.post").at(-1)).toMatchObject({ bodyMd: "For the company.", parentPostId: "p1", businessId: "b1" }));
  });

  it("a visitor sees the description and size, is asked to join, and the feed is never requested", async () => {
    api.handlers["live.communities.get"] = () => ({ community: community({ role: null }), members: [], isMember: false, invited: false, canPost: false, canModerate: false, role: null, status: null });
    api.handlers["live.communities.join"] = () => ({});
    mount(<CommunityScreen communityId={ids.community} />);
    expect(await screen.findByText("Join this community to read its feed and post.")).toBeTruthy();
    expect(screen.getByText(/The member list is shown to members/)).toBeTruthy();
    expect(screen.getByText("Founders selling to operations teams.")).toBeTruthy();
    expect(screen.queryByLabelText("Write a post")).toBeNull();
    expect(callsTo(api, "live.communities.posts")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("community-join"));
    await waitFor(() => expect(callsTo(api, "live.communities.join")).toEqual([{ communityId: ids.community }]));
  });

  it("an empty feed says how to start it, and a community that is missing or private reads as missing", async () => {
    memberView();
    api.handlers["live.communities.posts"] = () => ({ items: [], nextCursor: null });
    const { unmount } = mount(<CommunityScreen communityId={ids.community} />);
    expect(await screen.findByTestId("feed-empty")).toBeTruthy();
    unmount();

    api.handlers["live.communities.get"] = () => {
      throw notFound();
    };
    mount(<CommunityScreen communityId="00000000-0000-4000-8000-00000000dead" />);
    expect(await screen.findByText("No such community")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All communities" }));
    expect(ctx.push).toHaveBeenCalledWith("/communities");
  });
});
