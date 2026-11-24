/**
 * The hosted browser's test page (founder, Nov 24, 2026): a few static pages Foundmill controls, at
 * `browser-test.<SITES_DOMAIN>`, for the first live connect and for the browser evals, in place of a third party's site.
 * It is on the site list as a test-only entry that founders never see (packages/connectors `browser-sites.ts`).
 *
 * Static, like every site here: no script, no cookie, nothing stored. A "save" is a form that sends its values back in
 * the address, and the page shows them, so a step can be checked by reading the page back. It also has a plan page
 * with a paying button (a hard stop) and a page that looks like a bot check (handed to the founder).
 */
import { escapeHtml } from "./pages";

export const BROWSER_TEST_LABEL = "browser-test";

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:.75rem 0 .25rem}nav a{margin-right:1rem}</style></head><body><nav><a href="/">Settings</a><a href="/plan">Plan</a><a href="/verify">Check</a></nav><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

const value = (q: URLSearchParams, name: string) => (q.get(name) ?? "").slice(0, 200);

/** The test page for a path, or null for a path it does not have. */
export function browserTestPage(path: string, query: URLSearchParams): string | null {
  if (path === "/" || path === "/settings") {
    return page(
      "Business settings",
      `<p>This is a test page for the team's hosted browser. Nothing here is real.</p><form action="/saved" method="get"><label for="business_name">Business name</label><input id="business_name" name="business_name" type="text"><label for="tax_rate">Default tax rate</label><input id="tax_rate" name="tax_rate" type="text"><p><button type="submit">Save</button></p></form>`,
    );
  }
  if (path === "/saved") {
    const name = value(query, "business_name");
    const tax = value(query, "tax_rate");
    return page("Saved", `<p>Your settings are saved.</p><p>Business name: ${escapeHtml(name || "(empty)")}</p><p>Default tax rate: ${escapeHtml(tax || "(empty)")}</p><p><a href="/">Change them</a></p>`);
  }
  if (path === "/plan") return page("Choose a plan", `<p>Starter plan. Total due today $29.00.</p><form action="/plan/confirm" method="get"><button type="submit">Buy now</button></form>`);
  if (path === "/plan/confirm") return page("Thank you", "<p>Nothing was bought: this is a test page.</p>");
  if (path === "/verify") return page("One more step", `<p>Confirm you are human to continue.</p><div class="g-recaptcha" data-sitekey="test"></div><label><input type="checkbox" name="human"> I am not a robot</label>`);
  return null;
}
