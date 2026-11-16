// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME, APP_ORIGIN } from "@foundmill/config";
import { SWITCHES_OFF } from "../flags";
import { HOME_DESCRIPTION, HOME_SHARE_IMAGE, HOME_TITLE, HomeJsonLd, homeJsonLd, homeMetadata } from "../seo";
import { LANDING_WORDS } from "../words";

describe("the home page's metadata (DIRECTION §4 'Metadata')", () => {
  it("has a title and description written for the first-timer, and a canonical address", () => {
    const m = homeMetadata(SWITCHES_OFF);
    expect(m.title).toEqual({ absolute: HOME_TITLE });
    expect(HOME_TITLE).toBe(`${APP_NAME} | Start your first project with one sentence`);
    expect(m.description).toBe(HOME_DESCRIPTION);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(m.alternates?.canonical).toBe("/");
  });

  it("shares with its own image, title and description", () => {
    const m = homeMetadata(SWITCHES_OFF);
    expect(m.openGraph).toMatchObject({ title: HOME_TITLE, description: HOME_DESCRIPTION, url: "/", siteName: APP_NAME, type: "website", locale: "en_US" });
    expect(m.openGraph?.images).toEqual([{ url: HOME_SHARE_IMAGE, width: 1200, height: 630, alt: expect.any(String) }]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: [HOME_SHARE_IMAGE] });
  });

  it("stays out of search until sign-up opens, then is indexed with no other change (founder, Nov 15)", () => {
    expect(homeMetadata({ ...SWITCHES_OFF, signupOpen: false }).robots).toEqual({ index: false, follow: false });
    expect(homeMetadata({ ...SWITCHES_OFF, signupOpen: true }).robots).toEqual({ index: true, follow: true });
  });
});

describe("the home page's structured data (one JSON-LD block)", () => {
  const graph = homeJsonLd()["@graph"];
  it("names the organization, the site and the app with a free offer, and no FAQ markup", () => {
    expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    const app = graph[2] as Record<string, unknown>;
    expect(app).toMatchObject({ name: APP_NAME, applicationCategory: "BusinessApplication", operatingSystem: "Web", url: `${APP_ORIGIN}/` });
    expect(app.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(app.description).toBe(LANDING_WORDS.footer.what);
    expect(JSON.stringify(graph)).not.toMatch(/FAQPage|HowTo|aggregateRating|review/i);
  });
  it("renders one script block whose content cannot close the tag", () => {
    const html = renderToStaticMarkup(<HomeJsonLd />);
    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(1);
    expect(html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"))).not.toContain("<");
  });
});
