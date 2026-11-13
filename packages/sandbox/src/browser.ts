/**
 * Page capture: the sandbox's browser capability (item 13, the design check).
 *
 * `capturePages(sandbox, request)` opens pages of the founder's project inside the sandbox at each width (desktop 1440 px
 * and phone 390 px), takes a PNG of each and reads a short description of what is on the page (`PageDescription`:
 * every visible element's role, text, size, colors, spacing, radius), for the reviewer agent and the design lint. It
 * works over the `Sandbox` interface only (`exec`, `writeFile`, `readFile`), so every runner gets it without a new
 * method:
 *
 * - **mock** (`INTEGRATIONS_MODE=mock`): no browser and no pixels. Returns `{ status: "simulated" }` with a notice; the
 *   design check reports it as simulated and never as a review of the page.
 * - **docker / e2b**: starts the project with `serve.command` in the background (its own process group, stopped after),
 *   waits for its port, then runs a small Playwright script (`CAPTURE_SCRIPT`) with Chromium headless. The Playwright
 *   library is looked up under `playwrightDir` (default `/opt/fm-browser`), then in the project's own dependencies, then
 *   in the global npm root; the browser under `PLAYWRIGHT_BROWSERS_PATH`. Without them the result is
 *   `{ status: "unavailable" }` with the reason, and nothing claims screenshots exist.
 *
 * Production setup this needs (not done here: the E2B template is infrastructure this change cannot build or test):
 * `infra/e2b/e2b.Dockerfile` already installs Chromium under `/opt/pw-browsers` and sets `PLAYWRIGHT_BROWSERS_PATH`, but
 * not the Playwright library itself (its `npx` cache is deleted). Add `npm install -g playwright@1.63.0` (the catalog's
 * pin) to its RUN step and rebuild the template; the local Docker runner's `node:22-bookworm` needs the same plus
 * `npx playwright install --with-deps chromium`. The capture runs after `closeEgress()`, so the page can only reach the
 * project's own server on 127.0.0.1.
 */
import { DESIGN_VIEWPORTS, DESIGN_VIEWPORT_KEYS, PageDescription, type DesignViewport } from "@foundmill/shared";
import { z } from "zod";
import { shellQuote } from "./shell";
import type { Sandbox } from "./types";

/** Where the image keeps Playwright (a `node_modules` lives under it). */
export const DEFAULT_PLAYWRIGHT_DIR = "/opt/fm-browser";
/** Pages one capture opens at most (each at every width): enough for a change, bounded for the reviewer's cost. */
export const MAX_CAPTURE_PAGES = 4;
/** The tallest screenshot, as a multiple of the viewport height (a long page is cut, and the result says so). */
export const MAX_SHOT_SCREENS = 3;
/** Exit code of the capture script when the image has no browser. */
export const NO_BROWSER_EXIT = 3;
/** Exit code when the project's server never answered on its port. */
export const NOT_SERVING_EXIT = 4;

export const SIMULATED_CAPTURE_NOTICE = "Simulated: no browser runs in simulation, so no page was opened and no screenshot was taken.";

const CAPTURE_DIR = "/tmp/fm-capture";
const SERVE_LOG = "/tmp/fm-capture/serve.log";
const SERVE_PID = "/tmp/fm-capture/serve.pid";
/** A static file server every capture writes, for a project that is plain HTML: `node STATIC_SERVER_PATH <dir> <port>`. */
export const STATIC_SERVER_PATH = "/tmp/fm-capture/static.mjs";

/** Serves `<dir>` on 127.0.0.1:<port>; `/x` finds `x`, `x.html` or `x/index.html`, and never leaves `<dir>`. */
export const STATIC_SERVER_SCRIPT = String.raw`
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
const root = resolve(process.argv[2] || ".");
const port = Number(process.argv[3]);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const find = async (p) => { for (const c of [p, p + ".html", join(p, "index.html")]) { try { if ((await stat(c)).isFile()) return c; } catch {} } return null; };
createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = resolve(root, "." + normalize(url));
  const hit = file.startsWith(root) ? await find(file) : null;
  if (!hit) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "content-type": types[extname(hit)] || "application/octet-stream" });
  res.end(await readFile(hit));
}).listen(port, "127.0.0.1");
`;

export interface PageCaptureRequest {
  /** Routes to open ("/", "/pricing"), at most `MAX_CAPTURE_PAGES`. */
  pages: readonly string[];
  viewports?: readonly DesignViewport[];
  /** Starts the project on `port` and keeps running (it is put in the background and stopped after the capture). */
  serve: { command: string; port: number; cwd?: string; readyTimeoutMs?: number };
  playwrightDir?: string;
  /** Per page load. Default 30 s. */
  pageTimeoutMs?: number;
  /** Prefix for screenshot ids ("before", "after"). */
  label?: string;
}

export interface CapturedShot {
  /** Stable within one capture: `<label>-<n>-<viewport>`. */
  id: string;
  page: string;
  viewport: DesignViewport;
  width: number;
  height: number;
  /** The page was taller than `MAX_SHOT_SCREENS` screens and the shot shows its top. */
  cut: boolean;
  pngBase64: string;
  description: PageDescription | null;
}

export type PageCaptureResult =
  | { status: "captured"; shots: CapturedShot[]; failed: { page: string; viewport: DesignViewport; reason: string }[]; durationMs: number }
  | { status: "simulated"; notice: string; pages: { page: string; viewport: DesignViewport }[] }
  | { status: "unavailable"; reason: string; durationMs: number };

const ShotLine = z.object({
  page: z.string(),
  viewport: z.enum(DESIGN_VIEWPORT_KEYS),
  ok: z.boolean(),
  reason: z.string().max(500).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  cut: z.boolean().optional(),
  png: z.string().optional(),
  description: z.unknown().optional(),
});

/** A route the capture may open: a path on the project's own server, nothing that leaves it. */
export function safeRoute(route: string): string | null {
  const r = route.trim();
  if (!r.startsWith("/") || r.startsWith("//") || r.length > 300) return null;
  if (/[\s\\"'`<>]/.test(r) || /^\/[a-z]+:/i.test(r)) return null;
  return r;
}

/**
 * The script the sandbox runs with Node: launch Chromium, wait for the server, open each page at each width, write one
 * JSON line per shot to `<dir>/shots.jsonl`. Self-contained (Node built-ins and Playwright only).
 */
export const CAPTURE_SCRIPT = String.raw`
import { createRequire } from "node:module";
import { readFileSync, appendFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
// Playwright from the image's own place, else the project's dependencies, else the global npm root.
let chromium;
const roots = [cfg.playwrightDir + "/package.json", process.cwd() + "/package.json", process.env.FM_NPM_ROOT ? process.env.FM_NPM_ROOT + "/index.js" : null].filter(Boolean);
for (const root of roots) {
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    try { chromium = createRequire(root)(name).chromium; } catch {}
    if (chromium) break;
  }
  if (chromium) break;
}
if (!chromium) { console.error("FM_NO_BROWSER playwright is not installed"); process.exit(${NO_BROWSER_EXIT}); }
const base = "http://127.0.0.1:" + cfg.port;
const deadline = Date.now() + cfg.readyTimeoutMs;
let up = false;
while (Date.now() < deadline) {
  try { const r = await fetch(base + "/", { redirect: "manual" }); if (r.status < 500) { up = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { console.error("FM_NOT_SERVING nothing answered on port " + cfg.port); process.exit(${NOT_SERVING_EXIT}); }
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch (e) { console.error("FM_NO_BROWSER chromium could not start: " + e.message); process.exit(${NO_BROWSER_EXIT}); }
const describe = (maxH) => {
  const rgbaOf = (s) => s && s !== "rgba(0, 0, 0, 0)" && s !== "transparent";
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (rgbaOf(b)) return b; } return "rgb(255, 255, 255)"; };
  const refOf = (el) => { const parts = []; for (let n = el, i = 0; n && n !== document.body && i < 3; n = n.parentElement, i++) { const tag = n.tagName.toLowerCase(); const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; parts.unshift(sib.length > 1 ? tag + ":nth-of-type(" + (sib.indexOf(n) + 1) + ")" : tag); } return parts.join(" > ") || "body"; };
  const roleOf = (el) => { const t = el.tagName.toLowerCase(); if (/^h[1-6]$/.test(t)) return "heading"; if (t === "button" || el.getAttribute("role") === "button") return "button"; if (t === "a") return "link"; if (t === "input" || t === "textarea" || t === "select") return "input"; if (t === "img" || t === "svg" || t === "picture") return "image"; const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()); return own ? "text" : "container"; };
  const out = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (out.length >= 300) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.top > maxH) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const role = roleOf(el);
    const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" ").replace(/\s+/g, " ").trim();
    const text = (role === "button" || role === "link" || role === "heading" ? (el.innerText || "") : role === "input" ? (el.getAttribute("placeholder") || el.value || "") : own).replace(/\s+/g, " ").trim().slice(0, 200);
    const spacing = ["marginTop", "marginBottom", "paddingTop", "paddingBottom", "paddingLeft", "rowGap", "columnGap"].map((k) => parseFloat(cs[k]) || 0).filter((v) => v > 0).slice(0, 16);
    const bgImage = cs.backgroundImage || "";
    if (role === "container" && !spacing.length && !bgImage.includes("gradient") && cs.boxShadow === "none" && !(parseFloat(cs.borderTopLeftRadius) > 0)) continue;
    out.push({ ref: refOf(el), role, ...(role === "heading" ? { level: Number(el.tagName[1]) } : {}), text, fontSizePx: Math.round(parseFloat(cs.fontSize) * 10) / 10, fontWeight: Number(cs.fontWeight) || 400, color: cs.color, background: bgOf(el), spacingPx: spacing, radiusPx: parseFloat(cs.borderTopLeftRadius) || 0, shadow: cs.boxShadow !== "none", gradient: bgImage.includes("gradient"), gradientText: bgImage.includes("gradient") && (cs.backgroundClip === "text" || cs.webkitBackgroundClip === "text"), widthPx: Math.round(r.width), heightPx: Math.round(r.height) });
  }
  return { widthPx: window.innerWidth, scrollWidthPx: document.documentElement.scrollWidth, title: document.title.slice(0, 200), elements: out };
};
for (const page of cfg.pages) {
  for (const vp of cfg.viewports) {
    const line = { page, viewport: vp.key };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    try {
      const p = await ctx.newPage();
      await p.goto(base + page, { waitUntil: "networkidle", timeout: cfg.pageTimeoutMs });
      const full = await p.evaluate(() => document.documentElement.scrollHeight);
      const maxH = vp.height * cfg.maxScreens;
      const height = Math.max(vp.height, Math.min(full, maxH));
      const png = await p.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: vp.width, height } });
      const d = await p.evaluate(describe, maxH);
      appendFileSync(cfg.out, JSON.stringify({ ...line, ok: true, width: vp.width, height, cut: full > maxH, png: png.toString("base64"), description: { page, viewport: vp.key, ...d } }) + "\n");
    } catch (e) {
      appendFileSync(cfg.out, JSON.stringify({ ...line, ok: false, reason: String(e && e.message || e).slice(0, 400) }) + "\n");
    } finally { await ctx.close(); }
  }
}
await browser.close();
`;

/** Open the changed pages at each width and return the shots, or why there are none. Never throws for a page or a missing browser. */
export async function capturePages(sandbox: Sandbox, request: PageCaptureRequest): Promise<PageCaptureResult> {
  const viewports = (request.viewports?.length ? request.viewports : DESIGN_VIEWPORT_KEYS).filter((v, i, a) => a.indexOf(v) === i);
  const pages = request.pages.map(safeRoute).filter((p): p is string => p !== null).filter((p, i, a) => a.indexOf(p) === i).slice(0, MAX_CAPTURE_PAGES);
  if (sandbox.provider === "mock") return { status: "simulated", notice: SIMULATED_CAPTURE_NOTICE, pages: pages.flatMap((page) => viewports.map((viewport) => ({ page, viewport }))) };
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  if (pages.length === 0) return { status: "unavailable", reason: "no page to open: the change names no route the project serves", durationMs: elapsed() };
  if (!Number.isInteger(request.serve.port) || request.serve.port < 1024 || request.serve.port > 65535) return { status: "unavailable", reason: "the project's port is not a usable local port", durationMs: elapsed() };

  const out = `${CAPTURE_DIR}/shots.jsonl`;
  const config = {
    playwrightDir: request.playwrightDir ?? DEFAULT_PLAYWRIGHT_DIR,
    port: request.serve.port,
    readyTimeoutMs: request.serve.readyTimeoutMs ?? 120_000,
    pageTimeoutMs: request.pageTimeoutMs ?? 30_000,
    maxScreens: MAX_SHOT_SCREENS,
    out,
    pages,
    viewports: viewports.map((key) => ({ key, ...DESIGN_VIEWPORTS[key] })),
  };
  await sandbox.exec(`rm -rf ${CAPTURE_DIR} && mkdir -p ${CAPTURE_DIR}`, { timeoutMs: 30_000 });
  await sandbox.writeFile(`${CAPTURE_DIR}/capture.mjs`, CAPTURE_SCRIPT);
  await sandbox.writeFile(STATIC_SERVER_PATH, STATIC_SERVER_SCRIPT);
  await sandbox.writeFile(`${CAPTURE_DIR}/config.json`, JSON.stringify(config));
  const cwd = request.serve.cwd ?? sandbox.workdir;
  // In the background in its own process group (setsid), so this exec returns at once and the stop after the capture
  // ends the server and every process it started (pnpm runs the dev server as a child).
  const serve = await sandbox.exec(`cd ${shellQuote(cwd)} && (PORT=${config.port} setsid nohup sh -c ${shellQuote(request.serve.command)} > ${SERVE_LOG} 2>&1 < /dev/null & echo $! > ${SERVE_PID})`, { timeoutMs: 30_000 });
  if (serve.code !== 0) return { status: "unavailable", reason: `the project could not be started (exit ${serve.code}): ${(serve.stderr || serve.stdout).trim().slice(0, 300)}`, durationMs: elapsed() };
  try {
    const browserDir = `${config.playwrightDir}/browsers`;
    const run = await sandbox.exec(`cd ${shellQuote(cwd)} && FM_NPM_ROOT="$(npm root -g 2>/dev/null)" PLAYWRIGHT_BROWSERS_PATH="\${PLAYWRIGHT_BROWSERS_PATH:-${browserDir}}" node ${CAPTURE_DIR}/capture.mjs ${CAPTURE_DIR}/config.json`, { timeoutMs: config.readyTimeoutMs + pages.length * viewports.length * (config.pageTimeoutMs + 10_000) + 30_000 });
    if (run.code === NO_BROWSER_EXIT) return { status: "unavailable", reason: `the sandbox has no browser (Playwright and Chromium are not installed under ${config.playwrightDir})`, durationMs: elapsed() };
    if (run.code === NOT_SERVING_EXIT) {
      const log = await sandbox.readFile(SERVE_LOG).catch(() => "");
      return { status: "unavailable", reason: `the project did not start on port ${config.port}${log.trim() ? `: ${log.trim().split("\n").slice(-3).join(" ").slice(0, 300)}` : ""}`, durationMs: elapsed() };
    }
    const text = await sandbox.readFile(out).catch(() => "");
    const shots: CapturedShot[] = [];
    const failed: { page: string; viewport: DesignViewport; reason: string }[] = [];
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      let parsed: z.infer<typeof ShotLine>;
      try {
        parsed = ShotLine.parse(JSON.parse(raw));
      } catch {
        continue;
      }
      if (!parsed.ok || !parsed.png || !parsed.width || !parsed.height || !/^[A-Za-z0-9+/]+=*$/.test(parsed.png.slice(0, 2048))) {
        failed.push({ page: parsed.page, viewport: parsed.viewport, reason: parsed.reason ?? "no screenshot came back" });
        continue;
      }
      const description = PageDescription.safeParse(parsed.description);
      shots.push({ id: `${request.label ?? "shot"}-${pages.indexOf(parsed.page) + 1}-${parsed.viewport}`, page: parsed.page, viewport: parsed.viewport, width: parsed.width, height: parsed.height, cut: parsed.cut === true, pngBase64: parsed.png, description: description.success ? description.data : null });
    }
    if (shots.length === 0 && failed.length === 0) return { status: "unavailable", reason: `the browser ran but wrote no screenshot (exit ${run.code}): ${run.stderr.trim().slice(0, 300)}`, durationMs: elapsed() };
    return { status: "captured", shots, failed, durationMs: elapsed() };
  } finally {
    await sandbox.exec(`[ -f ${SERVE_PID} ] && { kill -- -$(cat ${SERVE_PID}) 2>/dev/null || kill $(cat ${SERVE_PID}) 2>/dev/null; }; true`, { timeoutMs: 10_000 }).catch(() => undefined);
  }
}
