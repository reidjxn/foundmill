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
 *   6. the project's daily cap, per UTC day (`project_mail.daily_cap`, else PLATFORM_MAIL_DAILY_CAP);
 *   7. the deployment's daily ceiling across every project (PLATFORM_MAIL_DAILY_CEILING).
 *
 * The two counts are taken atomically (Redis INCR, shared by every replica). Outside development and test a count that
 * is not shared (no Redis, or Redis down and the store counting in this process's memory) caps nothing, so the send is
 * refused until Redis answers. A count is given back when a later guard refuses, or the vendor refused outright (a 4xx:
 * nothing went out); after a timeout or a 5xx the message may have gone, so it stays counted. The sender is
 * `<project name> via <APP_NAME>` (`platformMailSenderName`). The envelope (sender, Reply-To, unsubscribe link, signed
 * custom args, which cover the recipient) reaches the connector in `ToolContext.platformMail`, never through the agent's
 * arguments. Every refusal is a deny with its own policy id and a plain sentence (packages/shared `PLATFORM_MAIL_REFUSALS`), audited like any deny;
 * an approval used for a refused call is given back by the pipeline.
 */
import { randomUUID } from "node:crypto";
import { repos, type Business } from "@foundmill/db";
import { mockResultsAllowed, PLATFORM_MAIL_REFUSALS, PLATFORM_MAIL_SECRET_MIN_LENGTH, platformMailAddress, platformMailDomain, platformMailSigningSecret, type Env } from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, platformMailContentProblem, platformMailCustomArgs, platformMailSenderName, PlatformSendMail, platformUnsubscribeToken, platformUnsubscribeUrl, suppressionHashOfEmail, type ConnectorMode, type PlatformMailEnvelope } from "@foundmill/connectors";
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
}

/** Only for mock sends in development and test: links signed with it are never honored anywhere else (ingest refuses them). */
export { DEV_PLATFORM_MAIL_SECRET };

/** Throws at boot when the domain is set outside development and test without a signing secret of 32+ characters. */
export function platformMailConfig(env: Pick<Env, "APP_ENV" | "PLATFORM_MAIL_DOMAIN" | "PLATFORM_MAIL_DAILY_CAP" | "PLATFORM_MAIL_DAILY_CEILING" | "PLATFORM_MAIL_SIGNING_SECRET" | "INGEST_PUBLIC_URL" | "INGEST_URL">): PlatformMailConfig {
  return {
    domain: platformMailDomain(env),
    dailyCap: env.PLATFORM_MAIL_DAILY_CAP,
    ceiling: env.PLATFORM_MAIL_DAILY_CEILING,
    signingSecret: platformMailSigningSecret(env),
    unsubscribeBase: (env.INGEST_PUBLIC_URL?.trim() || env.INGEST_URL).replace(/\/+$/, ""),
  };
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
} as const;

/** Counter keys: one per project and one for the whole deployment, in fixed UTC-day windows. */
export const platformMailDayKey = (businessId: string): string => `pm:${businessId}:day`;
export const PLATFORM_MAIL_CEILING_KEY = "pm:all:day";

const OWN_SENDER_STATUSES = new Set(["connected", "degraded"]);

export interface PreparedPlatformMail {
  envelope: PlatformMailEnvelope;
  localPart: string;
  recipientHash: string;
  /** Gives both counts back (the send did not go out). Idempotent. */
  release(): Promise<void>;
}

export type PlatformMailDecision = { ok: true; prepared: PreparedPlatformMail } | { ok: false; policyId: string; reason: string };

export interface PlatformMailDeps {
  db: Parameters<typeof repos.projectMail.ensure>[0];
  rateLimits: RateLimitStore;
  config: PlatformMailConfig | undefined;
  appEnv?: string;
}

const refuse = (policyId: string, reason: string): PlatformMailDecision => ({ ok: false, policyId, reason });

export async function preparePlatformMail(deps: PlatformMailDeps, input: { business: Pick<Business, "id" | "name" | "isDemo">; args: unknown; mode: ConnectorMode; now: number }): Promise<PlatformMailDecision> {
  const config = deps.config;
  const businessId = input.business.id;
  // 1. Switched on, and configured for where it runs.
  if (!config?.domain) return refuse(PLATFORM_MAIL_POLICY.off, PLATFORM_MAIL_REFUSALS.off);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = input.mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  if (!secret || (strict && !/^https:\/\//.test(config.unsubscribeBase))) return refuse(PLATFORM_MAIL_POLICY.unconfigured, PLATFORM_MAIL_REFUSALS.unconfigured);
  // A simulated send is never reported to a person's project on staging or production as if it went out.
  if (input.mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, input.business.isDemo)) return refuse(PLATFORM_MAIL_POLICY.simulated, PLATFORM_MAIL_REFUSALS.off);

  // 2. The founder's own SendGrid wins.
  const own = await repos.integrations.getByKey(deps.db, businessId, "sendgrid");
  if (own && own.archivedAt === null && OWN_SENDER_STATUSES.has(own.status)) return refuse(PLATFORM_MAIL_POLICY.own_sender, PLATFORM_MAIL_REFUSALS.own_sender);

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

  // 6 and 7. The project's day, then the deployment's. Outside development and test only a shared count caps anything.
  const cap = row.dailyCap ?? config.dailyCap;
  const projectKey = platformMailDayKey(businessId);
  const counted: string[] = [];
  const release = async () => {
    for (const key of counted.splice(0)) await deps.rateLimits.release?.(key, DAY_MS, input.now);
  };
  const shared = () => devStack || deps.rateLimits.durable === true;
  const project = await deps.rateLimits.hit(projectKey, DAY_MS, input.now);
  counted.push(projectKey);
  if (!shared()) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.store, PLATFORM_MAIL_REFUSALS.store_unavailable);
  }
  if (project.count > cap) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.daily_cap, PLATFORM_MAIL_REFUSALS.daily_cap(cap));
  }
  const all = await deps.rateLimits.hit(PLATFORM_MAIL_CEILING_KEY, DAY_MS, input.now);
  counted.push(PLATFORM_MAIL_CEILING_KEY);
  if (!shared()) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.store, PLATFORM_MAIL_REFUSALS.store_unavailable);
  }
  if (all.count > config.ceiling) {
    await release();
    return refuse(PLATFORM_MAIL_POLICY.ceiling, PLATFORM_MAIL_REFUSALS.ceiling);
  }

  const messageRef = randomUUID();
  const email = platformMailAddress(row.localPart, config.domain);
  const { projectName, fromName } = platformMailSenderName(input.business.name, row.localPart);
  return {
    ok: true,
    prepared: {
      localPart: row.localPart,
      recipientHash,
      release,
      envelope: {
        from: { email, name: fromName },
        projectName,
        messageRef,
        unsubscribeUrl: platformUnsubscribeUrl(config.unsubscribeBase, platformUnsubscribeToken(secret, businessId, recipientHash)),
        customArgs: platformMailCustomArgs(secret, businessId, messageRef, recipientHash),
      },
    },
  };
}
