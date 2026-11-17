import { expect, test, type Page } from "@playwright/test";

/**
 * `/tour`, the earlier landing page for the second reader (it needs no api and no session); `/?example=` deep links
 * still open it on another business. The first-timer's page at `/` is first-timer.spec.ts. Runs in a fresh browser context, so the dev
 * auth cookie of the other specs is not present.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("the tour (/tour)", () => {
  test("explains the product, links every call to action to sign-in, and shows the live parts", async ({ page }) => {
    await page.goto("/tour");
    await expect(page).toHaveURL(/\/tour$/);
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Build a real business with a team of AI agents.");
    await expect(page.getByRole("img", { name: /Your team: you at the center/ })).toBeVisible();

    // The header is anchored by the Foundmill wordmark alone; the FM monogram is the favicon only.
    const home = page.getByRole("banner").getByRole("link", { name: "Foundmill home" });
    await expect(home).toBeVisible();
    await expect(home.locator("svg")).toHaveCount(1);
    expect((await home.locator("svg").boundingBox())!.height).toBe(20);
    await expect(page.locator("svg[data-variant]")).toHaveCount(0);

    // The hero's assurances: what a founder starts with (the free plan's included credits, no card); the key assurance
    // lives in "You decide" beside "Your key, sealed" (UX plan §7.1, A13).
    const hero = page.locator("section", { has: page.locator("#hero-title") });
    // The hero's assurances sit under the idea box (founder, 2026-11-13; docs/IDEA_BOX.md); the included credits are said
    // once a card lands, beside the ways to keep it.
    await expect(hero.getByText("Shaping your first idea is free and needs no sign-up")).toBeVisible();
    await expect(hero.getByText("Your idea stays private until you choose to share it")).toBeVisible();
    await expect(hero.getByText(/Anthropic key/)).toHaveCount(0);
    await expect(page.getByText(/Bring your own Anthropic key/)).toHaveCount(1);
    await expect(page.locator("#control").getByText(/^Bring your own Anthropic key, or stay on the included credits\./)).toBeVisible();

    // No section nav in the top bar (founder, 2026-11-13); each Why now pillar scrolls to the section that proves it.
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
    for (const [label, id] of [["Meet the team", "team"], ["Watch the work", "live"], ["Your decisions", "control"]] as const) {
      await page.locator("#why").getByRole("link", { name: label }).click();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }

    // How it works: four beats, each labeled Example; the fourth is day one as it runs (drafting → the plan note →
    // Continue), drawn with the product's parts.
    const how = page.locator("#how");
    await how.scrollIntoViewIfNeeded();
    await expect(how.getByTestId("step-title")).toHaveText(["Shape the idea", "Make it yours", "Press Continue", "Your first day"]);
    await expect(how.getByText("Example", { exact: true })).toHaveCount(4);
    const firstDay = how.getByRole("region", { name: "Vision, specification and roadmap · Drafting" });
    await expect(firstDay).toContainText("Drafting your vision, specification and roadmap…");
    await expect(firstDay).toContainText("Iris, Product lead, writes it from your idea and your profile. Orla, Chief of Staff, plans the first round of work from the roadmap.");
    const signoffs = how.getByRole("list", { name: "Inbox" }).getByRole("listitem");
    await expect(signoffs).toHaveText([/Your plan is ready/]);
    await expect(how.getByRole("list", { name: "Inbox" }).getByText("Needs you", { exact: true })).toHaveCount(1);
    await expect(how.getByText("Building starts: 11 tasks planned")).toBeVisible();
    await expect(how.getByText("The team drafts; you sign off; then they build. Your project's money is never spent without your approval; agent work uses your monthly allowance.")).toBeVisible();

    // The team: each department's lead, with their attribute ratings.
    await page.locator("#team").scrollIntoViewIfNeeded();
    const departments = page.getByRole("tablist", { name: "Departments" });
    await departments.getByRole("tab", { name: /Finance/ }).click();
    await expect(departments.getByRole("tab", { name: /Finance/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#team-panel").getByText("Finance lead")).toBeVisible();
    await expect(page.getByRole("list", { name: "Finance screens" })).toBeVisible();

    // The live tiles stream once the section is on screen; the Journey draws; the Channel Board is interactive.
    await page.locator("#live").scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: "Example agent sessions" }).getByRole("group")).toHaveCount(4);
    await page.locator("#journey").scrollIntoViewIfNeeded();
    const ribbon = page.locator("[aria-roledescription='journey ribbon']");
    await expect(ribbon).toBeVisible();
    // The product's own parts print the example's dollars as "$" too, never en-GB's "US$": the ribbon's revenue scale,
    // the milestone values and the live tiles' costs.
    await expect(ribbon).toContainText(/\$\d{3}\.00\/day/);
    await expect(page.getByText("$290.00", { exact: true })).toBeVisible();
    await expect(page.getByTestId("landing")).not.toContainText("US$");
    await expect(page.getByRole("region", { name: "Customer Update" })).toBeVisible();
    // The example is a US business: its own figures print as dollars.
    await expect(page.getByRole("region", { name: "Customer Update" }).getByText("$42.00", { exact: true })).toBeVisible();
    await page.locator("#channels").scrollIntoViewIfNeeded();
    const board = page.getByRole("group", { name: "Board: active channels" });
    await expect(board.getByRole("button")).toHaveCount(4);
    // Social media is off the board for the example business; putting it on adds a fifth running channel.
    await page.getByRole("button", { name: /^Social media,/ }).focus();
    await page.keyboard.press("Enter");
    await expect(board.getByRole("button")).toHaveCount(5);

    // The Inbox note's cost is in dollars too, and nothing of the earlier sterling example is left on the page.
    await page.locator("#control").scrollIntoViewIfNeeded();
    await expect(page.getByRole("article", { name: "Example Inbox note" }).locator('[data-value="$480.00"]')).toBeVisible();
    // The DecisionBar's hover card (portalled to <body>) states the cost in dollars as well.
    await page.getByTestId("decision-bar").getByRole("button", { name: /^Approve/ }).hover();
    await expect(page.getByText(/^Not reversible$/)).toBeVisible();
    for (const gone of ["£", "GBP", "Maths", "GCSE", "US$"]) await expect(page.locator("body")).not.toContainText(gone, { useInnerText: true });

    // Every way in goes to sign-in.
    await page.getByRole("banner").getByRole("link", { name: "Start your business" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the hero deck runs a cycle: a decision comes back, then a customer", async ({ page }) => {
    await page.goto("/tour");
    const deck = page.getByTestId("cycle-deck");
    // The first cycle runs on its own and comes back with a decision; Continue waits for the founder.
    await expect(deck).toHaveAttribute("data-phase", "decision", { timeout: 15_000 });
    await expect(deck.getByRole("button", { name: /1 thing needs you/ })).toBeVisible();
    await page.getByTestId("deck-decision").getByRole("button", { name: "Merge" }).click();
    await expect(deck.getByText("Photo grading merged", { exact: true })).toBeVisible();
    // The callout under Continue teaches the loop in the app's own words, until the visitor presses it. It is the
    // design system's Callout: a popover portaled to <body>, anchored to the deck's Continue (data-coachmark-active).
    const callout = page.locator("[data-coachmark][data-tour='deck-continue']");
    await expect(callout).toContainText("One press and your team works until nothing is left to do. Anything that needs you shows in Needs you.");
    await expect(page.locator("[data-testid='deck-continue'][data-coachmark-active]")).toHaveCount(1);

    // Pressing Continue runs the next cycle, which brings a customer; the gold card opens the Journey.
    await deck.getByRole("button", { name: "Continue" }).click();
    await expect(deck).toHaveAttribute("data-phase", "processing");
    await expect(callout).toHaveCount(0);
    await expect(page.getByTestId("deck-win")).toBeVisible({ timeout: 15_000 });
    await expect(deck.getByRole("button", { name: /Go to Journey/ })).toBeVisible();
    await page.getByTestId("deck-win").getByRole("button", { name: /See the Customer Update/ }).click();
    await expect(page.locator("#journey")).toBeInViewport();
    await expect(page.locator("#journey-title")).toBeFocused();
    await expect(deck).toHaveAttribute("data-phase", "idle");
    // The update it opens is about the same customer.
    await expect(page.getByRole("region", { name: "Customer Update" }).getByText("Okafor Math Tutoring").first()).toBeVisible();
  });

  test("the picker switches the whole page between the three example businesses", async ({ page }) => {
    await page.goto("/tour");
    const picker = page.getByRole("radiogroup", { name: "Watch it run" });
    await expect(picker.getByRole("radio")).toHaveCount(3);
    await expect(picker.getByRole("radio", { name: "Tutorlane" })).toHaveAttribute("aria-checked", "true");
    const landing = page.getByTestId("landing");
    const deck = page.getByTestId("cycle-deck");
    const update = page.getByRole("region", { name: "Customer Update" });

    const businesses = [
      { name: "Glitchwick", id: "glitchwick", customer: "Kettlebird Games", primary: "#c94a2c" },
      { name: "Northwind Skincare", id: "northwind", customer: "Larkfield Market", primary: "#2f6f5e" },
      { name: "Tutorlane", id: "tutorlane", customer: "Okafor Math Tutoring", primary: "#2B6CB0" },
    ];
    for (const b of businesses) {
      await picker.getByRole("radio", { name: b.name }).click();
      await expect(landing).toHaveAttribute("data-example", b.id);
      await expect(picker.getByRole("radio", { name: b.name })).toHaveAttribute("aria-checked", "true");
      // The page wears the business's brand colours and the address can be shared.
      expect(await landing.evaluate((el) => el.style.getPropertyValue("--kit-primary"))).toBe(b.primary);
      await expect(page).toHaveURL(b.id === "tutorlane" ? /\/tour$/ : new RegExp(`/\\?example=${b.id}$`));
      // Its name in the hero's product screen, and its customer in the Customer Update.
      await expect(deck.getByText(b.name, { exact: true })).toBeVisible();
      await update.scrollIntoViewIfNeeded();
      await expect(update.getByText(b.customer).first()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });

  test("`/`, `/tour` and the deep links are prerendered pages, regenerated hourly, not a render per visit", async ({ page }) => {
    for (const path of ["/", "/tour", "/?example=northwind", "/?example=glitchwick"]) {
      const res = await page.request.get(path);
      expect(res.ok(), path).toBe(true);
      const cacheControl = res.headers()["cache-control"] ?? "";
      expect(cacheControl, path).toMatch(/s-maxage=3600/);
      expect(cacheControl, path).not.toMatch(/no-store|private/);
    }
  });

  test("the picker works from the keyboard, and a deep link opens on its business", async ({ page }) => {
    await page.goto("/?example=northwind");
    const picker = page.getByRole("radiogroup", { name: "Watch it run" });
    await expect(picker.getByRole("radio", { name: "Northwind Skincare" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("cycle-deck").getByText("Northwind Skincare", { exact: true })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Departments" }).getByRole("tab", { name: /Formulation Lab/ })).toBeVisible();

    await picker.getByRole("radio", { name: "Northwind Skincare" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(picker.getByRole("radio", { name: "Glitchwick" })).toBeFocused();
    await expect(page.getByTestId("landing")).toHaveAttribute("data-example", "glitchwick");
    await expect(page).toHaveURL(/\?example=glitchwick$/);
    await page.keyboard.press("Home");
    await expect(page.getByTestId("landing")).toHaveAttribute("data-example", "tutorlane");
    await expect(page).toHaveURL(/\/tour$/);
    // Choosing never navigated or scrolled the page.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("Northwind's Ribbon agrees with its milestone cards and its Customer Update, and its long department names read whole", async ({ page }) => {
    await page.goto("/?example=northwind");
    await page.locator("#journey").scrollIntoViewIfNeeded();
    const ribbon = page.locator("[aria-roledescription='journey ribbon']");
    await expect(ribbon).toBeVisible();
    await ribbon.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await ribbon.boundingBox())!;
    const y = box.y + box.height * 0.6;
    // The day card names the hovered day. The pointer leaves the Ribbon between moves, so a card left over from the last
    // day never sits under it.
    const card = page.locator("[data-on-this-day]");
    const dayAt = async (x: number) => {
      await page.mouse.move(1, 1);
      await page.mouse.move(x, y);
      return (await card.count()) ? await card.getAttribute("data-on-this-day") : null;
    };
    let first = box.x;
    while (!(await dayAt(first)) && first < box.x + box.width / 2) first += 8;
    // Find a day by halving the distance.
    const hoverDay = async (day: string) => {
      let lo = first;
      let hi = box.x + box.width - 8;
      for (let i = 0; i < 24 && hi - lo > 0.25; i++) {
        const mid = (lo + hi) / 2;
        if (((await dayAt(mid)) ?? "") < day) lo = mid;
        else hi = mid;
      }
      await expect.poll(() => dayAt(hi)).toBe(day);
    };
    // The page moves the story (written for Oct 7, 2026) to the browser's today, every date by the same days.
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const moved = (storyDay: string) => new Date(Date.parse(`${storyDay}T00:00:00Z`) + Date.parse(`${today}T00:00:00Z`) - Date.parse("2026-10-07T00:00:00Z")).toISOString().slice(0, 10);
    // The first retail partner's day (Dec 26, 2024 on the story's calendar): the pharmacy's opening order is the milestone card's customer and
    // value.
    await hoverDay(moved("2024-12-26"));
    await expect(card).toContainText("First retail partner");
    await expect(card).toContainText("Oak Hill Pharmacy");
    await expect(card).toContainText("$3,782.60");
    // "Retail Partnerships" and "Formulation Lab" fit the card's department column (scaled at most, never cut).
    await expect(card.locator('[data-fit="truncated"]')).toHaveCount(0);
    // The 1,000th customer's day has paying customers on it, and two years add up to thousands of them, not hundreds.
    await hoverDay(moved("2025-09-25"));
    await expect(card).toContainText("1,000th customer");
    expect(Number(/Paying\s*(\d+)/i.exec(await card.innerText())?.[1])).toBeGreaterThan(0);
    expect(Number(/(\d+) payments/.exec((await ribbon.getAttribute("aria-label")) ?? "")?.[1])).toBeGreaterThan(3000);
    // Today the chain's opening order is on the Ribbon, at the Customer Update's value.
    await hoverDay(today);
    await expect(card).toContainText("Larkfield Market");
    await expect(card).toContainText("$16,632.00");
    await page.mouse.move(1, 1);
    const partner = page.locator("#journey").getByText("First retail partner", { exact: true }).locator("xpath=ancestor::*[contains(., '$3,782.60')][1]");
    await expect(partner).toContainText("Oak Hill Pharmacy");
    await expect(page.getByRole("region", { name: "Customer Update" })).toContainText("$16,632");
  });

  /** What each live tile shows: agent, task, phase pill, footer and the end of its terminal. */
  async function liveTiles(page: Page) {
    return page.locator("[data-session-id]").evaluateAll((els) =>
      els.map((el) => ({
        name: el.querySelector("[data-tile-name]")?.textContent ?? "",
        task: el.querySelector("[data-tile-task]")?.textContent ?? "",
        phase: (el.querySelector("[data-tile-status]")?.textContent ?? "").replace(/\d+%.*$/, "").trim(),
        footer: el.querySelector("[data-testid=tile-footer]")?.textContent ?? "",
        terminal: (el.querySelector(".xterm-rows, [role=log]")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      })),
    );
  }

  for (const example of ["tutorlane", "glitchwick", "northwind"]) {
    test(`${example}: the four live tiles keep working, each on its own task, and never read overdue`, async ({ page }) => {
      await page.goto(example === "tutorlane" ? "/tour" : `/?example=${example}`);
      await page.locator("#live").scrollIntoViewIfNeeded();
      const grid = page.getByRole("region", { name: "Example agent sessions" });
      await expect(grid.getByRole("group")).toHaveCount(4);
      await expect.poll(async () => (await liveTiles(page)).every((t) => t.terminal.length > 0), { timeout: 15_000 }).toBe(true);
      const first = await liveTiles(page);
      expect(new Set(first.map((t) => t.name)).size).toBe(4);
      const changed = new Set<number>();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(1000);
        const now = await liveTiles(page);
        for (const t of now) expect(t.footer, `${t.name}: ${t.footer}`).not.toMatch(/overdue/i);
        // Each tile plays its own task's terminal.
        const terminals = now.map((t) => t.terminal).filter(Boolean);
        expect(new Set(terminals).size).toBe(terminals.length);
        now.forEach((t, k) => {
          if (t.phase !== first[k]!.phase || t.task !== first[k]!.task) changed.add(k);
        });
      }
      expect(changed.size, "tiles move on to their next phase or task within 20 seconds").toBeGreaterThanOrEqual(2);
    });
  }

  test("under reduced motion the live tiles hold one legible frame", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?example=northwind");
    await page.locator("#live").scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: "Example agent sessions" }).getByRole("group")).toHaveCount(4);
    await expect.poll(async () => (await liveTiles(page)).every((t) => t.terminal.length > 0), { timeout: 15_000 }).toBe(true);
    const frame = await liveTiles(page);
    await page.waitForTimeout(5000);
    expect(await liveTiles(page)).toEqual(frame);
    for (const t of frame) expect(t.footer).toMatch(/ETA \d/);
  });
});
