import { describe, expect, it } from "vitest";
import { screenSiteFiles, siteHeldSentence, type SiteRule, type SiteScreenFile } from "../site-screen";

const html = (body: string, path = "index.html"): SiteScreenFile => ({ path, size: body.length, text: `<!doctype html><html><head><title>Lunchbox</title><link rel="stylesheet" href="styles.css"></head><body>${body}</body></html>` });
const CLEAN = html(
  `<h1>Lunchbox</h1><p>Fresh lunches for offices. Write to <a href="mailto:hello@lunchbox.example">hello@lunchbox.example</a>.</p>` +
    `<img src="logo.png" alt=""><a href="about.html">About</a> <a href="https://example.com">Partner</a> <a href="#top">Top</a>` +
    `<form method="post" action="/_fm/follow"><input type="email" name="email" required><button>Sign up</button></form>`,
);
const CSS: SiteScreenFile = { path: "styles.css", size: 40, text: "body{font:16px system-ui;background:url(bg.png)}" };

const rules = (files: SiteScreenFile[]): SiteRule[] => [...new Set(screenSiteFiles(files).flags.map((f) => f.rule))];
const withIndex = (...files: SiteScreenFile[]) => [CLEAN, ...files];

describe("screenSiteFiles", () => {
  it("passes a clean page with a sign-up form, a stylesheet and an image", () => {
    expect(screenSiteFiles([CLEAN, CSS, { path: "logo.png", size: 1000 }]).flags).toEqual([]);
  });

  it.each<[SiteRule, SiteScreenFile[]]>([
    ["too_many_files", withIndex(...Array.from({ length: 200 }, (_, i) => ({ path: `img/${i}.png`, size: 1 })))],
    ["too_large", withIndex(...Array.from({ length: 6 }, (_, i) => ({ path: `img/${i}.png`, size: 2 * 1024 * 1024 })))],
    ["file_too_large", withIndex({ path: "big.png", size: 3 * 1024 * 1024 })],
    ["path", withIndex({ path: ".env", size: 1 })],
    ["path", withIndex({ path: "_fm/follow.html", size: 1, text: "" })],
    ["file_type", withIndex({ path: "app.js", size: 1 })],
    ["file_type", withIndex({ path: "package.json", size: 1 })],
    ["no_index", [{ path: "about.html", size: 10, text: "<p>About</p>" }]],
    ["script", [html("<script>alert(1)</script>")]],
    ["embed", [html('<iframe src="https://evil.example"></iframe>')]],
    ["embed", [html('<base href="https://evil.example/">')]],
    ["meta_refresh", [html('<meta http-equiv="refresh" content="0;url=https://evil.example">')]],
    ["event_handler", [html('<img src="a.png" onerror="x()">')]],
    ["unsafe_url", [html('<a href="javascript:alert(1)">x</a>')]],
    ["form_action", [html('<form action="https://evil.example/collect"><input name="email"></form>')]],
    ["form_action", [html('<form><input name="email"></form>')]],
    ["sensitive_input", [html('<form action="/_fm/follow"><input type="password" name="p"></form>')]],
    ["sensitive_input", [html('<form action="/_fm/follow"><input name="c" autocomplete="cc-number"></form>')]],
    ["link_scheme", [html('<a href="http://insecure.example">x</a>')]],
    ["link_scheme", [html('<a href="tel:5552013344">call</a>')]],
    ["payment_link", [html('<a href="https://buy.stripe.com/test_abc">Buy</a>')]],
    ["payment_link", [html('<a href="https://checkout.stripe.com/c/pay/x">Pay</a>')]],
    ["css_import", withIndex({ path: "a.css", size: 10, text: "@import url(b.css);" })],
    ["css_outside_url", withIndex({ path: "a.css", size: 10, text: "body{background:url(https://tracker.example/p.gif)}" })],
    ["swallows_footer", [html("<p>hi</p><!--")]],
    ["swallows_footer", [html("<plaintext>")]],
    ["swallows_footer", withIndex({ path: "a.css", size: 10, text: "[data-fm-footer]{display:none!important}" })],
    ["swallows_footer", [html("<p>ok</p>").text ? { ...html("<p>ok</p>"), text: `${html("<p>ok</p>").text}<!-- </body> -->` } : html("")]],
    ["swallows_footer", [html("<p>a</p><!-- one --><p>b</p><!--")]],
    ["swallows_footer", [html("<textarea><p>b</p></title>")]],
    ["swallows_footer", [html("<template><p>b</p>")]],
    ["swallows_footer", withIndex({ path: "a.css", size: 10, text: "body{transform:scale(0)}" })],
    ["swallows_footer", withIndex({ path: "a.css", size: 10, text: "[data-fm-foote\\72]{display:none}" })],
    ["unreadable", withIndex({ path: "about.html", size: 10 })],
    ["markup_text", [html("<p>&lt;script&gt; is shown, and so is javascript: here</p>")]],
    ["personal_data", [html("<p>Call us on 555-201-3344</p>")]],
  ])("flags %s", (rule, files) => {
    expect(rules(files)).toContain(rule);
  });

  it("passes ordinary comments, a closed textarea and transforms on other elements", () => {
    expect(rules([html("<!-- nav --><p>a</p><!-- end --><textarea name=x></textarea>")])).toEqual([]);
    expect(rules([CLEAN, { path: "a.css", size: 10, text: ".card:hover{transform:scale(1.02)} body{color:#222}" }])).toEqual([]);
  });

  it("reads tags in any case and with odd spacing", () => {
    expect(rules([html("<SCRIPT >x</SCRIPT>")])).toContain("script");
    expect(rules([html('<a HREF = "JavaScript:x()">x</a>')])).toContain("unsafe_url");
  });

  it("names the rule in plain words for a held release", () => {
    const { flags } = screenSiteFiles([html("<script>x</script>")]);
    expect(siteHeldSentence(flags)).toBe("Held back: it contains a script. The next round of work fixes it.");
  });
});
