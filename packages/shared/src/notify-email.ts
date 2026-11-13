/**
 * Foundmill's own email to its users (docs/THESIS_REVIEW.md packages 1.5 and 5.1): the product reaching a person outside
 * the app. Sent by the gateway from `<PLATFORM_NOTIFY_LOCAL_PART>@<PLATFORM_MAIL_DOMAIN>` under the name APP_NAME, never
 * by an agent. Plain data and words, no Zod and no crypto, so the browser reads the same sentences and rules.
 *
 * `decision_waiting`: a note that needs the person's answer and that they have not opened on any device. Founder,
 * 2026-11-12: when it holds up the team's work (it holds Continue, or an agent's call or a task waits on it) the email goes
 * 30 minutes after they left (`NOTIFY_HOLDING_WAIT_MS`); every other waiting note waits 24 hours (`NOTIFY_WAIT_MS`). The
 * api's notify pass picks it, the gateway checks again, builds the words below and sends. The retention plan's other
 * kinds (wins, milestones, a finished run, used-up credits, the morning brief and the weekly review) go through the same
 * gateway route, picked by the orchestrator's notifier; their words are in `notify-words.ts`.
 */
import type { EmailNotificationKind } from "./constants";

/** A note has to wait this long, unopened by the person, before they are emailed about it. */
export const NOTIFY_WAIT_MS = 24 * 60 * 60 * 1000;
/** A note that holds up the team's work is emailed this long after the person was last in the app (founder, 2026-11-12). */
export const NOTIFY_HOLDING_WAIT_MS = 30 * 60 * 1000;
/** Notes older than this are not looked at any more (one email about each was the chance). */
export const NOTIFY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long the gateway remembers that a person was emailed about a note (longer than the lookback, so it outlives it). */
export const NOTIFY_ITEM_MARKER_MS = 8 * 24 * 60 * 60 * 1000;
/** Foundmill's own email waits while the projects' mail has used more than this share of its daily ceiling. */
export const NOTIFY_PROJECT_MAIL_HEADROOM = 0.75;
/** At most this many emails a person gets about one project in a UTC day. */
export const NOTIFY_PER_PROJECT_PER_DAY = 1;
/**
 * At most this many emails a person gets in a UTC day, across every kind and every project (founder, 2026-11-12); the
 * morning brief and the weekly review do not count toward it (`LIMITED_EMAIL_KINDS`).
 */
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
  /** The signed link that pauses every email (retention plan); absent: not offered. */
  pauseLink?: string;
  /** A one-click answer (retention plan; founder 2026-11-11): the recommended, reversible, free option; absent: none. */
  answer?: { label: string; consequence: string; link: string } | null;
}

export interface NotifyEmailText {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const href = (url: string): string => escapeHtml(url);

/** The footer of every email Foundmill sends a person: why they get it, and the way out. */
export const notifyEmailFooter = (projectName: string, appName: string, offLink: string): string => `You get this because you are part of ${oneLine(withoutLinks(projectName), 120)} on ${appName}. Turn these emails off: ${offLink}`;

/** The line under the link: a reply goes nowhere, so nobody waits on one. */
export const NOTIFY_NO_REPLY_LINE = "Replies to this email don't reach the team, so answer in the app.";

/** The opening sentence, before the note's subject. */
export function decisionWaitingLead(f: Pick<DecisionWaitingFacts, "projectName" | "agentName" | "holdsContinue" | "waitedMs">): string {
  const waited = waitedWords(f.waitedMs);
  if (f.holdsContinue) return `The team stopped ${waited} ago and is waiting on you:`;
  if (f.agentName) return `${oneLine(withoutLinks(f.agentName), 120)} asked you something ${waited} ago and the team is waiting on it:`;
  return `Something in ${oneLine(withoutLinks(f.projectName), 120)} has waited ${waited} for your answer:`;
}

// Any scheme followed by one or two slashes ("https://", "hxxp://", "ftp://"), glued to a word before it or not
// ("xhttps://evil.com" is cut whole).
const SCHEME_URL_RE = /[a-z][a-z0-9+.-]*:\/\/?\S+/gi;
// The schemes a mail client opens without slashes.
const SLASHLESS_SCHEME_RE = /[a-z0-9+.-]*(?:mailto|tel|sms|callto|facetime|skype|whatsapp|xmpp|sip|javascript|data|vbscript):\S+/gi;
const ADDRESS_RE = /\S+@\S+\.\S+/g;
// A word, then one or more ".label"s, then perhaps a port, a path, a query or a fragment.
const DOMAIN_RE = /[\p{L}\p{N}][\p{L}\p{N}-]*(?:\.[\p{L}\p{N}-]+)+(?:[:/?#]\S*)?/gu;
// A last label that can be a top-level domain: two letters or more ("com", "co", "рф"), or punycode ("xn--p1ai").
const TLD_RE = /^(?:\p{L}{2,}|xn--[a-z0-9-]+)$/iu;
// Prose that has the shape of a domain and is not one. Most already fail the last-label test ("e.g", "U.S", "3.5").
const ABBREVIATIONS = new Set(["e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "u.s.a", "ph.d", "m.d", "b.a", "m.a", "b.sc", "m.sc", "a.k.a", "r.s.v.p", "n.b", "p.s", "q.v", "et.al"]);

const looksLikeDomain = (match: string): boolean => {
  const host = match.split(/[:/?#]/, 1)[0]!.replace(/\.+$/, "");
  if (ABBREVIATIONS.has(host.toLowerCase())) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((l) => l.length > 0) && TLD_RE.test(labels[labels.length - 1]!);
};

/**
 * A note's subject, a project's name and an agent's name are written by people and agents, and agents read untrusted
 * content, while this email comes from Foundmill's own address: anything that reads as a link, a domain or an address
 * in them is cut, so the email's one link is the one into the app (security review, Nov 11, 2026). The text is NFKC
 * normalized first (fullwidth letters and dots become plain ones) and the ideographic full stops read as dots, then
 * every URL with a scheme (any scheme with slashes, glued to a word or not; mailto:, tel: and the other slashless ones)
 * reads "(link)", every email address "(address)", and every bare domain, with or without a path, punycode included,
 * "(link)". Prose stays: "e.g.", "U.S.", "3.5", "£2,300".
 */
export const withoutLinks = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[．。｡]/g, ".")
    .replace(SCHEME_URL_RE, "(link)")
    .replace(SLASHLESS_SCHEME_RE, "(link)")
    .replace(ADDRESS_RE, "(address)")
    .replace(DOMAIN_RE, (match) => (looksLikeDomain(match) ? "(link)" : match));

/** "‹project› needs your answer", and the body in plain text and simple HTML. */
export function decisionWaitingEmail(f: DecisionWaitingFacts): NotifyEmailText {
  const project = oneLine(withoutLinks(f.projectName), 120);
  const hi = f.personName ? `Hi ${oneLine(withoutLinks(f.personName), 60)},` : "Hi,";
  const lead = decisionWaitingLead({ ...f, projectName: project, agentName: f.agentName ? withoutLinks(f.agentName) : null });
  const quoted = `“${oneLine(withoutLinks(f.noteSubject), 200)}”`;
  const footer = notifyEmailFooter(project, f.appName, f.offLink);
  const answer = f.answer ? { label: oneLine(withoutLinks(f.answer.label), 80), consequence: oneLine(withoutLinks(f.answer.consequence), 300), link: f.answer.link } : null;
  const answerText = answer ? `\n\nAnswer “${answer.label}”: ${answer.link}\nThis is the recommended answer and can be changed later${answer.consequence ? `: ${answer.consequence}` : "."}` : "";
  const pauseText = f.pauseLink ? `\nPause every email: ${f.pauseLink}` : "";
  const text = `${hi}\n\n${lead}\n${quoted}\n\nOpen it: ${f.link}${answerText}\n\n${NOTIFY_NO_REPLY_LINE}\n\n--\n${footer}${pauseText}`;
  const html = [
    `<p>${escapeHtml(hi)}</p>`,
    `<p>${escapeHtml(lead)}<br>${escapeHtml(quoted)}</p>`,
    `<p><a href="${href(f.link)}">Open it</a></p>`,
    ...(answer ? [`<p><a href="${href(answer.link)}">Answer “${escapeHtml(answer.label)}”</a><br>${escapeHtml(`This is the recommended answer and can be changed later${answer.consequence ? `: ${answer.consequence}` : "."}`)}</p>`] : []),
    `<p>${escapeHtml(NOTIFY_NO_REPLY_LINE)}</p>`,
    `<hr><p>You get this because you are part of ${escapeHtml(project)} on ${escapeHtml(f.appName)}. <a href="${href(f.offLink)}">Turn these emails off</a>${f.pauseLink ? ` · <a href="${href(f.pauseLink)}">Pause every email</a>` : ""}</p>`,
  ].join("");
  return { subject: `${project} needs your answer`, text, html };
}

/** Settings › Preferences › Email: the switch per kind, its help line and the toast after a change. */
export const EMAIL_NOTIFICATION_LABELS: Readonly<Record<EmailNotificationKind, string>> = Object.freeze({
  decision_waiting: "Something waits for my answer",
  win: "A customer was won",
  milestone: "A milestone was reached",
  run_finished: "My team finished a run I started",
  credits: "Credits ran out",
  daily_brief: "Morning brief",
  weekly_review: "Weekly review",
  invitation_accepted: "Someone accepted my invitation",
});
/** One line under each switch. */
export const EMAIL_NOTIFICATION_HINTS: Readonly<Record<EmailNotificationKind, string>> = Object.freeze({
  decision_waiting: "30 minutes after you leave when it holds up the team's work; otherwise after a day.",
  win: "The moment a customer pays, with who was involved.",
  milestone: "Your first customer, your first revenue milestones and the like.",
  run_finished: "When a run of work you started finishes after you left.",
  credits: "When the team stops because the credits are used up.",
  daily_brief: "What the team did since yesterday and the one thing that needs you, at your hour.",
  weekly_review: "Monday morning, instead of the brief: the week in numbers and what comes next.",
  invitation_accepted: "When a person you invited joins your project.",
});
export const EMAIL_NOTIFICATIONS_HINT = "To the address you sign in with, never while you are in the app: at most three a day in all and one a day for each project. The morning brief and the weekly review don't count.";
export function emailNotificationSavedLine(kind: EmailNotificationKind, on: boolean): { title: string; description: string } {
  const what = `“${EMAIL_NOTIFICATION_LABELS[kind]}”`;
  return on ? { title: "Email on", description: `You get the ${what} emails.` } : { title: "Email off", description: `No more ${what} emails. Turn them on again any time from here.` };
}
/** The off page's question, naming the kind the link turns off. */
export function notifyOffBody(kind: EmailNotificationKind): string {
  return `Stop getting the “${EMAIL_NOTIFICATION_LABELS[kind]}” emails?`;
}

/** The page the link in the footer opens (served by ingest at `/mail/notify/off`): a button on GET, the change on POST. */
export const NOTIFY_OFF_PAGE = {
  title: "Turn off these emails",
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
  too_old: "The note is older than a week, and one email about it was the chance, so nothing was sent.",
  already_sent: "This person was already emailed about this note, so nothing was sent.",
  not_member: "This person can't see the note, so nothing was sent.",
  turned_off: "This person turned these emails off, so nothing was sent.",
  no_address: "This person has no address to email, so nothing was sent.",
  per_project: "This person already got an email about this project today, so nothing was sent.",
  per_person: "This person already got today's emails, so nothing was sent.",
  ceiling: "Today's limit for these emails has been reached, so nothing was sent.",
  busy: "Projects' own email is close to today's limit and keeps the room, so nothing was sent.",
  store: "Sending is paused for a moment, so nothing was sent. Try again later.",
  vendor: "The email service did not take the message, so nothing was sent.",
  paused: "This person paused every email, so nothing was sent.",
  present: "This person is in the app right now and sees it there, so nothing was sent.",
  nothing_new: "Nothing happened and nothing waits, so the brief had no news and was not sent.",
  not_started: "This project has not started yet, so nothing was sent.",
  not_pending: "What this email was about has changed, so nothing was sent.",
  per_address: "This address already got today's emails, so nothing was sent.",
} as const;
export type NotifyEmailNotSent = keyof typeof NOTIFY_EMAIL_REFUSALS;
