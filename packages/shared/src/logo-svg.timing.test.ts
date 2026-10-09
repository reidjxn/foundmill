/**
 * Linear-time guarantees for the SVG sanitiser (security review, 2026-10-09: a 570-byte transform froze the api).
 * Every value grammar gets two million adversarial characters, the shapes that made the old patterns backtrack, and
 * must answer in well under a tenth of a second; whole documents of the same shapes must stay fast too.
 */
import { describe, expect, it } from "vitest";
import { checkLogo } from "./logo";
import { SVG_MAX_INPUT_CHARS, SVG_VALUE_GRAMMARS, sanitiseSvg } from "./logo-svg";

const N = 2_000_000;
const GRAMMAR_BUDGET_MS = 100;
const DOCUMENT_BUDGET_MS = 1_000;

/**
 * Best of three runs: a busy machine (or a parallel test file) only ever adds time, while a super-linear pattern on
 * these inputs would blow the budget by orders of magnitude on every run.
 */
function timed<T>(fn: () => T): { ms: number; result: T } {
  let best = Infinity;
  let result!: T;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    result = fn();
    best = Math.min(best, performance.now() - t0);
  }
  return { ms: best, result };
}

const ones = "1".repeat(N);
const spaces = " ".repeat(N);

/** Adversarial inputs per grammar: long digit or space runs that end in a character the grammar refuses. */
const ADVERSARIAL: Record<keyof typeof SVG_VALUE_GRAMMARS, string[]> = {
  number: [`${ones}x`, `1e${ones}x`, `.${ones}x`, `1.${ones}.x`],
  length: [`${ones}x`, `${ones}p`, `1.${ones}%x`],
  numberList: [`${spaces}x`, `${"1,".repeat(N / 2)}x`],
  pathData: [`M${"1 ".repeat(N / 2)}x`, `${spaces}x`],
  transform: [`${"scale(1)  ".repeat(N / 10)}X`, `scale(${spaces}X`, `${spaces}X`, `${"rotate(1),".repeat(N / 10)}rotate(1deg)`],
  paint: [`url(#a)${spaces}\nX`, `rgb(${spaces}x`, `url(#a) rgb(${spaces}x`, `url(${spaces}#a${spaces}x`],
  colour: [`rgb(1${",1".repeat(N / 2)}x`, `hsl(${spaces}/${spaces}x`, `rgba(${spaces}`],
  reference: [`url(${spaces}#a${spaces}x`, `url(#${"a".repeat(N)})`],
  href: [`#${"a".repeat(N)}`],
  opacity: [`${ones}%x`, `1.${ones}x%`],
  fontFamily: ["a".repeat(N)],
  preserveAspectRatio: [`xMidYMid${spaces}x`],
  paintOrder: [`fill${" fill".repeat(N / 5)}x`],
  id: ["a".repeat(N)],
  rootSize: [`${ones}x`, `+${ones}.${ones}x`],
};

describe("value grammars run in linear time", () => {
  for (const [name, inputs] of Object.entries(ADVERSARIAL) as [keyof typeof SVG_VALUE_GRAMMARS, string[]][]) {
    it(`${name}: 2M adversarial characters in under ${GRAMMAR_BUDGET_MS} ms`, () => {
      const check = SVG_VALUE_GRAMMARS[name] as (v: string) => string | null;
      for (const input of inputs) {
        expect(input.length).toBeGreaterThanOrEqual(N);
        const { ms, result } = timed(() => check(input));
        expect(result, `${name} accepted an adversarial value`).toBeNull();
        expect(ms, `${name} took ${ms.toFixed(1)} ms on ${input.slice(0, 24)}…`).toBeLessThan(GRAMMAR_BUDGET_MS);
      }
    });
  }

  it("still accepts what it should", () => {
    const g = SVG_VALUE_GRAMMARS;
    expect(["1.5e3", ".5", "10.", "-3", "+2.25E-2"].map(g.number)).toEqual(["1.5e3", ".5", "10.", "-3", "+2.25E-2"]);
    expect(g.length("12.5px")).toBe("12.5px");
    expect(g.transform("translate(10,20) rotate(45) , scale(2)")).toBe("translate(10,20) rotate(45) , scale(2)");
    expect(g.transform("rotate(45deg)")).toBeNull();
    expect(g.paint("url(#g) #fff")).toBe("url(#g) #fff");
    expect(g.paint("url(#g)")).toBe("url(#g)");
    expect(g.paint("url(#g)#fff")).toBeNull();
    expect(g.colour("rgb( 1, 2, 3 )")).toBe("rgb( 1, 2, 3 )");
    expect(g.colour("rgb(1 2 3 / 50%)")).toBe("rgb(1 2 3 / 50%)");
    expect(g.rootSize("120px")).toBe("120px");
  });
});

describe("whole documents built from the same shapes stay fast", () => {
  const wrap = (inner: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="10" height="10"/>${inner}</svg>`;
  const fill = (unit: string, extra = 0) => unit.repeat(Math.floor((SVG_MAX_INPUT_CHARS - 200 - extra) / unit.length));

  const CASES: Record<string, string> = {
    // The reported payload, at the size the api accepts.
    "transform 'scale(1)  '…X": wrap(`<rect width="1" height="1" transform="${fill("scale(1)  ")}X"/>`),
    "attribute of 2M digits": wrap(`<rect width="${fill("1")}x" height="1"/>`),
    "rgb( and 2M spaces": wrap(`<rect width="1" height="1" fill="rgb(${fill(" ")}x"/>`),
    "style sheet of unclosed comments": wrap(`<style>${fill("/*")}</style>`),
    "style declaration of 2M spaces": wrap(`<rect width="1" height="1" style="fill:${fill(" ")}x"/>`),
    "root width of 2M digits": `<svg xmlns="http://www.w3.org/2000/svg" width="${fill("1")}%" height="1"><rect width="1" height="1"/></svg>`,
    "4,000 elements x 400 rules x many classes": wrap(
      `<style>${Array.from({ length: 399 }, (_, i) => `.c${i}{fill:#123456}`).join("")}</style>` + Array.from({ length: 3990 }, () => `<g class="${Array.from({ length: 60 }, (_, j) => `c${j}`).join(" ")}"/>`).join(""),
    ),
    "entity with a 2M-character name": wrap(`<text>&${fill("a")};</text>`),
    "end tag with a 2M-character name": wrap(`<g></${fill("g")}>`),
  };

  for (const [name, svg] of Object.entries(CASES)) {
    it(`${name} (${Math.round(svg.length / 1024)} KB) in under ${DOCUMENT_BUDGET_MS} ms`, () => {
      expect(svg.length).toBeLessThanOrEqual(SVG_MAX_INPUT_CHARS);
      const { ms, result } = timed(() => sanitiseSvg(svg));
      expect(ms, `${name} took ${ms.toFixed(0)} ms`).toBeLessThan(DOCUMENT_BUDGET_MS);
      if (!result.ok) expect(result.reason.length).toBeLessThan(300);
    });
  }

  it("the reported api payload (570 bytes, used to take seconds) is answered at once through checkLogo", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" transform="${"scale(1)  ".repeat(30)}X"/></svg>`;
    const { ms, result } = timed(() => checkLogo({ mime: "image/svg+xml", svg }));
    expect(ms).toBeLessThan(50);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.logo.removed).toContain("value:transform");
  });
});
