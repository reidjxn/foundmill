/**
 * The token contract (DESIGN §2–§7): the AA text ramp, the aliases hundreds of call sites rely on, the brand defaults
 * (Foundmill steel) and the motion values scripts mirror. Reads tokens.css and dugout.css as text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, kitOnPrimary, kitOnPrimaryDetail, kitRamp } from "./lib/colour";
import { DURATION_MS, MOTION_EASE, STAGGER_MS, STREAM_CADENCE, TYPING_DOTS } from "./lib/motion";

const tokensCss = readFileSync(join(__dirname, "tokens.css"), "utf8");
const dugoutCss = readFileSync(join(__dirname, "dugout.css"), "utf8");

/** Every `--name: value;` declared in a stretch of CSS, comments stripped, multi-line values joined. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.replace(/\s+/g, " ").trim());
  return out;
}
/** The body of one top-level rule (`:root`, `:root[data-text="comfortable"]`): from its opening brace to the first `}` at column 0. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} is not declared in tokens.css`);
  const end = css.indexOf("\n}", start);
  return css.slice(start + selector.length + 2, end < 0 ? undefined : end);
}
/** The design tokens: the `:root` rule only, so a later override block never shadows a root value here. */
const tokens = declarations(rule(tokensCss, ":root"));
const comfortable = declarations(rule(tokensCss, ':root[data-text="comfortable"]'));

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

describe("daylight: the landing page's light zone meets the same floor (DESIGN §9a)", () => {
  it.each(["--day-ink", "--day-ink-2", "--day-ink-3", "--day-accent", "--day-good", "--day-warn", "--day-bad"])("%s reaches 4.5 : 1 on the day canvas and the white field", (text) => {
    for (const s of ["--day-canvas", "--day-surface-1"]) expect(contrastRatio(hex(text), hex(s)), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it("white reads on the brand's blue field at every stop of the descent", () => {
    for (const s of ["--kit-primary", "--kit-lo", "--kit-deep"]) expect(contrastRatio("#ffffff", hex(s)), `white on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
});

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

describe("status colours as text (UX plan D5)", () => {
  // Pills, consequence lines and error text sit on menus and hover cards (surface-3) and pressed plates (surface-4),
  // not only on the panel. bad and info were lifted the minimum step that passes; good and warn already did.
  it.each(["--status-good", "--status-warn", "--status-bad", "--status-info"])("%s reaches 4.5 : 1 on surface-3 and surface-4", (status) => {
    for (const s of ["--surface-3", "--surface-4"]) expect(contrastRatio(hex(status), hex(s)), `${status} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it("documents the lifted values", () => {
    expect(hex("--status-bad").toLowerCase()).toBe("#f36066");
    expect(hex("--status-info").toLowerCase()).toBe("#5e8eff");
    // Lifted by the smallest step, not restyled: still within a hair of the old hues on the canvas.
    expect(contrastRatio(hex("--status-bad"), hex("--canvas"))).toBeGreaterThan(6);
    expect(contrastRatio(hex("--status-info"), hex("--canvas"))).toBeGreaterThan(6);
  });
});

describe("type scale and text size (UX plan §9)", () => {
  it("keeps the data label at the 11 px floor on its 14 px line (DESIGN §2: nothing below 11 but kbd glyphs)", () => {
    expect(resolve("--fs-data")).toBe("11px");
    expect(resolve("--lh-data")).toBe("14px");
    expect(Number.parseFloat(resolve("--fs-micro"))).toBeGreaterThanOrEqual(11);
  });
  it("sets the rem base apart from the body size, so comfortable text never moves the structure", () => {
    expect(resolve("--fs-root")).toBe("13px");
    expect(resolve("--fs-body")).toBe("13px");
    const base = /@layer base \{([\s\S]*?)\n\}/.exec(dugoutCss)?.[1] ?? "";
    expect(base).toMatch(/html \{[\s\S]*?font-size: var\(--fs-root\);/);
    expect(base).toMatch(/body \{[\s\S]*?font-size: var\(--fs-body\);\s*line-height: var\(--lh-body\);/);
  });
  it("comfortable text grows body 14/20, small 12.5/16 and chat 14/21 and touches nothing else", () => {
    expect(comfortable.get("--fs-body")).toBe("14px");
    expect(comfortable.get("--lh-body")).toBe("20px");
    expect(comfortable.get("--fs-small")).toBe("12.5px");
    expect(comfortable.get("--lh-small")).toBe("16px");
    expect(comfortable.get("--fs-chat")).toBe("14px");
    expect(comfortable.get("--lh-chat")).toBe("21px");
    expect([...comfortable.keys()].sort()).toEqual(["--fs-body", "--fs-chat", "--fs-small", "--lh-body", "--lh-chat", "--lh-small"]);
    // The structure is not in the override: headers, rows, the sidebar and the rem base keep their root values.
    for (const name of ["--fs-root", "--panel-header-height", "--row-compact", "--row-comfortable", "--sidebar-width", "--fs-title", "--fs-action", "--fs-label", "--fs-data"]) expect(comfortable.has(name), name).toBe(false);
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
    expect(hex("--kit-primary").toLowerCase()).toBe("#3570cc");
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
  it("puts text on the steel primary at WCAG AA and APCA Lc 75 (A11Y-05: white on #3F7FE0 was 3.94 : 1)", () => {
    const on = kitOnPrimaryDetail(hex("--kit-primary"));
    expect(on.passes).toBe(true);
    expect(contrastRatio(hex("--kit-on-primary"), hex("--kit-primary"))).toBeGreaterThanOrEqual(4.5);
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
  it("draws a defined word (Term) with the entity link's geometry, dotted: dotted = learn, dashed = not measured", () => {
    const css = utility("term-link");
    expect(css).toContain("color: inherit");
    expect(css).toContain("text-decoration-style: dotted");
    expect(css).toContain("text-decoration-thickness: 1px");
    expect(css).toContain("currentColor 40%");
    expect(css).toContain("text-underline-offset: 0.24em");
    expect(css).toContain("cursor: help");
    expect(css).not.toContain("dashed");
    expect(utility("dashed-edge")).toContain("dashed");
  });
  it("offers the 2027 surface and light utilities", () => {
    for (const name of ["surface-panel", "surface-raised", "surface-well", "surface-overlay", "surface-dialog", "glass", "canvas-lit", "edge", "edge-tint", "glow-dept", "glow-brand", "rim", "sheen", "orbit", "shimmer", "presence-breathe", "typing-dots", "stream-caret", "landed", "slide-indicator", "slide-plate", "pressable", "focus-ring", "focus-within-ring", "rule-fade", "t-data", "t-title", "t-action", "t-micro", "t-unit", "t-currency"]) {
      expect(() => utility(name), name).not.toThrow();
    }
  });
});

describe("controls.css", () => {
  const controlsCss = readFileSync(join(__dirname, "controls.css"), "utf8");
  it("keeps an option's consequence line at the full on-colour on filled buttons (A11Y-06: dimmed, it fell under 4.5 : 1)", () => {
    const desc = /@utility btn-desc \{([\s\S]*?)\n\}/.exec(controlsCss)?.[1] ?? "";
    expect(desc).toMatch(/:is\(\[data-variant="primary"\], \[data-variant="danger"\], \[data-variant="gold"\]\) & \{\s*color: currentColor;/);
    // The dimmed line stays on the dark grounds, where text-1 at 76 % is still far above AA.
    expect(contrastRatio("#B8BBC0", "#151920")).toBeGreaterThan(4.5);
  });
  it("gives the steel's text and every live brand's text at least 4.5 : 1 at full strength", () => {
    for (const brand of ["#3570CC", "#2F6F5E", "#0F766E", "#AE5729", "#6B7C1D", "#1B4FD8"]) {
      expect(kitOnPrimaryDetail(brand).ratio, brand).toBeGreaterThanOrEqual(4.5);
    }
    // White on the old steel was 3.94 : 1: the candidate that keeps the floor is chosen instead, and flagged.
    const old = kitOnPrimaryDetail("#3F7FE0");
    expect(old.passes).toBe(false);
    expect(old.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
