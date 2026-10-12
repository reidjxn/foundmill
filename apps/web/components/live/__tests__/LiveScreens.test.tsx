// @vitest-environment happy-dom
/** /communities, /communities/[id], /leaderboards and /leaderboards/[boardId] against canned API answers. */
import { TRPCClientError } from "@trpc/client";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeApi } from "./fake-trpc";
import { format } from "date-fns";
import { DateFormatProvider } from "@foundmill/dugout";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
const ctx = vi.hoisted(() => ({ gameMode: "live" as "live" | "personal", role: "owner", sectionPermissions: {} as Record<string, string>, committed: true, push: vi.fn() }));
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("./fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({
    businessId: "b1",
    data: { business: { name: "Ledgerly", gameMode: ctx.gameMode, committedAt: ctx.committed ? new Date() : null, archivedAt: null }, membership: { role: ctx.role, sectionPermissions: ctx.sectionPermissions } },
  }),
}));
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ctx.push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));

import { CommunitiesScreen } from "../CommunitiesScreen";
import { CommunityScreen } from "../CommunityScreen";
import { LeaderboardScreen } from "../LeaderboardScreen";
import { LeaderboardsScreen } from "../LeaderboardsScreen";
import { LiveViewerProvider } from "../viewer";
import { callsTo, ids, renderWithProviders } from "./fake-trpc";

const AT = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const notFound = () => new TRPCClientError("Not found", { result: { error: { message: "Not found", code: -32004, data: { code: "NOT_FOUND" } } } as never });

const community = (over: Record<string, unknown> = {}) => ({ id: ids.community, name: "Fintech ops founders", slug: "fintech-ops-founders", descriptionMd: "Founders selling to operations teams.", visibility: "public", ownerBusinessId: ids.business, createdBy: ids.me, memberCount: 4, createdAt: AT(1000), updatedAt: AT(10), archivedAt: null, role: "owner", ...over });
const mount = (ui: ReactElement) => renderWithProviders(<LiveViewerProvider value={{ userId: ids.me, displayName: "Jamie Reyes" }}>{ui}</LiveViewerProvider>);
const lookup = (v: unknown) => ({
  users: ((v as { userIds: string[] }).userIds ?? []).map((userId) => ({ userId, displayName: ({ [ids.ana]: "Ana Ruiz", [ids.ben]: "Ben Okoye" } as Record<string, string>)[userId] ?? null })),
  businesses: ((v as { businessIds: string[] }).businessIds ?? []).map((businessId) => ({ businessId, name: "Northlight Payments", slug: "northlight", kitPrimary: "#1F6FEB", kitSecondary: "#F5B841", archetype: "b2b_saas", live: true })),
});

beforeEach(() => {
  api.handlers = { "live.people.lookup": lookup };
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
});

describe("/communities/[id]", () => {
  const post = (id: string, author: string, body: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({ id, communityId: ids.community, authorUserId: author, businessId: null, parentPostId: null, bodyMd: body, entityIds: [], status: "visible", createdAt: AT(minutesAgo), updatedAt: AT(minutesAgo), archivedAt: null, replyCount: 0, ...extra });
  const member = { id: "m1", communityId: ids.community, userId: ids.me, businessId: ids.business, role: "owner", status: "active", joinedAt: AT(900), createdAt: AT(900), updatedAt: AT(900) };

  function memberView() {
    api.handlers["live.communities.get"] = () => ({ community: community(), members: [member, { ...member, id: "m2", userId: ids.ana, businessId: null, role: "member" }], isMember: true, role: "owner" });
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

  it("a visitor sees the description and size, is asked to join, and the feed is never requested", async () => {
    api.handlers["live.communities.get"] = () => ({ community: community({ role: null }), members: [], isMember: false, role: null });
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

describe("/leaderboards", () => {
  const board = (id: string, kind: string, metric: string) => ({ id, boardKind: kind, division: "b2b_saas", period: "2026-Q4", metric, archetype: "b2b_saas", region: "eu", computedAt: AT(120), createdAt: AT(200), updatedAt: AT(120) });
  const growth = board(ids.board, "growth", "mrr_growth_pct");
  const won = board("00000000-0000-4000-8000-0000000000d1", "customers_won", "customers_won");
  const position = (b: ReturnType<typeof board>, n: number, movement: number, value: string) => ({ id: `e-${b.id}`, leaderboardId: b.id, businessId: ids.business, position: n, movement, form: "WWDLW", metricValue: value, verified: true, createdAt: AT(1), updatedAt: AT(1), board: b });

  it("lists every board with the business's position on each, and a panel of its positions", async () => {
    api.handlers["live.leaderboards.list"] = () => [won, growth];
    api.handlers["live.leaderboards.positions"] = () => [position(growth, 3, 1, "18.4000"), position(won, 2, -1, "47.0000")];
    mount(<LeaderboardsScreen />);
    const grid = await screen.findByRole("grid", { name: "Leaderboards" });
    const rows = await within(grid).findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain("Customers won");
    expect(rows[1]!.textContent).toContain("B2B SaaS · EU");
    expect(rows[1]!.textContent).toContain("Q4 2026");
    expect(rows[1]!.textContent).toContain("#2");
    expect(rows[2]!.textContent).toContain("#3");
    expect(callsTo(api, "live.leaderboards.positions")[0]).toEqual({ businessId: "b1" });

    const panel = screen.getByTestId("positions-panel");
    const links = within(panel).getAllByTestId("position-row");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`/leaderboards/${ids.board}`, `/leaderboards/${won.id}`]);
    expect(links[0]!.textContent).toContain("MRR growth 18.4%");
    expect(links[1]!.getAttribute("aria-label") ?? links[1]!.textContent).toContain("47");

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(ctx.push).toHaveBeenCalledWith(`/leaderboards/${won.id}`);
  });

  it("tells a business that is not ranked how to get on a board, and a Personal one to go LIVE", async () => {
    api.handlers["live.leaderboards.list"] = () => [growth];
    api.handlers["live.leaderboards.positions"] = () => [];
    const { unmount } = mount(<LeaderboardsScreen />);
    expect(await screen.findByText(/is not on a leaderboard yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open integrations/ }));
    expect(ctx.push).toHaveBeenCalledWith("/b/b1/settings/integrations");
    unmount();
    ctx.gameMode = "personal";
    mount(<LeaderboardsScreen />);
    expect(await screen.findByText(/is a Personal business, so it is not ranked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Settings/ }));
    expect(ctx.push).toHaveBeenLastCalledWith("/b/b1/settings/mode");
  });

  it("says what will appear when there are no boards", async () => {
    api.handlers["live.leaderboards.list"] = () => [];
    api.handlers["live.leaderboards.positions"] = () => [];
    mount(<LeaderboardsScreen />);
    expect(await screen.findByText(/No leaderboards yet/)).toBeTruthy();
  });
});

describe("/leaderboards/[boardId]", () => {
  const board = { id: ids.board, boardKind: "growth", division: "b2b_saas", period: "2026-Q4", metric: "mrr_growth_pct", archetype: "b2b_saas", region: "eu", computedAt: AT(120), createdAt: AT(200), updatedAt: AT(120) };
  const entry = (n: number, businessId: string, name: string | null, value: string, movement: number, form: string) => ({
    id: `e${n}`, leaderboardId: board.id, businessId, position: n, movement, form, metricValue: value, verified: true, createdAt: AT(1), updatedAt: AT(1),
    businessName: name, business: name ? { businessId, name, slug: name.toLowerCase().replace(/\W+/g, "-"), kitPrimary: "#1F6FEB", kitSecondary: "#F5B841", archetype: "b2b_saas", live: true } : null,
  });

  it("ranks the entries with position, movement, logo, the metric and form, and marks the founder's own business", async () => {
    api.handlers["live.leaderboards.get"] = () => board;
    api.handlers["live.leaderboards.entries"] = () => [entry(1, "x1", "Northlight Payments", "33.0000", 0, "WWWWD"), entry(2, "b1", "Ledgerly", "18.4000", 2, "WWDLW"), entry(3, "x3", null, "9.1000", -1, "LDLWD")];
    mount(<LeaderboardScreen boardId={board.id} />);
    const grid = await screen.findByRole("grid", { name: /Growth · B2B SaaS · EU entries/ });
    const rows = (await within(grid).findAllByRole("row")).slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("#1");
    expect(rows[0]!.textContent).toContain("Northlight Payments");
    expect(rows[0]!.textContent).toContain("33.0%");
    expect(rows[1]!.textContent).toContain("You");
    // The movement reads "up 2" / "down 1": the word is screen-reader text beside the visible figure.
    expect(rows[1]!.querySelector("[data-delta]")?.textContent).toBe("up 2");
    expect(rows[2]!.querySelector("[data-delta]")?.textContent).toBe("down 1");
    expect(rows[2]!.textContent).toContain("Unlisted business");
    expect(within(rows[0]!).getByLabelText(/Form, last five: success, success, success, success, partial/)).toBeTruthy();
    expect(within(grid).getByRole("columnheader", { name: /MRR growth/ })).toBeTruthy();
    expect(rows[0]!.querySelector("svg[role=img], [role=img]")).not.toBeNull(); // the logo
    const strip = screen.getByRole("list", { name: /at a glance/ });
    expect(strip.textContent).toMatch(/Your position\s*#2/);
    expect(strip.textContent).toMatch(/Businesses ranked\s*3/);
    expect(screen.getByText(/Verified integration metrics only/)).toBeTruthy();
    expect(callsTo(api, "live.leaderboards.entries")[0]).toEqual({ leaderboardId: board.id, limit: 200 });
  });

  it("says so when the business is not on the board, and when nobody is ranked", async () => {
    api.handlers["live.leaderboards.get"] = () => board;
    api.handlers["live.leaderboards.entries"] = () => [entry(1, "x1", "Northlight Payments", "33.0000", 0, "")];
    const { unmount } = mount(<LeaderboardScreen boardId={board.id} />);
    expect(await screen.findByText("Not ranked")).toBeTruthy();
    expect(screen.getByText("Ledgerly is not on this board")).toBeTruthy();
    unmount();
    api.handlers["live.leaderboards.entries"] = () => [];
    mount(<LeaderboardScreen boardId={board.id} />);
    expect(await screen.findByText(/Nobody is ranked on this board yet/)).toBeTruthy();
  });

  it("a board that does not exist reads as missing, with a way back", async () => {
    api.handlers["live.leaderboards.get"] = () => {
      throw notFound();
    };
    mount(<LeaderboardScreen boardId="00000000-0000-4000-8000-00000000dead" />);
    expect(await screen.findByText("No such leaderboard")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All leaderboards" }));
    expect(ctx.push).toHaveBeenCalledWith("/leaderboards");
  });
});
