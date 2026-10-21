import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { LONG, chooseTableView, devApi, openBusiness } from "./helpers";

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
}

/** The right edge of every column header in a grid sits inside the grid's own box (no header cut at the edge). */
async function headersInside(page: Page, grid: string): Promise<string[]> {
  return page.getByRole("grid", { name: grid }).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll<HTMLElement>("[role=columnheader]"))
      .filter((h) => (h.textContent ?? "").trim())
      .filter((h) => h.getBoundingClientRect().right > box.right + 1)
      .map((h) => (h.textContent ?? "").trim());
  });
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
      const agents = page.getByRole("grid", { name: "Agents" });
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
        await expect(explainer).toContainText("Everyone who works here. Agents have skills 1–20");
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
      await expect(page.getByTestId("squad-summary")).toContainText(/\d+ agents?/);
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
      await expect(page.getByTestId("hierarchy-summary")).not.toContainText(/\b1 (agents|leads|workers)\b/);
      if (guided) await expect(page.getByTestId("module-screen").locator("[data-term='hierarchy']").first()).toHaveClass(/term-link/);
      // The whole chart fits the panel's width at both widths: no sideways scroll, and no node text under 11 px.
      const chart = await page.locator("[data-scroll-region=diagram]").first().evaluate((el) => ({
        overflow: el.scrollWidth - el.clientWidth,
        smallest: Math.min(...Array.from(el.querySelectorAll<HTMLElement>("[role=treeitem] .fit-text")).map((t) => parseFloat(getComputedStyle(t).fontSize))),
      }));
      expect(chart.overflow, "the hierarchy fits its panel without scrolling sideways").toBeLessThanOrEqual(1);
      expect(chart.smallest, "node text never drops below 11 px").toBeGreaterThanOrEqual(11);

      await openTab(page, team, "staff", "team/staff");
      await expect(page.getByRole("grid", { name: "Staff" })).toBeVisible({ timeout: LONG });
      // A member walled off a section says so ("Finance · no access"), never "Role default" (RUI-04).
      const walled = page.getByRole("grid", { name: "Staff" }).getByText(/· no access/);
      if (await walled.count()) await expect(walled.first()).toBeVisible();
      // Nobody edits their own role or permissions (team.humans.role refuses it): the founder's own row offers neither.
      await page.getByRole("grid", { name: "Staff" }).getByRole("row").filter({ hasText: "You" }).first().click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Role and permissions…" })).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
    });

    test("Team: signing is never offered to agents, and Recruitment drafts an agent with the generate action", async ({ page, playwright }) => {
      await openBusiness(page);
      const guided = await guidanceOn(playwright);
      const team = await departmentBase(page, /^team$/i);

      await openTab(page, team, "responsibilities", "team/responsibilities");
      const matrix = page.getByRole("grid", { name: "Responsibilities" });
      await expect(matrix.getByText("Sign contracts")).toBeVisible({ timeout: LONG });
      const signRow = matrix.getByRole("row").filter({ hasText: "Sign contracts" });
      // With only the founder on the staff there is no one to delegate signing to; with staff it reads "Delegate to staff…".
      const delegate = signRow.getByRole("button", { name: "Delegate Sign contracts" });
      if (await delegate.count()) await expect(delegate).toHaveText("Delegate to staff…");
      else await expect(signRow.getByText("Founder or staff only")).toBeVisible();
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
        await expect(recruitExplainer).toContainText("Hire new agents");
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
      const dev = await departmentBase(page, /development/i);

      await openTab(page, dev, "plan", "development/plan");
      const tasks = page.getByRole("grid", { name: "Tasks" });
      await expect(tasks.getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
      await expect(tasks.getByRole("columnheader", { name: /progress/i })).toBeVisible();
      const firstFive = await tasks.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll<HTMLElement>("[role=columnheader]"))
          .slice(0, 5)
          .filter((h) => h.getBoundingClientRect().right > box.right + 1)
          .map((h) => h.textContent);
      });
      expect(firstFive, "Task, Status, Kind, Agent and Progress fit the panel").toEqual([]);
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

      // The Formulation Lab (Operations) shows the Specialists and Plan tabs only, not a copy of Development (DB-11).
      const lab = await departmentBase(page, /formulation lab/i);
      await page.goto(`${lab}/specialists`);
      await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/specialists", { timeout: LONG });
      const labTabs = page.getByRole("tablist").first().getByRole("tab");
      await expect(labTabs).toHaveText([/Specialists/, /Plan/]);

      await openTab(page, dev, "environments", "development/environments");
      const envs = page.getByRole("grid", { name: "Environments" });
      await expect(envs).toBeVisible({ timeout: LONG });
      const pills = await envs.locator("[data-tone]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(pills, "state pills are never cut").toEqual([]);
      expect(await headersInside(page, "Environments")).toEqual([]);
      // Live and awaiting branches come before the merged history.
      const states = await envs.locator("[role=row]").evaluateAll((rows) => rows.slice(1).map((r) => (/Live|Awaiting deployment|Merged|Stopped/.exec(r.textContent ?? "") ?? [""])[0]));
      const rank = (s: string) => ["Live", "Awaiting deployment", "Merged", "Stopped"].indexOf(s);
      expect(states.map(rank), "rows ordered live, awaiting, merged, stopped").toEqual([...states.map(rank)].sort((a, b) => a - b));
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
    await expect(page.getByRole("grid", { name: "Agents" })).toBeVisible({ timeout: LONG });
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
