import { test } from "@playwright/test";
import { signIn, LONG } from "./helpers";
test("probe", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/new/ideate");
  await page.waitForLoadState("networkidle", { timeout: LONG }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const out: unknown[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((e) => e.children.length < 3 && /^Speed to first customer$/.test((e.textContent||"").trim())).map((e) => e.closest("[data-attribute]") as HTMLElement ?? e).slice(0, 2)) {
      const chain: unknown[] = [];
      for (const e of [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))].filter((x) => !/cell-|w-6/.test(String(x.className)))) {
        const cs = getComputedStyle(e);
        chain.push({ tag: e.tagName, cls: e.className, cw: e.clientWidth, sw: e.scrollWidth, fs: cs.fontSize, fit: e.getAttribute("data-fit"), ov: cs.overflowX, w: e.getBoundingClientRect().width });
      }
      out.push({ text: el.textContent, chain });
    }
    return out;
  });
  console.log(JSON.stringify(info, null, 1)); console.log(await page.locator("[data-testid=concept-grid]").count());
});
