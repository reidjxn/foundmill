import { expect, test } from "@playwright/test";

/**
 * WP-03 T6: robots.txt, sitemap.xml, /llms.txt and the 404 for an address that is no route. Meant for a production
 * build (`next build && next start`, E2E_BASE_URL pointing at it), where these files are generated as a visitor gets them.
 * Whether the site is open to search follows the build's SIGNUP_OPEN (on a production origin), so the spec reads the same
 * variable. Signed out, with no stored session.
 */
const OPEN = /^(1|true|yes|on)$/i.test((process.env.SIGNUP_OPEN ?? "").trim());

test.use({ storageState: { cookies: [], origins: [] } });

test("robots.txt follows open sign-up", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const body = await res.text();
  if (OPEN) {
    expect(body).toContain("Allow: /");
    expect(body).toContain("Disallow: /api/");
    expect(body).toMatch(/Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
    expect(body).toMatch(/User-Agent: GPTBot[\s\S]*?Disallow: \/p\/\s+Disallow: \/u\//);
  } else {
    expect(body).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/);
    expect(body).not.toContain("Sitemap:");
  }
});

test("sitemap.xml lists the home page and the legal pages, with no priority", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("xml");
  const body = await res.text();
  for (const path of ["/", "/terms", "/privacy"]) expect(body).toContain(`<loc>https://foundmill.com${path}</loc>`);
  expect(body).not.toMatch(/<priority>|<changefreq>/);
});

test("/llms.txt is plain text and says the examples are not customers", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const body = await res.text();
  expect(body).toMatch(/^# Foundmill/);
  expect(body).toContain("examples, not customers");
});

test("an address that is no route answers 404 for a signed-out visitor, not a sign-in", async ({ page }) => {
  for (const path of ["/pricing-nope", "/.well-known/nope"]) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(404);
    await expect(page).toHaveURL(new RegExp(`${path.replace(/[.]/g, "\\.")}$`));
  }
  await page.goto("/pricing-nope");
  await expect(page.getByText("Nothing at this address")).toBeVisible();
  // An app screen still asks for a sign-in.
  await page.goto("/b/x");
  await expect(page).toHaveURL(/\/login\?next=/);
});
