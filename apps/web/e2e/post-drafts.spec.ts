import { expect, test, type Locator, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, settled, toast } from "./helpers";

/**
 * Posts the social agent drafts for the founder to share by tap (docs/NETWORK.md F3, F7; docs/DESIGN.md §9g; founder,
 * Nov 12, 2026: "a post the social channel agent wrote"), on the mock model. A throwaway project publishes its page
 * with the social channel off the board: a post is drafted all the same (WP-08 T4). A
 * drafted post appears on Customers › Creative, written by the team, with Share: every "opens ready to post" link
 * carries the post's words and the page's address with the post's own code for that network (`via=s.<code>`). Today shows one quiet line to it. "Not this one" sets it
 * aside: off the tab and off Today. A milestone shown on the page then gets its own post, pointing to its card; once a
 * share is opened for it, it stops waiting and Today's line goes. The links are checked as links and never followed:
 * nothing here opens a real network, and nothing says a post was posted. Stack and commands: e2e/README.md.
 */
const PITCH = "Bike repairs at your door, booked in a minute";
const ABOUT = "A van full of parts comes to the bike and fixes it where it stands.";
const TAP = [
  { network: "x", host: "x.com", linkParam: "url" },
  { network: "threads", host: "www.threads.com", linkParam: "url" },
  { network: "bluesky", host: "bsky.app", linkParam: null },
] as const;

const openLink = (panel: Locator, network: string) => panel.locator(`a[data-share-open="${network}"]`);

/** A post's link: the address it points to, with the post's own code for one network or for a copied link (item 8). */
const POST_CODE_LINK = (address: string) => new RegExp(`^${address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?via=s\\.[a-z2-7]{10}$`);

/**
 * Every "opens ready to post" link carries the whole text (never shortened) and the link, on the network's own host.
 * Each network's link is the address with that network's own code (`via=s.<code>`), a different one from the copied
 * link's: what comes back through a post is known for the post and the place it was shared.
 */
async function expectTapLinks(panel: Locator, text: string, address: string): Promise<void> {
  const seen = new Set<string>([(await panel.locator("[data-share-link]").innerText()).trim()]);
  for (const t of TAP) {
    const a = openLink(panel, t.network);
    await expect(a).toHaveAttribute("target", "_blank");
    const url = new URL((await a.getAttribute("href"))!);
    expect(url.protocol + url.host, t.network).toBe(`https:${t.host}`);
    let link: string;
    if (t.linkParam) {
      expect(url.searchParams.get("text"), t.network).toBe(text);
      link = url.searchParams.get(t.linkParam)!;
    } else {
      const all = url.searchParams.get("text")!;
      expect(all.startsWith(`${text}\n\n`), t.network).toBe(true);
      link = all.slice(text.length + 2);
    }
    expect(link, t.network).toMatch(POST_CODE_LINK(address));
    seen.add(link);
    await expect(panel.locator(`[data-share-count="${t.network}"]`)).not.toContainText("shortened");
  }
  expect(seen.size, "one code per network and one for the copied link").toBe(TAP.length + 1);
}

async function publishPage(page: Page, bid: string): Promise<string> {
  await page.goto(`/b/${bid}/today`);
  await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
  const check = page.getByTestId("needs-you").getByRole("button", { name: "Check it and publish" });
  await expect(async () => {
    await page.reload();
    await expect(check).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: LONG });
  await dismissCoachmarks(page);
  await check.click();
  await page.waitForURL(new RegExp(`/b/${bid}/d/[^/]+/public-page$`), { timeout: LONG });
  await settled(page);
  await dismissCoachmarks(page);
  const editor = page.getByTestId("public-page-editor");
  await expect(editor).toBeVisible({ timeout: LONG });
  await editor.getByLabel(/One-line pitch/).fill(PITCH);
  await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
  await editor.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByTestId("page-confirm-publish").click();
  await expect(page.getByTestId("page-state")).toHaveText(/Live since [A-Z][a-z]{2} \d{1,2}, \d{4}/, { timeout: LONG });
  return (await page.getByTestId("page-url").innerText()).trim();
}

/** The Channel Board, loaded, with the social channel's token. */
async function openBoard(page: Page, bid: string): Promise<Locator> {
  await page.goto(`/b/${bid}/d/distribution/formation`);
  const screen = page.getByTestId("module-screen");
  await expect(screen).toHaveAttribute("data-module", "distribution/formation", { timeout: LONG });
  await expect(screen.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: LONG });
  await settled(page);
  await dismissCoachmarks(page);
  // The panel's count is said only once the project's own channels have arrived: before that a token's place means nothing.
  await expect(screen.getByText(/\d+ of \d+ (?:running|on the board)/).first()).toBeVisible({ timeout: LONG });
  const board = page.getByRole("region", { name: "Channel Board" });
  const token = board.getByRole("button", { name: /^Social media/ });
  await expect(token).toBeVisible({ timeout: LONG });
  // The channels on the board walk on one by one, and the board is busy until they have: before that a channel on the
  // board can still be drawn in the tray. A project whose starters include social (the first card in the deck decides
  // the archetype) has it on the board from Take charge.
  await expect(board).not.toHaveAttribute("aria-busy", "true", { timeout: LONG });
  return token;
}

/** Puts the social channel on the board or takes it off, whichever way it stood. */
async function setSocialOnBoard(page: Page, bid: string, on: boolean): Promise<void> {
  const token = await openBoard(page, bid);
  // The token is dragged with a pointer; from the keyboard, Enter moves it onto the board or off it.
  if ((await token.getAttribute("aria-pressed")) !== String(on)) await token.press("Enter");
  await expect(token).toHaveAttribute("aria-pressed", String(on), { timeout: LONG });
  // The choice is saved: it reads the same after a reload.
  await expect(async () => {
    const again = await openBoard(page, bid);
    await expect(again).toHaveAttribute("aria-pressed", String(on), { timeout: 10_000 });
  }).toPass({ timeout: LONG });
}

async function openCreative(page: Page, bid: string): Promise<Locator> {
  await page.goto(`/b/${bid}/d/distribution/creative`);
  const screen = page.getByTestId("module-screen");
  await expect(screen).toHaveAttribute("data-module", "distribution/creative", { timeout: LONG });
  await expect(screen.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: LONG });
  await settled(page);
  await dismissCoachmarks(page);
  return screen;
}

/** The team's posts on the Creative tab, once at least `count` are there (the draft is written just after the press that asked for it). */
async function teamPosts(page: Page, bid: string, count: number): Promise<Locator> {
  const posts = page.locator("article[data-team-post]");
  await expect(async () => {
    await openCreative(page, bid);
    await expect(posts).toHaveCount(count, { timeout: 5_000 });
  }).toPass({ timeout: LONG });
  return posts;
}

async function openToday(page: Page, bid: string): Promise<void> {
  await page.goto(`/b/${bid}/today`);
  await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
  await settled(page);
  await dismissCoachmarks(page);
}

test.describe("posts the team drafts to share by tap", () => {
  test("a post appears with Share whether or not social is on the board, Today says so once, and it can be set aside, shared or confirmed posted", async ({ page, baseURL }) => {
    test.setTimeout(420_000);
    const name = `Post Bikes ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);

    // Social is off the board (WP-08 T4: the page going live is enough), then the page goes live.
    await setSocialOnBoard(page, bid, false);
    const pageAddress = await publishPage(page, bid);
    const origin = new URL(pageAddress).origin;
    const slug = new URL(pageAddress).pathname.replace("/p/", "");
    const pageAddressOnly = `${origin}/p/${slug}`;
    const posts = await teamPosts(page, bid, 1);
    const post = posts.first();
    const text = `${name} has a page now. ${PITCH}.`;
    await expect(post).toHaveAttribute("data-state", "draft");
    await expect(post.getByTestId("asset-body")).toHaveText(text);
    await expect(post).toContainText("A post about your page going live");
    await expect(post).toContainText("Written by your team for you to share");
    await expect(post).toContainText("Not shared yet");
    // An offer, not a decision: Share and "Not this one", never Approve or Reject; nothing says it was posted.
    await expect(post.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
    await expect(post.getByRole("button", { name: /^Reject/ })).toHaveCount(0);
    await expect(post).not.toContainText(/post-draft:|\bposted\b|\bpublished\b/i);
    const share = post.getByRole("button", { name: "Share: A post about your page going live" });
    await expect(share).toHaveText("Share");

    // The share panel: the team's words, the page's address with `via`, and every ready-to-post link carrying both.
    await share.click();
    const panel = page.getByTestId("share-post");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel.getByRole("heading", { name: "Share this post" })).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Text" })).toHaveValue(text);
    await expect(panel.locator("[data-share-link]")).toHaveText(POST_CODE_LINK(pageAddressOnly));
    await expectTapLinks(panel, text, pageAddressOnly);
    // The founder may change the words; every network follows, and the link stays.
    await panel.getByRole("textbox", { name: "Text" }).fill("We fix bikes where they stand. Our page is up.");
    await expectTapLinks(panel, "We fix bikes where they stand. Our page is up.", pageAddressOnly);
    await expect(panel.locator("[data-share-honest]")).toContainText("posts nothing for you");
    await expect(panel).not.toContainText(/\b(posted|published)\b/i);
    // No video tools connected on the founder's own key: the post is text only, and the panel says so.
    await expect(panel.locator("[data-share-media='not-connected']")).toContainText("Video tools aren't connected, so this post is text only.");
    await expect(panel.locator("video")).toHaveCount(0);
    await panel.getByRole("button", { name: "Close" }).last().click();
    await expect(panel).toHaveCount(0);
    // Looking is not sharing: it still waits.
    await expect(post).toHaveAttribute("data-state", "draft");

    // Today: one quiet line, which leads to the post.
    await openToday(page, bid);
    const note = page.getByTestId("post-ready-note");
    await expect(note).toHaveCount(1);
    await expect(note.getByRole("link")).toHaveText(/^A post is ready to share\s*Open$/);
    // It is not a task: Needs you does not carry it.
    await expect(page.getByTestId("needs-you")).not.toContainText("ready to share");
    await note.getByRole("link").click();
    await page.waitForURL(new RegExp(`/b/${bid}/d/[^/]+/creative\\?asset=[0-9a-f-]{36}$`), { timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    await expect(page.locator("article[data-team-post]")).toHaveCount(1, { timeout: LONG });

    // "Not this one": set aside, off the tab and off Today.
    await page.locator("article[data-team-post]").getByRole("button", { name: "Not this one: A post about your page going live" }).click();
    await expect(page.locator("article[data-team-post]")).toHaveCount(0, { timeout: LONG });
    await openCreative(page, bid);
    await expect(page.locator("article[data-team-post]")).toHaveCount(0);
    await openToday(page, bid);
    await expect(page.getByTestId("post-ready-note")).toHaveCount(0);

    // A milestone shown on the page gets its own post, pointing to its card.
    await page.goto(`/b/${bid}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    const live = page.locator("[data-trophy='page_live']");
    await expect(live).toHaveAttribute("data-achieved", "true", { timeout: LONG });
    await live.getByRole("button", { name: "Show on your page: Page live" }).click();
    const onPage = live.locator("[data-trophy-on-page='shown']");
    await expect(onPage).toContainText("On your page", { timeout: LONG });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
    await onPage.getByRole("button", { name: "Copy card link: Page live" }).click();
    await expect(toast(page, "Card link copied")).toBeVisible({ timeout: LONG });
    const cardAddress = await page.evaluate(() => navigator.clipboard.readText());
    expect(cardAddress).toMatch(/\/m\/[0-9a-f-]{36}$/);

    const second = (await teamPosts(page, bid, 1)).first();
    const milestoneText = `${name} reached a milestone: Page live. ${PITCH}.`;
    await expect(second).toContainText("A post about your milestone: Page live");
    await expect(second.getByTestId("asset-body")).toHaveText(milestoneText);
    await openToday(page, bid);
    await expect(page.getByTestId("post-ready-note")).toHaveCount(1);
    await teamPosts(page, bid, 1);
    await second.getByRole("button", { name: "Share: A post about your milestone: Page live" }).click();
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel.locator("[data-share-link]")).toHaveText(POST_CODE_LINK(cardAddress));
    await expectTapLinks(panel, milestoneText, cardAddress);
    const cardLink = (await panel.locator("[data-share-link]").innerText()).trim();
    // Copying the link is a share that was opened: recorded as that, and the post stops waiting. Nothing is posted.
    await panel.getByRole("button", { name: "Copy link" }).click();
    await expect(panel.locator("[data-share-said]")).toHaveText("Link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(cardLink);
    await panel.getByRole("button", { name: "Close" }).last().click();
    await expect(second).toHaveAttribute("data-state", "approved", { timeout: LONG });
    await expect(second).toContainText("Share opened");
    await expect(second).not.toContainText(/Posted on|Posted,|\bpublished\b|Approved/i);
    // "Did you post it?": only the founder's yes says it was posted.
    await expect(second.getByTestId("did-you-post")).toContainText("Did you post it?");
    await second.getByRole("button", { name: "Yes, I posted it" }).click();
    await expect(second.getByTestId("post-posted")).toContainText(/^Posted/, { timeout: LONG });
    await expect(second.getByTestId("did-you-post")).toHaveCount(0);
    // Still there to share again on another network; no longer offered to be set aside.
    await expect(second.getByRole("button", { name: /^Share:/ })).toBeVisible();
    await expect(second.getByRole("button", { name: /^Not this one/ })).toHaveCount(0);
    await openToday(page, bid);
    await expect(page.getByTestId("post-ready-note")).toHaveCount(0);

    // The board still says what social is: the founder's to post, never a channel that was launched for them.
    await openBoard(page, bid);
    await expect(page.getByTestId("board-by-tap").locator('[data-channel="social"]')).toContainText("You post each one with one press: the text and link are filled in for you.");
  });

  /*
   * What a shared post led to (item 8): a stranger opens the post's X link signed out, at phone width; the page sends
   * one visit beacon and remembers the post's code (`fm_post`, httpOnly); the stranger follows. This stack runs no
   * ingest, so the confirmation email's link cannot be used here and the follow stays pending, which is the honest
   * state: the Creative tab says nothing under the post (outcomes only, never a visit, never a zero). The confirmation
   * crediting the follow and the line it brings are apps/ingest `post-outcomes.test.ts`, apps/api
   * `post-attribution.test.ts` and packages/modules `team-posts.test.tsx`.
   */
  test("a stranger opens a shared post's link and follows; the post says nothing until a real outcome is confirmed", async ({ page, browser }) => {
    test.setTimeout(420_000);
    const name = `Code Bikes ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);
    await setSocialOnBoard(page, bid, true);
    const pageAddress = await publishPage(page, bid);
    const post = (await teamPosts(page, bid, 1)).first();
    await post.getByRole("button", { name: "Share: A post about your page going live" }).click();
    const panel = page.getByTestId("share-post");
    await expect(panel).toBeVisible({ timeout: LONG });
    const x = new URL((await openLink(panel, "x").getAttribute("href"))!).searchParams.get("url")!;
    expect(x).toMatch(POST_CODE_LINK(pageAddress));
    const code = new URL(x).searchParams.get("via")!.slice(2);
    await panel.getByRole("button", { name: "Close" }).last().click();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const stranger = await context.newPage();
      const beacon = stranger.waitForRequest((r) => r.method() === "POST" && r.url().includes("publicPage.visited"), { timeout: LONG });
      const local = new URL(x);
      await stranger.goto(`${local.pathname}${local.search}`);
      expect((await beacon).postData() ?? "").toContain(`s.${code}`);
      expect((await context.cookies()).find((c) => c.name === "fm_post")).toMatchObject({ value: code, httpOnly: true, sameSite: "Lax" });
      const form = stranger.locator("form[data-project-follow]");
      await expect(form).toBeVisible({ timeout: LONG });
      await form.getByLabel("Your email", { exact: true }).fill(`code-follower-${Date.now().toString(36)}@example.com`);
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Follow" }).click();
      await expect(stranger.locator("[data-project-follow='done']").getByRole("status")).toHaveText(/^Check your email to confirm\./, { timeout: LONG });
      // Nothing on the page counts visits or follows.
      await expect(stranger.locator("body")).not.toContainText(/\bvisits?\b|\bvisitors?\b/i);
    } finally {
      await context.close();
    }

    // The founder: the follow is not confirmed, so nothing is credited and the post says nothing.
    const again = (await teamPosts(page, bid, 1)).first();
    await expect(again.getByTestId("post-outcomes")).toHaveCount(0);
    await expect(again).not.toContainText(/\bvisits?\b|Led to/);
  });
});
