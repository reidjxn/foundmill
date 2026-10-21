import { test } from "@playwright/test";
import { signIn, LONG } from "./helpers";
test("probe", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/new/ideate");
  await page.waitForLoadState("networkidle", { timeout: LONG }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const snap = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".fit-box")).slice(0, 400).map((b) => { const r = b.getBoundingClientRect(); const t = b.querySelector<HTMLElement>(".fit-text")!.getBoundingClientRect(); const p = b.parentElement!; return [Math.round(r.x*10), Math.round(r.y*10), Math.round(r.width*10), Math.round(r.height*10), Math.round(t.y*10), Math.round(t.height*10), p.scrollWidth - p.clientWidth, b.getAttribute("data-fit")].join(","); }));
  const before = await snap();
  await page.addStyleTag({ content: ".fit-ghost{overflow-x:clip}" });
  await page.waitForTimeout(800);
  const after = await snap();
  let diffs = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { diffs++; if (diffs < 15) console.log(before[i], "=>", after[i]); }
  console.log("boxes", before.length, "diffs", diffs);
});
