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
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-attribute-hint]")).slice(0, 12)) {
      const chain: unknown[] = [];
      for (const e of [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))]) {
        const cs = getComputedStyle(e);
        chain.push({ tag: e.tagName, cls: e.className, cw: e.clientWidth, sw: e.scrollWidth, fs: cs.fontSize, fit: e.getAttribute("data-fit"), ov: cs.overflowX, w: e.getBoundingClientRect().width });
      }
      out.push({ text: el.textContent, chain });
    }
    return out;
  });
  console.log(JSON.stringify(info.filter((i: any) => /Speed/.test(i.text)).slice(0, 2), null, 1));
});
