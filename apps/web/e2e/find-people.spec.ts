import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import { API_URL, LONG, expectTapTarget, signInAs } from "./helpers";

/**
 * One identity and Find people (docs/NETWORK.md F16; a9 A9-P1-3): a person who published /u/<handle> is found on
 * /network at 390 px by words and by what they are good at, opens on the network's person page with what their page
 * says, and turns up in the name search too. A person building on their own reads like anyone: their row never says
 * so (the solo guard, NETWORK §10).
 */

async function as(
  playwright: PlaywrightWorkerArgs["playwright"],
  userId: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { authorization: `Bearer dev:${userId}` },
  });
}

async function call(api: APIRequestContext, path: string, json: unknown): Promise<void> {
  const res = await api.post(`/trpc/${path}`, { data: { json } });
  expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
}

test.describe("find people", () => {
  const person = randomUUID();
  const viewer = randomUUID();
  const tag = person.slice(0, 6);
  const name = `Sky Baker ${tag}`;
  const handle = `sky-${tag}`;
  const headline = `Sourdough by bike ${tag}`;

  test.beforeAll(async ({ playwright }) => {
    const p = await as(playwright, person);
    await call(p, "founder.profile.update", { displayName: name, confirmAdult: true });
    await call(p, "founder.publicProfile.publish", {
      handle,
      content: {
        headline,
        about: "Bread for the neighborhood.",
        strengths: [`Baking${tag}`, "Sales"],
        wantsToLearn: ["Pricing"],
        lookingFor: "on_my_own",
        place: "Leeds, UK",
      },
    });
    await p.dispose();
    const v = await as(playwright, viewer);
    await call(v, "founder.profile.update", { displayName: "Viewer", confirmAdult: true });
    await v.dispose();
  });

  test("at 390 px: found by words and by what they are good at, opened on the network with their page's words", async ({
    page,
  }) => {
    test.setTimeout(LONG * 4);
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, viewer, "/network");
    const panel = page.getByTestId("find-people");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);

    await panel.getByTestId("find-people-good-at").fill(`baking${tag}`);
    const row = panel.locator(`[data-person-handle="${handle}"]`);
    await expect(row).toBeVisible({ timeout: LONG });
    await expect(panel.getByTestId("find-people-row")).toHaveCount(1);
    await expect(row).toContainText(headline);
    await expect(row).toContainText("Leeds, UK");
    // Building on their own: the row says nothing about people.
    await expect(row).not.toContainText(/own|cofounder|partner/i);
    await expectTapTarget(row);

    await panel.getByTestId("find-people-good-at").fill("");
    await panel.getByTestId("find-people-q").fill(tag);
    await expect(row).toBeVisible({ timeout: LONG });

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/profiles/founder/${person}$`), { timeout: LONG });
    const about = page.getByTestId("profile-person");
    await expect(about).toBeVisible({ timeout: LONG });
    await expect(about).toContainText(headline);
    await expect(about).toContainText("Bread for the neighborhood.");
    await expect(page.getByTestId("profile-looking-for")).toHaveCount(0);
    await expect(page.getByTestId("profile-person-page")).toHaveAttribute("href", `/u/${handle}`);
    await expect(page.getByTestId("profile-report-open")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // The name search finds the same person, as their page.
    await page.goto("/network");
    const search = page.getByTestId("people-search");
    await expect(search).toBeVisible({ timeout: LONG });
    await search.getByTestId("people-search-input").fill(name);
    await expect(search.getByTestId("people-search-results")).toContainText(name, {
      timeout: LONG,
    });
    await expect(search.getByTestId("people-search-results")).toContainText(headline);
  });
});
