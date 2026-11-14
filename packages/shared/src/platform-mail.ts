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
export const PLATFORM_MAIL_OWN_SENDER_LINE = "Your own email account is connected, so the team sends from it instead.";
export const PLATFORM_MAIL_SIMULATED_LINE = "Sending is simulated here: no message leaves for real.";
export const PLATFORM_MAIL_PAUSED_LINE = "Sending from this address is paused for now. Nothing is waiting on you.";

/** "12 of 50 sent today". */
export const platformMailCountLine = (sentToday: number, cap: number): string => `${sentToday.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} sent today`;

/** Why the gateway refused a send from the project's address, in plain words (the refusal's reason; the agent reports it). */
export const PLATFORM_MAIL_REFUSALS = {
  off: "Sending from the project's own address is not switched on here, so nothing was sent.",
  own_sender: "This project sends from its own email account; use that instead. Nothing was sent.",
  paused: "Sending from this project's address is paused for now, so nothing was sent.",
  daily_cap: (cap: number) => `This project has sent its ${cap.toLocaleString("en-US")} messages for today. Nothing was sent; sending opens again at midnight UTC.`,
  ceiling: "Every project together has reached today's sending limit. Nothing was sent; sending opens again at midnight UTC.",
  content: (why: string) => `Nothing was sent: ${why}`,
  suppressed: "This person asked not to be emailed, or their address bounced. Nothing was sent.",
  unconfigured: "Sending from the project's own address is not set up completely here, so nothing was sent.",
  /** The shared count of today's messages cannot be read right now (Redis down), so no cap could be checked. */
  store_unavailable: "Sending is paused for a moment, so nothing was sent. Try again later.",
  /** A commercial message (`projectMailClass`) and the founders have not entered the project's postal address. */
  no_postal_address: "Not sent: the founder has not added a postal address yet. A marketing email must show one by law, and the founder adds it in Settings › Integrations. Replies to people who wrote first and receipts can still go out.",
} as const;

/*
 * ---- The postal address in every commercial message (US CAN-SPAM; founder, Nov 13, 2026) ----
 *
 * CAN-SPAM (15 U.S.C. 7704(a)(5); 16 CFR 316) asks every commercial email to carry a valid physical postal address of the
 * sender (a PO box or a registered commercial mail receiving agency is allowed) and a working way to opt out. A project's
 * marketing email shows the founders' own address, which they enter in Settings › Integrations; until they do, the
 * gateway refuses a commercial send from the project's address. Foundmill's own email always shows Foundmill's address
 * (`APP_POSTAL_ADDRESS` in @foundmill/config).
 */

/** Why a project's message is sent, as the agent declares it (`platform_mail.send_mail`'s `purpose`; absent: `marketing`). */
export const PROJECT_MAIL_PURPOSES = ["marketing", "reply", "receipt"] as const;
export type ProjectMailPurpose = (typeof PROJECT_MAIL_PURPOSES)[number];

export type MailClass = "commercial" | "transactional";

/** How far back the relationship that makes a reply or a receipt transactional may lie: 30 days. */
export const PROJECT_MAIL_RELATIONSHIP_MS = 30 * 86_400_000;

/**
 * The one place a project's message is classified (CAN-SPAM 15 U.S.C. 7702(2) and (17), 16 CFR 316.3). A message is
 * commercial when its primary purpose is to advertise or promote; it is transactional or relationship when its primary
 * purpose is to complete or confirm a transaction the recipient already agreed to (a receipt), or to answer what the
 * recipient asked (a reply to a person who wrote first). A double opt-in confirmation the platform sends itself is
 * transactional too (`FOLLOW_CONFIRMATION_MAIL_CLASS`): the person asked for it and it says only that.
 *
 * The gateway can check the relationship, never the words, so a declared purpose counts only with its proof, and
 * anything unsure is commercial:
 *   - `reply`: this person wrote to the project first, and a verified reply reached its address within
 *     `PROJECT_MAIL_RELATIONSHIP_MS` (`wroteFirst`);
 *   - `receipt`: a payment from this address reached the project within that window (`paid`);
 *   - anything else (no purpose, `marketing`, or a purpose without its proof): commercial.
 * The agent is told (the tool's description) that a reply or a receipt carries no promotion; one that does is commercial
 * by law, whatever the purpose says.
 */
export function projectMailClass(input: { purpose: ProjectMailPurpose | undefined | null; wroteFirst: boolean; paid: boolean }): MailClass {
  if (input.purpose === "reply" && input.wroteFirst) return "transactional";
  if (input.purpose === "receipt" && input.paid) return "transactional";
  return "commercial";
}

/** The follow confirmation (package 1.6, double opt-in): transactional, so it never waits on the postal address. */
export const FOLLOW_CONFIRMATION_MAIL_CLASS: MailClass = "transactional";

export const POSTAL_ADDRESS_MIN = 10;
export const POSTAL_ADDRESS_MAX = 300;

/** The address as the footer shows it: one line, its lines joined with commas, spaces and stray punctuation tidied. */
export function normalizePostalAddress(raw: string): string {
  return raw
    .normalize("NFC")
    .split(/[\r\n]+/)
    .map((line) => line.replace(/\s+/g, " ").trim().replace(/^[,;]+|[,;]+$/g, "").trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/[\s,;.]+$/, "")
    .trim();
}

/** Why `raw` cannot be a project's postal address, in plain words; null when it can (after `normalizePostalAddress`). */
export function postalAddressProblem(raw: string): string | null {
  const control = [...raw].some((ch) => {
    const c = ch.codePointAt(0)!;
    return (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127;
  });
  if (control || /[<>{}[\]\\|]/.test(raw)) return "Use letters, numbers and ordinary punctuation only.";
  const value = normalizePostalAddress(raw);
  if (value.length < POSTAL_ADDRESS_MIN) return "Enter the whole address: the street or PO box, the city, the postal code and the country.";
  if (value.length > POSTAL_ADDRESS_MAX) return `Keep the address under ${POSTAL_ADDRESS_MAX} characters.`;
  if (/https?:|www\.|@/i.test(value)) return "Enter a postal address, not a web or email address.";
  if (!/\p{L}/u.test(value) || !/\p{N}/u.test(value)) return "Include the street or PO box number and the postal code.";
  return null;
}

/** The footer's line: "Postal address: PO Box 12, Springfield, IL 62701, USA." */
export const postalAddressLine = (address: string): string => `Postal address: ${normalizePostalAddress(address)}.`;

/** Settings › Integrations › Email from your project: the field and the words around it. */
export const POSTAL_ADDRESS_LABEL = "Postal address for your emails";
export const POSTAL_ADDRESS_WHY = "By law in the US, every marketing email must show the sender's postal address, so the team's marketing emails show this one at the bottom. A PO box is fine.";
export const POSTAL_ADDRESS_PRIVATE = "It is never shown on your public page, only at the bottom of marketing emails. Replies to people who wrote first and receipts go out without it.";
export const POSTAL_ADDRESS_MISSING = "Until you add it, the team cannot send marketing emails from this address.";
export const POSTAL_ADDRESS_FOUNDERS_ONLY = "Only the founders can change it.";
export const POSTAL_ADDRESS_PLACEHOLDER = "PO Box 1234, Springfield, IL 62701, USA";

/**
 * The note a founder gets the first time the gateway refuses a commercial send for want of the address (decided
 * in-process like the page note: "Add it in Settings" opens Settings › Integrations, "Later" puts it aside). One while
 * it is open, and after "Later" no other for `quietMs`; saving the address answers it.
 */
export const POSTAL_ADDRESS_NOTE = {
  key: "project_mail.postal_address",
  subject: "Add a postal address for your emails",
  options: { add: "postal_add", later: "postal_later" },
  addLabel: "Add it in Settings",
  laterLabel: "Later",
  quietMs: 7 * 86_400_000,
  body: "The team tried to send a marketing email from the project's address, and it was not sent. By law in the US, every marketing email must show the sender's postal address, and none is added yet. Add yours in Settings › Integrations: a PO box is fine, and it is never shown on your public page. Replies to people who wrote first and receipts still go out.",
} as const;

/** Whether a note's decision block is the postal address note's (its `decision.key`). */
export function isPostalAddressDecision(decision: unknown): boolean {
  return !!decision && typeof decision === "object" && (decision as { key?: unknown }).key === POSTAL_ADDRESS_NOTE.key;
}

/** The page a person sees after the unsubscribe link (served by ingest). */
export const UNSUBSCRIBE_CONFIRM_TITLE = "Unsubscribe";
export const UNSUBSCRIBE_CONFIRM_BODY = "Stop receiving email from this project?";
export const UNSUBSCRIBE_CONFIRM_BUTTON = "Unsubscribe";
export const UNSUBSCRIBE_DONE_BODY = "You are unsubscribed. This project will not email you again.";
export const UNSUBSCRIBE_INVALID_BODY = "This unsubscribe link is not valid. Reply to the message and ask to be removed, and it will be done.";
