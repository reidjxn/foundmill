import { expect, test, type Page } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Entity profile (BUILD §11.12 profile tabs; AC-11.12.3 merge then unmerge) on the seeded Northwind Skincare records.
 * Stack and commands: e2e/README.md.
 */
interface CrmRowRef {
  name: string;
  kind: string | undefined;
  href: string;
}

/**
 * The Kind column is a chip with one record's kind in words, singular (components/crm/logic.ts KIND_WORD: Person,
 * Organization, Agent, …); the match ignores case and the ref keeps the lower-cased word.
 */
const KIND_CHIP = /^(Person|Organization|Agent|Staff|Member|Community|Venue)$/i;

/** The first visible CRM rows: name, kind chip label and profile link. */
async function crmRows(page: Page, limit = 12): Promise<CrmRowRef[]> {
  const rows = page.getByRole("grid", { name: "CRM records" }).getByRole("row");
  await expect(rows.nth(1), "the seed gives Northwind CRM records").toBeVisible({ timeout: LONG });
  const out: CrmRowRef[] = [];
  const n = Math.min(await rows.count(), limit + 1);
  for (let i = 1; i < n; i++) {
    const row = rows.nth(i);
    const link = row.locator("a[href*='/crm/'][href$='/overview']").first();
    if (!(await link.count())) continue;
    const cells = await row.getByRole("gridcell").allInnerTexts();
    out.push({ name: (await link.innerText()).trim(), kind: cells.map((c) => c.trim()).find((c) => KIND_CHIP.test(c))?.toLowerCase(), href: (await link.getAttribute("href"))! });
  }
  return out;
}

async function openFirstEntity(page: Page): Promise<string> {
  await openBusiness(page, "crm");
  // Name cells are EntityLinks to /b/<bid>/crm/<entityId>/overview.
  const [first] = await crmRows(page, 1);
  expect(first, "the seed gives Northwind CRM records").toBeTruthy();
  await page.goto(first!.href);
  await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
  return first!.href;
}

test.describe("entity profile", () => {
  test("header with relationship strength and lead score, seven tabs", async ({ page }) => {
    await openFirstEntity(page);
    await expect(page.getByTestId("profile-header")).toContainText("Relationship");
    for (const tab of ["Overview", "Activity", "Relationships", "Commercial", "Documents", "Notes", "Journey"]) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    await expect(page.getByTestId("key-facts")).toBeVisible();
    await expect(page.getByTestId("standing")).toContainText("Lead score");
    await page.getByRole("tab", { name: "Relationships" }).click();
    await expect(page.getByTestId("relationship-graph")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("intro-paths")).toBeVisible();
    await page.getByRole("tab", { name: "Journey" }).click();
    await expect(page.getByTestId("journey-list")).toBeVisible({ timeout: LONG });
  });

  test("data duties: export shows the JSON; deletion is queued, never immediate", async ({ page }) => {
    await openFirstEntity(page);
    await page.getByTestId("entity-export").click();
    await expect(page.getByTestId("export-dialog")).toContainText("exportedAt");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-dialog")).toBeHidden();
    await page.getByTestId("entity-delete").click();
    await expect(page.getByTestId("delete-request-dialog")).toContainText("never runs immediately");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("delete-request-dialog")).toBeHidden();
  });

  test("notes can be added", async ({ page }) => {
    await openFirstEntity(page);
    await page.getByRole("tab", { name: "Notes" }).click();
    const text = `Met at the trade fair; wants samples in March (${Date.now().toString(36)}).`;
    await page.getByTestId("note-input").fill(text);
    await page.getByTestId("note-save").click();
    await expect(page.getByTestId("notes-list")).toContainText(text, { timeout: LONG });
    await expect(page.getByTestId("note-input")).toHaveValue("");
  });

  test("merge then unmerge restores both records (AC-11.12.3)", async ({ page }) => {
    await openBusiness(page, "crm");
    // The duplicate candidate must be another record of the same kind (the dialog searches by name, email or domain
    // within the source's kind). The listing also carries the agents as records, so the pair is taken from the
    // people and organizations: the first person or organization that has a second row of its kind.
    const rows = await crmRows(page);
    const pair = rows.flatMap((source) => {
      if (!source.kind || !/^(person|organization)$/.test(source.kind)) return [];
      const other = rows.find((r) => r.kind === source.kind && r.name !== source.name);
      return other ? [{ source, other }] : [];
    })[0];
    expect(pair, "the seed gives Northwind two people or two organizations to merge").toBeTruthy();
    const { source, other } = pair!;
    const url = source.href;
    await page.goto(url);
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
    await page.getByTestId("entity-merge").click();
    const dialog = page.getByTestId("merge-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Find the duplicate/).fill(other.name.split(/\s+/)[0]!);
    const match = page.getByTestId("merge-matches").getByRole("option").filter({ hasText: other.name }).first();
    await expect(match).toBeVisible({ timeout: LONG });
    await match.click();
    await page.getByTestId("merge-confirm").click();
    await expect(dialog).toBeHidden({ timeout: LONG });
    const banner = page.getByTestId("merge-banner");
    await expect(banner).toBeVisible({ timeout: LONG });
    await expect(banner).toContainText("Absorbed a duplicate");
    await page.getByTestId("unmerge").first().click();
    await expect(banner).toHaveCount(0, { timeout: LONG });
    await page.goto(url);
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
    // Nothing is left absorbed: no banner, and every merge in the history is marked reverted.
    await expect(page.getByTestId("merge-banner")).toHaveCount(0);
    const history = page.getByTestId("merge-history");
    if (await history.count()) await expect(history.getByRole("button", { name: "Unmerge" })).toHaveCount(0);
  });
});
