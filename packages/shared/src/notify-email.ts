/**
 * Foundmill's own email to its users (docs/THESIS_REVIEW.md packages 1.5 and 5.1): the product reaching a person outside
 * the app. Sent by the gateway from `<PLATFORM_NOTIFY_LOCAL_PART>@<PLATFORM_MAIL_DOMAIN>` under the name APP_NAME, never
 * by an agent. Plain data and words, no Zod and no crypto, so the browser reads the same sentences and rules.
 *
 * The one kind so far is `decision_waiting`: a note that needs the person's answer (it holds Continue, or asks for a
 * decision) has been open 24 hours and they have not opened it on any device. The api's notify pass picks it
 * (apps/api `services/notify`), the gateway checks again, builds the words below and sends.
 */
import type { EmailNotificationKind } from "./constants";

/** A note has to wait this long, unopened by the person, before they are emailed about it. */
export const NOTIFY_WAIT_MS = 24 * 60 * 60 * 1000;
/** Notes older than this are not looked at any more (one email about each was the chance). */
export const NOTIFY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many emails a person gets about one project in a UTC day. */
export const NOTIFY_PER_PROJECT_PER_DAY = 1;
/** At most this many emails a person gets in a UTC day, across every project. */
export const NOTIFY_PER_PERSON_PER_DAY = 3;

const oneLine = (value: string, max: number): string => {
  const v = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
};

/** "26 hours", "2 days": how long the note has waited (never under 24 hours here). */
export function waitedWords(waitedMs: number): string {
  const hours = Math.max(1, Math.floor(waitedMs / 3_600_000));
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

/** What the words need; every value is the gateway's own read of the database, never the caller's text. */
export interface DecisionWaitingFacts {
  /** The person's own name (their profile), or null. */
  personName: string | null;
  /** The project's name. */
  projectName: string;
  /** The agent who asked, as the person names agents (Settings › Preferences), or null for a note from the platform. */
  agentName: string | null;
  /** The note holds Continue (a hard stop): the team has stopped until it is answered. */
  holdsContinue: boolean;
  /** The note's subject, entity mentions reduced to their names. */
  noteSubject: string;
  waitedMs: number;
  /** `APP_URL/b/<business id>/inbox/<item id>`. */
  link: string;
  /** The signed link that turns this kind of email off for the person. */
  offLink: string;
  appName: string;
}

export interface NotifyEmailText {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const href = (url: string): string => escapeHtml(url);

/** The footer of every email Foundmill sends a person: why they get it, and the way out. */
export const notifyEmailFooter = (projectName: string, appName: string, offLink: string): string => `You get this because you are part of ${oneLine(projectName, 120)} on ${appName}. Turn these emails off: ${offLink}`;

/** The line under the link: a reply goes nowhere, so nobody waits on one. */
export const NOTIFY_NO_REPLY_LINE = "Replies to this email don't reach the team, so answer in the app.";

/** The opening sentence, before the note's subject. */
export function decisionWaitingLead(f: Pick<DecisionWaitingFacts, "projectName" | "agentName" | "holdsContinue" | "waitedMs">): string {
  const waited = waitedWords(f.waitedMs);
  if (f.holdsContinue) return `The team stopped ${waited} ago and is waiting on you:`;
  if (f.agentName) return `${oneLine(f.agentName, 120)} asked you something ${waited} ago and the team is waiting on it:`;
  return `Something in ${oneLine(f.projectName, 120)} has waited ${waited} for your answer:`;
}

/**
 * A note's subject is written by the team, which reads untrusted content, and this email comes from Foundmill's own
 * address: anything that reads as a link or an address in it is cut, so the email's one link is the one into the app.
 */
export const withoutLinks = (value: string): string => value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "(link)").replace(/\S+@\S+\.\S+/g, "(address)");

/** "‹project› needs your answer", and the body in plain text and simple HTML. */
export function decisionWaitingEmail(f: DecisionWaitingFacts): NotifyEmailText {
  const project = oneLine(withoutLinks(f.projectName), 120);
  const hi = f.personName ? `Hi ${oneLine(withoutLinks(f.personName), 60)},` : "Hi,";
  const lead = decisionWaitingLead({ ...f, projectName: project, agentName: f.agentName ? withoutLinks(f.agentName) : null });
  const quoted = `“${oneLine(withoutLinks(f.noteSubject), 200)}”`;
  const footer = notifyEmailFooter(project, f.appName, f.offLink);
  const text = `${hi}\n\n${lead}\n${quoted}\n\nOpen it: ${f.link}\n\n${NOTIFY_NO_REPLY_LINE}\n\n--\n${footer}`;
  const html = [
    `<p>${escapeHtml(hi)}</p>`,
    `<p>${escapeHtml(lead)}<br>${escapeHtml(quoted)}</p>`,
    `<p><a href="${href(f.link)}">Open it</a></p>`,
    `<p>${escapeHtml(NOTIFY_NO_REPLY_LINE)}</p>`,
    `<hr><p>You get this because you are part of ${escapeHtml(project)} on ${escapeHtml(f.appName)}. <a href="${href(f.offLink)}">Turn these emails off</a></p>`,
  ].join("");
  return { subject: `${project} needs your answer`, text, html };
}

/** Settings › Preferences › Email: the switch per kind, its help line and the toast after a change. */
export const EMAIL_NOTIFICATION_LABELS: Readonly<Record<EmailNotificationKind, string>> = Object.freeze({ decision_waiting: "Email me when something has waited a day for my answer" });
export const EMAIL_NOTIFICATIONS_HINT = "To the address you sign in with: at most one email a day for each project, and three a day in all.";
export function emailNotificationSavedLine(on: boolean): { title: string; description: string } {
  return on
    ? { title: "Email on", description: "You get an email when something has waited a day for your answer." }
    : { title: "Email off", description: "No more emails about answers that wait. Turn it on again any time from here." };
}

/** The page the link in the footer opens (served by ingest at `/mail/notify/off`): a button on GET, the change on POST. */
export const NOTIFY_OFF_PAGE = {
  title: "Turn off these emails",
  body: "Stop getting an email when something has waited a day for your answer?",
  button: "Turn off",
  done: "Done. You won't get these emails anymore. You can turn them on again in Settings › Preferences.",
  invalid: "This link is not valid, so nothing changed. You can turn these emails off in Settings › Preferences.",
} as const;

/** Why the gateway did not send (the api logs the code; nobody else reads these). */
export const NOTIFY_EMAIL_REFUSALS = {
  off: "Email to people about their projects is not switched on here, so nothing was sent.",
  unconfigured: "Email to people about their projects is not set up completely here, so nothing was sent.",
  simulated: "Sending is only simulated here, and simulated email is not allowed for this project, so nothing was sent.",
  sample: "This is a sample project, and no one is emailed about one, so nothing was sent.",
  not_waiting: "The note no longer waits for this person's answer, so nothing was sent.",
  not_member: "This person can't see the note, so nothing was sent.",
  turned_off: "This person turned these emails off, so nothing was sent.",
  no_address: "This person has no address to email, so nothing was sent.",
  per_project: "This person already got an email about this project today, so nothing was sent.",
  per_person: "This person already got today's emails, so nothing was sent.",
  ceiling: "Every project together has reached today's sending limit, so nothing was sent.",
  store: "Sending is paused for a moment, so nothing was sent. Try again later.",
  vendor: "The email service did not take the message, so nothing was sent.",
} as const;
export type NotifyEmailNotSent = keyof typeof NOTIFY_EMAIL_REFUSALS;
