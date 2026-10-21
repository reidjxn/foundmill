import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/**
 * The shell's chrome in the 2027 look (DESIGN §7, §8): the top bar never clips at the 1280 minimum (the search gives
 * way first), the tab bar's lit bar sits under the active tab and slides, the command palette finds the business by its
 * name, and overlays that portal to the body take the business's brand colour. Stack and commands: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;
/** The stream's endpoint, as playwright.config.ts hands it to the web app. */
const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL ?? "ws://localhost:4003";

test.describe("shell chrome", () => {
  test("at 1280 the screen title and the chips keep their words; the search gives way first", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page, "settings/departments");
    const bar = page.getByTestId("kit-bar");
    await expect(bar).toBeVisible();
    const title = page.getByTestId("kitbar-screen-title");
    await expect(title).toContainText("Settings");
    // Nothing on the bar is cut: no element overflows its box, and the title is never at its last resort.
    const clipped = await bar.evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>("*"))
        // Visible, at least 2 px (visually hidden text such as Continue's " · " separator is 1 px by design).
        .filter((el) => !el.closest("[aria-hidden=true]") && el.getBoundingClientRect().width >= 2 && getComputedStyle(el).visibility !== "hidden")
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(el).overflowX))
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${el.clientWidth}<${el.scrollWidth}`),
    );
    expect(clipped).toEqual([]);
    await expect(title.locator("[data-fit-box]")).not.toHaveAttribute("data-fit", "truncated");
    // The search took only the room that was left: narrower than its 320 px, at least its icon.
    const search = (await page.getByTestId("kitbar-search").boundingBox())!;
    expect(search.width).toBeLessThan(320);
    expect(search.width).toBeGreaterThanOrEqual(34);
    // The chips sit inside the window.
    const stop = (await page.getByTestId("stop-all-trigger").boundingBox())!;
    expect(stop.x + stop.width).toBeLessThanOrEqual(1280);
  });

  test("at 1440 the search shows its whole placeholder; the chips' second phrase shows only while the search has its whole width", async ({ page }) => {
    // The bar as a founder normally sees it: the live connection up. This stack runs no stream service (README), so
    // without a stand-in the "Reconnecting…" chip joins the bar once its grace runs out, and by DESIGN §8 the search then
    // rightly gives way to its icon. The stand-in acknowledges every subscription (lib/stream.ts protocol) and answers pings.
    let businessLive = false;
    await page.routeWebSocket(
      (url) => url.href.startsWith(STREAM_URL),
      (ws) => {
        ws.onMessage((message) => {
          const frame = JSON.parse(String(message)) as { t?: string; ch?: string };
          if (frame.t === "sub" && frame.ch) {
            ws.send(JSON.stringify({ t: "subscribed", ch: frame.ch }));
            if (frame.ch === `ev:${NORTHWIND_BUSINESS_ID}`) businessLive = true;
          } else if (frame.t === "ping") ws.send(JSON.stringify({ t: "pong" }));
        });
      },
    );
    await openBusiness(page);
    await expect.poll(() => businessLive, { timeout: LONG }).toBe(true);
    await expect(page.getByTestId("connection-chip")).toHaveCount(0);
    const search = page.getByTestId("kitbar-search");
    await expect(search.getByText("Search or jump to…")).toBeVisible();
    const box = (await search.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(320.5);
    // The mode chip's "· asks before spending" is the first thing to give way (KitBarFit `chips-brief`): it is visible
    // exactly when the bar carries no compaction step, and the search never loses its placeholder to it.
    const bar = page.getByTestId("kit-bar");
    const brief = bar.locator("[data-chip-brief]");
    const compact = (await bar.getAttribute("data-compact")) ?? "";
    if (compact.includes("chips-brief")) await expect(brief).toBeHidden();
    else await expect(brief).toBeVisible();
  });

  test("the tab bar's lit bar sits under the active tab and moves with it", async ({ page }) => {
    await openBusiness(page, "inbox");
    const tabs = page.getByRole("tablist", { name: "Inbox tabs" });
    const indicator = tabs.locator("[data-tab-indicator]");
    await expect(indicator).toBeVisible({ timeout: LONG });
    // Both boxes are read on every poll: the strip can still reflow after the click (a count badge settling on a tab
    // to the left), and the indicator follows the tab, so a tab box read once before polling can go stale for good.
    const under = async (name: RegExp) => {
      await expect
        .poll(async () => {
          const tab = await tabs.getByRole("tab", { name }).boundingBox();
          const bar = await indicator.boundingBox();
          if (!tab || !bar) return false;
          return bar.x >= tab.x - 1 && bar.x + bar.width <= tab.x + tab.width + 1 && bar.width > 8;
        }, { timeout: LONG })
        .toBe(true);
    };
    await under(/^All/);
    await tabs.getByRole("tab", { name: /^Customers/ }).click();
    await expect(page).toHaveURL(/tab=customers/, { timeout: LONG });
    await under(/^Customers/);
  });

  test("the command palette finds the business by its name and takes the brand's colour", async ({ page }) => {
    await openBusiness(page, "inbox");
    // The document carries the business's brand while the shell is mounted, so the portaled palette is lit by it.
    const kit = await page.evaluate(() => document.documentElement.style.getPropertyValue("--kit-primary"));
    expect(kit).not.toBe("");
    await page.getByTestId("kitbar-search").click();
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    // Departments lead the list when nothing is typed (settings sit with the commands, last).
    await expect(palette.locator("[cmdk-group-heading]").first()).toHaveText(/Departments|Ask|Generate|Recent/);
    await page.getByRole("combobox").fill("north");
    await expect(palette.getByRole("option", { name: /Northwind Skincare/ })).toBeVisible({ timeout: LONG });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${B}/home`), { timeout: LONG });
  });
});
