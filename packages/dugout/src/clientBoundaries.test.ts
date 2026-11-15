/**
 * Client boundaries (ARCHITECTURE §14, wave 3): Next.js Server Components import the `@foundmill/dugout` barrel, so
 * every module that only works in the browser must open with `"use client"`, file by file (never on a barrel), while
 * pure helpers (BusinessLogo, format, brand paths, colour maths) stay server-safe.
 *
 * The rule below is the one applied in the sweep. A module needs the directive when it
 *   - calls a React hook other than useId / useMemo / useCallback (those exist in the react-server build), or any
 *     custom `useX()` hook,
 *   - calls createContext,
 *   - imports a browser-only library (Radix, cmdk, motion, zustand, hotkeys, TanStack, react-grid-layout, PixiJS,
 *     xterm, Monaco, visx/responsive, react-resizable-panels), or
 *   - creates a function inside the component and hands it to an `on*` prop (functions cannot cross from a server
 *     component to the DOM or to a client component).
 * Barrels never carry the directive, so server code can still import the pure exports beside the client ones.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname);

const SERVER_SAFE_HOOKS = new Set(["useId", "useMemo", "useCallback"]);
const CLIENT_LIBS = [
  /^@radix-ui\//,
  /^cmdk$/,
  /^motion(\/|$)/,
  /^framer-motion$/,
  /^zustand(\/|$)/,
  /^react-hotkeys-hook$/,
  /^react-resizable-panels$/,
  /^@tanstack\//,
  /^react-grid-layout(\/|$)/,
  /^pixi\.js(\/|$)/,
  /^@xterm\//,
  /^@monaco-editor\//,
  /^monaco-editor(\/|$)/,
  /^@visx\/responsive$/,
];

/** Files that re-export other modules. They must never carry the directive. */
export const BARRELS = [
  "index.ts",
  "lib/index.ts",
  "components/foundation.ts",
  "components/shell.ts",
  "components/data.ts",
  "components/journey.ts",
  "components/agents.ts",
  "components/conversation.ts",
  "components/call.ts",
  // The guided layer (UX plan §6): the definitions primitives and the first-run pieces.
  "components/guidance.ts",
  "components/firstrun.ts",
  "components/today.ts",
  "components/public.ts",
  "components/share.ts",
  "brand.ts",
];

/** Server-safe exports a Server Component is expected to use directly (ARCHITECTURE §14, DESIGN §4). */
export const SERVER_SAFE_FILES = [
  "brand/marks.ts",
  "lib/cn.ts",
  "lib/colour.ts",
  "lib/motion.ts",
  "lib/format.ts",
  // The date-format choice (Settings › Preferences): the patterns and their names; DateFormatProvider is the client piece.
  "lib/date-preferences.ts",
  "lib/rating.ts",
  "lib/seed.ts",
  "version.ts",
  "components/foundation/BusinessLogo.tsx",
  "components/foundation/Icon.tsx",
  "components/foundation/LogoMark.tsx",
  "components/foundation/Wordmark.tsx",
  "components/foundation/StatusPill.tsx",
  "components/foundation/Chip.tsx",
  "components/foundation/ProgressRing.tsx",
  "components/foundation/ProgressBar.tsx",
  "components/foundation/Sparkline.tsx",
  "components/foundation/StarRating.tsx",
  "components/foundation/Skeleton.tsx",
  "components/foundation/Kbd.tsx",
  // Overlays, people and states: presence breathing, the icon halo and the logo's light are CSS (overlays.css).
  "components/foundation/Avatar.tsx",
  "components/foundation/EmptyState.tsx",
  "components/foundation/ErrorState.tsx",
  "components/foundation/Spinner.tsx",
  "components/foundation/menuStyles.ts",
  "components/shell/types.ts",
  "components/shell/PageGrid.tsx",
  // The panel frame renders on the server; its "…" menu is the client piece (PanelMenuButton, Radix loaded on demand).
  "components/shell/Panel.tsx",
  "components/shell/NeedsLargerWindow.tsx",
  "components/journey/stage/schedule.ts",
  "components/journey/ribbon/geometry.ts",
  "components/agents/formation.ts",
  "components/agents/progress.ts",
  "components/data/csv.ts",
  // Figure micro-typography: plain spans, no hooks (a server component can set a figure).
  "components/data/Figure.tsx",
  "components/data/diff.ts",
  "components/data/filters.ts",
  "components/data/entityMarkup.ts",
  // Conversation and generation: the presence, receipts, reactions, typing line, live run and drafting frame are CSS
  // only (conversation.css); AgentDesk, DeskPresence (it reads the anthropomorphic agents provider for the first name),
  // QuickReplies and StreamingText are the client pieces.
  "components/conversation/types.ts",
  "components/conversation/ReadReceipt.tsx",
  "components/conversation/Reaction.tsx",
  "components/conversation/TypingLine.tsx",
  "components/conversation/LiveRun.tsx",
  "components/conversation/DraftingCard.tsx",
  "components/conversation/NudgeAck.tsx",
  // The guided layer (UX plan §6): the consequence line and the scale word are information a server component can
  // render; the next-step rules are pure; the fixture map and the keyboard-focus tracker hold no React at all.
  "components/guidance/ConsequenceLine.tsx",
  "components/guidance/ScaleLabel.tsx",
  "components/guidance/fixtures.ts",
  "components/guidance/keyboardFocus.ts",
  "components/firstrun/nextSteps.ts",
  // Today (founder, 2026-11-07): the week in words is plain markup inside a Panel.
  "components/today/WeekPlan.tsx",
  // Public pages: the project page is rendered by the signed-out route as a Server Component.
  "components/public/ProjectPage.tsx",
  "components/public/ProjectStory.tsx",
  "components/public/MilestoneCard.tsx",
  "components/public/PersonPage.tsx",
  // The Terms and the Privacy Policy (founder, 2026-11-13): rendered by their static routes as Server Components.
  "components/public/LegalPage.tsx",
  // The landing page's pieces (DESIGN §9a): plain markup the prerendered page renders as Server Components.
  "components/landing/ScreenFrame.tsx",
  "components/landing/LandingSection.tsx",
  "components/landing/DayList.tsx",
  "components/landing/AssuranceList.tsx",
  "components/landing/QuestionList.tsx",
  // The streak (retention plan, 2026-11-11): plain markup inside a Panel.
  "components/today/StreakStrip.tsx",
];

export function listSourceFiles(root = SRC): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "test" || name === "stories" || name === "node_modules") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        out.push(relative(root, p));
      }
    }
  };
  walk(root);
  return out.sort();
}

/** What may come right before a `/` that opens a regex literal (anything else makes it division). */
const REGEX_PRECEDERS = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase|\bdo|\belse|\bin|\bof|\bvoid|\bnew|\bdelete|\bthrow|\byield|\bawait)\s*$/;

/**
 * Remove comments and string literals so hook names inside fixtures or prose do not count. A small scanner rather
 * than regexes: template literals nest (`${cond ? `x` : "y"}`) and a regex cannot pair their backticks. Regex
 * literals are skipped too (as `//`), since one may hold a quote or a backtick (a Markdown rule for inline code) that
 * would otherwise open a string and swallow the code after it.
 */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  // Template nesting: each entry is the brace depth inside the current `${ … }` (-1 = in the literal's text).
  const tpl: number[] = [];
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === "/" && next !== "/" && next !== "*" && (!tpl.length || tpl[tpl.length - 1] !== -1) && REGEX_PRECEDERS.test(out.slice(-12))) {
      // A regex literal: to the closing unescaped `/` outside a character class, then its flags.
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        const c = src[j]!;
        if (c === "\\") j += 2;
        else if (inClass) {
          if (c === "]") inClass = false;
          j++;
        } else if (c === "[") {
          inClass = true;
          j++;
        } else if (c === "/") break;
        else j++;
      }
      while (j + 1 < n && /[a-z]/i.test(src[j + 1]!)) j++;
      out += "/re/";
      i = j + 1;
      continue;
    }
    if (tpl.length && tpl[tpl.length - 1] === -1) {
      // Inside template text.
      if (ch === "\\") i += 2;
      else if (ch === "`") {
        tpl.pop();
        out += '""';
        i++;
      } else if (ch === "$" && next === "{") {
        tpl[tpl.length - 1] = 0;
        out += "(";
        i += 2;
      } else i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += ch + ch;
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      tpl.push(-1);
      i++;
      continue;
    }
    if (tpl.length) {
      const depth = tpl[tpl.length - 1]!;
      if (ch === "{") tpl[tpl.length - 1] = depth + 1;
      else if (ch === "}") {
        if (depth === 0) {
          tpl[tpl.length - 1] = -1;
          out += ")";
          i++;
          continue;
        }
        tpl[tpl.length - 1] = depth - 1;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function hasUseClient(src: string): boolean {
  // The directive must be the first statement; leading comments are allowed.
  const head = src.replace(/^\uFEFF/, "").replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
  return /^["']use client["'];?/.test(head);
}

export function importedModules(src: string): string[] {
  return [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** `on*={...}` attribute values that create a function in place (closures, `fn ? () => … : undefined`, `function`). */
export function inlineHandlers(code: string): string[] {
  const found: string[] = [];
  const re = /\bon[A-Z]\w*=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const value = code.slice(m.index + m[0].length, i - 1);
    if (/=>|\bfunction\b/.test(value)) found.push(value.trim().slice(0, 60));
  }
  return found;
}

export interface BoundaryVerdict {
  needsClient: boolean;
  reasons: string[];
}

export function classify(src: string): BoundaryVerdict {
  const code = stripCommentsAndStrings(src);
  const reasons: string[] = [];
  const hooks = [...new Set([...code.matchAll(/\b(use[A-Z]\w*)\s*(?:<[^()]*?>)?\s*\(/g)].map((m) => m[1]!))].filter((h) => !SERVER_SAFE_HOOKS.has(h));
  if (hooks.length) reasons.push(`hooks: ${hooks.join(", ")}`);
  if (/\bcreateContext\s*(?:<[^()]*?>)?\s*\(/.test(code)) reasons.push("createContext");
  const libs = importedModules(src).filter((s) => CLIENT_LIBS.some((re) => re.test(s)));
  if (libs.length) reasons.push(`client libraries: ${[...new Set(libs)].join(", ")}`);
  const handlers = inlineHandlers(code);
  if (handlers.length) reasons.push(`inline handlers: ${handlers.slice(0, 2).join(" | ")}`);
  return { needsClient: reasons.length > 0, reasons };
}

describe("client boundaries", () => {
  const files = listSourceFiles();
  const sources = new Map(files.map((f) => [f, readFileSync(join(SRC, f), "utf8")] as const));

  it("marks every module that needs the browser with \"use client\"", () => {
    const missing = files.filter((f) => classify(sources.get(f)!).needsClient && !hasUseClient(sources.get(f)!)).map((f) => `${f} (${classify(sources.get(f)!).reasons.join("; ")})`);
    expect(missing).toEqual([]);
  });

  it("keeps the directive off barrels so server code can import the pure exports", () => {
    for (const b of BARRELS) {
      expect(sources.has(b), `${b} exists`).toBe(true);
      expect(hasUseClient(sources.get(b)!), `${b} has no directive`).toBe(false);
      expect(classify(sources.get(b)!).needsClient, `${b} is a pure barrel`).toBe(false);
    }
  });

  it("keeps the documented server-safe modules free of the directive and of client signals", () => {
    for (const f of SERVER_SAFE_FILES) {
      expect(sources.has(f), `${f} exists`).toBe(true);
      const verdict = classify(sources.get(f)!);
      expect(verdict.reasons, `${f} is server-safe`).toEqual([]);
      expect(hasUseClient(sources.get(f)!), `${f} has no directive`).toBe(false);
    }
  });

  it("never carries a directive that is not the first statement", () => {
    const misplaced = files.filter((f) => /["']use client["']/.test(stripCommentsAndStrings(sources.get(f)!).slice(200)) && !hasUseClient(sources.get(f)!));
    expect(misplaced).toEqual([]);
  });

  it("documents the client-only files (snapshot of the sweep)", () => {
    const client = files.filter((f) => hasUseClient(sources.get(f)!));
    // Every file with the directive has a reason; the list is the contract apps/web relies on.
    const unexplained = client.filter((f) => !classify(sources.get(f)!).needsClient);
    expect(unexplained).toEqual([]);
    expect(client.length).toBeGreaterThan(60);
  });

  it("detector: counts generic hook calls and ignores hook names inside strings", () => {
    expect(classify('import { useState } from "react"; export function A() { const [v] = useState<number>(1); return v; }').needsClient).toBe(true);
    expect(classify('export const diff = [" import { useState } from \\"react\\";", "+ const [s] = useState(1);"];').needsClient).toBe(false);
    expect(classify('export function B({ onClick }: { onClick?: () => void }) { return <button onClick={onClick} />; }').needsClient).toBe(false);
    expect(classify("export function C({ go }: { go: (k: string) => void }) { return <button onClick={() => go('x')} />; }").needsClient).toBe(true);
    expect(classify('import { useId, useMemo } from "react"; export function D() { const id = useId(); return useMemo(() => id, [id]); }').needsClient).toBe(false);
  });

  it("detector: skips regex literals, so a quote or a backtick inside one never swallows the code after it", () => {
    const code = 'const INLINE = /`[^`\\n]*`/g; const Q = /"[^"]*"/; export function A() { const [v] = useState(1); return v / 2; }';
    expect(stripCommentsAndStrings(code)).toContain("useState(1)");
    expect(stripCommentsAndStrings(code)).toContain("v / 2");
    expect(classify(code).needsClient).toBe(true);
    expect(classify("const half = total / 2 / count; export const x = half;").needsClient).toBe(false);
  });

  it("detector: strips nested template literals without swallowing the code after them", () => {
    const code = stripCommentsAndStrings("const a = `${w} ${flat ? `x` : \"y\"}`.trim(); // tail\nconst b = <button onClick={() => go()} />;");
    expect(code).toContain("onClick={() => go()}");
    expect(code).not.toContain("tail");
    expect(inlineHandlers(code)).toHaveLength(1);
  });
});
