/**
 * Reports of a person, a profile or a message, and the platform's review queue (docs/NETWORK.md F21; migration 0129).
 * The lists here are the database's checks, in the same order (packages/db `rls/reports.test.ts` compares them).
 *
 * A report is private to the platform: the person reported never learns who sent it, and the reporter never reads it
 * back. Every kind names the person it is about, so the queue shows a pattern across reports of one person.
 */

/** What a report can be about. A post in a community keeps its own report (`live.posts.report`) and its moderators. */
export const REPORT_TARGET_KINDS = ["person", "profile", "message"] as const;
export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number];

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "scam",
  "asks_for_money",
  "impersonation",
  "personal_data",
  "underage",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The words a person picks from, in the order shown. */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or hate",
  scam: "A scam or fraud",
  asks_for_money: "Asking for money or a payment off the platform",
  impersonation: "Pretending to be someone else",
  personal_data: "Sharing someone's private details",
  underage: "May be under 18",
  other: "Something else",
};

export const REPORT_RESOLUTIONS = ["no_action", "warned", "removed"] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

export const REPORT_RESOLUTION_LABELS: Record<ReportResolution, string> = {
  no_action: "Reviewed, no action",
  warned: "Person warned",
  removed: "Content or access removed",
};

/** The platform's response target: every report is reviewed within this many hours of arriving. */
export const REPORT_RESPONSE_TARGET_HOURS = 48;

/** Reports one person may file in a day (shared store, every api replica). */
export const REPORTS_PER_PERSON_PER_DAY = 10;

/** Longest note a reporter can add. */
export const REPORT_NOTE_MAX = 1000;

/** When a report is due for review. */
export function reportDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REPORT_RESPONSE_TARGET_HOURS * 3_600_000);
}

/**
 * What the reporter is told, whatever happened to the report (an unknown target reads the same as a filed one).
 * `appName` is APP_NAME.
 */
export function reportSentWords(appName: string) {
  return {
    title: "Report sent",
    body: `${appName} reviews every report within ${REPORT_RESPONSE_TARGET_HOURS} hours. The person is not told who reported them.`,
    blocked: "You also blocked them: they cannot ask to connect or message you.",
  } as const;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `OPERATOR_USER_IDS` as a set of account ids; anything that is not an id is left out, and unset is nobody. */
export function parseOperatorIds(raw: string | undefined | null): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter((x) => UUID.test(x)),
  );
}
