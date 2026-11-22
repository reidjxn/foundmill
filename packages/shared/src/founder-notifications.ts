/**
 * Founder notifications (retention plan, founder 2026-11-11): what the platform may tell a founder outside the app.
 * Every notification is about something real that happened in their business; none is sent while they are in the app
 * (`isPresent`), and each kind can be turned off in Settings › Preferences › Email. The daily limits and the waits are
 * the platform email's (notify-email.ts: three a day per person, briefs aside; 30 minutes for a decision that holds up
 * work, a day for the rest).
 */
import { ACCOUNT_SAFETY_EMAIL_KINDS, EMAIL_NOTIFICATION_KINDS, type AccountSafetyEmailKind, type EmailNotificationKind } from "./constants";
import { founderActionIdOfDecision } from "./founder-action";

/**
 * The kinds are the platform's own (`EMAIL_NOTIFICATION_KINDS`, constants.ts): one list, one preference
 * (`account_preferences.notifications.email`), one sender (the gateway's `/v1/notify/email`), founder 2026-11-12.
 */
export const FOUNDER_NOTIFICATION_KINDS = [...EMAIL_NOTIFICATION_KINDS, ...ACCOUNT_SAFETY_EMAIL_KINDS] as const;
/** The record's kinds: the person's own kinds and the account-safety notices (security review P2-3), which hold no switch. */
export type FounderNotificationKind = EmailNotificationKind | AccountSafetyEmailKind;

export const FOUNDER_NOTIFICATION_CHANNELS = ["email", "browser"] as const;
export type FounderNotificationChannel = (typeof FOUNDER_NOTIFICATION_CHANNELS)[number];

export const FOUNDER_NOTIFICATION_STATUSES = ["queued", "sent", "skipped", "failed"] as const;
export type FounderNotificationStatus = (typeof FOUNDER_NOTIFICATION_STATUSES)[number];

export const FOUNDER_NOTIFICATION_LIMITS = {
  /** A win, a milestone or a finished run is only sent if it happened within this long (a first deploy never mails the past). */
  lookbackMs: 24 * 60 * 60_000,
  /** The default hour for the morning brief, in the founder's time zone. */
  defaultBriefHour: 8,
  /** A one-click answer link works for this long, once. */
  actionTtlMs: 48 * 60 * 60_000,
} as const;

/** The query string a notification link carries, so the session it starts is counted as a return from it. */
export function notificationLinkParams(notificationId: string, via: "email" | "browser_notification" = "email"): string {
  return `via=${via}&n=${notificationId}`;
}

/**
 * Option ids of an agent's gated call (packages/db APPROVAL_OPTIONS): those notes are answered through the approval
 * itself and are never offered as a one-click answer.
 */
export const APPROVAL_OPTION_IDS: readonly string[] = ["approve_request", "reject_request"];

/**
 * Plan actions a one-click answer may run (security review, 2026-11-11): internal steps that spend nothing, contact
 * nobody and hire nobody. Anything else (a budget, a spend, a message or meeting with someone outside, a channel turned
 * on, an agent hired, trained or moved to another model, a hard gate) is answered in the app.
 */
export const ONE_CLICK_ACTION_TYPES: readonly string[] = ["create_task", "update_spec", "update_roadmap", "create_playbook", "disable_channel", "reply_only"];

export interface OneClickOption {
  id: string;
  label: string;
  consequence: string;
}

/**
 * The option an email may answer in one click (founder, 2026-11-11: "one-click answers for recommended, reversible,
 * in-policy options; hard gates never"): a plain decision's single recommended option, marked reversible, that costs
 * nothing. Never an agent's gated call, a sign-off (the founder reads the specification or roadmap first), a note
 * already answered, or a decision with no recommendation. Policy is checked again when the answer is given: a plan the
 * policy wants confirmed is only staged, never run, from an email.
 */
export function oneClickOption(item: { type: string; state: string; decision: Record<string, unknown> | null }, opts: { isSignoff: boolean }): OneClickOption | null {
  if (item.type !== "decision" || opts.isSignoff || (item.state !== "unread" && item.state !== "read") || !item.decision) return null;
  // A founder-executed request is pressed in a signed-in session, never from an email (founder, 2026-11-22).
  if (founderActionIdOfDecision(item.decision)) return null;
  const options = Array.isArray(item.decision.options) ? (item.decision.options as Record<string, unknown>[]) : [];
  if (options.some((o) => typeof o.id === "string" && APPROVAL_OPTION_IDS.includes(o.id))) return null;
  const recommended = options.filter((o) => o.recommended === true);
  if (recommended.length !== 1) return null;
  const o = recommended[0]!;
  const cost = typeof o.cost_minor === "number" ? o.cost_minor : 0;
  if (o.reversible !== true || cost !== 0 || typeof o.id !== "string" || typeof o.label !== "string") return null;
  // An option that names its own actions may only name internal, free ones; the api compiles and checks the plan again.
  if (Array.isArray(o.actions) && !(o.actions as { type?: unknown }[]).every((a) => typeof a?.type === "string" && ONE_CLICK_ACTION_TYPES.includes(a.type))) return null;
  return { id: o.id, label: o.label, consequence: typeof o.consequence === "string" ? o.consequence : "" };
}
