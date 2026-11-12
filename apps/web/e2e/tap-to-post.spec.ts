import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, settled, toast } from "./helpers";

/**
 * Tap-to-post (docs/NETWORK.md F3; docs/DESIGN.md §9e; founder, Nov 12, 2026): for a drafted post, one control per
 * network that opens that network's own share window with the text and the link filled in. A throwaway project
 * publishes its page; Product › Public page offers "Share your page" and Plan › Milestones offers "Share" on a
 * milestone that is on the page. The panel's links are checked as links (host, text, the address with `via`) and are
 * never followed: nothing here opens a real network. Changing the text changes every link. The Channel Board shows the
 * social channel as available with the sentence that says what that means. Stack and commands: e2e/README.md.
 */
/** With `E2E_UX_AUDIT=1` the share panel is also saved as docs/ux-audit/53-share-panel.png. */
const AUDIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/ux-audit");
const PITCH = "Bike repairs at your door, booked in a minute";
const ABOUT = "A van full of parts comes to the bike and fixes it where it stands.";
const BY_TAP = "You post each one with one press: the text and link are filled in for you.";

/** The networks whose window opens with the text and the link, and how each carries them. */
const TAP = [
  { network: "x", label: "X", host: "x.com", path: "/intent/post", linkParam: "url" },
  { network: "threads", label: "Threads", host: "www.threads.com", path: "/intent/post", linkParam: "url" },
  { network: "bluesky", label: "Bluesky", host: "bsky.app", path: "/intent/compose", linkParam: null },
] as const;
const LINK_ONLY = [
  { network: "linkedin", host: "www.linkedin.com", path: "/sharing/share-offsite/", param: "url" },
  { network: "facebook", host: "www.facebook.com", path: "/sharer/sharer.php", param: "u" },
  { network: "reddit", host: "www.reddit.com", path: "/submit", param: "url" },
] as const;

const openLink = (panel: Locator, network: string) => panel.locator(`a[data-share-open="${network}"]`);

/** Every "opens ready to post" link: the network's own https host, the text and the link as that network takes them, a new tab. */
async function expectTapLinks(panel: Locator, text: string, link: string): Promise<void> {
  const group = panel.locator('[data-share-group="tap"]');
  await expect(group.getByRole("heading", { name: "Opens ready to post" })).toBeVisible();
  await expect(group.locator("[data-share-network]")).toHaveCount(TAP.length);
  for (const t of TAP) {
    const a = openLink(panel, t.network);
    await expect(a).toHaveText(t.label);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", "noopener noreferrer");
    const href = (await a.getAttribute("href"))!;
    const url = new URL(href);
    expect(url.protocol, t.network).toBe("https:");
    expect(url.host, t.network).toBe(t.host);
    expect(url.pathname, t.network).toBe(t.path);
    // Encoded: nothing of the text or the link is raw in the address.
    expect(href.slice(href.indexOf("?") + 1), t.network).toMatch(/^(?:[a-z]+=(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})+&?)+$/);
    if (t.linkParam) {
      expect([...url.searchParams.keys()], t.network).toEqual(["text", t.linkParam]);
      expect(url.searchParams.get("text"), t.network).toBe(text);
      expect(url.searchParams.get(t.linkParam), t.network).toBe(link);
    } else {
      expect([...url.searchParams.keys()], t.network).toEqual(["text"]);
      expect(url.searchParams.get("text"), t.network).toBe(`${text}\n\n${link}`);
    }
  }
}

async function expectLinkOnly(panel: Locator, link: string): Promise<void> {
  const group = panel.locator('[data-share-group="link_only"]');
  await expect(group.getByRole("heading", { name: "Opens with your link" })).toBeVisible();
  await expect(group.getByText("Opens with your link; the text is not carried.")).toBeVisible();
  for (const t of LINK_ONLY) {
    const url = new URL((await openLink(panel, t.network).getAttribute("href"))!);
    expect(url.protocol + url.host + url.pathname, t.network).toBe(`https:${t.host}${t.path}`);
    expect(url.searchParams.get(t.param), t.network).toBe(link);
  }
  // LinkedIn and Facebook carry the link alone; Reddit a title too, and says the community is the founder's to pick.
  expect([...new URL((await openLink(panel, "linkedin").getAttribute("href"))!).searchParams.keys()]).toEqual(["url"]);
  expect([...new URL((await openLink(panel, "facebook").getAttribute("href"))!).searchParams.keys()]).toEqual(["u"]);
  await expect(panel.locator('[data-share-network="reddit"]')).toContainText("Opens with your title and link. You choose the community there.");
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
  // Not offered while nothing is live.
  await expect(page.getByTestId("page-share")).toHaveCount(0);
  await editor.getByLabel(/One-line pitch/).fill(PITCH);
  await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
  await editor.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByTestId("page-confirm-publish").click();
  await expect(page.getByTestId("page-state")).toHaveText(/Live since [A-Z][a-z]{2} \d{1,2}, \d{4}/, { timeout: LONG });
  return (await page.getByTestId("page-url").innerText()).trim();
}

test.describe("tap-to-post", () => {
  test("share the page and a milestone: every network's link is ready, follows the text, and the Board says social is yours to post", async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    const name = `Tap Bikes ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);
    const pageAddress = await publishPage(page, bid);
    const origin = new URL(pageAddress).origin;
    const slug = new URL(pageAddress).pathname.replace("/p/", "");
    expect(slug).toMatch(/^[a-z0-9-]{3,40}$/);
    const pageLink = `${origin}/p/${slug}?via=p.${slug}`;

    // Product › Public page: "Share your page", beside Copy link and Open.
    const address = page.getByTestId("page-address");
    await expect(address.getByRole("button", { name: "Copy link" })).toBeVisible();
    const sharePage = address.getByRole("button", { name: "Share your page" });
    await expect(sharePage).toBeVisible();
    await sharePage.click();
    const panel = page.getByTestId("share-post");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel.getByRole("heading", { name: "Share your page" })).toBeVisible();
    const pageText = `${name}: ${PITCH}.`;
    await expect(panel.getByRole("textbox", { name: "Text" })).toHaveValue(pageText);
    await expect(panel.locator("[data-share-link]")).toHaveText(pageLink);
    await expectTapLinks(panel, pageText, pageLink);
    await expectLinkOnly(panel, pageLink);
    // The networks that take no ready-made post: the text to copy and the page's own share image.
    const copyGroup = panel.locator('[data-share-group="copy"]');
    await expect(copyGroup.getByRole("heading", { name: "Copy and post in the app" })).toBeVisible();
    await expect(copyGroup.locator("[data-share-network]")).toHaveCount(2);
    await expect(panel.locator('a[data-share-image="instagram"]')).toHaveAttribute("href", `${origin}/p/${slug}/opengraph-image`);
    // Sending to someone is apart from the networks.
    const messages = panel.locator('[data-share-group="message"]');
    await expect(messages.getByRole("heading", { name: "Send to someone" })).toBeVisible();
    expect(new URL((await messages.locator('a[data-share-message="whatsapp"]').getAttribute("href"))!).host).toBe("wa.me");
    expect(new URL((await messages.locator('a[data-share-message="telegram"]').getAttribute("href"))!).host).toBe("t.me");
    if (process.env.E2E_UX_AUDIT) await panel.screenshot({ path: path.join(AUDIT_DIR, "53-share-panel.png") });
    // How much of each limit is used, as words; honest at the foot; nothing says "posted".
    await expect(panel.locator('[data-share-count="x"]')).toHaveText(`${pageText.length + 25} of 280`);
    await expect(panel.locator("[data-share-honest]")).toHaveText("Foundmill posts nothing for you. Each button opens that network's own window, and you press Post there.");
    await expect(panel).not.toContainText(/\b(posted|published)\b/i);
    // No logos, no pictures of networks: a word and an icon.
    await expect(panel.locator("img")).toHaveCount(0);

    // Changing the text changes every link, with characters that need encoding; the link itself never changes.
    const edited = `Open today: 50% off & free tea? "Yes" #1\nCome by.`;
    await panel.getByRole("textbox", { name: "Text" }).fill(edited);
    await expectTapLinks(panel, edited, pageLink);
    await expectLinkOnly(panel, pageLink);
    await expect(panel.locator("[data-share-link]")).toHaveText(pageLink);
    // Far too long for the short networks: shortened there, at a word, and said in words.
    const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
    await panel.getByRole("textbox", { name: "Text" }).fill(long);
    const xUrl = new URL((await openLink(panel, "x").getAttribute("href"))!);
    const xText = xUrl.searchParams.get("text")!;
    expect(xText.endsWith("…")).toBe(true);
    expect(long.startsWith(xText.slice(0, -1))).toBe(true);
    expect(xText.length).toBeLessThanOrEqual(255);
    expect(xUrl.searchParams.get("url")).toBe(pageLink);
    await expect(panel.locator('[data-share-count="x"]')).toHaveText(/^\d+ of 280, shortened to fit$/);
    await expect(panel.locator('[data-share-count="instagram"]')).not.toContainText("shortened");

    // "Copy link" copies the address with its via, and says so; the page's own fields are untouched by any of this.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
    await panel.getByRole("button", { name: "Copy link" }).click();
    await expect(panel.locator("[data-share-said]")).toHaveText("Link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pageLink);
    await panel.getByRole("button", { name: "Close" }).last().click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("public-page-editor").getByLabel(/One-line pitch/)).toHaveValue(PITCH);
    // Nothing was saved: opened again, the panel starts from the page's own words.
    await sharePage.click();
    await expect(panel.getByRole("textbox", { name: "Text" })).toHaveValue(pageText);
    await panel.getByRole("button", { name: "Close" }).last().click();

    // Plan › Milestones: show "Page live", then Share beside "Copy card link".
    await page.goto(`/b/${bid}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    const live = page.locator("[data-trophy='page_live']");
    await expect(live).toHaveAttribute("data-achieved", "true", { timeout: LONG });
    // Not offered on a milestone that is not on the page.
    await expect(page.locator("[data-trophy-share-post]")).toHaveCount(0);
    await live.getByRole("button", { name: "Show on your page: Page live" }).click();
    const onPage = live.locator("[data-trophy-on-page='shown']");
    await expect(onPage).toContainText("On your page", { timeout: LONG });
    await expect(toast(page, "On your page")).toBeVisible({ timeout: LONG });
    await onPage.getByRole("button", { name: "Copy card link: Page live" }).click();
    await expect(toast(page, "Card link copied")).toBeVisible({ timeout: LONG });
    const cardAddress = await page.evaluate(() => navigator.clipboard.readText());
    expect(cardAddress).toMatch(/\/m\/[0-9a-f-]{36}$/);
    const cardLink = `${cardAddress}?via=p.${slug}`;
    const shareMilestone = onPage.getByRole("button", { name: "Share: Page live" });
    await expect(shareMilestone).toHaveText("Share");
    await expect(page.locator("[data-trophy-share-post]")).toHaveCount(1);
    await shareMilestone.click();
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel.getByRole("heading", { name: "Share “Page live”" })).toBeVisible();
    const milestoneText = `${name} reached a milestone: Page live.`;
    await expect(panel.getByRole("textbox", { name: "Text" })).toHaveValue(milestoneText);
    await expect(panel.locator("[data-share-link]")).toHaveText(cardLink);
    await expectTapLinks(panel, milestoneText, cardLink);
    await expectLinkOnly(panel, cardLink);
    // The tall picture for a story post, from the card's own address.
    await expect(panel.locator('a[data-share-image="instagram"]')).toHaveAttribute("href", `${cardAddress}/story-image`);
    await panel.getByRole("textbox", { name: "Text" }).fill("The page is up. Come and look.");
    await expectTapLinks(panel, "The page is up. Come and look.", cardLink);
    await panel.getByRole("button", { name: "Close" }).last().click();
    await expect(panel).toHaveCount(0);

    // The Channel Board: social is available, in the founder's words.
    await page.goto(`/b/${bid}/d/distribution/formation`);
    const screen = page.getByTestId("module-screen");
    await expect(screen).toBeVisible({ timeout: LONG });
    await expect(screen).toHaveAttribute("data-module", "distribution/formation");
    await expect(screen.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: LONG });
    await dismissCoachmarks(page);
    const board = page.getByRole("region", { name: "Channel Board" });
    await expect(board).toBeVisible({ timeout: LONG });
    await expect(board.getByRole("button", { name: /^Social media/ })).toBeVisible();
    const byTap = page.getByTestId("board-by-tap").locator('[data-channel="social"]');
    await expect(byTap).toContainText("Social media");
    await expect(byTap).toContainText(BY_TAP);
    // It is not listed among the channels that are not available.
    await expect(page.locator('[data-channel-unavailable="social"]')).toHaveCount(0);
  });
});
