import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, openSettings, settingsScreen, settled } from "./helpers";

/**
 * Settings in plain words (the 2027 screen pass): no stored identifiers, developer notes or plural slips reach the
 * founder, and the business's money is shown in its own currency. Read-only: nothing here saves a setting.
 * Stack and commands: e2e/README.md.
 *
 * Every tab is opened with `openSettings` and every locator for its content starts at the returned screen: while the
 * page streams, React parks a second copy of it outside the shell (helpers.ts `settingsScreen`), so a page-level locator
 * can match twice. Dialogs are portals outside the shell and are looked up on the page.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;

test.describe("settings, plain words", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("People: each person on one line with their role in words, no developer notes, and an invitation instead of the silent add", async ({ page }) => {
    const screen = await openSettings(page, "members");
    const list = screen.getByTestId("member-list");
    await expect(list).toBeVisible({ timeout: LONG });
    await expect(list).toContainText(/(Owner|Cofounder|Admin|Member|Collaborator|Viewer|Advisor) · since [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(screen).not.toContainText(/auth build|owner:|admin:/);
    await expect(list.getByRole("combobox").first()).toContainText(/^(Owner|Admin|Member|Viewer|Advisor)$/);
    // The founder's own row reads as a name with a "You" chip, never "You You".
    await expect(list).not.toContainText(/\bYou\s*You\b/);
    // Someone joins through an invitation they accept (THESIS 3.1): no "Add member" by account ID or sign-in email.
    await expect(screen.getByTestId("add-member")).toHaveCount(0);
    await expect(screen.getByTestId("invite-create")).toBeVisible();
    // A cofounder invitation (the owner's default) names the person's address; a collaborator's may be a bare link.
    const invite = screen.getByTestId("invite-someone");
    await expect(invite.getByText("Their email")).toBeVisible();
    await invite.getByLabel("Collaborator").check();
    await expect(invite.getByText("Email it to (optional)")).toBeVisible();
  });

  test("People: removing someone asks first (MLSL-40)", async ({ page }) => {
    const screen = await openSettings(page, "members");
    const list = screen.getByTestId("member-list");
    await expect(list).toBeVisible({ timeout: LONG });
    const remove = list.getByRole("button", { name: /^Remove (?!yourself)/, disabled: false }).first();
    test.skip((await remove.count()) === 0, "no removable member on the seeded business");
    await remove.click();
    const dialog = page.getByTestId("remove-member-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /^Remove / })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep" }).click();
    await expect(dialog).toBeHidden();
    // Nothing was removed: the member is still listed.
    await expect(remove).toBeVisible();
  });

  test("Preferences: your account ID is shown with a copy button (WEB-12)", async ({ page }) => {
    const screen = await openSettings(page, "preferences");
    const accountId = screen.getByTestId("account-id");
    await expect(accountId).toBeVisible({ timeout: LONG });
    await expect(accountId).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    await expect(screen.getByTestId("account-id-copy")).toBeVisible();
  });

  test("Business: Personal or live is named in words, with no notes about what comes later", async ({ page }) => {
    // It moved here from the old Settings › Mode (founder, 2026-11-07).
    const screen = await openSettings(page, "business");
    const modeSwitch = screen.getByTestId("switch-game-mode");
    await expect(modeSwitch).toBeVisible({ timeout: LONG });
    await expect(screen).toContainText("Personal or live");
    await expect(screen).not.toContainText(/Game mode/);
    // Going live carries its consequence and that it can be undone (UX plan §6.2).
    await expect(screen.getByTestId("game-mode-consequence")).toContainText("Reversible");
    await modeSwitch.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/come later|for now this records/);
    // Going live is for adults: the review asks for "I am 18 or older" and Confirm waits for it.
    await expect(dialog).toContainText("18 or older");
    // A founder who has confirmed it before (the network asks once; the seeded owner of shards 2 and 3 has) has nothing
    // to tick; one who has not (the profile onboarding saves in shard 1) is asked, and Confirm waits for the tick. The
    // dialog opens before the summary that says which it is has answered, so wait until it shows one or the other.
    const adult = dialog.getByTestId("go-live-adult");
    const confirm = dialog.getByRole("button", { name: "Confirm" });
    await expect.poll(async () => (await adult.count()) > 0 || (await confirm.isEnabled()), { timeout: LONG }).toBe(true);
    if (await adult.count()) {
      await expect(confirm).toBeDisabled();
      await adult.getByRole("checkbox").click();
    }
    await expect(confirm).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("What the team can do: plain answers with one concrete day each, the words defined on first use, and Autopilot says what it never does (UX plan §7.17)", async ({ page }) => {
    const screen = await openSettings(page, "mode");
    await expect(screen.getByRole("radio", { name: /^Routine work alone; ask before big or permanent steps/ })).toBeVisible({ timeout: LONG });
    // The three answers: the business thing, then the example line Commit shows, never "counterparties".
    const examples = screen.locator("[data-mode-example]");
    await expect(examples).toHaveCount(3);
    await expect(examples.first()).toContainText(/^Example: /);
    await expect(screen).not.toContainText(/counterpart/i);
    // No plumbing words reach the founder (DESIGN §10, the voice 3), and the old wrong copy is gone.
    await expect(screen).not.toContainText(/\b(hard gates?|policy|policies|caps?)\b/i);
    await expect(screen).not.toContainText(/new people|Empty means no/);
    // Defined terms sit where a founder first meets them (a dotted word with guidance on, plain text with it off;
    // `data-term` marks both).
    for (const id of ["autonomy", "chief_of_staff", "autopilot", "vacation"]) await expect(screen.locator(`[data-term="${id}"]`).first()).toBeVisible();
    const autopilot = screen.getByTestId("autopilot-section");
    await expect(autopilot.getByTestId("autopilot-help")).toHaveText("Autopilot presses Continue for you on a schedule. It never answers notes for you.", { timeout: LONG });
    await expect(autopilot.getByTestId("autopilot-switch")).toHaveAttribute("aria-describedby", "autopilot-help");
    // Continue runs until done (Nov 7, 2026) and the daily limits here bound it too.
    await expect(autopilot.getByText("Continue keeps the team working, one round of work after another, until nothing is left to do. The daily limits below apply to those rounds too.")).toBeVisible();
    // Vacation carries its consequence under the button.
    await expect(screen.getByTestId("vacation-consequence")).toContainText("Reversible");
  });

  test("Keys: says what the key is for in words, defines the key and the credits, and the Settings list shows its state", async ({ page }) => {
    const screen = await openSettings(page, "keys");
    const lede = screen.getByTestId("keys-lede");
    await expect(lede).toBeVisible({ timeout: LONG });
    await expect(lede).toHaveText("Agents think with Claude. Paste your Anthropic key so they run on your account, or use credits on Billing.");
    await expect(lede.locator('[data-term="api_key"]')).toHaveCount(1);
    await expect(lede.locator('[data-term="credits"]')).toHaveCount(1);
    await expect(lede.getByRole("link", { name: "Billing" })).toHaveAttribute("href", /\/settings\/billing$/);
    // The key's state left the sidebar foot (B13) and sits on the Keys entry of the Settings list.
    const chip = screen.getByTestId("key-status");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-key-status", /^(connected|none|revoked)$/);
    await expect(chip).toHaveText(/^(Connected|None|Revoked)$/);
    // Northwind runs on credits in this stack (no own-key integration, audit #95), so the chip reads None and the pill No key.
    await expect(chip).toHaveAttribute("data-key-status", "none");
    await expect(screen).toContainText("No key");
  });

  test("Billing: correct plurals, whole numbers in the usage tables, credits and model costs in US dollars", async ({ page }) => {
    const screen = await openSettings(page, "billing");
    await expect(screen.locator("[data-tier]").first()).toBeVisible({ timeout: LONG });
    await expect(screen).not.toContainText(/\b1 (businesses|seats|agents)\b/);
    // No business limit on any plan for now (founder, 2026-10-16); the included credits still cover one business.
    await expect(screen.locator("[data-tier=free]")).toContainText("Unlimited businesses");
    await expect(screen.locator("[data-tier=free]")).toContainText("for 1 business");
    await expect(screen.locator("[data-tier=free]")).toContainText("$5.00 of model credits a month");
    // Northwind keeps its books in pounds, but credits and metered model costs are US dollars, never relabeled.
    await expect(screen.getByTestId("credits-balance")).toContainText("$");
    await expect(screen.getByTestId("spent-this-month")).toContainText("$");
    await expect(screen.getByTestId("spent-this-month")).not.toContainText(/^£/);
    await expect(screen.getByRole("combobox", { name: "Top-up amount" })).toContainText("$");
    const usage = screen.getByRole("table", { name: "Usage by agent" });
    if (await usage.count()) {
      // Numbers never truncate: every numeric cell shows its whole text.
      const cut = await usage.locator("td").evaluateAll((tds) => tds.filter((td) => td.scrollWidth > td.clientWidth + 1).length);
      expect(cut).toBe(0);
      await expect(usage).not.toContainText("€");
      await expect(usage).not.toContainText("£");
    }
  });

  test("Integrations: how each connector signs in, in words; no phases or stored kinds", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const list = screen.getByTestId("connector-list");
    await expect(list).toBeVisible({ timeout: LONG });
    await expect(list).not.toContainText(/api_key|oauth\b|phase \d/);
    await expect(list).toContainText(/API key|Sign in with the vendor|Install the app|No sign-in needed/);
    // The Anthropic key decides who pays for model calls and pauses or resumes the team: it lives on the Keys tab only
    // (audit ARB-04), so its row links there instead of offering a generic Connect or Disconnect.
    const anthropic = list.locator('[data-connector="anthropic"]');
    await expect(anthropic.getByRole("button", { name: /Disconnect|^Connect$/ })).toHaveCount(0);
    await expect(anthropic.getByTestId("manage-in-keys")).toHaveAttribute("href", /\/settings\/keys$/);
  });

  test("Integrations: Stripe has its own box above the other connectors, and appears once (founder, Nov 18, 2026)", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const box = screen.getByTestId("stripe-payments");
    await expect(box).toBeVisible({ timeout: LONG });
    await expect(box).toContainText("Accept payments with Stripe");
    await expect(box.locator('[data-connector="stripe"]')).toHaveCount(1);
    await expect(screen.getByTestId("connector-list").locator('[data-connector="stripe"]')).toHaveCount(0);
    const [boxTop, listTop] = await Promise.all([box.boundingBox(), screen.getByTestId("connector-list").boundingBox()]);
    expect(boxTop!.y).toBeLessThan(listTop!.y);
  });

  test("Integrations: a live API-key connector asks for the founder's own key (masked) and connects with it", async ({ page }) => {
    // The e2e stack runs connectors in mock mode; the list answer is replayed with SendGrid marked live, as with LIVE_CONNECTORS.
    await page.route(/\/trpc\/[^?]*integrations\.list/, async (route) => {
      const response = await route.fetch();
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = (await response.json()) as { result?: { data?: { json?: { catalogue?: { key: string; live?: boolean; connectFields?: unknown[] }[] } } } }[];
      const list = body[procedures.indexOf("integrations.list")]?.result?.data?.json;
      for (const c of list?.catalogue ?? []) if (c.key === "sendgrid") c.live = true;
      await route.fulfill({ response, json: body });
    });
    let sent: Record<string, unknown> | null = null;
    await page.route(/\/trpc\/[^?]*integrations\.connect/, async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
      sent = Object.values(body)[0]?.json ?? null;
      await route.abort();
    });
    const screen = await openSettings(page, "integrations");
    const row = screen.locator('[data-connector="sendgrid"]');
    await expect(row).toBeVisible({ timeout: LONG });
    // The page first shows the list it was rendered with; Connect asks for the key once the replayed list marks it Live.
    await expect(row).toContainText("Live", { timeout: LONG });
    // The row re-renders when the list settles; a Connect pressed in that moment can miss, so press until the dialog opens.
    const dialog = page.getByTestId("connect-fields-dialog");
    await expect(async () => {
      await row.getByRole("button", { name: "Connect" }).click();
      await expect(dialog).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: LONG });
    await expect(dialog).toContainText("Connect SendGrid");
    await expect(dialog).toContainText("billed to your SendGrid account");
    const key = dialog.getByLabel("API key");
    await expect(key).toHaveAttribute("type", "password");
    await expect(dialog.getByRole("button", { name: "Connect" })).toBeDisabled();
    await key.fill("SG.e2e-founder-key");
    await dialog.getByRole("button", { name: "Connect" }).click();
    await expect.poll(() => sent, { timeout: LONG }).not.toBeNull();
    expect(sent).toMatchObject({ connectorKey: "sendgrid", input: { apiKey: "SG.e2e-founder-key" } });
  });

  test("Integrations: a founder lets the team read their Gmail for context; the inbox waits for Google's permission (founder, Nov 19, 2026)", async ({ page }) => {
    // The list is replayed with Gmail connected on drafts only, as after a sign-in without gmail.readonly.
    await page.route(/\/trpc\/[^?]*integrations\.list/, async (route) => {
      const response = await route.fetch();
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = (await response.json()) as { result?: { data?: { json?: { catalogue?: { key: string; integration: unknown }[] } } } }[];
      const list = body[procedures.indexOf("integrations.list")]?.result?.data?.json;
      for (const c of list?.catalogue ?? []) if (c.key === "gmail") c.integration = { id: "00000000-0000-4000-8000-0000000000e1", connectorKey: "gmail", status: "connected", scopes: ["https://www.googleapis.com/auth/gmail.compose"], settings: {}, accountLabel: "founder@example.com", lastError: null, lastHealthAt: null };
      await route.fulfill({ response, json: body });
    });
    let sent: Record<string, unknown> | null = null;
    await page.route(/\/trpc\/[^?]*integrations\.setContextReads/, async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
      sent = Object.values(body)[0]?.json ?? null;
      await route.abort();
    });
    const screen = await openSettings(page, "integrations");
    const panel = screen.getByTestId("google-context");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("sending mail and inviting people always ask you first");
    await expect(panel).toContainText("Your inbox is read once Google grants inbox access.");
    await expect(async () => {
      await panel.getByRole("checkbox", { name: /Let the team read your Gmail/ }).click();
      expect(sent).not.toBeNull();
    }).toPass({ timeout: LONG });
    expect(sent).toMatchObject({ connectorKey: "gmail", on: true });
  });

  test("Integrations: back from a vendor's consent page, the founder finishes or is told why nothing connected (#225)", async ({ page }) => {
    // The vendor's redirect lands on /integrations/oauth/callback, which sends the founder to the business the signed
    // state names (the api checks the signature when the founder finishes; nothing is connected on the way).
    const state = `${Buffer.from(JSON.stringify({ b: NORTHWIND_BUSINESS_ID, c: "gmail", u: "x", exp: 1, n: "n" })).toString("base64url")}.sig`;
    await page.goto(`/integrations/oauth/callback?state=${encodeURIComponent(state)}&error=access_denied`);
    await expect(page).toHaveURL(new RegExp(`${B}/settings/integrations\\?oauth_connector=gmail&oauth_error=access_denied`), { timeout: LONG });
    const screen = settingsScreen(page);
    await settled(page);
    const refused = screen.getByTestId("oauth-finish");
    await expect(refused).toContainText("You did not allow access on Gmail's page, so nothing was connected.", { timeout: LONG });
    await refused.getByRole("button", { name: "Dismiss" }).click();
    await expect(screen.getByTestId("oauth-finish")).toHaveCount(0);
    await expect(page).not.toHaveURL(/oauth_/);

    // With a code and the state, it finishes by itself with no press (founder, Nov 18, 2026). The request is caught
    // here, so this spec saves nothing; the address loses the code either way.
    let sent: Record<string, unknown> | null = null;
    await page.route(/\/trpc\/[^?]*integrations\.connect/, async (route) => {
      // The call can ride in a batch: take the entry for integrations.connect by its place in the path.
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
      sent = body[String(procedures.indexOf("integrations.connect"))]?.json ?? null;
      await route.abort();
    });
    await page.goto(`${B}/settings/integrations?oauth_connector=gmail&oauth_code=4%2F0Adeu5&oauth_state=${encodeURIComponent(state)}`);
    await expect.poll(() => sent, { timeout: LONG }).toMatchObject({ connectorKey: "gmail", input: { code: "4/0Adeu5", state } });
    await expect(page).not.toHaveURL(/oauth_/, { timeout: LONG });
  });

  test("Your words and Departments: the glossary tab is called Your words, no retired default words, modules named in words", async ({ page }) => {
    const glossary = await openSettings(page, "glossary");
    await expect(glossary.getByTestId("glossary-rows")).toBeVisible({ timeout: LONG });
    // "Your words" on the list, the panel and the browser title; the slug stays "glossary" (UX plan §7.17).
    await expect(glossary.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Your words" })).toHaveAttribute("aria-current", "page");
    await expect(glossary.getByRole("heading", { name: "Your words" })).toBeVisible();
    await expect(glossary.getByTestId("your-words-lede")).toHaveText("Rename the product's nouns to yours (clients instead of customers).");
    await expect(glossary).not.toContainText(/Glossary/);
    await expect(page).toHaveTitle(/^(?:\(\d+\) )?Your words · Settings · /);
    const terms = await glossary.getByLabel("Default word").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(terms.filter((t) => /^(squad|club|crest|shout)$/i.test(t))).toEqual([]);
    const departments = await openSettings(page, "departments");
    await expect(departments.getByTestId("department-list")).toBeVisible({ timeout: LONG });
    await expect(departments.getByTestId("department-list")).not.toContainText(/ · (product|development|distribution|finance|team|legal)\b/);
  });
});
