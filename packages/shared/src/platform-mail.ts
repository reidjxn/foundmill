/**
 * The Foundmill sending address of a project (docs/THESIS_REVIEW.md package 1.5; CLAUDE.md "Foundmill ... gives a
 * project an address to send email from, with a daily cap per project and the founder's approval for outside
 * contact"). Plain data and words, no Zod and no crypto, so the browser reads the same rules and sentences.
 *
 * A project sends from `<local part>@<PLATFORM_MAIL_DOMAIN>`: the local part is chosen once (packages/db
 * `project_mail`, from the public page's address when there is one, else the business's slug) and then stays, even if
 * the page's address changes later, so replies to old messages still find the project.
 */

/** Same shape as a page address: 3 to 40 lowercase letters, digits and hyphens, no hyphen at either end. */
export const MAIL_LOCAL_PART_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Words no project's local part may hold, alone or as one of its hyphen- or dot-separated parts (`paypal-security`,
 * `acme-no-reply`): the role addresses mail systems and people expect a domain's operator to answer (RFC 2142 and common
 * practice), the words a message pretending to come from a bank, a shop or Foundmill itself would use, and the platform's
 * own name. The migration's check constraint repeats this list and a test compares the two. A local part that contains
 * the product's name anywhere is refused as well (packages/db `mailLocalPartCandidates`, and the constraint).
 */
export const MAIL_RESERVED_LOCAL_PARTS: readonly string[] = [
  "abuse", "account", "accounts", "admin", "administrator", "alerts", "billing", "bounce", "bounces", "contact", "dmarc", "do-not-reply", "donotreply", "foundmill",
  "hello", "help", "hostmaster", "info", "login", "mailer-daemon", "marketing", "no-reply", "noc", "noreply", "notification", "notifications", "password",
  "payments", "postmaster", "privacy", "root", "sales", "security", "support", "team", "unsubscribe", "verification", "verify", "webmaster", "www",
];

/** True when one of the reserved words is the whole local part or a run of its hyphen- or dot-separated parts. */
export function mailLocalPartReserved(value: string): boolean {
  const parts = `-${value.toLowerCase().replace(/\./g, "-")}-`;
  return MAIL_RESERVED_LOCAL_PARTS.some((word) => parts.includes(`-${word}-`));
}

export const isMailLocalPart = (value: unknown): value is string => typeof value === "string" && MAIL_LOCAL_PART_PATTERN.test(value) && !mailLocalPartReserved(value);

/** `<local>@<domain>`, lowercase. */
export const platformMailAddress = (localPart: string, domain: string): string => `${localPart}@${domain}`.toLowerCase();

/** The local part of an address at `domain` (case-insensitive), or null when the address is at another domain or malformed. */
export function platformMailLocalPartOf(address: string, domain: string): string | null {
  const bare = (address.match(/<([^>]+)>/)?.[1] ?? address).trim().toLowerCase();
  const at = bare.lastIndexOf("@");
  if (at <= 0 || bare.slice(at + 1) !== domain.toLowerCase()) return null;
  // A sub-address (`acme+thread@`) still reaches the project.
  const local = bare.slice(0, at).split("+")[0] ?? "";
  return MAIL_LOCAL_PART_PATTERN.test(local) ? local : null;
}

/** What Settings › Integrations shows: the heading, and the line about outside contact. */
export const PLATFORM_MAIL_TITLE = "Email from your project";
export const PLATFORM_MAIL_APPROVAL_LINE = "Messages to people outside the project wait for your OK unless you said otherwise in What the team can do.";
export const PLATFORM_MAIL_REPLIES_LINE = "Replies come back to the project, and anyone can unsubscribe from a link in every message.";
export const PLATFORM_MAIL_OWN_SENDER_LINE = "Your own SendGrid account is connected, so the team sends from it instead.";
export const PLATFORM_MAIL_SIMULATED_LINE = "Sending is simulated here: no message leaves for real.";
export const PLATFORM_MAIL_PAUSED_LINE = "Sending from this address is paused for now. Nothing is waiting on you.";

/** "12 of 50 sent today". */
export const platformMailCountLine = (sentToday: number, cap: number): string => `${sentToday.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} sent today`;

/** Why the gateway refused a send from the project's address, in plain words (the refusal's reason; the agent reports it). */
export const PLATFORM_MAIL_REFUSALS = {
  off: "Sending from the project's own address is not switched on here, so nothing was sent.",
  own_sender: "This project sends from its own SendGrid account; use that instead. Nothing was sent.",
  paused: "Sending from this project's address is paused for now, so nothing was sent.",
  daily_cap: (cap: number) => `This project has sent its ${cap.toLocaleString("en-US")} messages for today. Nothing was sent; sending opens again at midnight UTC.`,
  ceiling: "Every project together has reached today's sending limit. Nothing was sent; sending opens again at midnight UTC.",
  content: (why: string) => `Nothing was sent: ${why}`,
  suppressed: "This person asked not to be emailed, or their address bounced. Nothing was sent.",
  unconfigured: "Sending from the project's own address is not set up completely here, so nothing was sent.",
  /** The shared count of today's messages cannot be read right now (Redis down), so no cap could be checked. */
  store_unavailable: "Sending is paused for a moment, so nothing was sent. Try again later.",
} as const;

/** The page a person sees after the unsubscribe link (served by ingest). */
export const UNSUBSCRIBE_CONFIRM_TITLE = "Unsubscribe";
export const UNSUBSCRIBE_CONFIRM_BODY = "Stop receiving email from this project?";
export const UNSUBSCRIBE_CONFIRM_BUTTON = "Unsubscribe";
export const UNSUBSCRIBE_DONE_BODY = "You are unsubscribed. This project will not email you again.";
export const UNSUBSCRIBE_INVALID_BODY = "This unsubscribe link is not valid. Reply to the message and ask to be removed, and it will be done.";
