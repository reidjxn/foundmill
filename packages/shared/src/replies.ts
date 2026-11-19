/**
 * Replies to a project's Foundmill address, kept and answered (WP-08 T2; audit a5 GTM-04; founder D3, Nov 16, 2026).
 *
 * Ingest keeps a verified reply's own words (`replyOwnText`: quoted text and the footer left out) as plain text on an
 * `interactions` row, at most `REPLY_BODY_MAX` characters, and at most `INBOUND_STORED_DAILY_CAP` replies a project in a
 * UTC day (a public address draws spam; past the cap the `lead.replied` event is still written and nothing is kept).
 * Members with access to Customers read them in the contact's profile and answer from there; the answer goes out from
 * the project's address as a reply (transactional) only while this person wrote to the project in the last 30 days.
 */
import { PROJECT_MAIL_RELATIONSHIP_MS } from "./platform-mail";

/** The most of a reply's text that is kept (founder D3). */
export const REPLY_BODY_MAX = 20_000;
/** Replies kept per project per UTC day (Estimate; counted from `interactions` rows, so no Redis). */
export const INBOUND_STORED_DAILY_CAP = 200;
/** The longest answer a founder can write. */
export const REPLY_ANSWER_MAX = 5_000;
/** How a sender with no record in the CRM is named: the address masked, never the whole address. */
export const REPLY_CONTACT_LABEL = "Contact";
/** The CRM `source` of a record created for a sender. */
export const REPLY_SOURCE = "reply";
/** Days a person's reply keeps an answer transactional (`PROJECT_MAIL_RELATIONSHIP_MS`). */
export const REPLY_ANSWER_WINDOW_DAYS = Math.round(PROJECT_MAIL_RELATIONSHIP_MS / 86_400_000);

/** The subject an answer goes out with: "Re: " once, before the original subject. */
export function answerSubject(original: string): string {
  const s = original.replace(/[\r\n]+/g, " ").trim();
  if (!s) return "Re: your message";
  const subject = /^re:/i.test(s) ? s : `Re: ${s}`;
  return subject.length <= 200 ? subject : `${subject.slice(0, 199)}…`;
}

/** Why an answer did not go out, as the gateway says it. */
export const REPLY_NOT_SENT = ["off", "unconfigured", "simulated", "not_found", "not_recent", "suppressed", "paused", "own_sender", "content", "daily_cap", "ceiling", "store", "vendor", "duplicate"] as const;
export type ReplyNotSent = (typeof REPLY_NOT_SENT)[number];

/** Every word the screen and the note show. US English, plain. */
export const REPLY_WORDS = {
  noteSubject: (name: string) => `${name} replied`,
  noteBody: "Their message is on their profile in Customers, where you can read it and answer.",
  threadTitle: "Email",
  empty: "Nothing yet. Replies to the project's email show up here.",
  answerLabel: "Your answer",
  answerButton: "Send answer",
  answered: "Answered",
  /** Who an answer is shown from: any of the founders may have written it. */
  answerFrom: "Your project",
  sent: "Answer sent.",
  simulated: "Simulated: email is not switched on here, so nothing was sent.",
  plainNote: "Shown exactly as they wrote it. Links are not clickable.",
  notSent: {
    off: "Email from the project is not switched on yet, so nothing was sent.",
    unconfigured: "Email from the project is not set up yet, so nothing was sent.",
    simulated: "Email is not switched on here, so nothing was sent.",
    not_found: "That message is no longer here.",
    not_recent: `This person has not written to the project in the last ${REPLY_ANSWER_WINDOW_DAYS} days, so this would not be a reply. Nothing was sent.`,
    suppressed: "This person asked not to get email from the project, so nothing was sent.",
    paused: "Email from the project's address is paused, so nothing was sent.",
    own_sender: "The project sends email from your own connected account, so answer from there. Nothing was sent.",
    content: "The answer could not be sent as written. Keep it to plain text.",
    daily_cap: "The project has sent all the email it can today. Try again tomorrow.",
    ceiling: "Email from every project together has reached today's limit. Try again tomorrow.",
    store: "Email is not available for a moment. Try again in a few minutes.",
    vendor: "The email service did not take the message. Try again in a few minutes.",
    duplicate: "This answer already went out, or may have. Check the thread before you send it again.",
  } satisfies Record<ReplyNotSent, string>,
} as const;
