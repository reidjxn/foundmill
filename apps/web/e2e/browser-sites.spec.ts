import { expect, test, type Page, type Route } from "@playwright/test";
import { LONG, departmentBase, openBusiness, openSettings, settled } from "./helpers";

/**
 * Settings › Integrations › "Add a website the team can work in" (hosted browser, founder, Nov 22, 2026) on the mock
 * stack: the plain words before the first site, the simulated sign-in that Done finishes, the row that then reads
 * "Signed in to <site>", and Disconnect. The mock stack seeds no running browser session and no queued hard stop, so the
 * live view (Development › Live sessions: Watch, Take over, Hand back, a held hard gate) and the Inbox's hard-gate note
 * stub their tRPC answers with `page.route` (`browser.sessions`, `browser.takeOver`, `browser.handBack`, `browserStep.get`,
 * and `inbox.get` with a browser step added to the seeded Ledgerly request); the E2B live-view address is routed to a
 * tiny page. Component tests: packages/dugout browser.test.tsx, packages/modules browser-sessions.test.tsx.
 * Stack and commands: e2e/README.md.
 */
test.describe("websites the team can work in", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
  });

  test("connect in the simulated sign-in, read the plain words first, then disconnect", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const section = screen.getByTestId("browser-sites-section");
    await expect(section).toBeVisible({ timeout: LONG });
    await expect(section.getByRole("heading", { name: "Add a website the team can work in" })).toBeVisible();
    await expect(section.getByTestId("browser-never")).toContainText("Banks, brokerages, payment accounts, social networks, government and identity sites, health records and password managers are never offered.");
    // The sites are listed here and nowhere else.
    await expect(screen.getByTestId("connector-list")).not.toContainText("(website)");

    const row = section.locator("[data-browser-site]").first();
    const name = (await row.locator("span.text-body-strong").first().innerText()).trim();
    await row.getByRole("button", { name: "Connect" }).click();

    const dialog = page.getByTestId("browser-connect-dialog");
    await expect(dialog.getByTestId("browser-connect-intro")).toHaveText("The team will work in this account as you. You can watch and stop it. It stops and asks you before it buys, pays, agrees to terms or deletes anything. Some sites do not allow this, and those are not offered. You can disconnect at any time, and the saved sign-in is deleted.");
    await dialog.getByRole("button", { name: "Continue" }).click();

    // The mock opens no page: a plain panel says the sign-in is simulated, and Done finishes it.
    await expect(dialog.getByTestId("browser-live-view-simulated")).toContainText("simulated sign-in");
    await expect(dialog.getByTestId("browser-live-view")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText(`Signed in to ${name}`, { timeout: LONG });
    await expect(row).toContainText("Disconnect deletes the saved sign-in.");

    // Put the seed back as it was.
    await row.getByRole("button", { name: `Disconnect ${name}` }).click();
    await expect(row.getByRole("button", { name: "Connect" })).toBeVisible({ timeout: LONG });
  });

  test("Cancel leaves nothing connected", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const section = screen.getByTestId("browser-sites-section");
    await expect(section).toBeVisible({ timeout: LONG });
    const row = section.locator("[data-browser-site]").first();
    await row.getByRole("button", { name: "Connect" }).click();
    const dialog = page.getByTestId("browser-connect-dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByTestId("browser-live-view-simulated")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("button", { name: "Connect" })).toBeVisible();
  });
});

test.describe("add any website", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
  });

  const answers: Record<string, unknown> = {
    "www.linkedin.com": { status: "refused", name: "www.linkedin.com", message: "www.linkedin.com is a social network. The team does not work in it, and it cannot be added.", quote: null, termsUrl: null },
    "nobots.example.com": { status: "refused", name: "nobots.example.com", message: "nobots.example.com's terms do not allow automated use of an account, so the team cannot work in it.", quote: "You may not use bots to access your account.", termsUrl: "https://nobots.example.com/terms" },
    "quiet.example.com": { status: "ask_first", name: "quiet.example.com", address: "quiet.example.com", line: "Foundmill has not confirmed that quiet.example.com's terms allow this. Its terms were read and do not say either way, so you decide.", quote: null, termsUrl: null, simulated: true, slotKey: "browser_web_1" },
  };

  async function openAdd(page: Page) {
    const seen: string[] = [];
    const asked: string[] = [];
    await page.route(/\/trpc\/[^?]*browser\.checkSite/, async (route) => {
      const cors = { "access-control-allow-origin": route.request().headers()["origin"] ?? "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-credentials": "true" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const url = (JSON.parse(route.request().postData() ?? "{}") as { 0?: { json?: { url?: string } } })[0]?.json?.url ?? "";
      asked.push(url);
      await route.fulfill({ json: [{ result: { data: { json: answers[url] } } }], headers: cors });
    });
    await stubTrpc(page, { "browser.starters": () => ({ sites: [{ name: "Etsy", address: "www.etsy.com" }], pending: [] }) }, seen);
    const screen = await openSettings(page, "integrations");
    const section = screen.getByTestId("browser-sites-section");
    await expect(section.getByTestId("browser-add-site")).toBeVisible({ timeout: LONG });
    return { section, asked };
  }

  test("a social network and a site whose terms forbid it are refused with the reason, and nothing connects", async ({ page }) => {
    const { section, asked } = await openAdd(page);
    await expect(section.getByTestId("browser-starter-www.etsy.com")).toBeVisible();
    await section.getByTestId("browser-add-address").fill("www.linkedin.com");
    await section.getByTestId("browser-add-check").click();
    await expect(section.getByTestId("browser-add-refused")).toContainText("is a social network");
    await expect(section.getByTestId("browser-add-connect")).toHaveCount(0);
    await section.getByTestId("browser-add-address").fill("nobots.example.com");
    await section.getByTestId("browser-add-check").click();
    await expect(section.getByTestId("browser-add-quote")).toHaveText("“You may not use bots to access your account.”");
    await expect(section.getByTestId("browser-add-connect")).toHaveCount(0);
    expect(asked).toEqual(["www.linkedin.com", "nobots.example.com"]);
  });

  test("a site whose terms do not say shows the honest line and connects only after the founder's own yes", async ({ page }) => {
    const { section } = await openAdd(page);
    await section.getByTestId("browser-add-address").fill("quiet.example.com");
    await section.getByTestId("browser-add-check").click();
    await expect(section.getByTestId("browser-add-line")).toContainText("Foundmill has not confirmed that quiet.example.com's terms allow this.");
    await expect(section.getByTestId("browser-add-connect")).toBeDisabled();
    await section.getByTestId("browser-add-accept").click();
    await expect(section.getByTestId("browser-add-connect")).toBeEnabled();
  });
});

/** Answers named tRPC procedures from `stubs`; a batch with other procedures is fetched for real and patched. Handles CORS (mutations go to the api origin). */
async function stubTrpc(page: Page, stubs: Record<string, (real: unknown) => unknown>, seen: string[] = []): Promise<void> {
  const names = Object.keys(stubs).map((n) => n.replace(".", "\\."));
  await page.route(new RegExp(`/trpc/[^?]*(${names.join("|")})`), async (route: Route) => {
    const cors = { "access-control-allow-origin": route.request().headers()["origin"] ?? "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-credentials": "true" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const paths = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
    seen.push(...paths);
    const real = paths.some((p) => !(p in stubs) || stubs[p]!.length > 0) ? ((await (await route.fetch()).json()) as Array<{ result: { data: { json: unknown } } }>) : [];
    const body = paths.map((p, i) => (p in stubs ? { result: { data: { json: stubs[p]!(real[i]?.result?.data.json) } } } : real[i]));
    await route.fulfill({ json: body, headers: cors });
  });
}

const LIVE = "https://6080-isample0000000001.e2b.app";
const session = (held: { why: string; note: string } | null) => ({ canControl: true, sessions: [{ siteKey: "wave", siteName: "Wave", liveViewUrl: `${LIVE}/vnc.html`, url: "https://next.waveapps.com/settings", startedAt: new Date().toISOString(), steps: 4, held, signIn: false, simulated: false }] });

test.describe("live view on Working now", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
    await page.route(`${LIVE}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Wave</title><p>Wave live view</p>" }));
  });

  async function openLive(page: Page) {
    await page.goto(`${departmentBase("development")}/training-ground`);
    await settled(page);
    const card = page.getByTestId("browser-session");
    await expect(card).toBeVisible({ timeout: LONG });
    return card;
  }

  test("Watch is read only, Take over pauses the team, Hand back returns the page", async ({ page }) => {
    let held: { why: string; note: string } | null = null;
    const seen: string[] = [];
    await stubTrpc(page, {
      "browser.sessions": () => session(held),
      "browser.takeOver": () => ((held = { why: "founder", note: "The founder took over" }), { held: true }),
      "browser.handBack": () => ((held = null), { handedBack: true }),
    }, seen);
    const card = await openLive(page);
    await expect(card).toHaveAccessibleName("Working in Wave");
    await expect(card).toHaveAttribute("data-held", "none");

    await card.getByTestId("browser-session-watch").click();
    const dialog = page.getByTestId("browser-session-dialog");
    await expect(dialog).toHaveAttribute("data-interactive", "false");
    await expect(dialog.getByTestId("browser-live-view")).toHaveAttribute("data-interactive", "false");
    await expect(dialog.frameLocator("iframe").getByText("Wave live view")).toBeVisible({ timeout: LONG });

    await dialog.getByTestId("browser-session-dialog-take-over").click();
    await expect(dialog).toHaveAttribute("data-interactive", "true", { timeout: LONG });
    await expect(dialog.getByTestId("browser-live-view")).toHaveAttribute("data-interactive", "true");
    await expect(dialog).toContainText("The team is paused while you have the page.");

    await dialog.getByTestId("browser-session-dialog-hand-back").click();
    await expect(dialog).toHaveAttribute("data-interactive", "false", { timeout: LONG });
    await expect(page.getByTestId("browser-session")).toHaveAttribute("data-held", "none");
    expect(seen).toEqual(expect.arrayContaining(["browser.takeOver", "browser.handBack"]));
  });

  test("a session held at a hard gate opens interactive with its note and Hand back", async ({ page }) => {
    let held: { why: string; note: string } | null = { why: "hard_gate", note: 'Press "Buy now" yourself' };
    await stubTrpc(page, { "browser.sessions": () => session(held), "browser.handBack": () => ((held = null), { handedBack: true }) });
    const card = await openLive(page);
    await expect(card.getByTestId("browser-session-held")).toHaveText('Press "Buy now" yourself');
    await expect(card.getByTestId("browser-session-take-over")).toHaveCount(0);
    await card.getByTestId("browser-session-watch").click(); // reads "Open Wave" while the team waits for you
    const dialog = page.getByTestId("browser-session-dialog");
    await expect(dialog).toHaveAttribute("data-interactive", "true");
    await expect(dialog).toContainText('Press "Buy now" yourself');
    await dialog.getByTestId("browser-session-dialog-hand-back").click();
    await expect(page.getByTestId("browser-session")).toHaveAttribute("data-held", "none", { timeout: LONG });
  });
});

test.describe("hard-gate note in the Inbox", () => {
  test("shows the page before the press and presses nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
    const stepId = "5e1e5e5e-0000-4000-8000-0000000000a1";
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const seen: string[] = [];
    await stubTrpc(
      page,
      {
        "inbox.get": (real) => {
          const r = real as { approval: Record<string, unknown> | null };
          if (r.approval) Object.assign(r.approval, { connectorKey: "browser_wave", tool: "click", browserStep: { stepId, siteKey: "wave" } });
          return r;
        },
        "browserStep.get": () => ({ siteKey: "wave", siteName: "Wave", target: "Buy now", class: "hard_gate", why: "buy", url: "https://next.waveapps.com/plan", amount: "$29.00", simulated: false, createdAt: new Date().toISOString(), screenshotDataUrl: png }),
      },
      seen,
    );
    page.on("request", (r) => void (/browser\.(takeOver|handBack|stop)/.test(r.url()) && seen.push(r.url())));
    await page.goto("/b/b1e5e5e5-0000-4000-8000-000000000002/inbox?tab=all");
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    await page.getByTestId("inbox-list").getByRole("option").filter({ hasText: /needs your OK: .+ › set budget/ }).first().click();
    const note = page.getByTestId("hard-gate-note");
    await expect(note).toBeVisible({ timeout: LONG });
    await expect(note.getByRole("img", { name: 'The page before "Buy now"' })).toBeVisible();
    await expect(note.getByTestId("hard-gate-address")).toHaveText("https://next.waveapps.com/plan");
    await expect(note.getByTestId("hard-gate-amount")).toHaveText("Amount shown on the page: $29.00");
    await expect(note.getByRole("button", { name: "Open Wave" })).toBeVisible();
    expect(seen.filter((p) => /browser\.(takeOver|handBack|stop)/.test(p)), "viewing presses nothing").toEqual([]);
  });
});
