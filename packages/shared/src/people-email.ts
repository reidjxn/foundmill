/**
 * The words of the emails about people (docs/NETWORK.md F5, F20): an invitation to a project, and the note to the
 * person who invited someone that they joined. Built by
 * the gateway (`POST /v1/notify/email`) from its own reads; the api sends ids and, where a link carries one, the token.
 *
 * Every name in them (a project's, a person's) is written by a person, and the email comes from Foundmill's own
 * address, so each goes through `withoutLinks` and onto one line: the only links are the ones the gateway built. None of
 * them says or implies anything about work or a job: they say what is yours and who is asking.
 */
import { NOTIFY_NO_REPLY_LINE, withoutLinks, type NotifyEmailText } from "./notify-email";
import { FORMER_PROJECT_CARD, FOUNDER_NOTICE_MORE, rolePhrase } from "./founder-notices";
import { INVITATION_ROLE_SENTENCE, invitationRolePhrase, type InvitationRole } from "./people";

const oneLine = (value: string, max: number): string => {
  const v = withoutLinks(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const P = "margin:0 0 12px;font-size:14px;line-height:22px";
const BUTTON = "background:#1b4fd8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600";
const FOOT = "color:#6b7280;font-size:12px;line-height:18px;margin:12px 0 0";

/** "Nov 27, 2026" (US dates, CLAUDE.md), in UTC so the day is the one the server counts. */
export const emailDate = (at: Date): string => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(at);

interface Piece {
  paragraphs: string[];
  button?: { label: string; href: string };
  after?: string[];
  footer: string;
  footerLinks?: { label: string; href: string }[];
}

function render(subject: string, piece: Piece): NotifyEmailText {
  const text = [
    ...piece.paragraphs,
    ...(piece.button ? [`${piece.button.label}: ${piece.button.href}`] : []),
    ...(piece.after ?? []),
    NOTIFY_NO_REPLY_LINE,
    `--\n${piece.footer}${(piece.footerLinks ?? []).map((l) => `\n${l.label}: ${l.href}`).join("")}`,
  ].join("\n\n");
  const html = [
    ...piece.paragraphs.map((p) => `<p style="${P}">${esc(p)}</p>`),
    ...(piece.button ? [`<p style="margin:16px 0"><a href="${esc(piece.button.href)}" style="${BUTTON}">${esc(piece.button.label)}</a></p>`] : []),
    ...(piece.after ?? []).map((p) => `<p style="${P}">${esc(p)}</p>`),
    `<p style="${P}">${esc(NOTIFY_NO_REPLY_LINE)}</p>`,
    `<hr><p style="${FOOT}">${esc(piece.footer)}${(piece.footerLinks ?? []).map((l) => ` · <a href="${esc(l.href)}" style="color:#6b7280">${esc(l.label)}</a>`).join("")}</p>`,
  ].join("");
  return { subject: subject.slice(0, 200), text: `${text}\n`, html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:560px">${html}</div>` };
}

/** The footer link of every invitation email: it stops every invitation to the address (ingest `/mail/invitations/off`). */
export const INVITATIONS_OFF_LINK_LABEL = "Don't send me invitations";

/** An invitation to a project, to the address the inviter typed, with the link that stops every invitation to it. */
export function invitationEmail(f: { appName: string; inviterName: string | null; projectName: string; role: InvitationRole; link: string; expiresAt: Date; offLink: string }): NotifyEmailText {
  const inviter = f.inviterName ? oneLine(f.inviterName, 60) : "Someone";
  const project = oneLine(f.projectName, 120);
  return render(`${inviter} invited you to ${project} on ${f.appName}`, {
    paragraphs: ["Hi,", `${inviter} invited you to join ${project} as ${invitationRolePhrase(f.role)}.`, INVITATION_ROLE_SENTENCE[f.role]],
    button: { label: "See the invitation", href: f.link },
    after: [`It works until ${emailDate(f.expiresAt)}. If you don't know ${f.inviterName ? inviter : "who sent it"}, ignore this email: nothing happens unless you accept.`],
    footer: `You get this because ${inviter} typed this address on ${f.appName}. People on ${f.appName} can invite this address again; to stop every invitation to it, use the link below.`,
    footerLinks: [{ label: INVITATIONS_OFF_LINK_LABEL, href: f.offLink }],
  });
}

/**
 * The footer link of the waitlist's email: the platform-wide stop (the same token as "Don't send me invitations"; its
 * page is the `joining` variant, `joiningOffPage`). It says what that stop covers for this sender: email about joining
 * (invitations and this one); the page adds that the projects built here stop too. A person's own notices about their
 * projects are not covered, so the words never promise every email.
 */
export const accountEmailOffLinkLabel = (appName: string): string => `Don't email this address about joining ${appName}`;

/**
 * To a person on the waitlist, once, when their place opens (WP-03 T2; `ACCOUNT_EMAIL_KINDS`). `cardName` is the card
 * the waitlist keeps for them, read by the gateway while it is still kept; a person typed it, so it goes through
 * `withoutLinks` onto one line. `link` is `APP_URL/start`.
 */
export function waitlistAdmittedEmail(f: { appName: string; cardName: string | null; link: string; offLink: string }): NotifyEmailText {
  const cardName = f.cardName ? oneLine(f.cardName, 80) : "";
  return render(`Your place on ${f.appName} is open`, {
    paragraphs: [`Your place is open. Sign in with this address to pick up where you left off.`, ...(cardName ? [`Your card for ${cardName} is saved in your account.`] : []), "Your place does not expire."],
    button: { label: `Open ${f.appName}`, href: f.link },
    footer: `You get this because you saved your place on ${f.appName} with this address.`,
    footerLinks: [{ label: accountEmailOffLinkLabel(f.appName), href: f.offLink }],
  });
}

/**
 * The link a person asked for from a small screen, to open a desktop-only page on a computer (WP-03 T3;
 * `ACCOUNT_EMAIL_KINDS`). `link` is `APP_URL` and a path `isContinuePath` accepts, built by the gateway. The footer
 * carries the same platform-wide stop as the waitlist's email.
 */
export function continueLinkEmail(f: { appName: string; link: string; offLink: string }): NotifyEmailText {
  return render("Your link to continue on a computer", {
    paragraphs: ["You asked for this link from your phone. Open it on a computer to continue. It opens after you sign in with this address."],
    button: { label: `Continue on ${f.appName}`, href: f.link },
    footer: `You get this because you asked for this link on ${f.appName}.`,
    footerLinks: [{ label: accountEmailOffLinkLabel(f.appName), href: f.offLink }],
  });
}

/** To the person who invited someone: they joined. One of the person's own kinds (`invitation_accepted`), with its off link. */
export function invitationAcceptedEmail(f: { appName: string; recipientName: string | null; personName: string | null; projectName: string; role: InvitationRole; link: string; offLink: string; pauseLink: string }): NotifyEmailText {
  const project = oneLine(f.projectName, 120);
  const who = f.personName ? oneLine(f.personName, 60) : "The person you invited";
  return render(`${who} joined ${project}`, {
    paragraphs: [f.recipientName ? `Hi ${oneLine(f.recipientName, 60)},` : "Hi,", `${who} accepted your invitation and joined ${project} as ${invitationRolePhrase(f.role)}.`],
    button: { label: "Open People", href: f.link },
    footer: `You get this because you invited someone to ${project} on ${f.appName}.`,
    footerLinks: [
      { label: "Turn these emails off", href: f.offLink },
      { label: "Pause every email", href: f.pauseLink },
    ],
  });
}

/**
 * What a founder notice says (security review P2-3; `ACCOUNT_SAFETY_EMAIL_KINDS`). Built by the gateway from its own
 * reads of the audit entry, the people's profile names, the project's name and the recipient's zone. `reader` is who it
 * goes to: a current founder, the person it happened to (`subject`), a founder someone else removed or demoted within 30
 * days before a deletion request or after it (`former`), who may carry the one-click link that cancels the deletion, or,
 * for a deletion request only, the person who asked (`self`: the receipt, whatever the team's size). There is no off link: these emails reach the
 * founders whatever their email switches say, so the footer says why instead.
 */
export interface FounderNoticeFacts {
  appName: string;
  notice: "role_changed" | "removed" | "deletion_requested" | "deletion_canceled";
  reader: "founder" | "subject" | "former" | "self";
  recipientName: string | null;
  /** Who did it, by their profile name (null: none yet). */
  actorName: string | null;
  /** The person whose role changed or who was removed (null for a deletion, or no name yet). */
  subjectName: string | null;
  projectName: string;
  /** "Nov 13, 2026 at 3:45 PM EST": when it was done, in the reader's zone. */
  when: string;
  /** The role before and after (role_changed, removed). */
  fromRole?: string | null;
  toRole?: string | null;
  /** "Nov 20, 2026": the day a scheduled deletion happens (deletion_requested; and on a removal while one waits). */
  scheduledFor?: string | null;
  /** The actor of a cancel was a former founder: the day their standing ended ("Nov 12, 2026"). */
  actorFormerUntil?: string | null;
  /** The one-click cancel (`/a/<token>`) and the last day it works; only for a former founder or the person it happened to. */
  cancel?: { link: string; until: string } | null;
  /** Into the app: People for a role change or a removal, the Danger zone for a deletion (founders only). */
  link?: string | null;
}

/** The subject line and the body of a founder notice, in plain text and simple HTML. */
export function founderNoticeEmail(f: FounderNoticeFacts): NotifyEmailText {
  const project = oneLine(f.projectName, 120);
  const actor = f.actorName ? oneLine(f.actorName, 60) : f.notice === "deletion_canceled" && f.actorFormerUntil ? "Someone who was a founder" : "One of the founders";
  const subject = f.subjectName ? oneLine(f.subjectName, 60) : "a founder";
  const hi = f.recipientName ? `Hi ${oneLine(f.recipientName, 60)},` : "Hi,";
  const from = rolePhrase(f.fromRole ?? "owner");
  const to = rolePhrase(f.toRole ?? "member");
  const scheduled = f.scheduledFor ? `${project} is set to be deleted on ${f.scheduledFor}.` : `${project} is set to be deleted.`;
  const footer = `You get this because you are, or until recently were, a founder of ${project} on ${f.appName}. Emails about who runs a project and whether it is deleted always reach its founders, whatever your email settings say.`;
  const cancelPart = (lead: string): Pick<Piece, "button" | "after"> =>
    f.cancel ? { button: { label: FORMER_PROJECT_CARD.button, href: f.cancel.link }, after: [`${lead} You can cancel the deletion until ${f.cancel.until}.`, FORMER_PROJECT_CARD.note] } : {};
  let title: string;
  let piece: Omit<Piece, "footer">;
  switch (f.notice) {
    case "role_changed":
      if (f.reader === "subject") {
        title = `Your role in ${project} changed`;
        piece = {
          paragraphs: [hi, `${actor} changed your role in ${project} from ${from} to ${to} on ${f.when}.`, "If you didn't expect this, talk it over with the other founders. Your account, and anything else you build here, is not affected."],
          ...(f.cancel ? cancelPart(scheduled) : f.link ? { button: { label: `Open ${project}`, href: f.link } } : {}),
        };
      } else {
        title = `${actor} changed ${subject}'s role in ${project}`;
        piece = { paragraphs: [hi, `${actor} changed ${subject}'s role in ${project} from ${from} to ${to} on ${f.when}.`, "If this wasn't agreed, a founder can change it back in Settings › People."], ...(f.link ? { button: { label: "Open People", href: f.link } } : {}) };
      }
      break;
    case "removed":
      if (f.reader === "subject") {
        title = `You were removed from ${project}`;
        piece = { paragraphs: [hi, `${actor} removed you from ${project} on ${f.when}. You were ${from}.`, "Your account and your other projects are not affected. To come back, one of the founders can send you a new invitation."], ...cancelPart(scheduled) };
      } else {
        title = `${actor} removed ${subject} from ${project}`;
        piece = { paragraphs: [hi, `${actor} removed ${subject}, who was ${from}, from ${project} on ${f.when}.`, "If this wasn't agreed, a founder can invite them back from Settings › People."], ...(f.link ? { button: { label: "Open People", href: f.link } } : {}) };
      }
      break;
    case "deletion_requested": {
      if (f.reader === "self") {
        // The receipt: what was asked and when, and what to do if it was not them. Nobody else is named or counted.
        title = `You asked to delete ${project}`;
        piece = {
          paragraphs: [hi, `You asked to delete ${project} on ${f.when}.${f.scheduledFor ? ` It will be deleted on ${f.scheduledFor}.` : ""}`, "If this wasn't you, cancel in Settings › Danger zone and secure your account."],
          ...(f.link ? { button: { label: "Open the Danger zone", href: f.link } } : {}),
        };
        break;
      }
      title = `${actor} asked to delete ${project}`;
      const lead = `${actor} asked for ${project} to be permanently deleted on ${f.when}. It will be deleted${f.scheduledFor ? ` on ${f.scheduledFor}` : ""} unless a founder cancels.`;
      if (f.reader === "founder") piece = { paragraphs: [hi, lead, "To keep it, cancel from Settings › Danger zone before then. Nothing is deleted until that day."], ...(f.link ? { button: { label: "Open the Danger zone", href: f.link } } : {}) };
      else piece = f.cancel ? { paragraphs: [hi, lead], ...cancelPart("You were one of its founders until recently.") } : { paragraphs: [hi, lead, "If you want it kept, ask one of the founders to cancel it."] };
      break;
    }
    case "deletion_canceled": {
      title = `${actor} canceled the deletion of ${project}`;
      const who = f.actorFormerUntil ? `${actor}, a founder of ${project} until ${f.actorFormerUntil},` : actor;
      piece = {
        paragraphs: [
          hi,
          `${who} canceled the permanent deletion of ${project} on ${f.when}. Nothing was deleted and the project keeps working.`,
          ...(f.actorFormerUntil ? ["Canceling gave them nothing else: they are still out of the project."] : []),
          ...(f.reader === "founder" ? ["A founder can ask for the deletion again from Settings › Danger zone."] : []),
        ],
      };
      break;
    }
  }
  return render(title, { ...piece, footer });
}

/**
 * The one email that stands for every further founder notice about a project in the window, once the person has had the
 * window's share (`FOUNDER_NOTICE_LIMITS`). It names nobody and no change; it keeps the cancel when the notice it stands
 * for carried one.
 */
/**
 * The folded email past a person's essential founder notices' share (or the platform's circuit breaker), across every
 * project: it says more changed and where to look, and carries the latest deletion this person may still cancel, when
 * there is one (`cancel`, with that project's name). Sent once per such deletion, and once for none, in a UTC day.
 */
export function founderNoticeEssentialMoreEmail(f: { appName: string; recipientName: string | null; link: string | null; cancel?: { link: string; until: string; projectName: string } | null }): NotifyEmailText {
  const hi = f.recipientName ? `Hi ${oneLine(f.recipientName, 60)},` : "Hi,";
  return render(FOUNDER_NOTICE_MORE.all.subject, {
    paragraphs: [hi, FOUNDER_NOTICE_MORE.all.lead, FOUNDER_NOTICE_MORE.all.body],
    ...(f.cancel
      ? { button: { label: FORMER_PROJECT_CARD.button, href: f.cancel.link }, after: [`${oneLine(f.cancel.projectName, 120)} is set to be deleted. You can cancel the deletion until ${f.cancel.until}.`, FORMER_PROJECT_CARD.note] }
      : f.link
        ? { button: { label: "Open your projects", href: f.link } }
        : {}),
    footer: `You get this because you are, or until recently were, a founder of a project on ${f.appName}. Emails about who runs a project and whether it is deleted always reach its founders, whatever your email settings say.`,
  });
}

export function founderNoticeMoreEmail(f: { appName: string; recipientName: string | null; projectName: string; isFounder: boolean; link: string | null; cancel?: { link: string; until: string } | null }): NotifyEmailText {
  const project = oneLine(f.projectName, 120);
  const hi = f.recipientName ? `Hi ${oneLine(f.recipientName, 60)},` : "Hi,";
  return render(FOUNDER_NOTICE_MORE.subject(f.projectName), {
    paragraphs: [hi, FOUNDER_NOTICE_MORE.lead(f.projectName), f.isFounder ? FOUNDER_NOTICE_MORE.founder : FOUNDER_NOTICE_MORE.other],
    ...(f.cancel
      ? { button: { label: FORMER_PROJECT_CARD.button, href: f.cancel.link }, after: [`${project} is set to be deleted. You can cancel the deletion until ${f.cancel.until}.`, FORMER_PROJECT_CARD.note] }
      : f.link
        ? { button: { label: `Open ${project}`, href: f.link } }
        : {}),
    footer: `You get this because you are, or until recently were, a founder of ${project} on ${f.appName}. Emails about who runs a project and whether it is deleted always reach its founders, whatever your email settings say.`,
  });
}
