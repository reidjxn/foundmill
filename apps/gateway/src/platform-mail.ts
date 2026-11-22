/**
 * The guards in front of a project's Foundmill sending address (docs/THESIS_REVIEW.md package 1.5; ARCHITECTURE §9).
 *
 * `platform_mail.send_mail` goes through the whole tool-call pipeline like any tool: session scope, the connector's
 * per-minute limit, the business and agent state, and Cedar, unchanged (a first message to someone outside the project
 * asks the founder in augmented and assisted mode, because the tool contacts a third party and cannot be undone; a
 * suppressed recipient or one first seen in untrusted content is refused). Only once Cedar allowed it (or the founder
 * approved this very call) do these run, in this order, before any vendor call:
 *
 *   1. switched on: PLATFORM_MAIL_DOMAIN set, and (live, or outside development and test) the signing secret set and an
 *      https unsubscribe base (INGEST_PUBLIC_URL); a mock send only where simulated results are allowed
 *      (`mockResultsAllowed`: development, test, a sample business), never on a person's project on staging or production;
 *   2. the founder's own SendGrid is not connected (their own account wins: the team sends from it instead);
 *   3. the message: one recipient, plain text and simple HTML, no attachments (`platformMailContentProblem`);
 *   4. the suppression list again, for the recipient the message names (Cedar checked every address in the arguments);
 *   5. the project's address (`project_mail`, chosen on first use and then kept) and that Foundmill has not paused it;
 *   6. a commercial message carries the founders' postal address (US CAN-SPAM; founder, Nov 13, 2026): the message is
 *      classified once (packages/shared `projectMailClass`: a declared reply counts only when this person wrote to the
 *      project first, a declared receipt only when they paid it, anything else is commercial), and a commercial one
 *      with no address entered is refused, with one note to the founders to add it (`repos.postalAddress.raiseNote`);
 *   7. the project's daily cap, per UTC day (`project_mail.daily_cap`, else PLATFORM_MAIL_DAILY_CAP);
 *   8. the deployment's daily ceiling across every project (PLATFORM_MAIL_DAILY_CEILING).
 *
 * The two counts are taken atomically (Redis INCR, shared by every replica). Outside development and test a count that
 * is not shared (no Redis, or Redis down and the store counting in this process's memory) caps nothing, so the send is
 * refused until Redis answers. A count is given back when a later guard refuses, or the vendor refused outright (a 4xx:
 * nothing went out); after a timeout or a 5xx the message may have gone, so it stays counted. The sender is
 * `<project name> via <APP_NAME>` (`platformMailSenderName`), from the project's own domain once it is verified there
 * (`project_domains`), with the Foundmill address as Reply-To so replies still arrive. The envelope (sender, Reply-To, unsubscribe link, signed
 * custom args, which cover the recipient) reaches the connector in `ToolContext.platformMail`, never through the agent's
 * arguments. Every refusal is a deny with its own policy id and a plain sentence (packages/shared `PLATFORM_MAIL_REFUSALS`), audited like any deny;
 * an approval used for a refused call is given back by the pipeline.
 */
import { emailLinkSecret } from "@foundmill/shared/email-links";
import { randomUUID } from "node:crypto";
import { repos, type Business } from "@foundmill/db";
import { mockResultsAllowed, PLATFORM_MAIL_REFUSALS, PLATFORM_MAIL_SECRET_MIN_LENGTH, platformMailAddress, platformMailDomain, platformMailSigningSecret, PROJECT_MAIL_RELATIONSHIP_MS, projectMailClass, type Env, type MailClass, type ProjectMailPurpose } from "@foundmill/shared";
import { bookingLinkSecret, DEV_PLATFORM_MAIL_SECRET, emailEntityId, platformMailContentProblem, platformMailCustomArgs, platformMailSenderName, PlatformSendMail, platformUnsubscribeToken, platformUnsubscribeUrl, suppressionHashOfEmail, type ConnectorMode, type PlatformMailEnvelope } from "@foundmill/connectors";
import { writeGatewayEvent } from "./events";
import { DAY_MS, type RateLimitStore } from "./rate-limit";

export interface PlatformMailConfig {
  /** PLATFORM_MAIL_DOMAIN; null = off. */
  domain: string | null;
  dailyCap: number;
  ceiling: number;
  /** PLATFORM_MAIL_SIGNING_SECRET; in development and test a fixed one stands in while it is unset (mock sends only). */
  signingSecret: string | null;
  /** Where unsubscribe links point: INGEST_PUBLIC_URL, else INGEST_URL. */
  unsubscribeBase: string;
  /** Foundmill's own email to its users (notify-email.ts): sent from `<it>@<domain>` (PLATFORM_NOTIFY_LOCAL_PART, default `hello`). */
  notifyLocalPart?: string;
  /** Where the link in that email points (APP_URL). */
  appUrl?: string;
  /** That email's own daily ceiling, every person together (PLATFORM_NOTIFY_DAILY_CEILING, `pn:all:day`; default 1,000). */
  notifyCeiling?: number;
  /** Every ordinary founder notice together in a UTC day (PLATFORM_SAFETY_DAILY_CEILING, `pn:safety:day`; default 5,000), enforced. 0 means 0. */
  safetyCeiling?: number;
  /**
   * The circuit breaker over every essential founder notice together in a UTC day (PLATFORM_SAFETY_RESERVED_DAILY_CEILING,
   * `pn:safety:reserved:day`; default 20,000): a warning at half, an error at the ceiling, and past it the per-person
   * folded email. 0 means 0 (every essential notice folds).
   */
  safetyReservedCeiling?: number;
  /** Follow confirmations a project may send in a UTC day (`pm:<id>:follow`); default `FOLLOW_CONFIRM_DAILY_CAP`. For tests. */
  followCap?: number;
  /** Follow confirmations across the deployment in a UTC day (`pm:all:follow`); default `FOLLOW_CONFIRM_DAILY_CEILING`. For tests. */
  followCeiling?: number;
  /** Booking emails a project may send in a UTC day (`pm:<id>:booking`); default `BOOKING_MAIL.dailyCap`. For tests. */
  bookingCap?: number;
  /** Booking emails across the deployment in a UTC day (`pm:all:booking`); default `BOOKING_MAIL.dailyCeiling`. For tests. */
  bookingCeiling?: number;
  /** The key a booking's manage link is signed under (`bookingLinkSecret`: SESSION_TOKEN_SECRET, shared with the api). Null: no booking email. */
  bookingLinkSecret?: string | null;
  /**
   * The key the "Pause every email" link is signed under (`@foundmill/shared/email-links`, derived from
   * SESSION_TOKEN_SECRET under its own label; the api's `email.pause` checks it). Absent: no pause link.
   */
  pauseSecret?: string;
}

/** Only for mock sends in development and test: links signed with it are never honored anywhere else (ingest refuses them). */
export { DEV_PLATFORM_MAIL_SECRET };

/** Throws at boot when the domain is set outside development and test without a signing secret of 32+ characters. */
export function platformMailConfig(
  env: Pick<Env, "APP_ENV" | "PLATFORM_MAIL_DOMAIN" | "PLATFORM_MAIL_DAILY_CAP" | "PLATFORM_MAIL_DAILY_CEILING" | "PLATFORM_MAIL_SIGNING_SECRET" | "INGEST_PUBLIC_URL" | "INGEST_URL"> & Partial<Pick<Env, "PLATFORM_NOTIFY_LOCAL_PART" | "APP_URL" | "PLATFORM_NOTIFY_DAILY_CEILING" | "PLATFORM_SAFETY_DAILY_CEILING" | "PLATFORM_SAFETY_RESERVED_DAILY_CEILING" | "SESSION_TOKEN_SECRET">>,
): PlatformMailConfig {
  return {
    domain: platformMailDomain(env),
    dailyCap: env.PLATFORM_MAIL_DAILY_CAP,
    ceiling: env.PLATFORM_MAIL_DAILY_CEILING,
    signingSecret: platformMailSigningSecret(env),
    unsubscribeBase: (env.INGEST_PUBLIC_URL?.trim() || env.INGEST_URL).replace(/\/+$/, ""),
    notifyLocalPart: env.PLATFORM_NOTIFY_LOCAL_PART || "hello",
    notifyCeiling: env.PLATFORM_NOTIFY_DAILY_CEILING ?? PLATFORM_NOTIFY_DEFAULT_CEILING,
    // Set means set, 0 included (final review): only an absent value takes the default (loadEnv refuses 0 at boot).
    ...(env.PLATFORM_SAFETY_DAILY_CEILING !== undefined ? { safetyCeiling: env.PLATFORM_SAFETY_DAILY_CEILING } : {}),
    ...(env.PLATFORM_SAFETY_RESERVED_DAILY_CEILING !== undefined ? { safetyReservedCeiling: env.PLATFORM_SAFETY_RESERVED_DAILY_CEILING } : {}),
    ...(env.APP_URL ? { appUrl: env.APP_URL.trim().replace(/\/+$/, "") } : {}),
    ...(pauseSecretOf(env) ? { pauseSecret: pauseSecretOf(env)! } : {}),
    bookingLinkSecret: bookingLinkSecret({ APP_ENV: env.APP_ENV, SESSION_TOKEN_SECRET: (env as Partial<Pick<Env, "SESSION_TOKEN_SECRET">>).SESSION_TOKEN_SECRET }),
  };
}

/** The pause link's key: SESSION_TOKEN_SECRET (`emailLinkSecret`); without it, no pause link. */
function pauseSecretOf(env: Partial<Pick<Env, "APP_ENV" | "SESSION_TOKEN_SECRET">>): string | null {
  try {
    return emailLinkSecret({ APP_ENV: env.APP_ENV ?? "development", SESSION_TOKEN_SECRET: env.SESSION_TOKEN_SECRET });
  } catch {
    return null;
  }
}

export const PLATFORM_MAIL_POLICY = {
  off: "platform-mail-off",
  unconfigured: "platform-mail-unconfigured",
  own_sender: "platform-mail-own-sender",
  content: "platform-mail-content",
  suppressed: "platform-mail-suppressed",
  paused: "platform-mail-paused",
  daily_cap: "platform-mail-daily-cap",
  ceiling: "platform-mail-ceiling",
  /** A mock send where simulated results are not allowed (a person's project on staging or production). */
  simulated: "platform-mail-simulated",
  /** The daily counts are not shared by every replica right now (no Redis, or Redis down). */
  store: "platform-mail-store",
  /** A commercial message, and the founders have not entered the project's postal address (US CAN-SPAM). */
  no_postal_address: "platform-mail-no-postal-address",
} as const;

/** Counter keys: one per project and one for the whole deployment, in fixed UTC-day windows. */
export const platformMailDayKey = (businessId: string): string => `pm:${businessId}:day`;
export const PLATFORM_MAIL_CEILING_KEY = "pm:all:day";
/**
 * Follow confirmations (follow-confirm.ts) count on their own keys, never the project's mail day or the deployment's
 * outbound ceiling: anyone can sign up on a public page, so a flood of signups must never use up the email the founders
 * and their team send (security audit 2026-11-13, finding 10).
 */
export const followConfirmDayKey = (businessId: string): string => `pm:${businessId}:follow`;
export const FOLLOW_CONFIRM_CEILING_KEY = "pm:all:follow";
/** Booking emails have their own day too (booking-mail.ts): replies to the customer's own action, never the project's outreach. */
export const bookingMailDayKey = (businessId: string): string => `pm:${businessId}:booking`;
export const BOOKING_MAIL_CEILING_KEY = "pm:all:booking";
/**
 * At most 100 follow confirmations a project in a UTC day: twice the project's whole outbound day (50 by default), so a
 * real launch day is never cut short, while a flood that gets past the page's bot check costs at most 100 emails to
 * strangers from the project's address. A signup past it stays pending; the same person signing up the next day gets
 * the email.
 */
export const FOLLOW_CONFIRM_DAILY_CAP = 100;
/**
 * At most 1,000 across the deployment: half the outbound ceiling's default (2,000), so confirmations on the shared
 * sending domain stay a small share of what it carries, and a flood spread over many pages stops there (ten projects
 * at their cap) without touching anyone's outreach or Foundmill's own email.
 */
export const FOLLOW_CONFIRM_DAILY_CEILING = 1_000;
/** PLATFORM_NOTIFY_DAILY_CEILING's default. */
export const PLATFORM_NOTIFY_DEFAULT_CEILING = 1_000;

const OWN_SENDER_STATUSES = new Set(["connected", "degraded"]);
/** The connectors that are a founder's own sender: when one is connected, the project's Foundmill address steps aside. */
const OWN_SENDER_CONNECTORS = ["sendgrid", "resend"] as const;
/** Resend counts only while it can send: a degraded one (no verified domain) must not leave the project with no sender at all. */
const ownSenderCounts = (key: string, status: string): boolean => (key === "resend" ? status === "connected" : OWN_SENDER_STATUSES.has(status));

export interface PreparedPlatformMail {
  envelope: PlatformMailEnvelope;
  localPart: string;
  recipientHash: string;
  /** How the message was classified (`projectMailClass`). */
  mailClass: MailClass;
  /** Gives both counts back (the send did not go out). Idempotent. */
  release(): Promise<void>;
}

/**
 * The signed one-click unsubscribe link for a message a founder's own sender (Resend) is about to send: the same link
 * the project's Foundmill address carries, so an opt-out lands in this project's suppression list through ingest. Null
 * where that cannot work: platform mail is not switched on here (ingest answers 404 for the link), or, live or outside
 * development and test, there is no signing secret or no https address for ingest. The caller then sends nothing.
 */
export function ownSenderUnsubscribeUrl(config: PlatformMailConfig | undefined, input: { businessId: string; email: string; mode: ConnectorMode; appEnv?: string }): string | null {
  if (!config?.domain) return null;
  const devStack = input.appEnv === undefined || input.appEnv === "development" || input.appEnv === "test";
  const strict = input.mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  if (!secret || (strict && !/^https:\/\//.test(config.unsubscribeBase))) return null;
  return platformUnsubscribeUrl(config.unsubscribeBase, platformUnsubscribeToken(secret, input.businessId, suppressionHashOfEmail(input.email)));
}

export type PlatformMailDecision = { ok: true; prepared: PreparedPlatformMail } | PlatformMailRefusal;

export interface PlatformMailDeps {
  db: Parameters<typeof repos.projectMail.ensure>[0];
  rateLimits: RateLimitStore;
  config: PlatformMailConfig | undefined;
  appEnv?: string;
}

export type PlatformMailRefusal = { ok: false; policyId: string; reason: string };
const refuse = (policyId: string, reason: string): PlatformMailRefusal => ({ ok: false, policyId, reason });

function platformMailSecret(deps: Pick<PlatformMailDeps, "config" | "appEnv">, mode: ConnectorMode): string | null {
  const signingSecret = deps.config?.signingSecret;
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  return signingSecret && signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? signingSecret : mode === "live" || !devStack ? null : DEV_PLATFORM_MAIL_SECRET;
}

/**
 * Guard 1 alone: whether the project's Foundmill address is switched on and configured where it runs. It reads only
 * config and takes no ticket, so the pipeline also runs it before asking the founder (WP-02 T3): nobody is asked to
 * approve a message that cannot be sent.
 */
export function platformMailSwitchRefusal(deps: Pick<PlatformMailDeps, "config" | "appEnv">, input: { business: Pick<Business, "isDemo">; mode: ConnectorMode }): PlatformMailRefusal | null {
  const config = deps.config;
  if (!config?.domain) return refuse(PLATFORM_MAIL_POLICY.off, PLATFORM_MAIL_REFUSALS.off);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = input.mode === "live" || !devStack;
  if (!platformMailSecret(deps, input.mode) || (strict && !/^https:\/\//.test(config.unsubscribeBase))) return refuse(PLATFORM_MAIL_POLICY.unconfigured, PLATFORM_MAIL_REFUSALS.unconfigured);
  // A simulated send is never reported to a person's project on staging or production as if it went out.
  if (input.mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, input.business.isDemo)) return refuse(PLATFORM_MAIL_POLICY.simulated, PLATFORM_MAIL_REFUSALS.off);
  return null;
}

export async function preparePlatformMail(deps: PlatformMailDeps, input: { business: Pick<Business, "id" | "name" | "isDemo">; args: unknown; mode: ConnectorMode; now: number; agentId?: string; log?: { warn: (obj: Record<string, unknown>, msg: string) => void } }): Promise<PlatformMailDecision> {
  const config = deps.config;
  const businessId = input.business.id;
  // 1. Switched on, and configured for where it runs.
  const off = platformMailSwitchRefusal(deps, input);
  if (off || !config?.domain) return off ?? refuse(PLATFORM_MAIL_POLICY.off, PLATFORM_MAIL_REFUSALS.off);
  const domain = config.domain;
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const secret = platformMailSecret(deps, input.mode)!;

  // 2. The founder's own sender wins: their SendGrid or their Resend (founder-key connectors, 2026-11-12).
  for (const ownKey of OWN_SENDER_CONNECTORS) {
    const own = await repos.integrations.getByKey(deps.db, businessId, ownKey);
    if (own && own.archivedAt === null && ownSenderCounts(ownKey, own.status)) return refuse(PLATFORM_MAIL_POLICY.own_sender, PLATFORM_MAIL_REFUSALS.own_sender);
  }

  // 3. One recipient, plain text and simple HTML, nothing attached.
  const parsed = PlatformSendMail.safeParse(input.args ?? {});
  if (!parsed.success) return refuse(PLATFORM_MAIL_POLICY.content, PLATFORM_MAIL_REFUSALS.content("send_mail takes one recipient, a subject, a plain-text body and optional simple HTML, and nothing attached."));
  const problem = platformMailContentProblem(parsed.data);
  if (problem) return refuse(PLATFORM_MAIL_POLICY.content, PLATFORM_MAIL_REFUSALS.content(problem));

  // 4. The recipient the message actually goes to.
  const recipientHash = suppressionHashOfEmail(parsed.data.to.email);
  if (await repos.channels.isSuppressed(deps.db, businessId, { emailHash: recipientHash })) return refuse(PLATFORM_MAIL_POLICY.suppressed, PLATFORM_MAIL_REFUSALS.suppressed);

  // 5. The project's address, kept once chosen.
  const row = await repos.projectMail.ensure(deps.db, businessId);
  if (row.status !== "active") return refuse(PLATFORM_MAIL_POLICY.paused, PLATFORM_MAIL_REFUSALS.paused);

  // 6. A commercial message carries the founders' postal address; without one it is refused and the founders are told once.
  const mailClass = await classifyProjectMail(deps.db, businessId, { purpose: parsed.data.purpose, email: parsed.data.to.email, now: input.now });
  const postalAddress = mailClass === "commercial" ? await repos.postalAddress.addressOf(deps.db, businessId) : null;
  if (mailClass === "commercial" && !postalAddress) {
    await raisePostalAddressNote(deps.db, businessId, { agentId: input.agentId ?? null, now: input.now }).catch((e: unknown) => input.log?.warn({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "postal address note not raised"));
    return refuse(PLATFORM_MAIL_POLICY.no_postal_address, PLATFORM_MAIL_REFUSALS.no_postal_address);
  }

  // 7 and 8. The project's day, then the deployment's. Outside development and test only a shared count caps anything.
  const counted = await takePlatformMailDay(deps, { businessId, cap: row.dailyCap ?? config.dailyCap, ceiling: config.ceiling, devStack, now: input.now });
  if (!counted.ok) return counted;
  const release = counted.release;

  const messageRef = randomUUID();
  const email = platformMailAddress(row.localPart, domain);
  const { projectName, fromName } = platformMailSenderName(input.business.name, row.localPart);
  // The project's own domain, once verified (WP-08 domain plan, Path B): From is there, replies still come back here.
  const own = await repos.projectDomains.sendingFrom(deps.db, businessId, { live: input.mode === "live" });
  return {
    ok: true,
    prepared: {
      localPart: row.localPart,
      recipientHash,
      mailClass,
      release,
      envelope: {
        ...(own ? { from: { email: own.email, name: fromName }, replyTo: { email, name: fromName } } : { from: { email, name: fromName } }),
        projectName,
        messageRef,
        unsubscribeUrl: platformUnsubscribeUrl(config.unsubscribeBase, platformUnsubscribeToken(secret, businessId, recipientHash)),
        customArgs: platformMailCustomArgs(secret, businessId, messageRef, recipientHash),
        commercial: mailClass === "commercial",
        ...(postalAddress ? { postalAddress } : {}),
      },
    },
  };
}

/**
 * Step 6's classification, with the proof a declared purpose needs (packages/shared `projectMailClass`): a reply only to
 * a person whose verified reply reached the project within `PROJECT_MAIL_RELATIONSHIP_MS`, a receipt only for a payment
 * from this address within it. Read only when the agent declared one; anything else is commercial.
 */
export async function classifyProjectMail(db: PlatformMailDeps["db"], businessId: string, input: { purpose: ProjectMailPurpose | undefined; email: string; now: number }): Promise<MailClass> {
  const since = new Date(input.now - PROJECT_MAIL_RELATIONSHIP_MS);
  const wroteFirst = input.purpose === "reply" ? await repos.postalAddress.wroteFirst(db, businessId, { entityId: emailEntityId(input.email), since }) : false;
  const paid = input.purpose === "receipt" ? await repos.postalAddress.paid(db, businessId, { email: input.email, since }) : false;
  return projectMailClass({ purpose: input.purpose, wroteFirst, paid });
}

/**
 * The founders' note to add the address, from the Chief of Staff (else the agent that tried to send), once while open
 * and quiet for a week after "Later" (`repos.postalAddress.raiseNote`), through the outbox like every Inbox note.
 */
export async function raisePostalAddressNote(db: PlatformMailDeps["db"], businessId: string, input: { agentId: string | null; now: number }): Promise<void> {
  const chief = await repos.agents.chiefOfStaff(db, businessId).catch(() => null);
  const fromAgentId = chief?.id ?? input.agentId;
  if (!fromAgentId) return;
  await repos.postalAddress.raiseNote(db, businessId, {
    fromAgentId,
    now: new Date(input.now),
    onCreated: async (tx, item) => {
      await writeGatewayEvent(tx, {
        businessId,
        type: "inbox.item_created",
        actor: { kind: "agent", id: fromAgentId },
        payload: { inboxItemId: item.id, type: item.type, fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: null },
      });
    },
  });
}

/**
 * Steps 6 and 7: one message on the project's UTC day and one on the deployment's, refused (and both given back) over
 * either, or when the counts are not shared by every replica outside development and test. The follow confirmation
 * (follow-confirm.ts) passes its own `keys` (`followConfirmDayKey`, `FOLLOW_CONFIRM_CEILING_KEY`) and its own cap and
 * ceiling, so those emails never take the project's mail day or the deployment's outbound ceiling.
 */
export async function takePlatformMailDay(
  deps: Pick<PlatformMailDeps, "rateLimits">,
  input: { businessId: string; cap: number; ceiling: number; devStack: boolean; now: number; keys?: { project: string; all: string } },
): Promise<{ ok: true; release: () => Promise<void> } | PlatformMailRefusal> {
  const projectKey = input.keys?.project ?? platformMailDayKey(input.businessId);
  const allKey = input.keys?.all ?? PLATFORM_MAIL_CEILING_KEY;
  const counted: string[] = [];
  const release = async () => {
    for (const key of counted.splice(0)) await deps.rateLimits.release?.(key, DAY_MS, input.now);
  };
  const shared = () => input.devStack || deps.rateLimits.durable === true;
  const project = await deps.rateLimits.hit(projectKey, DAY_MS, input.now);
  counted.push(projectKey);
  if (!shared()) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.store, PLATFORM_MAIL_REFUSALS.store_unavailable);
  }
  if (project.count > input.cap) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.daily_cap, PLATFORM_MAIL_REFUSALS.daily_cap(input.cap));
  }
  const all = await deps.rateLimits.hit(allKey, DAY_MS, input.now);
  counted.push(allKey);
  if (!shared()) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.store, PLATFORM_MAIL_REFUSALS.store_unavailable);
  }
  if (all.count > input.ceiling) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.ceiling, PLATFORM_MAIL_REFUSALS.ceiling);
  }
  return { ok: true, release };
}
