/**
 * reports (0112) — a person's report of a person, a profile or a message, and the platform's review queue
 * (docs/NETWORK.md F21). Service connection only, every function: the table is the service role's.
 *
 * The api resolves what a report names before it files one (`profileOwner`, `messageAuthor`), so a report always holds
 * the person it is about and never an id the reporter could not see: a message only from a thread they are or were in,
 * a profile only while it is public.
 */
import {
  REPORT_REASONS,
  REPORT_RESOLUTIONS,
  REPORT_RESPONSE_TARGET_HOURS,
  REPORT_TARGET_KINDS,
  reportDueAt,
  type ReportResolution,
} from "@foundmill/shared/reports";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { founderProfiles, messages, messageThreads, reports, type Report } from "../schema";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";

const FileInput = z.object({
  reporterUserId: Id,
  targetKind: z.enum(REPORT_TARGET_KINDS),
  targetUserId: Id,
  targetMessageId: Id.nullable().default(null),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(1000).nullable().default(null),
});
export type FileReportInput = z.input<typeof FileInput>;

/** One open report as the operator's queue shows it. */
export interface OpenReport {
  id: string;
  createdAt: Date;
  dueAt: Date;
  targetKind: Report["targetKind"];
  reason: Report["reason"];
  note: string | null;
  reporterUserId: string;
  reporterName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  targetHandle: string | null;
  /** The reported message as it reads now (null once deleted, or for another kind). */
  messageBody: string | null;
  /** Open reports about the same person, this one included: a pattern the operator should see. */
  openAboutPerson: number;
}

export const reportsRepo = {
  /**
   * Files a report. Null when the reporter already has an open report of the same thing (the partial unique index), or
   * when the report would be about themselves.
   */
  async file(db: Executor, input: FileReportInput): Promise<Report | null> {
    const v = parseInput(FileInput, input, "report");
    if (v.targetUserId === v.reporterUserId) return null;
    const rows = await db
      .insert(reports)
      .values({
        reporterUserId: v.reporterUserId,
        targetKind: v.targetKind,
        targetUserId: v.targetUserId,
        targetMessageId: v.targetKind === "message" ? v.targetMessageId : null,
        reason: v.reason,
        note: v.note || null,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  },

  /** The account behind a public profile at /u/<handle>; null for an unknown handle and for a profile that is not public. */
  async profileOwner(db: Executor, handle: string): Promise<string | null> {
    const row = maybeOne(
      await db
        .select({ userId: founderProfiles.userId })
        .from(founderProfiles)
        .where(
          and(
            eq(founderProfiles.handle, handle.trim().toLowerCase()),
            eq(founderProfiles.public, true),
          ),
        )
        .limit(1),
    );
    return row?.userId ?? null;
  },

  /** Who wrote a message, when the reader is or was in its thread; null otherwise (and for their own message). */
  async messageAuthor(db: Executor, readerId: string, messageId: string): Promise<string | null> {
    const row = maybeOne(
      await db
        .select({ fromUser: messages.fromUser })
        .from(messages)
        .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
        .where(
          and(
            eq(messages.id, messageId),
            or(
              sql`${readerId}::uuid = any(${messageThreads.participantIds})`,
              sql`${readerId}::uuid = any(${messageThreads.leftIds})`,
            ),
          ),
        )
        .limit(1),
    );
    if (!row || row.fromUser === readerId) return null;
    return row.fromUser;
  },

  /** Open reports, oldest first, with the names an operator needs. */
  async listOpen(db: Executor, opts: { limit?: number } = {}): Promise<OpenReport[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const open = await db
      .select()
      .from(reports)
      .where(isNull(reports.resolvedAt))
      .orderBy(asc(reports.createdAt), asc(reports.id))
      .limit(limit);
    if (open.length === 0) return [];
    const people = [
      ...new Set(
        open
          .flatMap((r) => [r.reporterUserId, r.targetUserId])
          .filter((x): x is string => x !== null),
      ),
    ];
    const messageIds = open.map((r) => r.targetMessageId).filter((x): x is string => x !== null);
    const targets = [
      ...new Set(open.map((r) => r.targetUserId).filter((x): x is string => x !== null)),
    ];
    const [profiles, bodies, counts] = await Promise.all([
      db
        .select({
          userId: founderProfiles.userId,
          name: founderProfiles.displayName,
          handle: founderProfiles.handle,
        })
        .from(founderProfiles)
        .where(inArray(founderProfiles.userId, people)),
      messageIds.length
        ? db
            .select({ id: messages.id, body: messages.body })
            .from(messages)
            .where(inArray(messages.id, messageIds))
        : Promise.resolve([]),
      targets.length
        ? db
            .select({ userId: reports.targetUserId, n: sql<number>`count(*)::int` })
            .from(reports)
            .where(and(isNull(reports.resolvedAt), inArray(reports.targetUserId, targets)))
            .groupBy(reports.targetUserId)
        : Promise.resolve([]),
    ]);
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const body = new Map(bodies.map((b) => [b.id, b.body]));
    const count = new Map(counts.map((c) => [c.userId, c.n]));
    return open.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      dueAt: reportDueAt(r.createdAt),
      targetKind: r.targetKind,
      reason: r.reason,
      note: r.note,
      reporterUserId: r.reporterUserId,
      reporterName: byUser.get(r.reporterUserId)?.name ?? null,
      targetUserId: r.targetUserId,
      targetName: r.targetUserId ? (byUser.get(r.targetUserId)?.name ?? null) : null,
      targetHandle: r.targetUserId ? (byUser.get(r.targetUserId)?.handle ?? null) : null,
      messageBody: r.targetMessageId ? (body.get(r.targetMessageId) ?? null) : null,
      openAboutPerson: r.targetUserId ? (count.get(r.targetUserId) ?? 1) : 1,
    }));
  },

  /** Resolves one open report. Null when it does not exist or was resolved already. */
  async resolve(
    db: Executor,
    reportId: string,
    operatorId: string,
    resolution: ReportResolution,
  ): Promise<Report | null> {
    const v = parseInput(
      z.object({ reportId: Id, operatorId: Id, resolution: z.enum(REPORT_RESOLUTIONS) }),
      { reportId, operatorId, resolution },
      "report resolution",
    );
    const rows = await db
      .update(reports)
      .set({ resolvedAt: new Date(), resolvedBy: v.operatorId, resolution: v.resolution })
      .where(and(eq(reports.id, v.reportId), isNull(reports.resolvedAt)))
      .returning();
    return rows[0] ?? null;
  },

  /** How many reports wait, and how many of them are past the response target. */
  async counts(db: Executor, now: Date = new Date()): Promise<{ open: number; overdue: number }> {
    const dueBefore = new Date(now.getTime() - REPORT_RESPONSE_TARGET_HOURS * 3_600_000);
    const row = maybeOne(
      await db
        .select({
          open: sql<number>`count(*)::int`,
          overdue: sql<number>`(count(*) filter (where ${lt(reports.createdAt, dueBefore)}))::int`,
        })
        .from(reports)
        .where(isNull(reports.resolvedAt)),
    );
    return { open: row?.open ?? 0, overdue: row?.overdue ?? 0 };
  },
};
