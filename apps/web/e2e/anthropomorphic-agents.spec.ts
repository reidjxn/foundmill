import { expect, test, type Page } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, devApi, openBusiness, settingsScreen, settled, toast } from "./helpers";

/**
 * Anthropomorphic agents (founder, 2026-10-22; styles 2026-10-24): Settings › Preferences has a switch; on, every agent is
 * named by a first name beside its position ("Malik (Chief of Staff)") and pictured with an AI-generated face; off, agents
 * read exactly as before. With the switch on, a Style choice (Humans, 3D cartoon humans, 2D cartoon humans and animals,
 * Fantasy) picks which character each agent is: the same agent is "Malik" in Humans and a fantasy name in Fantasy, with
 * its position beside the name either way, and Humans brings the human name back. Runs on the seeded Northwind Skincare in
 * mock mode (the mock image connector makes a placeholder picture for every style). The dev founder is shared by every
 * spec, so the account's choice found before (switch and style) is put back afterwards.
 * Stack and commands: e2e/README.md.
 */
type Style = "humans" | "cartoon_3d" | "cartoon_2d" | "fantasy";
type Guidance = { anthropomorphicAgents?: boolean; agentStyle?: Style };

/** The radio card's name for each style (AGENT_STYLE_META labels). */
const STYLE_LABEL: Record<Style, string> = { humans: "Humans", cartoon_3d: "3D cartoon humans", cartoon_2d: "2D cartoon humans and animals", fantasy: "Fantasy" };

/** "Malik (Chief of Staff)": a first name, then the position in brackets. */
const NAME_WITH_POSITION = /^[\p{L}]+ \(.+\)$/u;

/** A name of any script or punctuation ("Mal'Kor"), then the position in brackets. */
const ANY_NAME_WITH_POSITION = /^(.+?) \((.+)\)$/u;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function setSwitch(page: Page, on: boolean): Promise<void> {
  await openBusiness(page, "settings/preferences");
  const toggle = settingsScreen(page).getByTestId("anthropomorphic-switch");
  await expect(toggle).toBeVisible({ timeout: LONG });
  await settled(page);
  const isOn = (await toggle.getAttribute("aria-checked")) === "true";
  if (isOn !== on) {
    await toggle.click();
    // On names the style that is in force (the account's, Humans after the reset in beforeAll).
    await expect(toast(page, on ? /^Anthropomorphic agents on: .+$/ : "Anthropomorphic agents off")).toBeVisible({ timeout: LONG });
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

/** Switches the faces on and chooses a style in Settings › Preferences; the toast names it. */
async function chooseStyle(page: Page, style: Style): Promise<void> {
  await setSwitch(page, true);
  const card = settingsScreen(page).getByRole("radio", { name: STYLE_LABEL[style], exact: true });
  await expect(card).toBeVisible({ timeout: LONG });
  if ((await card.getAttribute("aria-checked")) !== "true") {
    await card.click();
    await expect(toast(page, `Anthropomorphic agents on: ${STYLE_LABEL[style]}`)).toBeVisible({ timeout: LONG });
  }
  await expect(card).toHaveAttribute("aria-checked", "true");
}

/** The first Inbox sender's label ("Name (Position)") with the account's style as it is now. */
async function firstSenderLabel(page: Page): Promise<string> {
  await openInbox(page);
  const sender = page.getByTestId("row-sender").first();
  await expect(sender, "the seed gives Northwind notes from agents with a persona").toBeVisible({ timeout: LONG });
  return (await sender.textContent())?.trim() ?? "";
}

async function openInbox(page: Page): Promise<void> {
  await openBusiness(page, "inbox");
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
}

test.describe("anthropomorphic agents", () => {
  let before = false;
  let beforeStyle: Style = "humans";

  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.get("/trpc/founder.preferences.guidance");
    expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
    const found = ((await res.json()) as { result: { data: { json: Guidance } } }).result.data.json;
    before = found.anthropomorphicAgents === true;
    beforeStyle = found.agentStyle ?? "humans";
    const reset = await api.post("/trpc/founder.preferences.update", { data: { json: { anthropomorphicAgents: false, agentStyle: "humans" } } });
    expect(reset.ok(), await reset.text()).toBe(true);
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.post("/trpc/founder.preferences.update", { data: { json: { anthropomorphicAgents: before, agentStyle: beforeStyle } } });
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
    // Off: no style to choose.
    await expect(screen.getByRole("radiogroup", { name: "Style" })).toHaveCount(0);

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

  test("style: Settings offers four styles when on; Fantasy gives the same agent a fantasy name with its position beside it, and Humans brings the human name back", async ({ page }) => {
    await setSwitch(page, true);
    const group = settingsScreen(page).getByRole("radiogroup", { name: "Style" });
    await expect(group).toBeVisible({ timeout: LONG });
    await expect(group.getByRole("radio")).toHaveCount(4);
    for (const style of Object.keys(STYLE_LABEL) as Style[]) await expect(group.getByRole("radio", { name: STYLE_LABEL[style], exact: true })).toBeVisible();
    await expect(group.getByRole("radio", { name: STYLE_LABEL.humans, exact: true })).toHaveAttribute("aria-checked", "true");

    const humanLabel = await firstSenderLabel(page);
    expect(humanLabel).toMatch(NAME_WITH_POSITION);
    const humanPosition = ANY_NAME_WITH_POSITION.exec(humanLabel)![2];

    // Fantasy: a different name, the same position beside it, still marked as an AI agent on the profile.
    await openBusiness(page, "settings/preferences");
    await chooseStyle(page, "fantasy");
    const fantasyLabel = await firstSenderLabel(page);
    const fantasy = ANY_NAME_WITH_POSITION.exec(fantasyLabel);
    expect(fantasy, `"${fantasyLabel}" should read "Name (Position)"`).not.toBeNull();
    expect(fantasy![1]).not.toBe(humanLabel.split(" (")[0]);
    expect(fantasy![2]).toBe(humanPosition);
    await page.locator("[data-inbox-row]").filter({ has: page.getByTestId("row-sender") }).first().click();
    await page.getByTestId("persona-link").click();
    await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("agent-profile")).toContainText(fantasy![1]!);
    await expect(page.getByTestId("agent-profile")).toContainText("AI agent");

    // The choice is the account's, so it survives a reload; the pictures come from the Fantasy route.
    await page.reload();
    await expect.poll(async () => page.locator("img[data-avatar='photo']").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src)), { timeout: 45_000, intervals: [1_000, 3_000, 5_000] }).toEqual(
      expect.arrayContaining([expect.stringContaining("/personas/fantasy/")]),
    );

    // Back to Humans: the human name returns.
    await openBusiness(page, "settings/preferences");
    await chooseStyle(page, "humans");
    expect(await firstSenderLabel(page)).toBe(humanLabel);
    await setSwitch(page, false);
  });

  test("on: one name everywhere: the Inbox subject, its sender, a Plan row and the Home department card name agents the same way (Nov 8, 2026)", async ({ page }) => {
    await setSwitch(page, true);

    // Ledgerly's seeded request: the stored subject names the agent by its stored name; the web names it as the sender.
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/inbox?tab=all`);
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    const request = page.locator("[data-inbox-row]").filter({ hasText: /needs your OK: .+ › set budget/ }).first();
    await expect(request, "the seed gives Ledgerly an agent's request to approve").toBeVisible({ timeout: LONG });
    const label = (await request.getByTestId("row-sender").textContent())?.trim() ?? "";
    expect(label).toMatch(NAME_WITH_POSITION);
    await expect(request.getByTestId("row-subject")).toHaveText(new RegExp(`^${escapeRe(label)} needs your OK: `));
    await request.click();
    await expect(page.getByTestId("inbox-subject")).toHaveText(new RegExp(`^${escapeRe(label)} needs your OK: `), { timeout: LONG });
    await expect(page.getByTestId("persona-link")).toHaveText(label);
    await expect(page.getByTestId("approval-summary")).toHaveText(new RegExp(`^${escapeRe(label)} wants to `));

    // The Plan: the Agent column (and so its sort, filter and CSV) reads "Name (Position)".
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/d/development/plan`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/plan", { timeout: LONG });
    const planAgents = page.getByRole("grid", { name: "Tasks" }).locator("[data-entity-kind='agent']");
    await expect(planAgents.first(), "the seed assigns Ledgerly's development tasks to agents").toBeVisible({ timeout: LONG });
    const planLabels = (await planAgents.allTextContents()).map((t) => t.trim());
    for (const l of planLabels) expect(l).toMatch(NAME_WITH_POSITION);
    const planFirstNames = new Set(planLabels.map((l) => l.split(" (")[0]!));

    // Home: the Development card's lead and team strip use the same first names (the card used to drop the persona).
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/home`);
    const card = page.locator("[data-department]").filter({ has: page.getByRole("heading", { name: "Development" }) }).first();
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(card.getByRole("button", { name: /^[\p{L}]+ \(.+\), department lead$/u })).toBeVisible({ timeout: LONG });
    const strip = (await card.locator("[data-squad-member]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map((a) => a.split(",")[0]!);
    expect(strip.length).toBeGreaterThan(0);
    for (const name of strip) expect(name, "a persona first name, never the stored title").toMatch(/^[\p{L}]+$/u);
    expect(strip.some((n) => planFirstNames.has(n)), `a Plan agent (${[...planFirstNames].join(", ")}) is on the card (${strip.join(", ")})`).toBe(true);
    await setSwitch(page, false);
  });

  test("style: 3D cartoon and 2D cartoon each name agents with a position beside the name", async ({ page }) => {
    for (const style of ["cartoon_3d", "cartoon_2d"] as const) {
      await openBusiness(page, "settings/preferences");
      await chooseStyle(page, style);
      expect(await firstSenderLabel(page)).toMatch(ANY_NAME_WITH_POSITION);
    }
    await openBusiness(page, "settings/preferences");
    await chooseStyle(page, "humans");
    await setSwitch(page, false);
  });
});
