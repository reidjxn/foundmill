/**
 * Task reports (0110 `task_reports`, WP-05 T3): the result of a task an agent finished, saved by the gateway's platform
 * tools (`save_report`, and `complete_task` when the session saved none). Service connection only; a member's own reads
 * go through RLS.
 *
 * - `save` writes one report of a task of this business (the table's trigger refuses another business's task).
 * - `latestForTask` is what the next agent reads and what the founder's note quotes.
 * - `listForBusiness` pages the business's reports, newest first.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { taskReports, type TaskReport } from "../schema";
import { Id, PageInput, maybeOne, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

export const TASK_REPORT_LIMITS = { title: 200, bodyMd: 60_000, sources: 50, sourceTitle: 300 } as const;

export const SaveTaskReportInput = z.object({
  taskId: Id,
  sessionId: Id.nullable().default(null),
  agentId: Id,
  title: z.string().trim().min(1).max(TASK_REPORT_LIMITS.title),
  bodyMd: z.string().trim().min(1).max(TASK_REPORT_LIMITS.bodyMd),
  sources: z
    .array(z.object({ url: z.url(), title: z.string().trim().min(1).max(TASK_REPORT_LIMITS.sourceTitle) }))
    .max(TASK_REPORT_LIMITS.sources)
    .default([]),
  simulated: z.boolean().default(false),
});
export type SaveTaskReportInput = z.input<typeof SaveTaskReportInput>;

export const taskReportsRepo = {
  async save(db: Executor, businessId: string, input: SaveTaskReportInput): Promise<TaskReport> {
    const v = parseInput(SaveTaskReportInput, input, "task report");
    const [row] = await db.insert(taskReports).values({ businessId, ...v }).returning();
    return row!;
  },

  /** The task's newest report, or null. */
  async latestForTask(db: Executor, businessId: string, taskId: string): Promise<TaskReport | null> {
    return maybeOne(
      await db
        .select()
        .from(taskReports)
        .where(and(eq(taskReports.businessId, businessId), eq(taskReports.taskId, taskId)))
        .orderBy(desc(taskReports.createdAt), desc(taskReports.id))
        .limit(1),
    );
  },

  /** The business's reports, newest first. */
  async listForBusiness(db: Executor, businessId: string, page: PageInput = {}): Promise<Page<TaskReport>> {
    const p = parseInput(PageInput, page, "page");
    const ks = timeKeyset<TaskReport>(taskReports.createdAt, taskReports.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(taskReports)
      .where(and(eq(taskReports.businessId, businessId), ks.after(p.cursor)))
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },
};
