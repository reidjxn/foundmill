/**
 * Filing a report (docs/NETWORK.md F21; routers/report.ts). The service connection, as for `attributions`: the table is
 * the service role's, and every rule is checked here before a row is written.
 */
import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORTS_PER_PERSON_PER_DAY,
} from "@foundmill/shared/reports";
import { repos } from "@foundmill/db";
import { z } from "zod";
import type { Context } from "../context";
import { takeOrThrow } from "./rate-limit";

const Id = z.guid();
const DAY = 24 * 3_600_000;

// A handle is matched as given (an unknown or malformed one reads the same as a filed report).

export const ReportTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), handle: z.string().trim().min(1).max(64) }),
  z.object({ kind: z.literal("person"), userId: Id }),
  z.object({ kind: z.literal("message"), messageId: Id }),
]);

export const ReportInput = z.object({
  target: ReportTarget,
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(REPORT_NOTE_MAX).optional(),
  /** Also block the person: they can no longer ask to connect or message the reporter. */
  block: z.boolean().default(false),
});

export type ReportCtx = Pick<Context, "db" | "limits" | "log"> & { userId: string };

/** The account a target is about, or null when the reporter may not name it (it reads the same as a filed report). */
async function personOf(
  ctx: ReportCtx,
  target: z.infer<typeof ReportTarget>,
): Promise<string | null> {
  if (target.kind === "profile") return repos.reports.profileOwner(ctx.db, target.handle);
  if (target.kind === "message")
    return repos.reports.messageAuthor(ctx.db, ctx.userId, target.messageId);
  const exists = await repos.social.existingUsers(ctx.db, [target.userId]);
  return exists.has(target.userId) ? target.userId : null;
}

export async function fileReport(
  ctx: ReportCtx,
  input: z.infer<typeof ReportInput>,
): Promise<{ reported: true; blocked: boolean }> {
  await takeOrThrow(ctx.limits, "Report", [
    { key: `report:${ctx.userId}`, rule: { limit: REPORTS_PER_PERSON_PER_DAY, windowMs: DAY } },
  ]);
  const about = await personOf(ctx, input.target);
  if (!about || about === ctx.userId) return { reported: true, blocked: false };
  const filed = await repos.reports.file(ctx.db, {
    reporterUserId: ctx.userId,
    targetKind: input.target.kind,
    targetUserId: about,
    targetMessageId: input.target.kind === "message" ? input.target.messageId : null,
    reason: input.reason,
    note: input.note ?? null,
  });
  // The operator's alert in the logs: the id and the kind only, never who or what was written.
  if (filed)
    ctx.log.warn(
      { reportId: filed.id, kind: filed.targetKind, reason: filed.reason },
      "report filed: review within the response target",
    );
  let blocked = false;
  if (input.block) {
    await repos.social.blockPerson(ctx.db, ctx.userId, about);
    blocked = true;
  }
  return { reported: true, blocked };
}
