/**
 * The design check's record (item 13): what the visual check of a code agent's UI change found, as it is attached to
 * the work the founder approves (the `task.design_checked` event, and the "What exactly" rows of the change's approval).
 *
 * Four honest outcomes, never more:
 * - `reviewed`: a separate reviewer looked at real screenshots of the changed pages (desktop and 390 px) and listed fixes
 *   (possibly none). The author agent was asked once to apply them; `after` holds the screenshots taken after that.
 * - `measured`: the screenshots exist but the reviewer could not be reached; the fixes are only what the browser's
 *   measurements prove (contrast, overflow, sizes), and `reason` says so.
 * - `not_seen`: the sandbox could not show the pages (no browser in the image, the project did not start, every page
 *   failed). No screenshot exists and nothing was reviewed; `reason` says why.
 * - `simulated`: mock mode. The mock sandbox has no browser, so nothing was opened or reviewed; it is labeled simulated.
 * The check never blocks the founder: whatever its outcome, the work goes on to the tests and the approval as before.
 */
import { z } from "zod";
import { DESIGN_PRINCIPLES, DESIGN_SEVERITIES, DESIGN_VIEWPORT_KEYS, viewportLabel, type DesignViewport } from "./design-lint";

export const DESIGN_CHECK_STATUSES = ["reviewed", "measured", "not_seen", "simulated"] as const;
export const DesignCheckStatus = z.enum(DESIGN_CHECK_STATUSES);
export type DesignCheckStatus = (typeof DESIGN_CHECK_STATUSES)[number];

/** Fixes a record keeps (the reviewer may return more; the top ones are what the author is asked to apply). */
export const DESIGN_CHECK_MAX_FIXES = 5;

export const DesignCheckFix = z.object({
  rank: z.number().int().min(1).max(DESIGN_CHECK_MAX_FIXES),
  page: z.string().min(1).max(300),
  viewport: z.enum(["desktop", "phone", "both"]),
  element: z.string().min(1).max(200),
  problem: z.string().min(1).max(300),
  fix: z.string().min(1).max(300),
  principle: z.enum(DESIGN_PRINCIPLES),
  severity: z.enum(DESIGN_SEVERITIES),
});
export type DesignCheckFix = z.infer<typeof DesignCheckFix>;

/** A screenshot as the record keeps it: where it is stored (a content address in the business's own store), not the pixels. */
export const DesignShotRef = z.object({
  id: z.string().min(1).max(80),
  page: z.string().min(1).max(300),
  viewport: z.enum(DESIGN_VIEWPORT_KEYS),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(100000),
  /** The page was longer than the shot. */
  cut: z.boolean().default(false),
  /** sha256 of the PNG in the business's workspace store; null when it could not be stored. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});
export type DesignShotRef = z.infer<typeof DesignShotRef>;

export const DesignCheckResult = z.object({
  status: DesignCheckStatus,
  /** Why the pages were not seen, or the simulation notice; null when reviewed. */
  reason: z.string().max(400).nullable(),
  /** The changed pages the check opened (or would have). */
  pages: z.array(z.string().min(1).max(300)).max(8),
  fixes: z.array(DesignCheckFix).max(DESIGN_CHECK_MAX_FIXES),
  /** Shots the reviewer could not judge, and why. */
  unreadable: z.array(z.object({ page: z.string().max(300), viewport: z.enum(DESIGN_VIEWPORT_KEYS), why: z.string().max(200) })).max(8),
  before: z.array(DesignShotRef).max(8),
  after: z.array(DesignShotRef).max(8),
  /** Whether the author agent was asked to apply the fixes (once), and so whether `after` can exist. */
  fixesAsked: z.boolean(),
});
export type DesignCheckResult = z.infer<typeof DesignCheckResult>;
export type DesignCheckResultInput = z.input<typeof DesignCheckResult>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const where = (viewport: DesignViewport | "both") => (viewport === "both" ? "desktop and 390 px" : viewportLabel(viewport));

/** "2 pages at desktop and 390 px": what the check looked at. */
function scope(r: Pick<DesignCheckResult, "pages">): string {
  return `${plural(r.pages.length, "page")} at desktop and 390 px`;
}

/** One sentence for the founder: what the design check did, in plain words. Never says a page looks good. */
export function designCheckHeadline(input: DesignCheckResultInput): string {
  const r = DesignCheckResult.parse(input);
  if (r.status === "simulated") return "Design check simulated, not done: no page was opened in a browser, so there are no screenshots and nothing was reviewed.";
  if (r.status === "not_seen") return `Design check not done: the pages could not be shown in the sandbox${r.reason ? ` (${r.reason})` : ""}, so there are no screenshots and nothing was reviewed.`;
  if (r.status === "measured") return `Screenshots of ${scope(r)} were taken, but the reviewer could not be reached, so ${r.fixes.length ? `the ${plural(r.fixes.length, "fix", "fixes")} below come only from the browser's measurements${r.fixesAsked ? "; the agent was asked to apply them once" : ""}` : "only the browser's measurements were checked, and they found nothing to fix"}.`;
  if (r.fixes.length === 0) return `A reviewer looked at screenshots of ${scope(r)} and suggested no changes.`;
  return `A reviewer looked at screenshots of ${scope(r)} and suggested ${plural(r.fixes.length, "fix", "fixes")}${r.fixesAsked ? "; the agent was asked to apply them once" : ""}.`;
}

/** "1. /pricing at 390 px: the button “Buy” … Fix: …", one line per fix, most important first. */
export function designCheckFixLines(input: DesignCheckResultInput): string[] {
  const r = DesignCheckResult.parse(input);
  return r.fixes.map((f) => `${f.rank}. ${f.page} at ${where(f.viewport)}, ${f.element}: ${f.problem} Fix: ${f.fix}`);
}

/** The rows the change's approval shows under "What exactly". */
export function designCheckRows(input: DesignCheckResultInput): { label: string; value: string }[] {
  const r = DesignCheckResult.parse(input);
  const rows = [{ label: "Design check", value: designCheckHeadline(r) }];
  if (r.fixes.length) rows.push({ label: "Design fixes", value: designCheckFixLines(r).join("\n") });
  if (r.status === "reviewed" || r.status === "measured") {
    const before = r.before.filter((s) => s.sha256).length;
    const after = r.after.filter((s) => s.sha256).length;
    rows.push({ label: "Screenshots", value: `${plural(before, "screenshot")} before${r.fixesAsked ? `, ${plural(after, "screenshot")} after the fixes` : ""}, kept with the task's saved code.` });
  }
  return rows;
}
