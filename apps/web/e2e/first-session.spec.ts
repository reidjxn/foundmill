import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, expectTapTarget, settled } from "./helpers";

/**
 * The first session (docs/holistic-plan/WP-04-the-first-session.md, Done-when 1), from Today to a published `/p/<slug>`
 * at 390 x 844 and at 1440 x 900, with `needs-larger-window` never on the path. T6's part: Today's "Check it and
 * publish" opens Product › Public page in the shell's phone layout (no department tab bar, the tab's name as the title,
 * Back to Today), the form and the preview in one column, Publish behind its confirmation, and then, on a phone, the
 * share panel in place with the ask and the link; on a desktop the buttons stay and "Copy message" holds the same words.
 * The kept card, the three questions and Commit as name and go come before Today here once WP-04 T1 and T2 land; until
 * then the project is started through today's Commit form, at desktop width, before the window is resized.
 */
const PITCH = "Bike repairs at your door, booked in a minute";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function signedOutStatus(browser: Browser, pagePath: string): Promise<number | undefined> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  try {
    const res = await (await context.newPage()).goto(pagePath);
    return res?.status();
  } finally {
    await context.close();
  }
}

for (const size of [
  { width: 390, height: 844, phone: true },
  { width: 1440, height: 900, phone: false },
]) {
  test(`at ${size.width} x ${size.height}: Today, check the page, publish it, share it; the page answers signed out`, async ({ page, browser }) => {
    test.setTimeout(240_000);
    const name = `First Bikes ${size.width} ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);
    await page.setViewportSize({ width: size.width, height: size.height });
    // Never the larger-window ask on the path: counted on every screen of it.
    const notWalled = () => expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    // Today: the Product lead's note asks for the page; its one tap opens the tab.
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await notWalled();
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
    await notWalled();
    const preview = page.getByTestId("public-page-preview");
    if (size.phone) {
      await expect(page.getByTestId("app-shell")).toHaveAttribute("data-phone", "");
      // The phone frame: the tab's name as the title, no tab bar (every other tab asks for a larger window), a way back.
      await expect(page.getByTestId("phone-screen-title")).toHaveText("Public page");
      await expect(page.getByTestId("phone-tabs")).toHaveCount(0);
      await expectTapTarget(page.getByTestId("phone-back-to-today"), "Back to Today");
      // One column: the preview under the form, both the width of the screen.
      const e = (await editor.boundingBox())!;
      const p = (await preview.boundingBox())!;
      expect(e.width).toBeGreaterThan(size.width - 40);
      expect(p.y).toBeGreaterThan(e.y + e.height - 1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    } else {
      await expect(page.getByTestId("app-shell")).not.toHaveAttribute("data-phone", "");
      await expect(page.getByRole("tablist").first().getByRole("tab", { name: "Public page" })).toBeVisible();
      await expect(page.getByTestId("phone-back-to-today")).toHaveCount(0);
    }

    // Check it: the team's draft is already in the fields (the founder changes the pitch), then publish behind the confirmation.
    await expect(editor.getByLabel(/One-line pitch/)).not.toHaveValue("");
    await editor.getByLabel(/One-line pitch/).fill(PITCH);
    const publish = editor.getByRole("button", { name: "Publish", exact: true });
    if (size.phone) await expectTapTarget(publish, "Publish");
    await publish.click();
    const confirm = page.getByRole("dialog", { name: "Publish your public page?" });
    await expect(confirm).toBeVisible();
    await confirm.getByTestId("page-confirm-publish").click();
    await expect(page.getByTestId("page-state")).toHaveText(/Live since/, { timeout: LONG });
    await notWalled();
    const url = (await page.getByTestId("page-url").innerText()).trim();
    const pagePath = new URL(url).pathname;
    expect(pagePath).toMatch(/^\/p\/[a-z0-9-]{3,40}$/);
    const slug = pagePath.replace("/p/", "");
    const link = `${new URL(url).origin}${pagePath}?via=p.${slug}`;
    const ask = `I'm starting ${name}. ${PITCH}. Would you use this?`;

    if (size.phone) {
      // The share panel opens in place: the ask, the link, and the device's own share sheet where there is one.
      const panel = page.getByRole("dialog", { name: "Send your page to three people" });
      await expect(panel).toBeVisible({ timeout: LONG });
      await expect(panel.getByRole("textbox", { name: "Text" })).toHaveValue(ask);
      await expect(panel.locator("[data-share-link]")).toHaveText(link);
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      await panel.getByRole("button", { name: "Close" }).last().click();
      await expect(panel).toHaveCount(0);
      for (const label of ["Copy link", "Copy message", "Share your page"]) await expectTapTarget(page.getByTestId("page-address").getByRole("button", { name: label }), label);
    } else {
      // A desktop keeps today's buttons; nothing opens by itself, and Copy message holds the same words.
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const address = page.getByTestId("page-address");
      await expect(address.getByRole("button", { name: "Copy link" })).toBeVisible();
      await expect(address.getByRole("button", { name: "Share your page" })).toBeVisible();
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
      await address.getByRole("button", { name: "Copy message" }).click();
      await expect(address.getByRole("button", { name: "Message copied" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ask}\n\n${link}`);
    }

    // The page is live for anyone with the link.
    expect(await signedOutStatus(browser, pagePath)).toBe(200);

    if (size.phone) {
      // Back to Today works; every other department tab still asks for a larger window on a phone.
      await page.getByTestId("phone-back-to-today").click();
      await expect(page).toHaveURL(new RegExp(`/b/${bid}/today$`));
      await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
      await notWalled();
      await page.goto(page.url().replace(/\/today$/, "/crm"));
      await expect(page.getByTestId("needs-larger-window")).toBeVisible({ timeout: LONG });
    }
  });
}
