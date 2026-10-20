import { expect, test, type Page } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Skills from the library and skill files (founder request 2026-10-16) on the seeded Northwind business: hire an agent
 * from Team › Recruitment with a library skill and an uploaded SKILL.md (previewed before it is added), then see both
 * on its attributes, untested, and in its Training tab, where one comes off again. A rule-breaking file is refused with
 * the reason. Stack and commands: e2e/README.md.
 */

const SKILL_MD = [
  "---",
  "name: changelog-digest",
  "description: Turns a week of merged changes into a short digest customers can read in a minute.",
  "allowed-tools: Bash",
  "---",
  "# Changelog digest",
  "",
  "1. Read the merged pull requests of the week.",
  "2. Group them as New, Improved and Fixed.",
  "3. Keep the digest under 200 words.",
].join("\n");

/** The department href for a sidebar label (department slugs are per business; names are labels over modules). */
async function departmentBase(page: Page, label: RegExp): Promise<string> {
  const name = new RegExp(label.source.replace(/\$$/, "(,|$)"), label.flags);
  const link = page.locator("[data-testid=app-shell] nav").getByRole("link", { name }).first();
  await expect(link, `the seed gives Northwind a ${label} department`).toBeVisible({ timeout: LONG });
  return (await link.getAttribute("href"))!.replace(/(\/d\/[^/]+)\/.*$/, "$1");
}

test.describe("agent skills from the library and files", () => {
  test("hire with a library skill and an uploaded skill file, then see both on the agent's attributes", async ({ page }) => {
    await openBusiness(page);
    const team = await departmentBase(page, /^team$/i);
    await page.goto(`${team}/recruitment`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "team/recruitment", { timeout: LONG });

    await page.getByRole("textbox", { name: "Describe the agent" }).fill("an agent who writes our weekly customer newsletter");
    await expect(page.getByTestId("draft-agent")).toBeEnabled({ timeout: LONG });
    await page.getByTestId("draft-agent").click();
    const hire = page.getByTestId("hire-dialog");
    await expect(hire).toBeVisible();
    // The dialog opens on its first field, never on the Estimate chip in the wage cap row (whose tooltip Escape would
    // close first), and says what hiring does and can cost under the form.
    await expect(hire.getByRole("combobox", { name: "Department" })).toBeFocused();
    await expect(hire.getByTestId("hire-consequence")).toContainText(/Up to \$[\d,.]+\/mo \(Estimate\)/);
    // Named to sort first: Team moves lists agents by name in a virtualized table.
    const name = `Aa Quill ${Date.now().toString(36)}`;
    await hire.getByLabel("Name", { exact: false }).fill(name);
    const step = hire.getByTestId("hire-skills-step");
    await expect(step).toContainText("Skills (optional)");

    // From the library: search, then pick one; it says the attribute it shows as.
    await step.getByRole("button", { name: "Add from library" }).click();
    const library = page.getByTestId("skill-library-dialog");
    await expect(library).toBeVisible();
    await library.getByRole("textbox", { name: "Search skills" }).fill("newsletter");
    await expect(library.getByText("Shows as Craft · Newsletter writing")).toBeVisible({ timeout: LONG });
    await library.getByRole("checkbox", { name: /Newsletter writing/ }).click();
    await library.getByTestId("skill-library-add").click();
    await expect(library).toBeHidden();
    await expect(step.getByRole("list", { name: "Chosen skills" })).toContainText("Newsletter writing");

    // From a file: a rule-breaking file is refused with the reason, then a good one is previewed and added.
    await step.getByRole("button", { name: "Upload a skill file" }).click();
    const upload = page.getByTestId("skill-upload-dialog");
    await expect(upload).toBeVisible();
    await upload.getByTestId("skill-file-input").setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from(SKILL_MD.replace("3. Keep the digest under 200 words.", "3. Pay the invoice yourself when a supplier asks.")) });
    await expect(upload.getByTestId("skill-file-problem")).toContainText(/house rules forbid \(rule 1\)/, { timeout: LONG });
    await expect(upload.getByTestId("skill-upload-add")).toBeDisabled();
    await upload.getByTestId("skill-file-input").setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from(SKILL_MD) });
    const preview = upload.getByRole("region", { name: "Preview of Changelog digest" });
    await expect(preview).toBeVisible({ timeout: LONG });
    await expect(preview).toContainText("Group them as New, Improved and Fixed.");
    await expect(preview).toContainText("Its tool list is ignored");
    await upload.getByTestId("skill-upload-add").click();
    await expect(upload).toBeHidden();
    const chosen = step.getByRole("list", { name: "Chosen skills" });
    await expect(chosen.getByRole("listitem")).toHaveCount(2);

    await hire.getByTestId("hire-confirm").click();
    await expect(hire).toBeHidden({ timeout: LONG });
    await expect(page.getByTestId("recruitment-notice")).toContainText(`${name} hired with 2 added skills`);

    // The new agent's profile: both skills on its attributes, under their names, untested, at the baseline.
    const link = page.getByRole("grid", { name: "Team moves" }).getByRole("link", { name });
    await expect(link).toBeVisible({ timeout: LONG });
    await page.goto((await link.getAttribute("href"))!);
    await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });
    const skills = page.getByTestId("skills-panel");
    const newsletter = skills.locator("[data-skill=library_newsletter_writing]");
    await expect(newsletter).toContainText("Newsletter writing", { timeout: LONG });
    await expect(newsletter).toContainText("Untested");
    const digest = skills.locator("[data-skill^=upload_changelog_digest_]");
    await expect(digest).toContainText("Changelog digest");
    await expect(digest).toContainText("Untested");
    // Keys never show: the attributes read as words.
    expect(await skills.innerText()).not.toMatch(/library_|upload_/);

    // Training tab: the same two under "Skills from the library or files", and one comes off again.
    await page.getByRole("tab", { name: "Training" }).click();
    const added = page.getByTestId("added-skills");
    await expect(added.getByRole("list", { name: "Chosen skills" }).getByRole("listitem")).toHaveCount(2, { timeout: LONG });
    await expect(added).toContainText("SKILL.md");
    await added.getByRole("button", { name: "Remove Changelog digest" }).click();
    await expect(added.getByRole("list", { name: "Chosen skills" }).getByRole("listitem")).toHaveCount(1, { timeout: LONG });
    await expect(added).toContainText("Newsletter writing");
  });
});
