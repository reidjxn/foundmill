/**
 * The token contract (DESIGN §2–§7): the AA text ramp, the aliases hundreds of call sites rely on, the brand defaults
 * (Foundmill steel) and the motion values scripts mirror. Reads tokens.css and dugout.css as text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, kitOnPrimary, kitRamp } from "./lib/colour";
import { DURATION_MS, MOTION_EASE, STAGGER_MS, STREAM_CADENCE, TYPING_DOTS } from "./lib/motion";

const tokensCss = readFileSync(join(__dirname, "tokens.css"), "utf8");
const dugoutCss = readFileSync(join(__dirname, "dugout.css"), "utf8");

/** Every `--name: value;` declared in tokens.css, comments stripped, multi-line values joined. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.replace(/\s+/g, " ").trim());
  return out;
}
const tokens = declarations(tokensCss);

/** Resolve a token to its final literal value by following var() references. */
function resolve(name: string, depth = 0): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not declared in tokens.css`);
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (ref && depth < 8) return resolve(ref[1]!, depth + 1);
  return value;
}
const hex = (name: string) => {
  const v = resolve(name);
  expect(v, `${name} resolves to a hex colour`).toMatch(/^#[0-9a-f]{6}$/i);
  return v;
};
const ms = (name: string) => Number(/^(\d+(?:\.\d+)?)ms$/.exec(resolve(name))?.[1]);

describe("text ramp: WCAG AA is the floor (DIRECTION #1)", () => {
  const surfaces = ["--canvas", "--rail", "--surface-1", "--surface-2", "--surface-3", "--surface-4", "--ink"];
  it.each(["--text-1", "--text-2", "--text-3", "--reading"])("%s reaches 4.5 : 1 on every surface", (text) => {
    for (const s of surfaces) expect(contrastRatio(hex(text), hex(s)), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps text-4 for disabled text only: it is too faint for content, so it must stay distinct from text-3", () => {
    expect(contrastRatio(hex("--text-4"), hex("--surface-1"))).toBeLessThan(4.5);
    expect(contrastRatio(hex("--text-3"), hex("--surface-1"))).toBeGreaterThan(contrastRatio(hex("--text-4"), hex("--surface-1")));
  });
  it("orders the surfaces from the canvas up and keeps ink below the canvas", () => {
    const lum = (n: string) => contrastRatio(hex(n), "#000000");
    expect(lum("--ink")).toBeLessThan(lum("--canvas"));
    const ladder = ["--canvas", "--rail", "--surface-1", "--surface-2", "--surface-3", "--surface-4"].map(lum);
    expect([...ladder].sort((a, b) => a - b)).toEqual(ladder);
  });
});

describe("aliases: the original names point at the 2027 values", () => {
  it.each([
    ["--bg-base", "--canvas"],
    ["--bg-panel", "--surface-1"],
    ["--bg-panel-alt", "--surface-2"],
    ["--bg-ink", "--ink"],
    ["--line-subtle", "--line"],
    ["--text-primary", "--text-1"],
    ["--text-secondary", "--text-2"],
    ["--accent-link", "--accent"],
    ["--radius-panel", "--r-sm"],
    ["--radius-chip", "--r-xs"],
    ["--ease", "--ease-out"],
    ["--dur-micro", "--dur-hover"],
    ["--dur-ribbon", "--dur-draw"],
    ["--shadow-overlay", "--elev-2"],
    ["--inner-highlight", "--elev-0"],
    ["--chip-height", "--control-xs"],
  ])("%s → %s", (alias, target) => {
    expect(tokens.get(alias)).toBe(`var(${target})`);
  });
  it("still declares every name the components and the brand-asset script read", () => {
    for (const name of ["--kit-primary", "--kit-secondary", "--kit-on-primary", "--on-kit-light", "--on-kit-dark", "--gold", "--gold-deep", "--white", "--dur-panel", "--dur-hover-card", "--dur-view", "--dur-pulse", "--dur-reveal", "--dur-shimmer", "--delay-hover-card", "--backdrop", "--backdrop-blur", "--focus-ring", "--focus-offset"]) {
      expect(tokens.has(name), name).toBe(true);
    }
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) expect(tokens.has(`--dept-${n}`)).toBe(true);
    for (const n of [1, 2, 3, 4]) expect(tokens.has(`--rating-${n}`)).toBe(true);
    for (const s of ["good", "warn", "bad", "info"]) expect(tokens.has(`--status-${s}`)).toBe(true);
  });
});

describe("brand defaults: Foundmill steel for frames without a business (DIRECTION #11)", () => {
  it("is steel blue with the accent as its lift", () => {
    expect(hex("--kit-primary").toLowerCase()).toBe("#3f7fe0");
    expect(hex("--kit-lift")).toBe(hex("--accent"));
  });
  it("matches kitRamp and kitOnPrimary for the default primary, so a business with steel looks the same", () => {
    const ramp = kitRamp(hex("--kit-primary"));
    expect(hex("--kit-hi").toUpperCase()).toBe(ramp.hi);
    expect(hex("--kit-lo").toUpperCase()).toBe(ramp.lo);
    expect(hex("--kit-deep").toUpperCase()).toBe(ramp.deep);
    expect(hex("--kit-aura").toUpperCase()).toBe(ramp.aura);
    expect(hex("--kit-on-primary").toUpperCase()).toBe(kitOnPrimary(hex("--kit-primary")));
  });
  it("never derives a root token from a brand token (custom properties resolve at :root, so it would ignore the business)", () => {
    for (const [name, value] of tokens) {
      if (name.startsWith("--kit-")) continue;
      expect(value, name).not.toMatch(/var\(--kit-/);
    }
  });
});

describe("shape and motion", () => {
  it("keeps every radius below 16 px", () => {
    for (const r of ["--r-xs", "--r-sm", "--r-md", "--r-lg"]) expect(Number.parseFloat(resolve(r))).toBeLessThan(16);
  });
  it("mirrors the durations and cadences scripts use (lib/motion.ts)", () => {
    for (const [key, value] of Object.entries(DURATION_MS)) expect(ms(`--dur-${key}`), key).toBe(value);
    expect(ms("--stream-char-min")).toBe(STREAM_CADENCE.charMinMs);
    expect(ms("--stream-char-max")).toBe(STREAM_CADENCE.charMaxMs);
    expect(ms("--stream-comma-pause")).toBe(STREAM_CADENCE.commaPauseMs);
    expect(ms("--caret-blink")).toBe(STREAM_CADENCE.caretBlinkMs);
    expect(ms("--typing-loop")).toBe(TYPING_DOTS.loopMs);
    expect(ms("--typing-stagger")).toBe(TYPING_DOTS.staggerMs);
    expect(ms("--stagger-step")).toBe(STAGGER_MS.skeleton);
    expect(ms("--reply-stagger")).toBe(STAGGER_MS.reply);
    const curve = (v: string) => v.replace(/\s+/g, "");
    expect(curve(resolve("--ease-out"))).toBe(curve(MOTION_EASE.out));
    expect(curve(resolve("--ease-spring"))).toBe(curve(MOTION_EASE.spring));
    expect(curve(resolve("--ease-inout"))).toBe(curve(MOTION_EASE.inout));
  });
  it("keeps the structure: shell sizes are unchanged", () => {
    expect(resolve("--sidebar-width")).toBe("232px");
    expect(resolve("--kitbar-height")).toBe("56px");
    expect(resolve("--processing-strip-height")).toBe("3px");
    expect(resolve("--tabbar-height")).toBe("40px");
    expect(resolve("--inbox-list-width")).toBe("380px");
    expect(resolve("--reading-measure")).toBe("640px");
  });
});

describe("dugout.css", () => {
  const utility = (name: string) => {
    const m = new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`).exec(dugoutCss);
    if (!m) throw new Error(`@utility ${name} not found`);
    return m[1]!;
  };
  it("holds no colour literals (tokens only)", () => {
    const code = dugoutCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(code).not.toMatch(/rgba?\(/);
  });
  it("sets sentence case on actions, tabs and labels, and caps only on the data label", () => {
    for (const name of ["t-tab", "t-tab-sm", "t-label", "t-action", "t-action-sm", "t-title"]) expect(utility(name), name).not.toContain("uppercase");
    expect(utility("t-data")).toContain("text-transform: uppercase");
    expect(utility("t-label")).toContain("var(--font-body)");
    expect(utility("t-data")).toContain("var(--text-3)");
  });
  it("keeps tabular figures off body text (DIRECTION #2)", () => {
    const base = /@layer base \{([\s\S]*?)\n\}/.exec(dugoutCss)?.[1] ?? "";
    expect(base).not.toMatch(/font-variant-numeric|"tnum"/);
    expect(utility("tabular")).toContain("tabular-nums");
  });
  it("stops every animation under reduced motion", () => {
    expect(dugoutCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-iteration-count: 1 !important/);
  });
  it("keeps the landing page's utilities", () => {
    for (const name of ["landing-lit", "t-display-hero"]) expect(() => utility(name)).not.toThrow();
    expect(dugoutCss).toContain('[data-reveal="pending"]');
    expect(dugoutCss).toContain("--animate-marquee");
    expect(dugoutCss).toContain("--animate-progress");
  });
  it("draws entity links in the text's own colour, underlined at 40 %, no icon (founder, 2026-10-09)", () => {
    const css = utility("entity-link");
    expect(css).toContain("color: inherit");
    expect(css).toContain("text-decoration-line: underline");
    expect(css).toContain("currentColor 40%");
    expect(css).toContain("text-underline-offset: 0.24em");
  });
  it("offers the 2027 surface and light utilities", () => {
    for (const name of ["surface-panel", "surface-raised", "surface-well", "surface-overlay", "surface-dialog", "glass", "canvas-lit", "edge", "edge-tint", "glow-dept", "glow-brand", "rim", "sheen", "orbit", "shimmer", "presence-breathe", "typing-dots", "stream-caret", "landed", "slide-indicator", "slide-plate", "pressable", "focus-ring", "focus-within-ring", "rule-fade", "t-data", "t-title", "t-action", "t-micro", "t-unit", "t-currency"]) {
      expect(() => utility(name), name).not.toThrow();
    }
  });
});
