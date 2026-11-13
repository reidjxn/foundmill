/**
 * The design check step (item 13): after a code agent changes UI in a founder's project, the changed pages are opened in
 * the sandbox at desktop and 390 px (`capturePages`, packages/sandbox), a separate reviewer on the vision route critiques
 * the screenshots (`buildDesignReviewRequest` → `designReview` → `finaliseDesignReview`, packages/agents), and the author
 * agent is asked once to apply the fixes. The critique and the before and after screenshots are recorded on the task
 * (`task.design_checked`) and shown on the change's approval.
 *
 * It never blocks the founder: a check that cannot run (no browser in the image, the project does not start, the
 * reviewer is unreachable) says so in a note and in the record, and the session goes on to its tests as before. It never
 * claims screenshots that do not exist: `simulated` (mock mode) and `not_seen` records carry none.
 *
 * The pure parts (which paths are UI, which routes they serve, how the project starts) are exported for tests; the
 * session supplies the sandbox, the model and the store through `DesignCheckPorts`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildDesignReviewRequest, designFixTurn, finaliseDesignReview, type ReviewShot } from "@foundmill/agents";
import { DesignReviewOutput } from "@foundmill/models";
import { isPngBase64, MAX_CAPTURE_PAGES, STATIC_SERVER_PATH, type CapturedShot, type PageCaptureResult } from "@foundmill/sandbox";
import { designCheckFixLines, designCheckHeadline, type DesignCheckResult, type DesignShotRef } from "@foundmill/shared";
import type { CompleteRequest } from "@foundmill/models";

/** Files whose change can change what a page looks like. */
const UI_FILE = /\.(?:tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|mdx)$/i;
/** Tests, stories and fixtures are never what a visitor sees. */
const NOT_UI = /(?:^|\/)(?:__tests__|__mocks__|e2e|tests?|stories|\.storybook|fixtures|node_modules|dist|build|\.next)\/|\.(?:test|spec|stories)\.[a-z]+$/i;
/** The port the project is served on inside the sandbox. */
export const DESIGN_CHECK_PORT = 4317;

/** A relative path is inside the workspace only when, normalized, it neither climbs out nor is absolute. */
const insideRelative = (p: string) => !path.isAbsolute(p) && p !== ".." && !p.startsWith(`..${path.sep}`) && !p.startsWith("../");

/**
 * A path a tool call wrote, relative to the workspace with forward slashes, or null when it is not a string or leaves
 * the workspace (`a/../../x`, an absolute path elsewhere). The agent's tool input is never trusted as a path.
 */
export function touchedPath(cwd: string, p: unknown): string | null {
  if (typeof p !== "string" || !p || p.length > 500 || p.includes("\0")) return null;
  const rel = path.normalize(path.isAbsolute(p) ? path.relative(path.resolve(cwd), path.resolve(p)) : p);
  if (!rel || rel === "." || !insideRelative(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** A screenshot's bytes when it is a PNG (its signature checked), else null: nothing else is stored as a screenshot. */
export function screenshotBytes(pngBase64: string): Uint8Array | null {
  if (!isPngBase64(pngBase64)) return null;
  const bytes = Buffer.from(pngBase64, "base64");
  return bytes.length > 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG" ? new Uint8Array(bytes) : null;
}

/** The paths of a change that can affect a page (only paths inside the workspace). */
export function uiChanges(paths: readonly string[]): string[] {
  return [...new Set(paths.map((p) => path.posix.normalize(p.replace(/^\.\//, ""))).filter((p) => insideRelative(p) && UI_FILE.test(p) && !NOT_UI.test(p)))];
}

/**
 * The route a file serves, relative to its app's directory, when its place says so: Next.js `app/…/page.tsx` and
 * `pages/…`, SvelteKit `routes/…/+page.svelte`, a static `index.html` or `public/x.html`. Null for anything else (a
 * component, a stylesheet) and for a dynamic route (`[slug]`), which has no address without a value.
 */
export function routeForPath(rel: string): string | null {
  const p = rel.replace(/^src\//, "");
  const segments = (s: string) => s.split("/").filter((seg) => seg && !/^\(.*\)$/.test(seg) && !seg.startsWith("@"));
  const join = (segs: string[]) => (segs.some((s) => /^\[.*\]$/.test(s)) ? null : `/${segs.join("/")}`);
  let m = /^app\/(?:(.*)\/)?page\.(?:tsx|jsx|ts|js|mdx)$/.exec(p);
  if (m) return join(segments(m[1] ?? ""));
  m = /^pages\/(.+)\.(?:tsx|jsx|ts|js|mdx|vue|astro)$/.exec(p);
  if (m) {
    if (/^(?:_app|_document|_error|api\/)/.test(m[1]!)) return null;
    const segs = segments(m[1]!);
    if (segs.at(-1) === "index") segs.pop();
    return join(segs);
  }
  m = /^routes\/(?:(.*)\/)?\+page\.svelte$/.exec(p);
  if (m) return join(segments(m[1] ?? ""));
  if (rel === "index.html" || rel === "public/index.html") return "/";
  m = /^(?:public\/)?([A-Za-z0-9_-]+)\.html$/.exec(rel);
  if (m) return `/${m[1]}.html`;
  return null;
}

/** The pages to open for a change: the routes it touched, else the home page (a component or style is seen there first). */
export function pagesForChanges(paths: readonly string[], appDir = ""): string[] {
  const prefix = appDir ? `${appDir.replace(/\/$/, "")}/` : "";
  const routes = uiChanges(paths)
    .map((p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : prefix ? null : p))
    .filter((p): p is string => p !== null)
    .map(routeForPath)
    .filter((r): r is string => r !== null);
  const unique = [...new Set(routes)];
  return (unique.length ? unique : ["/"]).slice(0, MAX_CAPTURE_PAGES);
}

export interface DesignServePlan {
  /** The app's directory relative to the workspace ("" for the root). */
  appDir: string;
  /** Its package name, for the dependency install's `--filter` (null at the root or without a name). */
  packageName: string | null;
  command: string;
  port: number;
  pages: string[];
}

const SAFE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

/**
 * How the project serves the changed pages: the nearest package.json above the first UI change with a `dev` or `start`
 * script (run with pnpm on DESIGN_CHECK_PORT), else a static `index.html` served by the capture's own static server.
 * Null when the change is not UI; `{ unservable }` when nothing can serve it.
 */
export async function planDesignServe(cwd: string, touched: readonly string[]): Promise<DesignServePlan | { unservable: string } | null> {
  const ui = uiChanges(touched);
  if (ui.length === 0) return null;
  const root = path.resolve(cwd);
  let appDir = "";
  type PackageJson = { name?: unknown; scripts?: Record<string, unknown> };
  let pkg = null as PackageJson | null;
  const inRoot = (dir: string) => dir === root || dir.startsWith(root + path.sep);
  for (let dir = path.dirname(path.resolve(root, ui[0]!)); inRoot(dir); dir = path.dirname(dir)) {
    try {
      pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as PackageJson;
      appDir = path.relative(root, dir).split(path.sep).join("/");
      break;
    } catch {
      if (dir === root) break;
    }
  }
  const pages = pagesForChanges(touched, appDir);
  const scripts = pkg?.scripts ?? {};
  const script = typeof scripts.dev === "string" ? "dev" : typeof scripts.start === "string" ? "start" : null;
  const packageName = appDir && typeof pkg?.name === "string" && SAFE_NAME.test(pkg.name) ? pkg.name : null;
  if (script) return { appDir, packageName, command: `pnpm run ${script} --port ${DESIGN_CHECK_PORT}`, port: DESIGN_CHECK_PORT, pages };
  const staticRoot = await fs
    .access(path.join(root, appDir, "index.html"))
    .then(() => appDir || ".")
    .catch(() => null);
  if (staticRoot) return { appDir, packageName: null, command: `node ${STATIC_SERVER_PATH} . ${DESIGN_CHECK_PORT}`, port: DESIGN_CHECK_PORT, pages };
  return { unservable: "the project has no dev or start script and no index.html to serve" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------------------------------------------------

export interface DesignCheckPorts {
  /** Open the pages in the sandbox ("before" first; "after" once the author applied the fixes). */
  capture(label: "before" | "after"): Promise<PageCaptureResult>;
  /** The reviewer's call on the vision route. */
  review(req: CompleteRequest & { schema: typeof DesignReviewOutput }): Promise<DesignReviewOutput>;
  /** Keep the PNGs in the business's store; a ref per shot, `sha256` null for one that could not be kept. */
  store(shots: readonly CapturedShot[]): Promise<DesignShotRef[]>;
  note(level: "info" | "warn", text: string): Promise<void>;
}

export interface DesignCheckContext {
  businessName: string;
  taskTitle: string;
  pages: readonly string[];
}

const toReviewShot = (s: CapturedShot): ReviewShot => ({ id: s.id, page: s.page, viewport: s.viewport, width: s.width, height: s.height, cut: s.cut, pngBase64: s.pngBase64, description: s.description });

/** A record for a check that could not see the pages, with its note. */
export async function designCheckNotSeen(ports: Pick<DesignCheckPorts, "note">, pages: readonly string[], reason: string): Promise<DesignCheckResult> {
  const result: DesignCheckResult = { status: "not_seen", reason: reason.slice(0, 400), pages: [...pages].slice(0, 8), fixes: [], unreadable: [], before: [], after: [], fixesAsked: false };
  await ports.note("warn", designCheckHeadline(result));
  return result;
}

/**
 * The first half: screenshots before, the review, the fixes. Returns the record so far and the one turn to send the
 * author, or null when there is nothing to fix (or nothing was seen).
 */
export async function designCheckBefore(ports: DesignCheckPorts, ctx: DesignCheckContext): Promise<{ result: DesignCheckResult; fixTurn: string | null }> {
  const pages = [...ctx.pages].slice(0, 8);
  let captured: PageCaptureResult;
  try {
    captured = await ports.capture("before");
  } catch (err) {
    return { result: await designCheckNotSeen(ports, pages, `the sandbox failed: ${String((err as Error).message ?? err).slice(0, 200)}`), fixTurn: null };
  }
  if (captured.status === "simulated") {
    const result: DesignCheckResult = { status: "simulated", reason: captured.notice, pages, fixes: [], unreadable: [], before: [], after: [], fixesAsked: false };
    await ports.note("info", designCheckHeadline(result));
    return { result, fixTurn: null };
  }
  if (captured.status === "unavailable") return { result: await designCheckNotSeen(ports, pages, captured.reason), fixTurn: null };
  if (captured.shots.length === 0) return { result: await designCheckNotSeen(ports, pages, `no page loaded${captured.failed[0] ? ` (${captured.failed[0].page}: ${captured.failed[0].reason.slice(0, 160)})` : ""}`), fixTurn: null };

  const shots = captured.shots.map(toReviewShot);
  const before = await ports.store(captured.shots);
  let output: DesignReviewOutput | null = null;
  let reviewError: string | null = null;
  try {
    output = await ports.review({ ...buildDesignReviewRequest({ businessName: ctx.businessName, taskTitle: ctx.taskTitle, shots }), schema: DesignReviewOutput });
  } catch (err) {
    reviewError = String((err as Error).message ?? err).slice(0, 200);
  }
  const fin = finaliseDesignReview(output, shots);
  const failedPages = captured.failed.map((f) => ({ page: f.page, viewport: f.viewport, why: `did not load: ${f.reason}`.slice(0, 200) }));
  const result: DesignCheckResult = {
    // Without the reviewer the fixes are what the browser measured, and the record says so.
    status: reviewError ? "measured" : "reviewed",
    reason: reviewError ? `the reviewer could not be reached (${reviewError})` : null,
    pages: [...new Set(captured.shots.map((s) => s.page))].slice(0, 8),
    fixes: fin.fixes,
    unreadable: [...fin.unreadable, ...failedPages].slice(0, 8),
    before,
    after: [],
    fixesAsked: fin.fixes.length > 0,
  };
  await ports.note("info", [designCheckHeadline(result), ...designCheckFixLines(result)].join("\n"));
  return { result, fixTurn: fin.fixes.length > 0 ? designFixTurn(fin.fixes, { measuredOnly: reviewError !== null }) : null };
}

/** The second half, after the author's one turn on the fixes: the screenshots after. Never reviews again. */
export async function designCheckAfter(ports: Pick<DesignCheckPorts, "capture" | "store" | "note">, result: DesignCheckResult): Promise<DesignCheckResult> {
  let captured: PageCaptureResult;
  try {
    captured = await ports.capture("after");
  } catch (err) {
    captured = { status: "unavailable", reason: String((err as Error).message ?? err).slice(0, 200), durationMs: 0 };
  }
  if (captured.status !== "captured" || captured.shots.length === 0) {
    await ports.note("warn", `The screenshots after the design fixes were not taken${captured.status === "unavailable" ? ` (${captured.reason})` : ""}; the approval shows the ones from before.`);
    return result;
  }
  const after = await ports.store(captured.shots);
  await ports.note("info", `Took ${after.length} screenshot${after.length === 1 ? "" : "s"} after the design fixes.`);
  return { ...result, after };
}
