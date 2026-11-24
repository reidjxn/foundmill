/**
 * A report over the word limit its task states is sent back once to be rewritten, never cut (the founder's 100% rule,
 * Nov 24, 2026): models cannot count their own words, and a report the founder reads should fit what the task asked.
 * The second save is kept whatever its length, so a task never stalls on it. Both platform hosts (the gateway's and the
 * mock) call this before they store a report.
 */
import { countWords, lengthRetryMessage, statedWordLimit } from "@foundmill/shared";

/** The audit action a refused save records, so one session's second save on the task is kept. */
export const AUDIT_ACTION_REPORT_TOO_LONG = "platform.report.too_long";

/** Why the report goes back, or null when it fits, the task states no limit, or this session was already sent back once. */
export function reportLengthRefusal(task: { title: string; goalMd: string }, bodyMd: string, refusedBefore: boolean): string | null {
  if (refusedBefore) return null;
  const limit = statedWordLimit(`${task.title}\n${task.goalMd}`);
  const words = countWords(bodyMd);
  if (limit === null || words <= limit) return null;
  return lengthRetryMessage(words, limit).replace("Reply with the rewritten deliverable only.", "Save the rewritten report with save_report; nothing was saved this time.");
}
