import { readFile } from "node:fs/promises";
import { expect, test, type Download } from "@playwright/test";
import { LONG, commitThrowaway, openBusiness, openSettings, settingsScreen } from "./helpers";

/**
 * Settings › Danger zone (BUILD §11.15): Export everything saves a JSON file holding every table of the business; an
 * archived business is listed for its owner under Your businesses › Archived businesses (and on /new), where it can be
 * exported and restored. The archive test commits a throwaway business so the seeded ones are never archived. Stack and commands:
 * e2e/README.md. The tab's own content is looked up through `settingsScreen` (React parks a second copy of a streamed
 * screen outside the shell for a moment, helpers.ts); the confirmation dialog is a portal and is looked up on the page.
 */

async function archiveJson(download: Download): Promise<{ format: string; business: { id: string }; tables: Record<string, unknown[]>; counts: Record<string, number> }> {
  const path = await download.path();
  return JSON.parse(await readFile(path!, "utf8")) as Awaited<ReturnType<typeof archiveJson>>;
}

test.describe("settings › danger zone", () => {
  test("Export everything saves a JSON file with every table, and the Inbox note names it", async ({ page }) => {
    const bid = await openBusiness(page, "settings/danger");
    const screen = settingsScreen(page);
    await expect(screen.getByTestId("danger-zone")).toBeVisible({ timeout: LONG });
    // Archive and delete each carry their consequence, cost and reversibility under the button (UX plan §6.2, principle 6).
    const archiveLine = screen.getByTestId("archive-consequence");
    await expect(archiveLine).toContainText("Restore it from Your businesses.");
    await expect(archiveLine).toContainText("No cost");
    await expect(archiveLine.locator("[data-consequence-reversible]")).toHaveAttribute("data-consequence-reversible", "true");
    const deleteLine = screen.getByTestId("delete-consequence");
    await expect(deleteLine).toContainText("Not reversible");
    await expect(deleteLine.locator("[data-consequence-reversible]")).toHaveAttribute("data-consequence-reversible", "false");
    const downloading = page.waitForEvent("download", { timeout: LONG });
    await screen.getByTestId("export-everything").click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/-export-\d{4}-\d{2}-\d{2}\.json$/);
    const archive = await archiveJson(download);
    expect(archive.format).toBe("foundmill-export/2");
    expect(archive.business.id).toBe(bid);
    for (const table of ["tasks", "entities", "transactions", "agent_messages", "usage_ledger", "audit_log"]) expect(Object.keys(archive.tables)).toContain(table);
    expect(archive.counts.transactions).toBe(archive.tables.transactions!.length);
    expect(Object.keys(archive.tables)).not.toContain("credentials");
    await expect(screen.getByTestId("export-file-name")).toHaveText(download.suggestedFilename());
    // A blocked or lost download can be saved again without exporting again.
    const again = page.waitForEvent("download", { timeout: LONG });
    await screen.getByTestId("export-save-again").click();
    expect((await again).suggestedFilename()).toBe(download.suggestedFilename());
  });

  test("archive a business, find it under Archived businesses, export it there and restore it", async ({ page }) => {
    test.setTimeout(240_000);
    const name = `Archive ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);
    const screen = await openSettings(page, "danger", bid);
    await expect(screen.getByTestId("danger-zone")).toBeVisible({ timeout: LONG });
    await expect(screen.getByTestId("danger-zone")).toContainText("Your businesses › Archived businesses");
    await screen.getByRole("button", { name: `Archive ${name}` }).click();
    // The dialog repeats the consequence line before the choice.
    await expect(page.getByRole("dialog").locator("[data-consequence]")).toContainText("Reversible");
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();

    // Off to Your businesses, where the owner finds it.
    await page.waitForURL(/\/businesses#archived$/, { timeout: LONG });
    await expect(page.locator(`[data-business-row="${bid}"]`)).toHaveCount(0);
    const row = page.locator(`[data-archived-business="${bid}"]`);
    await expect(row).toBeVisible({ timeout: LONG });
    await expect(row).toContainText(name);
    const downloading = page.waitForEvent("download", { timeout: LONG });
    await row.getByTestId("archived-export").click();
    const archive = await archiveJson(await downloading);
    expect(archive.business.id).toBe(bid);
    expect(archive.counts.agents).toBeGreaterThan(0);

    await row.getByTestId("archived-restore").click();
    await page.waitForURL(new RegExp(`/b/${bid}/home`), { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.goto("/businesses");
    await expect(page.locator(`[data-business-row="${bid}"]`)).toBeVisible({ timeout: LONG });
    await expect(page.locator(`[data-archived-business="${bid}"]`)).toHaveCount(0);
    await page.goto("/new");
    await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
    await expect(page.locator(`[data-archived-business="${bid}"]`)).toHaveCount(0);
  });
});
