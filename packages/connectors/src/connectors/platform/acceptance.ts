/**
 * Acceptance lines on a task that is not code (founder, Nov 16, 2026): `complete_task` carries one result per line,
 * met or not, and for a met line where it shows (a section of the saved report, or the tool call that did it). The
 * gateway refuses a malformed set; the orchestrator ends the session done only when a report was saved and every
 * line holds. No model grades anything: these are the agent's own claims, checked against what the session did.
 */
import { z } from "zod";

export const AcceptanceResult = z.object({
  line: z.number().int().min(1).max(30),
  met: z.boolean(),
  /** A heading of the report this session saved with save_report (its words, without the #), where the line is shown. */
  reportSection: z.string().trim().min(1).max(200).optional(),
  /** The outside tool call that did it, by tool name ("send_mail", or "platform_mail:send_mail"); never a platform tool. */
  tool: z.string().trim().min(1).max(100).optional(),
});
export type AcceptanceResultT = z.infer<typeof AcceptanceResult>;

/** The acceptance lines of a task that is not code: its sentences, in order (a code task's are checked by its tests). */
export function acceptanceLines(task: { kind: string; acceptance: unknown }): string[] {
  if (task.kind === "code" || !Array.isArray(task.acceptance)) return [];
  return task.acceptance.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The Markdown headings of a report (`## Price` → "price"), squashed: a cited section must be one of them, whole. */
const headings = (body: string): Set<string> =>
  new Set(body.split("\n").flatMap((l) => {
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
    return m ? [squash(m[1]!)] : [];
  }));

/**
 * Why `complete_task` is refused for these results, or null: one result per line, a met line says where, a cited
 * section is in the report this session saved, and a task with lines has such a report. `reportBody` is the body of
 * the report this session saved with save_report, or null when it saved none.
 */
export function acceptanceRefusal(lines: readonly string[], results: readonly AcceptanceResultT[] | undefined, reportBody: string | null): string | null {
  if (lines.length === 0) return null;
  const n = lines.length;
  if (reportBody === null) return `this task has ${n} acceptance line${n === 1 ? "" : "s"}: save your result with save_report first, then call complete_task with one acceptance result per line`;
  if (!results || results.length === 0) return `this task has ${n} acceptance line${n === 1 ? "" : "s"}: send acceptance with one result for each line, 1 to ${n} (met or not, and for a met line its reportSection or tool)`;
  const seen = new Set<number>();
  const sections = headings(reportBody);
  for (const r of results) {
    if (r.line > n) return `this task has ${n} acceptance line${n === 1 ? "" : "s"}; there is no line ${r.line}`;
    if (seen.has(r.line)) return `line ${r.line} has more than one result`;
    seen.add(r.line);
    if (r.met && !r.reportSection && !r.tool) return `line ${r.line} is marked met without saying where: give the reportSection of your report or the tool that did it`;
    if (r.reportSection && !sections.has(squash(r.reportSection.replace(/^#+\s*/, "")))) return `line ${r.line} cites the section "${r.reportSection}", which is not a heading of the report you saved`;
  }
  const missing = lines.map((_, i) => i + 1).filter((i) => !seen.has(i));
  if (missing.length > 0) return `no result for line${missing.length === 1 ? "" : "s"} ${missing.join(", ")}: send one result for each line`;
  return null;
}

/** How the session's calls of one tool went: `ran` went through and answered; `real` also was not simulated. */
export interface ToolUse {
  ran: number;
  real: number;
}

/**
 * A tool's name as an agent may write it ("mcp__web__fetch_page", "web:fetch_page", "fetch_page"), as the keys
 * `toolsUsed` holds: the bare name, lowercase, and with its connector when one was written.
 */
export function toolKeys(name: string): { bare: string; connector: string | null } {
  const n = name.trim().toLowerCase();
  const mcp = /^mcp__(.+?)__(.+)$/.exec(n);
  if (mcp) return { connector: mcp[1]!, bare: mcp[2]! };
  const pre = /^([a-z0-9_]+)[:.](.+)$/.exec(n);
  return pre ? { connector: pre[1]!, bare: pre[2]! } : { connector: null, bare: n };
}
/** The key a cited tool is looked up under: "<connector>:<tool>" when the citation names its connector, else the tool. */
export const toolUseKey = (name: string): string => {
  const k = toolKeys(name);
  return k.connector ? `${k.connector}:${k.bare}` : k.bare;
};

/**
 * The numbers (from 1) of the lines that do not hold: no result, marked not met, met on an outside tool this session
 * never ran (`used` holds outside tools only, so a platform tool never stands behind a line), or, on a real project
 * (`realOnly`), on a tool whose every call was simulated or not connected, or on a section of a simulated report
 * (WP-05 T2's rule, per line). A cited section was checked against the report's headings by the gateway.
 */
export function unmetAcceptanceLines(lines: readonly string[], results: readonly AcceptanceResultT[] | null, used: ReadonlyMap<string, ToolUse>, opts: { realOnly: boolean; reportSimulated: boolean }): number[] {
  return lines.map((_, i) => i + 1).filter((n) => {
    const r = results?.find((x) => x.line === n);
    if (!r || !r.met) return true;
    if (!r.tool) return !r.reportSection || (opts.realOnly && opts.reportSimulated);
    const u = used.get(toolUseKey(r.tool));
    return !u || (opts.realOnly ? u.real === 0 : u.ran === 0);
  });
}
