/**
 * founder.email.sendLink (WP-03 T3): a person on a small screen who meets a desktop-only page asks for an email with a
 * link to it, to open on a computer. The api sends only the signed-in person's own id and the path (`isContinuePath`,
 * checked by the input and again by the gateway); the gateway reads the address, counts and sends
 * (apps/gateway notify-account-email.ts, `continue_link`).
 *
 * Never reported as sent unless it was: a simulated send (mock mode in development and test) answers
 * `{ sent: false, reason: "simulated" }`, a gateway without the method (test doubles) `"off"`, and a gateway that did not
 * answer `"vendor"`; the screen then offers Copy link. `email` is the signed-in address, returned only when it went, for
 * "Sent. Check <email>.".
 */
import type { NotifyEmailNotSent } from "@foundmill/shared";
import { AppError } from "@foundmill/shared";
import type { Context } from "../context";

export interface SendLinkAnswer {
  sent: boolean;
  reason: NotifyEmailNotSent | null;
  email: string | null;
}

export async function sendContinueLink(ctx: Context & { userId: string }, path: string): Promise<SendLinkAnswer> {
  if (!ctx.gateway.accountEmail) return { sent: false, reason: "off", email: null };
  try {
    const answer = await ctx.gateway.accountEmail({ kind: "continue_link", userId: ctx.userId, data: { path } });
    if (answer.sent && !answer.simulated) return { sent: true, reason: null, email: ctx.email ?? null };
    const reason = (answer.sent ? "simulated" : answer.reason) as NotifyEmailNotSent;
    ctx.log.info({ reason }, "continue link not sent");
    return { sent: false, reason, email: null };
  } catch (e) {
    ctx.log.warn({ code: e instanceof AppError ? e.code : "unknown" }, "continue link not sent: the gateway did not answer");
    return { sent: false, reason: "vendor", email: null };
  }
}
