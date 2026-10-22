import { expect, test, type Page } from "@playwright/test";
import { LONG, devApi, openBusiness, settingsScreen, settled, toast } from "./helpers";

/**
 * Anthropomorphic agents (founder, 2026-10-22): Settings › Preferences has a switch; on, every agent is named by a human
 * first name beside its position ("Malik (Chief of Staff)") and pictured with an AI-generated face; off, agents read
 * exactly as before. Runs on the seeded Northwind Skincare in mock mode (the mock image connector makes a placeholder
 * face). The dev founder is shared by every spec, so the account's choice found before is put back afterwards.
 * Stack and commands: e2e/README.md.
 */
type Guidance = { anthropomorphicAgents?: boolean };

/** "Malik (Chief of Staff)": a first name, then the position in brackets. */
const NAME_WITH_POSITION = /^[\p{L}]+ \(.+\)$/u;

async function setSwitch(page: Page, on: boolean): Promise<void> {
  await openBusiness(page, "settings/preferences");
  const toggle = settingsScreen(page).getByTestId("anthropomorphic-switch");
  await expect(toggle).toBeVisible({ timeout: LONG });
  await settled(page);
  const isOn = (await toggle.getAttribute("aria-checked")) === "true";
  if (isOn !== on) {
    await toggle.click();
    await expect(toast(page, on ? "Anthropomorphic agents on" : "Anthropomorphic agents off")).toBeVisible({ timeout: LONG });
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

async function openInbox(page: Page): Promise<void> {
  await openBusiness(page, "inbox");
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
}

test.describe("anthropomorphic agents", () => {
  let before = false;

  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.get("/trpc/founder.preferences.guidance");
    expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
    before = ((await res.json()) as { result: { data: { json: Guidance } } }).result.data.json.anthropomorphicAgents === true;
    const reset = await api.post("/trpc/founder.preferences.update", { data: { json: { anthropomorphicAgents: false } } });
    expect(reset.ok(), await reset.text()).toBe(true);
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.post("/trpc/founder.preferences.update", { data: { json: { anthropomorphicAgents: before } } });
    expect(res.ok(), await res.text()).toBe(true);
    await api.dispose();
  });

  test("off by default: the switch explains itself and the Inbox names agents as it always did", async ({ page }) => {
    await openBusiness(page, "settings/preferences");
    const screen = settingsScreen(page);
    const toggle = screen.getByTestId("anthropomorphic-switch");
    await expect(toggle).toBeVisible({ timeout: LONG });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(screen.getByTestId("anthropomorphic-panel")).toContainText("They are still AI agents");
    await expect(screen.getByTestId("anthropomorphic-panel")).toContainText("Off shows them by role.");

    await openInbox(page);
    await expect(page.getByTestId("row-sender")).toHaveCount(0);
  });

  test("on: an Inbox sender reads \"Name (Position)\" in the list and the reading pane; off brings back today's label", async ({ page }) => {
    await setSwitch(page, true);

    await openInbox(page);
    const sender = page.getByTestId("row-sender").first();
    await expect(sender, "the seed gives Northwind notes from agents with a persona").toBeVisible({ timeout: LONG });
    const label = (await sender.textContent())?.trim() ?? "";
    expect(label).toMatch(NAME_WITH_POSITION);
    const [, firstName, position] = /^([\p{L}]+) \((.+)\)$/u.exec(label)!;

    // The same label heads the reading pane, with no second role line repeating the position.
    await page.locator("[data-inbox-row]").filter({ has: page.getByTestId("row-sender") }).first().click();
    await expect(page.getByTestId("inbox-item-header")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("persona-link")).toHaveText(label);
    await expect(page.getByTestId("persona-role")).toHaveCount(0);

    // The agent's profile: the first name leads, the position stays, and the page says it is an AI agent.
    await page.getByTestId("persona-link").click();
    await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("agent-profile")).toContainText(firstName!);
    await expect(page.getByTestId("agent-profile")).toContainText(position!);
    await expect(page.getByTestId("agent-profile")).toContainText("AI agent");

    // Off: today's label.
    await setSwitch(page, false);
    await openInbox(page);
    await expect(page.getByTestId("row-sender")).toHaveCount(0);
    const rows = page.getByTestId("inbox-list").getByRole("option");
    await expect(rows.first()).toBeVisible({ timeout: LONG });
    await rows.first().click();
    await expect(page.getByTestId("inbox-item-header")).toBeVisible({ timeout: LONG });
    const link = page.getByTestId("persona-link");
    if ((await link.count()) > 0) await expect(link).not.toHaveText(NAME_WITH_POSITION);
  });

  test("on: the Team table shows first names, with the position in the Role column, and faces load once they are made", async ({ page }) => {
    await setSwitch(page, true);
    await openBusiness(page);
    const link = page.locator("[data-testid=app-shell] nav").getByRole("link", { name: /^team(,|$)/i }).first();
    await expect(link, "the seed gives Northwind a Team department").toBeVisible({ timeout: LONG });
    const base = (await link.getAttribute("href"))!.replace(/(\/d\/[^/]+)\/.*$/, "$1");
    await page.goto(`${base}/squad`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "team/squad", { timeout: LONG });
    // The Agent column shows first names, with the position in the Role column beside it: no brackets in the name.
    const names = page.getByRole("grid", { name: "Agents" }).locator("[data-entity-kind='agent']");
    await expect(names.first()).toBeVisible({ timeout: LONG });
    for (const text of await names.allTextContents()) expect(text).not.toMatch(/\(/);
    // The mock image connector makes a face for each persona; the page asks again every 15 seconds until they are ready.
    await expect.poll(async () => page.locator("img[data-avatar='photo']").count(), { timeout: 45_000, intervals: [1_000, 3_000, 5_000] }).toBeGreaterThan(0);
    await setSwitch(page, false);
  });
});
