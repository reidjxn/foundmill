import { expect, test, type Page } from "@playwright/test";
import { devApi, LONG, NORTHWIND_BUSINESS_ID, signIn } from "./helpers";

/**
 * Nothing the founder reads is ever cut off (founder, 2026-10-09: "some buttons cut off text ... make sure the spacing
 * is perfect in every box and those overlapping scenarios never happen"). Every screen is measured at the two desktop
 * widths (1280, the minimum, and 1440, the reference) and the spec fails on:
 *
 * - a control (button, tab, radio card, menu item, table header, chip or pill) whose label overflows its box, or is cut
 *   with an ellipsis without the FitText last resort (`data-fit="truncated"`) and a tooltip carrying the full text;
 * - any truncated text that contains a number or a currency sign (numbers never truncate; they fit or reflow);
 * - an input adornment (icon, prefix, suffix, trailing control) overlapping the text area of its field;
 * - a table, or any region that scrolls sideways, whose content is wider than its box at the measured width: columns
 *   past the panel's edge behind a sideways scroll are hidden from the founder just as surely as a cut label. The only
 *   exceptions are regions marked `data-scroll-region` where scrolling is what the founder expects (code, diffs, the
 *   terminal, the task graph and the team diagram, a live preview).
 *
 * Long free text in a row (a note preview, a long name in a table cell) may still end in an ellipsis: that is a list
 * convention, not a clipped control.
 *
 * Dates change width with the person's date format (Settings › Preferences: "Oct 7, 2026", "7 Oct 2026", "2026-10-07",
 * "3:45 PM" or "15:45"). `E2E_DATE_FORMATS=us.12h,day_first.24h,iso.24h` measures every screen under each choice (the
 * dev founder's preference is set through the API for the run and put back after); the default measures US, 12-hour.
 */

const B = `/b/${NORTHWIND_BUSINESS_ID}`;
const FIXED_ROUTES = [
  `${B}/home`,
  `${B}/inbox`,
  `${B}/crm`,
  `${B}/milestones`,
  ...["business", "members", "departments", "mode", "integrations", "keys", "glossary", "billing", "preferences", "danger"].map((t) => `${B}/settings/${t}`),
  "/network",
  "/communities",
  "/leaderboards",
  "/onboarding",
  "/new",
  "/businesses",
  "/new/ideate",
  "/new/import",
];

interface Violation {
  kind: "control-clipped" | "number-truncated" | "input-overlap" | "table-overflow" | "scroll-overflow";
  text: string;
  where: string;
  px?: string;
}

/** Runs in the page: returns every violation on the current screen. */
function measure(): Violation[] {
  const out: Violation[] = [];
  const short = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const where = (el: Element) => {
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
      const id = (a as HTMLElement).dataset?.testid;
      if (id) return id;
    }
    return el.tagName.toLowerCase();
  };
  const CONTROL = 'button, [role=tab], [role=radio], [role=menuitem], [role=option], th, [role=columnheader], [data-chip], [data-status-pill]';
  const NUMBER = /[0-9£$€¥]|\bSEK\b|\bGBP\b|\bUSD\b|\bEUR\b/;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (el.closest("[aria-hidden=true], [data-fit-ghost], svg")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const text = short(el.textContent);
    if (!text) continue;
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
    const overflowing = el.scrollWidth > el.clientWidth + 1;
    if (!overflowing) continue;
    const ellipsis = cs.textOverflow === "ellipsis";
    const clips = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const control = el.closest(CONTROL);
    const fitTruncated = !!el.closest('[data-fit="truncated"]') && !!(el.closest("[title]") || el.closest("[aria-describedby]"));
    if ((ellipsis || clips) && (ownText || ellipsis) && el.children.length < 4) {
      if (NUMBER.test(text) && !el.closest("[data-allow-truncate]")) out.push({ kind: "number-truncated", text, where: where(el), px: `${el.clientWidth}<${el.scrollWidth}` });
      else if (control && !fitTruncated) out.push({ kind: "control-clipped", text, where: where(el), px: `${el.clientWidth}<${el.scrollWidth}` });
    } else if (control && el === control && cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 2) {
      out.push({ kind: "control-clipped", text, where: where(el), px: `${el.clientWidth}<${el.scrollWidth} (spills)` });
    }
  }
  for (const field of Array.from(document.querySelectorAll<HTMLElement>("[data-input-wrapper]"))) {
    const input = field.querySelector("input");
    if (!input) continue;
    const ir = input.getBoundingClientRect();
    const ics = getComputedStyle(input);
    const left = ir.left + parseFloat(ics.paddingLeft);
    const right = ir.right - parseFloat(ics.paddingRight);
    for (const part of Array.from(field.children)) {
      if (part === input || part.contains(input)) continue;
      const pr = part.getBoundingClientRect();
      if (!pr.width) continue;
      const overlap = Math.min(right, pr.right) - Math.max(left, pr.left);
      if (overlap > 0.5) out.push({ kind: "input-overlap", text: short(part.textContent) || "(icon)", where: input.id || input.getAttribute("aria-label") || where(field), px: `${Math.round(overlap)}px` });
    }
  }
  // Sideways overflow: a scrolling region (or a clipping box holding a table) whose content is wider than it is.
  const TABLE = "table, [role=grid], [role=table], [role=treegrid]";
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cs = getComputedStyle(el);
    const scrolls = cs.overflowX === "auto" || cs.overflowX === "scroll";
    const clipsTable = (cs.overflowX === "hidden" || cs.overflowX === "clip") && !!el.querySelector(TABLE);
    if (!scrolls && !clipsTable) continue;
    if (el.scrollWidth <= el.clientWidth + 2) continue;
    if (el.closest("[data-scroll-region], [aria-hidden=true], [data-fit-ghost]") || el.querySelector(":scope > [data-scroll-region]")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || cs.visibility === "hidden" || cs.display === "none") continue;
    const table = el.matches(TABLE) ? el : el.querySelector<HTMLElement>(TABLE);
    const name = table?.getAttribute("aria-label") ?? table?.closest("[data-datatable]")?.querySelector("h2")?.textContent ?? "";
    out.push({ kind: table ? "table-overflow" : "scroll-overflow", text: short(name || el.textContent), where: where(el), px: `${el.clientWidth}<${el.scrollWidth}` });
  }
  return out;
}

async function screensUnder(page: Page): Promise<string[]> {
  // Every department tab, one inbox note, one CRM record and one agent profile, found from the shell's own links.
  await page.goto(`${B}/home`);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  await page.waitForLoadState("networkidle", { timeout: LONG });
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
  const depts = [...new Set(hrefs.filter((h) => /\/d\/[^/]+\/[^/?#]+$/.test(h)))];
  const routes = new Set<string>(FIXED_ROUTES);
  for (const dept of depts) {
    await page.goto(dept);
    await page.waitForLoadState("networkidle", { timeout: LONG });
    const tabs = await page.$$eval('[role=tablist] a[href], nav a[href*="/d/"]', (as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const t of tabs) if (t.startsWith(`${dept.split("/d/")[0]}/d/${dept.split("/d/")[1]!.split("/")[0]}/`)) routes.add(t.split("?")[0]!);
    routes.add(dept);
  }
  const inboxItem = hrefs.find((h) => /\/inbox\/[0-9a-f-]{36}$/.test(h));
  if (inboxItem) routes.add(inboxItem);
  const crmRecord = hrefs.find((h) => /\/crm\/[0-9a-f-]{36}\/overview$/.test(h));
  if (crmRecord) routes.add(crmRecord);
  return [...routes];
}

type DatePrefs = { date: string; time: string };
const DATE_FORMAT_RUNS: DatePrefs[] = (process.env.E2E_DATE_FORMATS ?? "us.12h")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [date = "us", time = "12h"] = s.split(".");
    return { date, time };
  });

async function setDatePrefs(playwright: Parameters<typeof devApi>[0], prefs: DatePrefs): Promise<DatePrefs> {
  const api = await devApi(playwright);
  const before = ((await (await api.get("/trpc/founder.preferences.get")).json()) as { result: { data: { json: DatePrefs } } }).result.data.json;
  const res = await api.post("/trpc/founder.preferences.update", { data: { json: prefs } });
  expect(res.ok(), await res.text()).toBe(true);
  await api.dispose();
  return before;
}

async function measureEveryScreen(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  const routes = await screensUnder(page);
  const found: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState("networkidle", { timeout: LONG }).catch(() => undefined);
    await page.waitForTimeout(600);
    const violations = await page.evaluate(measure);
    for (const v of violations) found.push(`${route} · ${v.kind} · ${v.where} · "${v.text}" ${v.px ?? ""}`);
  }
  expect(found, `${found.length} clipped or overlapping elements at ${width} px:\n${found.join("\n")}`).toEqual([]);
}

for (const prefs of DATE_FORMAT_RUNS) {
  const label = DATE_FORMAT_RUNS.length > 1 || prefs.date !== "us" || prefs.time !== "12h" ? ` (dates ${prefs.date}, ${prefs.time})` : "";
  for (const width of [1280, 1440]) {
    test(`no text is clipped and no field overlaps at ${width} px${label}`, async ({ page, playwright }) => {
      test.setTimeout(20 * 60_000);
      const before = await setDatePrefs(playwright, prefs);
      try {
        await measureEveryScreen(page, width);
      } finally {
        await setDatePrefs(playwright, before);
      }
    });
  }
}
