/**
 * `POST /v1/platform-mail/booking` (founder, Nov 22, 2026): the emails a customer gets about their own booking, from
 * the project's Foundmill address: the confirmation, the reminder a day before, and the notice when the booking is
 * canceled or moved. Only the api and the orchestrator ask (the api right after it wrote the change; the orchestrator's
 * reminder pass). No agent tool reaches this and it needs no founder approval: each one answers the customer's own
 * booking and says only its facts.
 *
 * The caller sends ids and the kind, never any words and never an address: the subject and body are fixed
 * (`BOOKING_EMAIL` in @foundmill/shared/booking) around the booking's own facts, read here. In order:
 *
 *   1. platform mail switched on and configured (a mock send only where simulated results are allowed), and the key
 *      the manage link is signed under;
 *   2. the booking: this business's, with a customer, and in the state the kind speaks of (confirmed, or canceled for
 *      the cancellation notice; a reminder only before the start);
 *   3. the suppression list (the business's and the platform's);
 *   4. the project's address (`project_mail`) and that Foundmill has not paused it;
 *   5. booking's own day for the project and its own ceiling for the deployment (`BOOKING_MAIL` in
 *      @foundmill/config, on `pm:<id>:booking` and `pm:all:booking`): never the project's outreach day or the outbound
 *      ceiling, because these are replies to the customer's own action.
 *
 * Every "not sent" is an answer (`sent: false` with a reason), never an error: the booking stands whether or not its
 * email went out. No `mail.sent` event: this is not the project's outreach. The audit row carries the booking id and
 * the kind, never the address. Transactional (US CAN-SPAM): it never waits on the founders' postal address.
 */
import { z } from "zod";
import { APP_NAME, BOOKING_MAIL } from "@foundmill/config";
import { repos, showsBuiltOnMark } from "@foundmill/db";
import { builtOnWords, mockResultsAllowed, PLATFORM_BILLING_LIVE_KEY, PLATFORM_MAIL_SECRET_MIN_LENGTH, platformMailAddress } from "@foundmill/shared";
import { BOOKING_EMAIL, BOOKING_MAIL_KINDS, bookingTimeLabel, durationLabel } from "@foundmill/shared/booking";
import { bookingManageToken, bookingManageUrl, DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, PLATFORM_MAIL_KEY, platformMailCustomArgs, platformMailSenderName, platformUnsubscribeToken, platformUnsubscribeUrl, suppressionHashOfEmail, type ToolContext } from "@foundmill/connectors";
import { randomUUID } from "node:crypto";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { BOOKING_MAIL_CEILING_KEY, bookingMailDayKey, PLATFORM_MAIL_POLICY, takePlatformMailDay } from "./platform-mail";

export const BOOKING_MAIL_ROUTE = "/v1/platform-mail/booking";
/** The services that may ask: the api (a booking was made or changed) and the orchestrator (the reminder pass). */
export const BOOKING_MAIL_SERVICES: readonly string[] = ["api", "orchestrator"];

export const BookingMailRequest = z.strictObject({
  businessId: z.guid(),
  bookingId: z.guid(),
  kind: z.enum(BOOKING_MAIL_KINDS),
});
export type BookingMailRequest = z.infer<typeof BookingMailRequest>;

export type BookingMailNotSent = "off" | "unconfigured" | "simulated" | "not_found" | "wrong_state" | "suppressed" | "paused" | "daily_cap" | "ceiling" | "store" | "vendor";
export type BookingMailResponse = { sent: true; simulated: boolean } | { sent: false; reason: BookingMailNotSent };

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const POLICY_REASON: Record<string, BookingMailNotSent> = { [PLATFORM_MAIL_POLICY.daily_cap]: "daily_cap", [PLATFORM_MAIL_POLICY.ceiling]: "ceiling", [PLATFORM_MAIL_POLICY.store]: "store" };

export async function sendBookingMail(deps: GatewayDeps, input: BookingMailRequest, service: string): Promise<BookingMailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const notSent = async (reason: BookingMailNotSent): Promise<BookingMailResponse> => {
    deps.log.info({ businessId: input.businessId, bookingId: input.bookingId, kind: input.kind, reason }, "booking email not sent");
    return { sent: false, reason };
  };
  // 1. Switched on and configured for where it runs.
  if (!config?.domain) return notSent("off");
  const mode = modeFor(deps, PLATFORM_MAIL_KEY);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  const appUrl = config.appUrl ?? (strict ? null : "http://localhost:3000");
  if (!secret || !config.bookingLinkSecret || !appUrl || (strict && (!/^https:\/\//.test(config.unsubscribeBase) || !/^https:\/\//.test(appUrl)))) return notSent("unconfigured");
  const business = await repos.businesses.get(deps.db, input.businessId).catch(() => null);
  if (!business) return notSent("not_found");
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, business.isDemo)) return notSent("simulated");

  // 2. The booking, in the state the kind speaks of.
  const booking = await repos.booking.get(deps.db, input.businessId, input.bookingId);
  if (!booking || !booking.customerEmail || !booking.customerName) return notSent("not_found");
  const wanted = input.kind === "canceled" ? "canceled" : "confirmed";
  if (booking.status !== wanted || (input.kind === "reminder" && booking.startsAt <= now)) return notSent("wrong_state");
  const [service_, setup, page] = await Promise.all([repos.booking.service(deps.db, input.businessId, booking.serviceId), repos.booking.setup(deps.db, input.businessId), repos.pages.get(deps.db, input.businessId)]);
  if (!service_ || !setup.settings || !page) return notSent("not_found");

  // 3. Never to an address that asked not to be emailed, or bounced.
  const email = booking.customerEmail.trim().toLowerCase();
  const emailHash = suppressionHashOfEmail(email);
  if (await repos.channels.isSuppressed(deps.db, input.businessId, { emailHash })) return notSent("suppressed");

  // 4. The project's address, kept once chosen.
  const row = await repos.projectMail.ensure(deps.db, input.businessId);
  if (row.status !== "active") return notSent("paused");

  // 5. Booking's own day and ceiling, never the project's outreach day or the outbound ceiling.
  const counted = await takePlatformMailDay(deps, {
    businessId: input.businessId,
    cap: config.bookingCap ?? BOOKING_MAIL.dailyCap,
    ceiling: config.bookingCeiling ?? BOOKING_MAIL.dailyCeiling,
    devStack,
    now: now.getTime(),
    keys: { project: bookingMailDayKey(input.businessId), all: BOOKING_MAIL_CEILING_KEY },
  });
  if (!counted.ok) return notSent(POLICY_REASON[counted.policyId] ?? "store");

  const messageRef = randomUUID();
  const { projectName, fromName } = platformMailSenderName(business.name, row.localPart);
  // The customer reads the time in their own zone (kept when they booked), else in the founder's.
  const when = bookingTimeLabel(booking.startsAt, booking.visitorTimeZone ?? setup.settings.timeZone);
  const foot = (await showsBuiltOnMark(deps.db, business, { paidEntry: deps.paidEntry === true, live: modeFor(deps, PLATFORM_BILLING_LIVE_KEY) === "live" })) ? builtOnWords(APP_NAME).foot(projectName) : null;
  const facts = {
    projectName,
    serviceName: service_.name,
    when,
    duration: durationLabel(service_.durationMin),
    mode: service_.mode,
    // A canceled booking has nothing left to manage: its email links to the booking page, to pick another time.
    manageUrl: input.kind === "canceled" ? `${appUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(page.slug)}/book` : bookingManageUrl(appUrl, page.slug, bookingManageToken(config.bookingLinkSecret, booking.id)),
    ...(booking.canceledBy === "customer" || booking.canceledBy === "founder" ? { canceledBy: booking.canceledBy } : {}),
    foot,
  };
  const ctx: ToolContext = {
    businessId: input.businessId,
    agentId: NIL_ID,
    sessionId: NIL_ID,
    integration: mockIntegrationRecord(PLATFORM_MAIL_KEY, input.businessId),
    log: deps.log,
    mode,
    platformMail: {
      from: { email: platformMailAddress(row.localPart, config.domain), name: fromName },
      projectName,
      messageRef,
      unsubscribeUrl: platformUnsubscribeUrl(config.unsubscribeBase, platformUnsubscribeToken(secret, input.businessId, emailHash)),
      customArgs: platformMailCustomArgs(secret, input.businessId, messageRef, emailHash),
      // About the customer's own booking and nothing else: transactional, never waiting on the postal address.
      commercial: false,
    },
  };
  const connector = deps.registry.get(PLATFORM_MAIL_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_mail", { to: { email, name: booking.customerName }, subject: BOOKING_EMAIL.subject(input.kind, facts), text: BOOKING_EMAIL.text(input.kind, facts) }, ctx);
  } catch (e) {
    if (isConfigError(e)) {
      await counted.release();
      return notSent("unconfigured");
    }
    throw e;
  }
  if (!result.ok) {
    // A definite refusal sent nothing and is given back; a timeout or a 5xx may have gone out and stays counted.
    if (vendorRefusedOutright(result.error)) await counted.release();
    return notSent("vendor");
  }
  await repos.audit
    .append(deps.db, input.businessId, { actorKind: "system", action: "gateway.platform_mail.booking", target: { kind: "booking", id: booking.id }, details: { service, kind: input.kind, mode, simulated: mode === "mock", fromLocalPart: row.localPart, emailHashPrefix: emailHash.slice(0, 12), messageRef } })
    .catch((e: unknown) => deps.log.warn({ businessId: input.businessId, reason: e instanceof Error ? e.name : "unknown" }, "booking email audit not written"));
  return { sent: true, simulated: mode === "mock" };
}
