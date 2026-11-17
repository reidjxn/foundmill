import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { LONG, chooseTableView, commitThrowaway, completeProfile, openBusiness, openSettings, signInAs } from "./helpers";

/**
 * Entity profile (BUILD §11.12 profile tabs; AC-11.12.3 merge then unmerge) on the seeded Northwind Skincare records.
 * A collaborator (who reads Customers, never Finance; the collaborator's walls, Nov 14, 2026): invited to a project of
 * the founder's own from Settings › People, a second account joins and its Commercial tab says the amounts are hidden,
 * from the api's own answer. A sample business takes no invitations, so a seeded paying customer is read with that same
 * answer (`amountMinor` null, `moneyHidden`): its payments are listed, each amount "—", and no money shows on the tab.
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
  // The open view is saved per person: an earlier spec may have left a sorted one open (By kind lists the agents first).
  await chooseTableView(page, "All");
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

/**
 * Presses one of a screen's top-right action buttons from the keyboard. Seeded Northwind has no finished cycle, so with
 * guidance on the first-Continue callout (UX plan §7.7) sits under Continue in the top bar, over the screen header's
 * right-hand actions (Export, Request deletion, New record). It is not modal and stays until "Got it", which marks the
 * tour done for the whole dev account (first-days.spec.ts and tours.spec.ts still expect it), so the button is focused
 * and pressed with Enter, as crm.spec.ts and billing.spec.ts do, rather than clicked through the callout's card.
 */
async function pressAction(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId);
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
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

  test("Re-watch opens the win's own replay (never 'No replay for this id'); Activity shows payments as money", async ({ page }) => {
    // A customer of the seed: its payment has a Customer Update, its older signup and activation may not.
    await openBusiness(page, "crm");
    await page.getByTestId("crm-search-input").fill("role:customer");
    await page.keyboard.press("Enter");
    const link = page.getByRole("grid", { name: "CRM records" }).getByRole("row").nth(1).getByRole("link").first();
    await expect(link).toBeVisible({ timeout: LONG });
    await link.click();
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
    await page.getByRole("tab", { name: "Journey" }).click();
    const list = page.getByTestId("journey-list");
    await expect(list).toBeVisible({ timeout: LONG });
    const rewatch = list.getByTestId("rewatch").last();
    if (await rewatch.count()) {
      await rewatch.click();
      await expect(page.getByTestId("journey-screen")).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("journey-not-found")).toHaveCount(0);
      await page.getByTestId("journey-back").click();
    }
    await page.getByRole("tab", { name: "Activity" }).click();
    const timeline = page.getByTestId("activity-timeline");
    await expect(timeline).toBeVisible({ timeout: LONG });
    // "35349.99 GBP" was the hand-rolled format; payments now read "£35,349.99".
    await expect(timeline).not.toContainText(/\d+\.\d{2} [A-Z]{3}\b/);
  });

  test("data duties: export shows the JSON; deletion is queued, never immediate", async ({ page }) => {
    await openFirstEntity(page);
    await pressAction(page, "entity-export");
    await expect(page.getByTestId("export-dialog")).toContainText("exportedAt");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-dialog")).toBeHidden();
    await pressAction(page, "entity-delete");
    await expect(page.getByTestId("delete-request-dialog")).toContainText("never runs immediately");
    // What the request does now and later (audit RA-23): outreach suppressed at once, the record purged by the nightly job.
    await expect(page.getByTestId("delete-request-dialog")).toContainText("Outreach to them stops now");
    await expect(page.getByTestId("delete-request-dialog")).toContainText("nightly, audited deletion job");
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

  test("a merge a later one relies on says which merge to undo first; undone newest first, both records return", async ({ page }) => {
    // Three new people: the kept one has no email, both duplicates have one, so the second merge keeps the first one's
    // email and relies on that merge.
    const tag = Date.now().toString(36);
    const kept = `Merge Kept ${tag}`;
    const first = `Merge First ${tag}`;
    const second = `Merge Second ${tag}`;
    const add = async (name: string, email?: string): Promise<string> => {
      await openBusiness(page, "crm");
      await pressAction(page, "crm-new");
      const dialog = page.getByTestId("new-entity-dialog");
      await expect(dialog).toBeVisible({ timeout: LONG });
      await dialog.getByLabel("Name").fill(name);
      if (email) await dialog.getByLabel("Email").fill(email);
      await page.getByTestId("new-entity-save").click();
      await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("profile-header")).toContainText(name);
      return page.url();
    };
    const firstUrl = await add(first, `first.${tag}@merge.example`);
    const secondUrl = await add(second, `second.${tag}@merge.example`);
    const keptUrl = await add(kept);
    const mergeIn = async (name: string) => {
      await page.getByTestId("entity-merge").click();
      const dialog = page.getByTestId("merge-dialog");
      await dialog.getByLabel(/Find the duplicate/).fill(name);
      await page.getByTestId("merge-matches").getByRole("option").filter({ hasText: name }).first().click();
      await page.getByTestId("merge-confirm").click();
      await expect(dialog).toBeHidden({ timeout: LONG });
    };
    await mergeIn(first);
    await mergeIn(second);

    const banner = page.getByTestId("merge-banner");
    await expect(banner.getByTestId("unmerge-blocked")).toContainText(`Undo the later merge of “${second}” first`, { timeout: LONG });
    await expect(banner.getByTestId("unmerge-blocked")).toContainText("the email");
    await expect(banner.getByTestId("unmerge")).toHaveCount(1);
    await banner.getByTestId("unmerge").click();
    await expect(banner.getByTestId("unmerge-blocked")).toHaveCount(0, { timeout: LONG });
    await banner.getByTestId("unmerge").click();
    await expect(page.getByTestId("merge-banner")).toHaveCount(0, { timeout: LONG });

    for (const [url, name] of [[firstUrl, first], [secondUrl, second], [keptUrl, kept]] as const) {
      await page.goto(url);
      await expect(page.getByTestId("profile-header")).toContainText(name, { timeout: LONG });
      await expect(page.getByTestId("merge-banner")).toHaveCount(0);
    }
  });
});


/** Every `crm.entity.get` answer in a tRPC response, as the api answers someone walled off Finance: no amounts, `moneyHidden`. */
function withoutAmounts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAmounts);
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  if (Array.isArray(o.conversions) && o.entity && typeof o.entity === "object") {
    return { ...o, moneyHidden: true, conversions: o.conversions.map((c) => ({ ...(c as object), amountMinor: null })) };
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, withoutAmounts(v)]));
}

test.describe("entity profile for a collaborator", () => {
  test("a collaborator who joined a project reads its Commercial tab with the amounts hidden; the owner reads them", async ({ page, browser }) => {
    test.setTimeout(300_000);
    // A project of the founder's own (a sample business takes no invitations), with a customer record.
    const bid = await commitThrowaway(page, "Collaborator Money Co");
    await page.goto(`/b/${bid}/crm`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await pressAction(page, "crm-new");
    const dialog = page.getByTestId("new-entity-dialog");
    await expect(dialog).toBeVisible({ timeout: LONG });
    await dialog.getByLabel("Name").fill("Wren Garza");
    await page.getByTestId("new-entity-save").click();
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
    const commercial = page.url().replace(/\/[a-z]+(\?.*)?$/, "/commercial");
    await page.goto(commercial);
    await expect(page.getByTestId("commercial-payments")).toBeVisible({ timeout: LONG });
    await expect(page.getByText("Hidden: your access does not include Finance")).toHaveCount(0);

    // A collaborator invitation, accepted by a second account.
    const people = await openSettings(page, "members", bid);
    const panel = people.getByTestId("invite-someone");
    await panel.getByLabel("Collaborator").check();
    await panel.getByTestId("invite-create").click();
    const invitation = new URL((await people.getByTestId("invite-link-value").textContent({ timeout: LONG }))!.trim()).pathname;
    const context = await browser.newContext();
    const theirs = await context.newPage();
    try {
      await signInAs(theirs, randomUUID(), invitation);
      await expect(theirs.getByTestId("invitation")).toHaveAttribute("data-state", "pending", { timeout: LONG });
      // A new account confirms it is 18 or older on the invitation (0100).
      await theirs.getByTestId("invitation-adult").getByRole("checkbox", { name: "I am 18 or older" }).check();
      await theirs.getByTestId("invitation-accept").click();
      // A new person is asked for a name on the invitation card (WP-12 T2); this case fills in the full profile instead.
      await expect(theirs.getByTestId("invitation-name")).toBeVisible({ timeout: LONG });
      await theirs.goto("/onboarding");
      await completeProfile(theirs);
      await theirs.goto(commercial);
      await expect(theirs.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
      await expect(theirs.getByTestId("commercial-payments")).toBeVisible({ timeout: LONG });
      // The api says the money is hidden for them (crm.entity.get `moneyHidden`): the tiles say so, no total of nothing.
      await expect(theirs.getByText("Hidden: your access does not include Finance").first()).toBeVisible({ timeout: LONG });
      await expect(theirs.getByTestId("entity-profile")).not.toContainText(/[€£$]\s?\d/);
    } finally {
      await context.close();
    }
  });

  test("a paying customer's payments, as a collaborator's answer carries them: listed, each amount \"—\", no money on the tab", async ({ page }) => {
    // The seed's sample business takes no invitations, so its paying customers are read with the api's answer for a
    // reader walled off Finance (amountMinor null, moneyHidden), which the test above gets from the api itself.
    await openBusiness(page, "crm");
    // Only the customers who have paid: the seed gives stage "customer" to a payer, "activated" or "signed_up" to the rest.
    await page.getByTestId("crm-search-input").fill("role:customer stage:customer");
    await page.keyboard.press("Enter");
    const grid = page.getByRole("grid", { name: "CRM records" });
    const rows = grid.getByRole("row");
    // The unfiltered list (newest first) shows until the filtered rows replace it: wait for the chips, then for every
    // row to be a paying customer, before collecting any.
    await expect(page.getByTestId("crm-search")).toContainText("stage:customer");
    await expect(rows.nth(1).getByRole("link").first()).toBeVisible({ timeout: LONG });
    await expect(grid.locator('td[data-col="roles"]').filter({ hasNotText: "Customer" })).toHaveCount(0, { timeout: LONG });
    await expect(grid.locator('td[data-col="stage"]').filter({ hasNotText: "Customer" })).toHaveCount(0, { timeout: LONG });
    const hrefs: string[] = [];
    for (let i = 1; i < Math.min(await rows.count(), 13); i++) {
      const href = await rows.nth(i).locator("a[href*='/crm/'][href$='/overview']").first().getAttribute("href").catch(() => null);
      if (href) hrefs.push(href.replace(/\/overview$/, "/commercial"));
    }
    // Each of them has paid: the first whose Commercial tab has loaded its payments.
    const payments = page.getByTestId("commercial-payments");
    let commercial = "";
    for (const href of hrefs) {
      await page.goto(href);
      await expect(payments).toBeVisible({ timeout: LONG });
      if ((await payments.getByTestId("payment-amount").count()) > 0) {
        commercial = href;
        break;
      }
    }
    expect(commercial, "the seed gives Northwind a paying customer").not.toBe("");
    await expect(payments.getByTestId("payment-amount").first()).toHaveText(/\d/, { timeout: LONG });
    const count = await payments.getByTestId("payment-amount").count();

    await page.route(/\/trpc\/[^?]*crm\.entity\.get/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: withoutAmounts(await response.json()) });
    });
    await page.goto(commercial);
    await expect(payments).toBeVisible({ timeout: LONG });
    await expect(payments.getByTestId("payment-amount")).toHaveCount(count, { timeout: LONG });
    for (const amount of await payments.getByTestId("payment-amount").all()) await expect(amount).toHaveText("—");
    await expect(page.getByText("Hidden: your access does not include Finance").first()).toBeVisible();
    await expect(page.getByTestId("entity-profile")).not.toContainText(/[€£$]\s?\d/);
    await page.goto(commercial.replace(/\/commercial$/, "/journey"));
    await expect(page.getByTestId("journey-list")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("journey-list")).toContainText("Payment");
    await expect(page.getByTestId("journey-list")).not.toContainText(/[€£$]\s?\d/);
  });
});
