import { describe, expect, it } from "vitest";
import { sanitiseSvg, SVG_INTRINSIC_PX } from "./logo-svg";

const wrap = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const ok = (input: string) => {
  const r = sanitiseSvg(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r;
};
/** Nothing executable or external may survive, whatever the input did. */
const assertInert = (output: string) => {
  const svg = output.replace('xmlns="http://www.w3.org/2000/svg"', "");
  expect(svg).not.toMatch(/<script|<foreignObject|<image|<iframe|<object|<embed|<a[\s>]|<set|<animate|<style/i);
  expect(svg).not.toMatch(/\son[a-z]+=/i);
  expect(svg).not.toMatch(/javascript:|data:|https?:|@import|expression\(/i);
};

describe("sanitiseSvg: what survives", () => {
  it("keeps shapes, gradients, clip paths, internal references and text, and writes a canonical root", () => {
    const r = ok(
      wrap(
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B4FD8"/><stop offset="1" stop-color="#f5c400"/></linearGradient><clipPath id="c"><rect width="100" height="100" rx="18"/></clipPath></defs>' +
          '<g clip-path="url(#c)"><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="20" fill="#fff" fill-opacity="0.9"/></g>' +
          '<path d="M10 10 L90 10 L50 90 Z" fill="none" stroke="#0f1318" stroke-width="4" transform="rotate(10 50 50)"/>' +
          '<text x="50" y="58" font-family="Inter, sans-serif" font-size="24" text-anchor="middle" fill="#fff">NW &amp; Co</text>',
      ),
    );
    expect(r.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${SVG_INTRINSIC_PX}" height="${SVG_INTRINSIC_PX}">`)).toBe(true);
    expect(r.svg).toContain('fill="url(#g)"');
    expect(r.svg).toContain('clip-path="url(#c)"');
    expect(r.svg).toContain('stop-color="#1b4fd8"');
    expect(r.svg).toContain(">NW &amp; Co</text>");
    expect(r.shapes).toBe(4);
    expect(r.colours.slice(0, 2)).toEqual(expect.arrayContaining(["#1b4fd8"]));
    expect(r.removed).toEqual([]);
    assertInert(r.svg);
  });

  it("is idempotent", () => {
    const once = ok(wrap('<rect x="10" y="10" width="80" height="80" rx="16" fill="#123456"/>'));
    const twice = ok(once.svg);
    expect(twice.svg).toBe(once.svg);
  });

  it("derives the coordinate system from width and height when there is no viewBox, and keeps the aspect ratio", () => {
    const r = ok(wrap('<rect width="200" height="100" fill="#000"/>', 'width="200" height="100"'));
    expect(r.viewBox).toEqual([0, 0, 200, 100]);
    expect([r.width, r.height]).toEqual([512, 256]);
  });

  it("turns style attributes and simple style sheets into presentation attributes", () => {
    const r = ok(
      wrap(
        '<style>.a{fill:#ff0000;stroke:#00ff00} #b{fill:#0000ff} rect{stroke-width:2} .c:hover{fill:#123123} a b{fill:#abcabc}</style>' +
          '<rect class="a" width="10" height="10"/><rect id="b" class="a" width="10" height="10"/><circle cx="5" cy="5" r="3" style="fill:#eeeeee;opacity:0.5"/>',
      ),
    );
    expect(r.svg).toContain('<rect width="10" height="10" stroke-width="2" fill="#ff0000" stroke="#00ff00"/>');
    // The id rule beats the class rule (specificity); the element rule still applies.
    expect(r.svg).toContain('<rect id="b" width="10" height="10" stroke-width="2" fill="#0000ff" stroke="#00ff00"/>');
    expect(r.svg).toContain('fill="#eeeeee"');
    expect(r.svg).toContain('opacity="0.5"');
    expect(r.svg).not.toContain("#123123");
    expect(r.svg).not.toContain("#abcabc");
    expect(r.svg).not.toContain("class=");
    expect(r.removed).toContain("element:style");
  });

  it("reads xlink:href as href and keeps internal use references", () => {
    const r = ok(wrap('<defs><path id="p" d="M0 0 L10 10"/></defs><use xlink:href="#p" x="5"/>', 'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20"'));
    expect(r.svg).toContain('<use href="#p" x="5"/>');
    expect(r.svg).not.toContain("xlink");
  });
});

describe("sanitiseSvg: attack cases", () => {
  it("drops <script>, including CDATA content and scripts nested in groups", () => {
    const r = ok(wrap('<script>alert(1)</script><g><script type="text/javascript"><![CDATA[fetch("https://evil.example")]]></script><rect width="1" height="1"/></g>'));
    assertInert(r.svg);
    expect(r.svg).not.toContain("alert");
    expect(r.removed).toContain("element:script");
  });

  it("drops event handlers on the root and on shapes (onload, onclick, onmouseover, mixed case)", () => {
    const r = ok(wrap('<rect width="10" height="10" onclick="alert(1)" OnMouseOver="alert(2)"/>', 'viewBox="0 0 10 10" onload="alert(document.domain)"'));
    assertInert(r.svg);
    expect(r.removed).toEqual(expect.arrayContaining(["attribute:onload", "attribute:onclick", "attribute:OnMouseOver"]));
  });

  it("drops <foreignObject> with its HTML", () => {
    const r = ok(wrap('<foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(1)"></iframe><img src="x" onerror="alert(1)"/></body></foreignObject><rect width="1" height="1"/>'));
    assertInert(r.svg);
    expect(r.removed).toContain("element:foreignObject");
  });

  it("drops javascript: links: <a href>, xlink:href and gradient hrefs", () => {
    const r = ok(
      wrap(
        '<a href="javascript:alert(1)"><rect width="10" height="10"/></a><a xlink:href="javascript:alert(2)"><circle r="3"/></a>' +
          '<linearGradient id="g" href="javascript:alert(3)"><stop offset="0" stop-color="#fff"/></linearGradient><rect width="5" height="5" fill="url(#g)"/>',
        'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"',
      ),
    );
    assertInert(r.svg);
    expect(r.removed).toEqual(expect.arrayContaining(["element:a", "href:not-internal"]));
  });

  it("drops an external <use> (http, protocol-relative and file references)", () => {
    for (const ref of ["https://evil.example/sprite.svg#logo", "//evil.example/x.svg#a", "file:///etc/passwd#x", "sprite.svg#a"]) {
      const r = ok(wrap(`<use href="${ref}"/><use xlink:href="${ref}"/><rect width="1" height="1"/>`, 'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"'));
      expect(r.svg).not.toContain("<use");
      assertInert(r.svg);
      expect(r.removed).toEqual(expect.arrayContaining(["href:not-internal", "element:use-without-internal-href"]));
    }
  });

  it("drops a <use> pointing at an id that does not exist", () => {
    const r = ok(wrap('<use href="#missing"/><rect width="1" height="1"/>'));
    expect(r.svg).not.toContain("<use");
  });

  it("neutralises <style> with url(), @import and expressions, and style attributes with url()", () => {
    const r = ok(
      wrap(
        '<style>@import url("https://evil.example/x.css"); rect{fill:url(https://evil.example/track.png)}</style>' +
          '<style>.x{fill:url(https://evil.example/a.svg#p);stroke:#00ff00} .y{fill:expression(alert(1))}</style>' +
          '<rect class="x y" width="10" height="10" style="fill:url(&quot;https://evil.example/b&quot;);stroke-width:url(javascript:alert(1));opacity:0.5"/>',
      ),
    );
    assertInert(r.svg);
    expect(r.svg).toContain('stroke="#00ff00"');
    expect(r.svg).toContain('opacity="0.5"');
    expect(r.svg).not.toContain("url(");
    expect(r.removed).toEqual(expect.arrayContaining(["element:style", "style:sheet-with-at-rules", "style:fill", "style:stroke-width"]));
  });

  it("drops data: URIs in <image> (and every <image>, <feImage> and filter)", () => {
    const r = ok(
      wrap(
        '<image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" width="10" height="10"/><image xlink:href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"/>' +
          '<filter id="f"><feImage href="https://evil.example/x.png"/></filter><rect width="10" height="10" filter="url(#f)"/>',
        'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"',
      ),
    );
    assertInert(r.svg);
    expect(r.svg).not.toContain("filter");
    expect(r.removed).toEqual(expect.arrayContaining(["element:image", "element:filter", "attribute:filter"]));
  });

  it("drops animation that could rewrite attributes (set, animate) and <iframe>/<object>/<embed>", () => {
    const r = ok(wrap('<set attributeName="href" to="javascript:alert(1)"/><animate attributeName="fill" values="red"/><iframe src="https://evil.example"/><object data="x"/><embed src="y"/><rect width="1" height="1"/>'));
    assertInert(r.svg);
    expect(r.removed).toEqual(expect.arrayContaining(["element:set", "element:animate", "element:iframe", "element:object", "element:embed"]));
  });

  it("refuses paint and clip values that are not colours or internal references", () => {
    const r = ok(wrap('<rect width="1" height="1" fill="url(https://evil.example/p#x)" stroke="url(javascript:alert(1))" clip-path="url(data:x)" mask="url(#nope)"/>'));
    expect(r.svg).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><rect width="1" height="1"/></svg>`);
  });

  it("decodes character references before checking, so encoded javascript: does not slip through", () => {
    const r = ok(wrap('<use href="&#106;avascript:alert(1)"/><use href="&#x6A;avascript&#x3A;alert(1)"/><rect width="1" height="1"/>'));
    expect(r.svg).not.toContain("<use");
  });

  it("refuses DOCTYPEs and custom entities (XXE and billion laughs)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&xxe;</text></svg>`;
    expect(sanitiseSvg(xxe)).toMatchObject({ ok: false });
    expect(sanitiseSvg(wrap("<text>&lol9;</text>"))).toMatchObject({ ok: false, reason: expect.stringMatching(/entity/) });
  });

  it("drops prefixed elements and attributes from editors and a namespace switch on a child", () => {
    const r = ok(wrap('<sodipodi:namedview pagecolor="#fff"/><g inkscape:label="Layer" xml:space="preserve"><rect width="1" height="1"/></g><g xmlns="http://www.w3.org/1999/xhtml"><rect width="1" height="1"/></g>', 'xmlns:sodipodi="x" xmlns:inkscape="y" viewBox="0 0 1 1"'));
    expect(r.svg).not.toMatch(/sodipodi|inkscape|xml:space|xhtml/);
    expect(r.removed).toEqual(expect.arrayContaining(["element:sodipodi:namedview", "attribute:inkscape:label"]));
  });

  it("does not resolve prototype names as allowed elements, attributes or entities", () => {
    const r = ok(wrap('<constructor/><rect width="1" height="1" toString="x" __proto__="y" constructor="z"/>'));
    expect(r.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><rect width="1" height="1"/></svg>');
    expect(sanitiseSvg(wrap("<text>&constructor;</text>"))).toMatchObject({ ok: false });
  });

  it("escapes text and attribute values on output", () => {
    const r = ok(wrap('<text font-family="Inter">&lt;/text&gt;&lt;script&gt;x&lt;/script&gt;</text>'));
    expect(r.svg).toContain("<text font-family=\"Inter\">&lt;/text&gt;&lt;script&gt;x&lt;/script&gt;</text>");
  });

  it("rejects malformed or non-SVG documents", () => {
    for (const bad of ["", "not svg", "<html><body/></html>", '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 1 1"><rect/></svg>', "<svg viewBox='0 0 1 1'><rect width=1 height=1/></svg>", '<svg viewBox="0 0 1 1"><g></svg>', '<svg viewBox="0 0 1 1"></svg><svg/>']) {
      expect(sanitiseSvg(bad).ok).toBe(false);
    }
  });

  it("rejects a document with nothing left to draw", () => {
    expect(sanitiseSvg(wrap('<script>alert(1)</script><foreignObject/>'))).toMatchObject({ ok: false, reason: expect.stringMatching(/Nothing drawable/) });
  });

  it("rejects input over the size and complexity limits", () => {
    expect(sanitiseSvg(wrap(`<path d="M0 0 ${"L1 1 ".repeat(10_000)}"/>`), { maxOutputChars: 32 * 1024 })).toMatchObject({ ok: false, reason: expect.stringMatching(/too complex/) });
    expect(sanitiseSvg("x".repeat(3 * 1024 * 1024))).toMatchObject({ ok: false });
    expect(sanitiseSvg(wrap("<g>".repeat(60) + "</g>".repeat(60)))).toMatchObject({ ok: false, reason: expect.stringMatching(/nested/) });
    expect(sanitiseSvg(wrap('<rect width="1" height="1"/>', 'viewBox="0 0 100 10"'))).toMatchObject({ ok: false, reason: expect.stringMatching(/too wide/) });
  });
});
