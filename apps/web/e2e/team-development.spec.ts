import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { COACHMARK_CARD, LONG, chooseTableView, departmentBase as departmentBaseFor, devApi, dismissCoachmarks, openBusiness, openExplainer, setBuilderView } from "./helpers";

// Builder view on for this file (it reads the Code, Health and Hierarchy tabs, ratings out of 20 and the cycle number); global-setup.ts starts every run with it off. Restored afterwards.
let builderViewBefore = false;
test.beforeAll(async ({ playwright }) => {
  builderViewBefore = await setBuilderView(playwright, true);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, builderViewBefore);
});

/**
 * Team and Development screens on the seeded Northwind business at the two desktop widths (1280, the minimum, and
 * 1440, the reference): every tab renders its panels, nothing is cut at the panel edge, raw identifiers never show,
 * and the founder's main actions on these tabs work (the generate action on Recruitment, the hard gate on
 * Responsibilities). The guided layer on Team (UX plan §7.10, §7.15): the Agents explainer and its Simple view, the
 * defined words, the consequence lines in the dialogs, the key cap only for operators. The page-wide clipping guard is
 * no-clip.spec.ts; this spec checks what is specific to these tabs.
 */

/** The dev founder's guidance switch (Settings › Preferences): explainers and term underlines render only while it is on; key caps only while it is off. */
async function guidanceOn(playwright: PlaywrightWorkerArgs["playwright"]): Promise<boolean> {
  const api = await devApi(playwright);
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { guidance: "on" | "off" } } } };
  await api.dispose();
  return body.result.data.json.guidance === "on";
}

/** The department href for a sidebar label (department slugs are per business; names are labels over modules). */
async function departmentBase(page: Page, label: RegExp): Promise<string> {
  // The link's name is its label plus a badge count ("Team, 1 item"), so the label is matched without the badge.
  const name = new RegExp(label.source.replace(/\$$/, "(,|$)"), label.flags);
  const link = page.locator("[data-testid=app-shell] nav").getByRole("link", { name }).first();
  await expect(link, `the seed gives Northwind a ${label} department`).toBeVisible({ timeout: LONG });
  return (await link.getAttribute("href"))!.replace(/(\/d\/[^/]+)\/.*$/, "$1");
}

async function openTab(page: Page, base: string, slug: string, module: string): Promise<void> {
  await page.goto(`${base}/${slug}`);
  await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", module, { timeout: LONG });
  await page.waitForLoadState("networkidle", { timeout: LONG }).catch(() => undefined);
  await closeTours(page);
}

/**
 * The department tour and the saved-views callout (UX plan §6.2) open on the account's first department visit, or again
 * after tours.spec.ts resets them; a card's popover covers the tab's View button, so the spec closes what shows (each
 * waits for the one before it) until none opens.
 */
async function closeTours(page: Page): Promise<void> {
  const card = page.locator(COACHMARK_CARD).first();
  for (let i = 0; i < 5; i++) {
    const shown = await card.waitFor({ state: "visible", timeout: 1_500 }).then(() => true, () => false);
    if (!shown) return;
    await dismissCoachmarks(page);
  }
}

/** The right edge of every column header in a grid sits inside the grid's own box (no header cut at the edge). */
async function headersInside(page: Page, grid: string): Promise<string[]> {
  // The Agents table is a tree grid (leads with their specialists nested under them).
  return page.locator(`[role=grid][aria-label="${grid}"], [role=treegrid][aria-label="${grid}"]`).first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll<HTMLElement>("[role=columnheader]"))
      .filter((h) => (h.textContent ?? "").trim())
      .filter((h) => h.getBoundingClientRect().right > box.right + 1)
      .map((h) => (h.textContent ?? "").trim());
  });
}

/** A tRPC answer (one result or a batch) with the first merge-queue row of `dev.prs.list` marked saved only. */
function withOneSavedOnly(body: unknown): unknown {
  for (const entry of Array.isArray(body) ? body : [body]) {
    const merged = (entry as { result?: { data?: { json?: { merged?: Array<Record<string, unknown>> } } } })?.result?.data?.json?.merged;
    const row = merged?.find((m) => m.source === "merge_queue");
    if (row) {
      row.landed = "saved_only";
      break;
    }
  }
  return body;
}

for (const width of [1280, 1440]) {
  test.describe(`team and development at ${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    test("Team: agents table fits with AI cost, names end in an ellipsis, health groups and hierarchy render", async ({ page, playwright }) => {
      await openBusiness(page);
      const guided = await guidanceOn(playwright);
      const team = await departmentBase(page, /^team$/i);

      await openTab(page, team, "squad", "team/squad");
      const agents = page.getByRole("treegrid", { name: "Agents" });
      const explainer = page.locator("[data-explainer='team-agents']");
      await expect(page.getByRole("button", { name: /^View: / })).toBeVisible({ timeout: LONG });
      if (guided) {
        // Guided: the built-in Simple view (Agent, Status, Current task, Rating) is the tab's default (a view the dev
        // founder left open, in this spec or another, still wins, so it is chosen here) with the explainer above the
        // table and the column words defined once under it (UX plan §7.10); the General view is a click away.
        await chooseTableView(page, "Simple");
        await expect(agents.getByRole("columnheader", { name: /Rating \/20/ })).toBeVisible();
        await expect(agents.getByRole("columnheader", { name: /^Role/ })).toHaveCount(0);
        await expect(agents.getByRole("columnheader", { name: /AI cost/ })).toHaveCount(0);
        expect(await headersInside(page, "Agents"), "every Simple column fits the panel").toEqual([]);
        await expect(explainer).toBeVisible();
        await expect(explainer).toContainText("Explain this page");
        await expect(await openExplainer(page, "team-agents")).toContainText("Everyone who works here. Agents have skills 1–20");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("form-caption")).toContainText("Form: the last five tasks");
        await expect(page.getByTestId("form-caption").locator("[data-term='form']")).toHaveClass(/term-link/);
        await expect(page.getByTestId("column-terms").locator("[data-term='rating']")).toBeVisible();
      } else {
        await expect(explainer).toHaveCount(0);
        await expect(page.getByTestId("form-caption")).toHaveCount(0);
        await expect(page.getByTestId("column-terms")).toHaveCount(0);
      }
      await chooseTableView(page, "General");
      // The metered cost says it is US dollars (C19), and the rating column says its scale (C1).
      await expect(agents.getByRole("columnheader", { name: /AI cost \(USD\)/i })).toBeVisible({ timeout: LONG });
      await expect(agents.getByRole("columnheader", { name: /Rating \/20/ })).toBeVisible();
      expect(await headersInside(page, "Agents"), "every General column fits the panel").toEqual([]);
      // Every rated agent shows the 1–20 mean with its band word (a compact ScaleLabel), never a bare /10 figure.
      await expect(agents.locator("[data-rating-cell]").first()).toHaveText(/^\d+\.\d(Poor|Average|Good|Excellent)$/, { timeout: LONG });
      await expect(agents.locator("[data-rating-cell] [data-scale-label]").first()).toBeVisible();
      // Leads first: the Chief of Staff named, then the leads and specialists counted (the background helpers are not).
      await expect(page.getByTestId("squad-summary")).toHaveText(/^Chief of Staff · \d+ leads? · \d+ specialists?( · \d+ needs? you)?$/);
      await expect(page.getByTestId("squad-summary")).not.toContainText(/\b1 (leads|specialists)\b/);
      // The Chief of Staff's row is pinned first; the leads are collapsed, each with a "+N specialists" expander.
      await expect(agents.getByRole("row").nth(1)).toHaveAttribute("aria-level", "1");
      const expander = agents.getByRole("button", { name: /^Show \d+ specialists? under / }).first();
      await expect(expander).toBeVisible();
      await expect(expander).toHaveText(/^\+\d+ specialists?$/);
      const levelTwo = agents.locator("[role=row][aria-level='2']");
      const before = await levelTwo.count();
      await expander.click();
      await expect(agents.getByRole("button", { name: /^Hide \d+ specialists? under / }).first()).toBeVisible();
      await expect.poll(() => levelTwo.count()).toBeGreaterThan(before);
      // Opened specialists sit indented under their lead.
      await expect(levelTwo.first().locator("[data-nest-level='1']")).toHaveCount(1);
      await agents.getByRole("button", { name: /^Hide \d+ specialists? under / }).first().click();
      await expect.poll(() => levelTwo.count()).toBe(before);
      // The background helpers are one honest line, with a read-only list behind it, never rows of the table.
      const helpers = page.getByTestId("background-helpers-line");
      await expect(helpers).toContainText("5 background helpers also run, linking names, sorting what comes in and checking drafts. They never take tasks or write to you.");
      await expect(agents.getByRole("link", { name: "Entity Linker", exact: true })).toHaveCount(0);
      await helpers.getByRole("button", { name: "Show them" }).click();
      const helperList = page.getByTestId("background-helpers-dialog");
      await expect(helperList).toBeVisible();
      await expect(helperList.locator("li[data-agent-id]")).toHaveCount(5);
      await expect(helperList).toContainText("Entity Linker");
      await page.keyboard.press("Escape");
      await expect(helperList).toBeHidden();
      const overflow = await agents.locator("a[href*='/agents/']").first().evaluate((a) => getComputedStyle(a).textOverflow);
      expect(overflow, "a long agent name ends in an ellipsis instead of being cut").toBe("ellipsis");
      // Letting an agent go says what happens and that there is no way back (ConsequenceLine), and opens on Keep.
      await agents.getByRole("row").nth(1).click({ button: "right" });
      const letGo = page.getByRole("menuitem", { name: "Let go" });
      await expect(letGo).toBeVisible();
      if ((await letGo.getAttribute("aria-disabled")) === "true") {
        await page.keyboard.press("Escape");
      } else {
        await letGo.click();
        const release = page.getByTestId("release-dialog");
        await expect(release).toBeVisible();
        await expect(release.getByTestId("release-consequence")).toContainText("Running tasks stop; history and logs stay on the profile. Nothing is deleted.");
        await expect(release.getByTestId("release-consequence")).toContainText("Not reversible");
        await expect(release.getByRole("button", { name: "Keep" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(release).toBeHidden();
      }

      await openTab(page, team, "health", "team/health");
      await expect(page.getByRole("list", { name: "Agents by health" })).toBeVisible({ timeout: LONG });
      await expect(page.locator("[data-health-group]").first()).toBeVisible();
      if (guided) await expect(page.getByTestId("module-screen").locator("[data-term='health']").first()).toHaveClass(/term-link/);
      // The card figures read in words (C20): "Last active" and "Failed sessions, 24 h", never "Heartbeat" or "Errors 24 h".
      await expect(page.locator("[data-health-group]").first()).toContainText("Last active");
      await expect(page.locator("[data-health-group]").first()).toContainText("Failed sessions, 24 h");
      await expect(page.getByTestId("module-screen")).not.toContainText(/Heartbeat|Errors 24 h/);
      // Each group says what its status means once, in its header; its cards never repeat that sentence.
      const repeats = await page.locator("[data-health-group]").evaluateAll((groups) =>
        groups.flatMap((g) => {
          const header = g.querySelector("[data-panel-header]");
          const leaves = header ? Array.from(header.querySelectorAll("*")).filter((e) => !e.children.length).map((e) => (e.textContent ?? "").trim()) : [];
          const sentence = leaves.filter((t) => t.endsWith(".")).sort((a, b) => b.length - a.length)[0];
          return sentence && (g.textContent ?? "").split(sentence).length - 1 > 1 ? [sentence] : [];
        }),
      );
      expect(repeats, "no health card repeats its group's description").toEqual([]);

      await openTab(page, team, "hierarchy", "team/hierarchy");
      await expect(page.getByRole("tree", { name: "Team hierarchy" })).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("hierarchy-summary")).toHaveText(/^Chief of Staff · \d+ leads? · \d+ specialists?$/);
      await expect(page.getByTestId("hierarchy-summary")).not.toContainText(/\b1 (leads|specialists)\b/);
      // Leads first: no background helper is a node; one line says they run.
      await expect(page.getByRole("tree", { name: "Team hierarchy" }).getByRole("treeitem", { name: /^Entity Linker,/ })).toHaveCount(0);
      await expect(page.getByTestId("background-helpers-line")).toContainText("5 background helpers also run");
      if (guided) await expect(page.getByTestId("module-screen").locator("[data-term='hierarchy']").first()).toHaveClass(/term-link/);
      // The whole chart fits the panel's width at both widths: no sideways scroll, and no node text under 11 px.
      const chart = await page.locator("[data-scroll-region=diagram]").first().evaluate((el) => ({
        overflow: el.scrollWidth - el.clientWidth,
        smallest: Math.min(...Array.from(el.querySelectorAll<HTMLElement>("[role=treeitem] .fit-text")).map((t) => parseFloat(getComputedStyle(t).fontSize))),
      }));
      expect(chart.overflow, "the hierarchy fits its panel without scrolling sideways").toBeLessThanOrEqual(1);
      expect(chart.smallest, "node text never drops below 11 px").toBeGreaterThanOrEqual(11);

      await openTab(page, team, "staff", "team/staff");
      await expect(page.getByRole("grid", { name: "People" })).toBeVisible({ timeout: LONG });
      // A member walled off a section says so ("Finance · no access"), never "Role default" (RUI-04).
      const walled = page.getByRole("grid", { name: "People" }).getByText(/· no access/);
      if (await walled.count()) await expect(walled.first()).toBeVisible();
      // Nobody edits their own role or permissions (team.humans.role refuses it): the founder's own row offers neither.
      await page.getByRole("grid", { name: "People" }).getByRole("row").filter({ hasText: "You" }).first().click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Role and permissions…" })).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
    });

    test("Team: signing is never offered to agents, and Recruitment drafts an agent with the generate action", async ({ page, playwright }) => {
      await openBusiness(page);
      const guided = await guidanceOn(playwright);
      const team = await departmentBase(page, /^team$/i);

      await openTab(page, team, "responsibilities", "team/responsibilities");
      // The everyday answers live in Settings › What the team can do; this table hands one decision to one person.
      const pointer = page.getByTestId("responsibilities-pointer");
      await expect(pointer).toContainText("Everyday choices live in Settings › What the team can do.", { timeout: LONG });
      await expect(pointer.getByRole("link", { name: "Settings › What the team can do" })).toHaveAttribute("href", /\/settings\/mode$/);
      const matrix = page.getByRole("grid", { name: "Responsibilities" });
      await expect(matrix.getByText("Sign contracts")).toBeVisible({ timeout: LONG });
      const signRow = matrix.getByRole("row").filter({ hasText: "Sign contracts" });
      // With only the founder on the staff there is no one to delegate signing to; with staff it reads "Delegate to staff…".
      const delegate = signRow.getByRole("button", { name: "Delegate Sign contracts" });
      if (await delegate.count()) await expect(delegate).toHaveText("Delegate to staff…");
      else await expect(signRow.getByText("Founder or staff only")).toBeVisible();
      expect(await headersInside(page, "Responsibilities")).toEqual([]);
      // The Simple view (guidance on, UX plan §7.10) leaves out what a decision covers; the All view carries it, and the
      // open view is saved per person, so the check picks it rather than assuming it.
      await chooseTableView(page, "All decisions");
      await expect(matrix.getByRole("columnheader", { name: /covers/i })).toHaveCount(1);
      expect(await headersInside(page, "Responsibilities")).toEqual([]);
      // Opening a decision's departments narrows the matrix: every column still fits and the detail says what it covers.
      await matrix.getByText("Message customers").click();
      await expect(page.getByRole("table", { name: "Message customers by department" })).toBeVisible({ timeout: LONG });
      await expect(page.getByRole("grid", { name: "Responsibilities" }).getByRole("columnheader", { name: /covers/i })).toHaveCount(0);
      expect(await headersInside(page, "Responsibilities"), "with the detail open nothing scrolls out of the matrix").toEqual([]);
      await expect(page.getByRole("grid", { name: "Responsibilities" }).getByRole("button", { name: "Delegate Hire agents" })).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("grid", { name: "Responsibilities" }).getByRole("columnheader", { name: /covers/i })).toHaveCount(1);

      // Playbooks (audit AC-07): a sentence becomes a flow the founder sees, saves off, turns on and removes again.
      const before = await page.getByTestId("playbook-row").count();
      await page.getByTestId("playbook-text").fill("When a lead replies positively, draft a reply and book a call; I approve the first message.");
      await page.getByTestId("playbook-preview").click();
      const flow = page.getByTestId("playbook-draft");
      await expect(flow.getByTestId("playbook-when")).toContainText(/lead replies/i, { timeout: LONG });
      await expect(flow.getByTestId("playbook-step").first()).toBeVisible();
      await page.getByTestId("playbook-save").click();
      await expect(page.getByTestId("playbook-row")).toHaveCount(before + 1, { timeout: LONG });
      const saved = page.getByTestId("playbook-row").last();
      await expect(saved.getByRole("button", { name: "Turn on" })).toBeVisible({ timeout: LONG });
      await saved.getByRole("button", { name: "Turn on" }).click();
      await expect(saved.getByRole("button", { name: "Turn off" })).toBeVisible({ timeout: LONG });
      await saved.getByRole("button", { name: /^Remove/ }).click();
      await expect(page.getByTestId("playbook-row")).toHaveCount(before, { timeout: LONG });

      await openTab(page, team, "recruitment", "team/recruitment");
      const draft = page.getByTestId("draft-agent");
      await expect(draft).toBeVisible({ timeout: LONG });
      await expect(draft).toBeDisabled();
      // The tab's explainer sits in the builder panel while guided; the key cap on the generate button is for
      // operators only (the shortcut works in both states).
      const recruitExplainer = page.locator("[data-explainer='team-recruitment']");
      if (guided) {
        await expect(recruitExplainer).toBeVisible();
        await expect(await openExplainer(page, "team-recruitment")).toContainText("Hire new agents");
        await page.keyboard.press("Escape");
        await expect(draft.locator("kbd")).toHaveCount(0);
      } else {
        await expect(recruitExplainer).toHaveCount(0);
        await expect(draft.locator("kbd")).toHaveText("⌘↵");
      }
      // The builder puts the template the sentence names first (TPD-26).
      await page.getByRole("textbox", { name: "Describe the agent" }).fill("an agent who writes our product documentation and help center articles");
      await expect(page.getByRole("list", { name: "Suggested templates" }).getByRole("listitem").first()).toHaveAttribute("data-suggestion", "docs_writer");
      await page.getByRole("textbox", { name: "Describe the agent" }).fill("an agent who writes our weekly customer newsletter");
      const suggestions = page.getByRole("list", { name: "Suggested templates" });
      await expect(suggestions).toBeVisible();
      // en-US percent: "60% fit", never "60 % fit".
      await expect(suggestions.getByText(/^\d+% fit$/).first()).toBeVisible();
      expect(await suggestions.innerText()).not.toMatch(/\d\s%/);
      await expect(draft).toBeEnabled();
      await draft.click();
      const dialog = page.getByTestId("hire-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: /^Hire / })).toBeVisible();
      // No promise of a first training run that never happens (TPD-11).
      await expect(dialog).not.toContainText(/First training run/);
      // What hiring does and what it can cost, under the form (ConsequenceLine, always); focus on the first field, not
      // the Estimate chip, so Escape closes the dialog itself.
      await expect(dialog.getByTestId("hire-consequence")).toContainText("Starts next cycle");
      await expect(dialog.getByTestId("hire-consequence")).toContainText(/Up to \$[\d,.]+\/mo \(Estimate\)/);
      await expect(dialog.getByRole("combobox", { name: "Department" })).toBeFocused();
      if (guided) await expect(dialog.locator("[data-reassurance]")).toContainText("let it go later");
      else await expect(dialog.locator("[data-reassurance]")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      const catalogue = page.getByRole("grid", { name: "Catalog" });
      await expect(catalogue.getByRole("row").nth(1)).toBeVisible();
      expect(await catalogue.getByRole("row").allTextContents(), "skills and departments read as words, never keys").not.toContainEqual(expect.stringMatching(/[a-z]_[a-z]/));
      expect(await headersInside(page, "Catalog")).toEqual([]);
      // The catalog says what it is (C10), its kind column is "Kind", and the moves read lend / duplicate / let go.
      await expect(page.getByTestId("catalogue-intro")).toHaveText("Ready-made agents. Hire one into a department and it starts next cycle.");
      await expect(catalogue.getByRole("columnheader", { name: /^Kind/ })).toBeVisible();
      await expect(catalogue.getByRole("columnheader", { name: /^Family/ })).toHaveCount(0);
      await page.getByRole("grid", { name: "Team moves" }).getByRole("row").nth(1).click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Lend to another department…" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Duplicate…" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Let go" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /Loan|Clone|Release/ })).toHaveCount(0);
      // Lending says what it does and that it can be undone (ConsequenceLine); moving changes the line.
      await page.getByRole("menuitem", { name: "Lend to another department…" }).click();
      const loan = page.getByTestId("loan-dialog");
      await expect(loan).toBeVisible();
      await expect(loan.getByTestId("loan-consequence")).toContainText("keeps its tasks, skills, tools and model");
      await expect(loan.getByTestId("loan-consequence")).toContainText("Reversible");
      await loan.getByRole("checkbox", { name: /Move instead of lending/ }).click();
      await expect(loan.getByTestId("loan-consequence")).toContainText("the new department's lead becomes its line manager");
      await page.keyboard.press("Escape");
      await expect(loan).toBeHidden();
    });

    test("Development: plan, pull requests, environments and specialists read as words and fit", async ({ page }) => {
      await openBusiness(page);
      // The sidebar lists areas, not departments: the seeded Development keeps the module's slug.
      const dev = departmentBaseFor("development");

      await openTab(page, dev, "plan", "development/plan");
      const tasks = page.getByRole("grid", { name: "Tasks" });
      await expect(tasks.getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
      await expect(tasks.getByRole("columnheader", { name: /progress/i })).toBeVisible();
      const firstFive = await tasks.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll<HTMLElement>("[role=columnheader]"))
          .slice(0, 7)
          .filter((h) => h.getBoundingClientRect().right > box.right + 1)
          .map((h) => h.textContent);
      });
      expect(firstFive, "Task, Run, Status, Kind, Agent, Progress and the … column fit the panel").toEqual([]);
      // The Run column: 44 px right after Task, a running task says so, a task behind another says what it runs after.
      const runHead = tasks.getByRole("columnheader", { name: "Run", exact: true });
      await expect(runHead).toBeVisible();
      expect(Math.round((await runHead.boundingBox())!.width), "the Run column is 44 px").toBe(44);
      expect(await tasks.getByRole("columnheader").evaluateAll((hs) => hs.slice(0, 2).map((h) => h.textContent?.trim())), "Run follows Task").toEqual(["Task", "Run"]);
      await expect(tasks.getByRole("img", { name: "Running now" }).first()).toBeVisible();
      const waiting = tasks.getByRole("row", { name: /Account page: refill schedule UI/ });
      await expect(waiting.getByRole("img", { name: "Runs after Subscription pause and skip finishes" })).toBeVisible();
      // Nothing on the screen asks the founder for a task graph.
      await expect(page.getByText(/task graph/i)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Plan something sooner" })).toBeVisible();
      // The … button on the first task row opens its menu (a real menu, not a right-click only), with Start in it.
      await tasks.getByRole("row").nth(1).getByRole("button", { name: /^Actions for / }).click();
      const rowMenu = page.getByRole("menu", { name: "Row actions" });
      await expect(rowMenu.getByRole("menuitem", { name: "Start" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(rowMenu).toBeHidden();
      // The task behind an open dependency cannot start: Start is off in its menu.
      await waiting.getByRole("button", { name: /^Actions for / }).click();
      await expect(rowMenu.getByRole("menuitem", { name: "Start" })).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
      const kinds = await tasks.locator("[data-col=kind]").allTextContents();
      expect(kinds.filter((k) => /^[a-z]/.test(k.trim())), "task kinds are words (Specialist), not keys (specialist)").toEqual([]);

      await openTab(page, dev, "pull-requests", "development/pull-requests");
      await expect(page.getByRole("grid", { name: "Merged pull requests" })).toBeVisible({ timeout: LONG });
      await expect(page.getByText(/AC-\d/)).toHaveCount(0);
      expect(await headersInside(page, "Merged pull requests")).toEqual([]);
      // The merge queue's own merges are listed (the seed has done code tasks), and nothing claims to be deploying (TPD-14, TPD-15).
      await expect(page.getByRole("grid", { name: "Merged pull requests" }).getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
      await expect(page.getByText("Deploying…")).toHaveCount(0);
      // Only code tasks are pull requests: the Formulation Chemist's stability-data task is not one (TPD-13).
      await expect(page.getByRole("grid", { name: "Open pull requests" }).getByText(/Stability data/)).toHaveCount(0);

      // The Formulation Lab (Operations) shows the Specialists and Plan tabs only, not a copy of Development (DB-11). The
      // name is a label over the operations module: Settings › Departments › Reset to defaults (settings-departments.spec)
      // gives it back its default name, so either label finds it.
      const lab = departmentBaseFor("operations");
      await page.goto(`${lab}/specialists`);
      await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/specialists", { timeout: LONG });
      // Its tabs sit in the Product area's bar (by module, docs/DESIGN.md §9), each naming the lab beside Development's.
      const labTabs = page.getByRole("tablist", { name: "Product tabs" }).locator(`[role=tab][id^="tab-${lab.split("/").pop()}/"]`);
      await expect(labTabs).toHaveText([/^Specialists · (Formulation Lab|Operations)/, /^Plan · (Formulation Lab|Operations)/]);

      // One finished change saved with nowhere to push (WP-05 T8): the first queue merge of the real answer is marked
      // `landed: "saved_only"`, as dev.prs.list marks a task whose latest completion says so (dev-prs.test.ts).
      await page.route(/\/trpc\/[^?]*dev\.prs\.list/, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: withOneSavedOnly(await response.json()) });
      });
      await openTab(page, dev, "environments", "development/environments");
      const envs = page.getByRole("grid", { name: "Environments" });
      await expect(envs).toBeVisible({ timeout: LONG });
      const pills = await envs.locator("[data-tone]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(pills, "state pills are never cut").toEqual([]);
      expect(await headersInside(page, "Environments")).toEqual([]);
      // Live and awaiting branches come before the merged history.
      const states = await envs.locator("[role=row]").evaluateAll((rows) => rows.slice(1).map((r) => (/Saved, not live anywhere|Live|Awaiting deployment|Merged|Stopped/.exec(r.textContent ?? "") ?? [""])[0]));
      // Saved and merged rows share a rank (both finished history).
      const rank = (s: string) => ["Live", "Awaiting deployment", "Merged", "Stopped"].indexOf(s === "Saved, not live anywhere" ? "Merged" : s);
      expect(states.map(rank), "rows ordered live, awaiting, merged or saved, stopped").toEqual([...states.map(rank)].sort((a, b) => a - b));
      // A change finished with nowhere to push reads as saved with its task, not live anywhere (WP-05 T8, D3).
      const savedPill = envs.locator("[data-status-pill]", { hasText: "Saved, not live anywhere" }).first();
      await expect(savedPill).toBeVisible();
      await expect(savedPill).toHaveAttribute("title", "The work is kept with this task. It goes live once the project has a place to publish.");
      await expect(page.getByTestId("env-saved-only")).toContainText("Saved, not live anywhere: The work is kept with this task.");
      // Branches read as their tasks ("order-webhook-hardening-3"), the git branch (agent/<task id>) in the tooltip. The
      // Simple view (guidance on, UX plan §7.10) leaves the Branch column out, so the check reads the full view.
      await chooseTableView(page, "All environments");
      await expect(envs.locator("[data-branch]").first()).toBeVisible({ timeout: LONG });
      const branches = await envs.locator("[data-branch]").evaluateAll((els) => els.map((e) => ({ shown: (e.textContent ?? "").trim(), raw: e.getAttribute("data-branch") ?? "", title: e.getAttribute("title") ?? "" })));
      expect(branches.length, "the seed has agent branches").toBeGreaterThan(0);
      for (const b of branches.filter((x) => x.raw.startsWith("agent/"))) {
        expect(b.shown, `${b.raw} shows a readable name`).not.toMatch(/agent\/|[0-9a-f]{8}-[0-9a-f]{4}/);
        expect(b.title).toBe(`Branch ${b.raw}`);
      }

      await openTab(page, dev, "specialists", "development/specialists");
      await expect(page.getByTestId("specialist-counts")).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("specialist-counts")).not.toContainText(/\b1 specialists\b/);
      // Specialists are agents and tasks are tasks: "4 specialists · 30 tasks", never 30 specialists (TPD-22).
      const counts = ((await page.getByTestId("specialist-counts").textContent()) ?? "").replace(/\s+/g, " ").trim();
      const parsed = /^(\d+) specialists? · (\d+) tasks? · \d+ running · \d+ reporting$/.exec(counts);
      expect(parsed, `header reads "N specialists · N tasks · …": ${counts}`).not.toBeNull();
      expect(Number(parsed![1]), "no more specialists than tasks").toBeLessThanOrEqual(Number(parsed![2]));
      // A ready task that never started is not finished (AC-11): the finished list never shows a Ready pill.
      const quiet = page.getByTestId("specialists-quiet");
      if (await quiet.count()) await expect(quiet.getByRole("table")).not.toContainText("Ready");
      const tiles = await page.getByRole("article").count();
      expect(tiles, "finished specialists with nothing to show collapse into one list, not a wall of tiles").toBeLessThanOrEqual(12);
      await expect(page.locator("[data-module-screen='development/specialists']")).not.toContainText("€");
    });
  });
}

test.describe("saved table views on module screens", () => {
  test("Team › Agents: a view saved as new comes back after a reload, and deleting it sticks (audit #204)", async ({ page }) => {
    await openBusiness(page);
    const team = await departmentBase(page, /^team$/i);
    await openTab(page, team, "squad", "team/squad");
    await chooseTableView(page, "General");
    const name = `E2E agents ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: /^View: / }).click();
    await page.getByRole("menuitem", { name: "Save as new view…" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: `View: ${name}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("treegrid", { name: "Agents" })).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("button", { name: `View: ${name}` })).toBeVisible({ timeout: LONG });
    await page.getByRole("button", { name: `View: ${name}` }).click();
    await page.getByRole("menuitem", { name: "Delete view" }).click();
    // Deleting the open view falls back to the table's default: Simple while guidance is on (UX plan §7.10).
    await expect(page.getByRole("button", { name: "View: Simple" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "View: Simple" })).toBeVisible({ timeout: LONG });
    await page.getByRole("button", { name: "View: Simple" }).click();
    await expect(page.getByRole("menuitemradio", { name })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
