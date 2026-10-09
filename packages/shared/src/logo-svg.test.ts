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
    // A sheet with thousands of rules is ignored rather than matched against every element.
    const huge = sanitiseSvg(wrap(`<style>${Array.from({ length: 500 }, (_, i) => `.c${i}{fill:#123456}`).join("")}</style><rect class="c1" width="1" height="1"/>`));
    expect(huge).toMatchObject({ ok: true, removed: expect.arrayContaining(["style:sheet-too-large"]) });
    expect(huge.ok && huge.svg).not.toContain("#123456");
  });
});

/** The review's render bombs (poc-logo/usebomb.ts, maskbomb.ts): references that multiply what the browser draws. */
function referenceBomb(levels: number, fan: number): string {
  let defs = `<g id="l0"><rect width="100" height="100" fill="#123456" fill-opacity="0.01"/></g>`;
  for (let l = 1; l <= levels; l++) {
    let uses = "";
    for (let k = 0; k < fan; k++) uses += `<use href="#l${l - 1}" x="${(k % 3) * 0.1}"/>`;
    defs += `<g id="l${l}">${uses}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs}</defs><use href="#l${levels}"/></svg>`;
}

function maskChain(levels: number, fan: number, kind: "mask" | "clipPath"): string {
  const attr = kind === "mask" ? "mask" : "clip-path";
  let defs = `<${kind} id="m0"><rect width="100" height="100" fill="#fff"/></${kind}>`;
  for (let l = 1; l <= levels; l++) {
    let kids = "";
    for (let k = 0; k < fan; k++) kids += `<rect x="${k}" width="90" height="90" fill="#fff" ${attr}="url(#m${l - 1})"/>`;
    defs += `<${kind} id="m${l}">${kids}</${kind}>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs}</defs><rect width="100" height="100" fill="#123456" ${attr}="url(#m${levels})"/></svg>`;
}

describe("sanitiseSvg: render cost (use, mask and clip-path chains)", () => {
  it("refuses use chains that expand past the cost cap, however small the file", () => {
    for (const [levels, fan] of [[4, 10], [5, 10], [9, 10], [33, 3]] as const) {
      const svg = referenceBomb(levels, fan);
      expect(svg.length).toBeLessThan(15_000);
      expect(sanitiseSvg(svg), `${levels}x${fan}`).toMatchObject({ ok: false, reason: expect.stringMatching(/repeats its parts too many times/) });
    }
    // 3x10 is 1,000 copies of one rectangle (the defs that hold the chain are not drawn themselves): under the cap.
    expect(ok(referenceBomb(3, 10)).renderCost).toBe(3223);
  });

  it("keeps a modest amount of reuse and reports its cost", () => {
    const r = ok(referenceBomb(2, 10));
    expect(r.renderCost).toBeGreaterThan(300);
    expect(r.renderCost).toBeLessThanOrEqual(5000);
    expect(ok(wrap('<rect width="10" height="10"/>')).renderCost).toBe(2);
  });

  it("drops mask and clip-path inside a mask or clip path, so mask chains cannot multiply", () => {
    for (const kind of ["mask", "clipPath"] as const) {
      const r = ok(maskChain(30, 10, kind));
      const attr = kind === "mask" ? "mask=" : "clip-path=";
      // Only the outer shape keeps its reference; none inside the chain does.
      expect(r.svg.split(attr).length - 1).toBe(1);
      expect(r.removedCounts.reference).toBe(300);
      expect(r.removed).toContain(`reference:${kind === "mask" ? "mask" : "clip-path"}-inside-mask`);
      expect(r.renderCost).toBeLessThan(5000);
    }
  });

  it("refuses reference cycles (use, gradients)", () => {
    expect(sanitiseSvg(wrap('<g id="a"><rect width="1" height="1"/><use href="#a"/></g>'))).toMatchObject({ ok: false, reason: expect.stringMatching(/loop/) });
    expect(sanitiseSvg(wrap('<defs><g id="b"><use href="#c"/></g><g id="c"><use href="#b"/></g></defs><use href="#b"/><rect width="1" height="1"/>'))).toMatchObject({ ok: false, reason: expect.stringMatching(/loop/) });
    expect(sanitiseSvg(wrap('<defs><linearGradient id="g1" href="#g2"/><linearGradient id="g2" href="#g1"/></defs><rect width="1" height="1" fill="url(#g1)"/>'))).toMatchObject({ ok: false, reason: expect.stringMatching(/loop/) });
  });
});

/** The second review's cases (poc-logo/dashbomb.ts, heavypath.ts, falsepos.ts). */
describe("sanitiseSvg: what a browser has to paint", () => {
  const DASHED = '<circle cx="50" cy="50" r="1000" fill="none" stroke="#123456" stroke-dasharray=".007"/>';

  it("drops stroke-dasharray and stroke-dashoffset as attributes, style declarations and sheet rules (dashbomb)", () => {
    const repeated = ok(wrap(DASHED.repeat(100)));
    expect(repeated.svg).not.toMatch(/dash/);
    expect(repeated.removedCounts).toEqual({ attribute: 100 });
    const reused = ok(wrap(`<defs><g id="a">${DASHED.repeat(40)}</g></defs>${'<use href="#a"/>'.repeat(100)}`));
    expect(reused.svg).not.toMatch(/dash/);
    const styled = ok(wrap('<style>circle{stroke-dasharray:.007}</style><circle r="40" stroke="#000" stroke-dashoffset="2" style="stroke-dasharray:1 1;stroke-dashoffset:3"/>'));
    expect(styled.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><circle r="40" stroke="#000"/></svg>');
    expect(styled.removed).toEqual(expect.arrayContaining(["style:stroke-dasharray", "style:stroke-dashoffset", "attribute:stroke-dashoffset"]));
  });

  it("weighs long path data and text: 1 per 32 characters of d or points, 1 per character of text", () => {
    const d = `M0 0${" L1 1".repeat(640)}`; // 3,204 characters
    expect(ok(wrap(`<path d="${d}"/>`)).renderCost).toBe(1 + 1 + Math.floor(d.length / 32));
    expect(ok(wrap(`<polygon points="${"1,1 ".repeat(100)}"/>`)).renderCost).toBe(1 + 1 + Math.floor("1,1 ".repeat(100).trim().length / 32));
    expect(ok(wrap("<text>Acme</text>")).renderCost).toBe(1 + 1 + 4);
  });

  it("refuses a long path drawn many times through nested use (heavypath: 60 KB x 1,000 used to cost 4,688)", () => {
    let d = "M0 0";
    while (d.length < 60_000) d += " L100 100 L0 1 L100 0 L0 100";
    const path = `<path id="p" d="${d}" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="round"/>`;
    const chain = `<g id="g1">${'<use href="#p"/>'.repeat(10)}</g><g id="g2">${'<use href="#g1"/>'.repeat(10)}</g><g id="g3">${'<use href="#g2"/>'.repeat(10)}</g>`;
    expect(sanitiseSvg(wrap(`<defs>${path}${chain}</defs><use href="#g3"/>`))).toMatchObject({ ok: false, reason: expect.stringMatching(/too heavy to draw quickly/) });
    // The same path drawn once is a normal (if detailed) logo.
    expect(ok(wrap(`<defs>${path}</defs><use href="#p"/>`)).renderCost).toBeLessThan(2_000);
  });

  it("still accepts a detailed logo near the size limit that reuses nothing", () => {
    const paths = Array.from({ length: 40 }, (_, i) => `<path d="M${i} 0${" l1.5 2.5 c1 1 2 2 3 3".repeat(90)}z" fill="#1f6f5f"/>`).join("");
    const rects = Array.from({ length: 200 }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1" fill="#e8c56b"/>`).join("");
    const r = ok(wrap(`${paths}${rects}<text x="10" y="90">Ledgerly</text>`));
    expect(r.svg.length).toBeGreaterThan(80 * 1024);
    expect(r.renderCost).toBeLessThan(5_000);
  });

  it("counts a gradient reference as 1 and leaves unreferenced defs out (falsepos: 500 gradient rects were refused)", () => {
    const stops = Array.from({ length: 8 }, (_, i) => `<stop offset="${i / 7}" stop-color="#${(i * 30).toString(16).padStart(2, "0")}3366"/>`).join("");
    for (const n of [300, 500, 800]) {
      const rects = Array.from({ length: n }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1" fill="url(#g)"/>`).join("");
      const r = ok(wrap(`<defs><linearGradient id="g">${stops}</linearGradient></defs>${rects}`));
      expect(r.renderCost).toBe(1 + n * 2);
    }
    // Drawn only where referenced: 3,000 shapes kept in defs cost nothing until a use draws them.
    const parked = `<defs><g id="parked">${'<rect width="1" height="1"/>'.repeat(3000)}</g><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>`;
    expect(ok(wrap(`${parked}<rect width="9" height="9"/>`)).renderCost).toBe(2);
    expect(ok(wrap(`${parked}<rect width="9" height="9" clip-path="url(#c)"/>`)).renderCost).toBe(2 + 2);
    expect(sanitiseSvg(wrap(`${parked}<use href="#parked"/><use href="#parked"/>`))).toMatchObject({ ok: false, reason: expect.stringMatching(/too heavy/) });
  });
});

describe("sanitiseSvg: bounded reports and messages", () => {
  it("reports at most 20 removed names, each cut to 40 characters, with complete counts per kind", () => {
    const attrs = Array.from({ length: 7600 }, (_, i) => `${"x".repeat(240)}${i}=""`).join(" ");
    const r = ok(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" ${attrs}/>${Array.from({ length: 50 }, (_, i) => `<e${i}${"y".repeat(200)}/>`).join("")}</svg>`);
    expect(r.removed.length).toBeLessThanOrEqual(20);
    for (const name of r.removed) expect(name.length).toBeLessThanOrEqual("attribute:".length + 41);
    expect(r.removedCounts).toEqual({ attribute: 7600, element: 50 });
    expect(JSON.stringify({ names: r.removed, counts: r.removedCounts }).length).toBeLessThan(2000);
  });

  it("cuts names taken from the input to 40 characters in error messages", () => {
    const long = "g".repeat(5000);
    const end = sanitiseSvg(wrap(`<g></${long}>`));
    expect(end).toMatchObject({ ok: false, reason: expect.stringContaining(`</${"g".repeat(40)}…>`) });
    expect(!end.ok && end.reason.length).toBeLessThan(120);
    const entity = sanitiseSvg(wrap(`<text>&${"q".repeat(31)};</text>`));
    expect(entity).toMatchObject({ ok: false, reason: expect.stringContaining(`&${"q".repeat(31)};`) });
    const longEntity = sanitiseSvg(wrap(`<text>&${"q".repeat(5000)};</text>`));
    expect(longEntity).toMatchObject({ ok: false, reason: expect.stringMatching(/unterminated character reference/) });
    const attr = sanitiseSvg(wrap(`<rect ${"a".repeat(200)}/>`));
    expect(!attr.ok && attr.reason.length).toBeLessThan(120);
  });

  it("drops values over the length cap before any grammar sees them (256; 64 KiB for d and points)", () => {
    const r = ok(wrap(`<rect width="${"1".repeat(300)}" height="1" fill="#000"/><path d="M0 0 ${"L1 1 ".repeat(1000)}"/>`));
    expect(r.removedCounts.value).toBe(1);
    expect(r.svg).toContain('<path d="M0 0 L1 1');
  });
});
