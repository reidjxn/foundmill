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
