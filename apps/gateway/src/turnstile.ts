/**
 * `POST /v1/turnstile/verify` (the landing page's idea box, founder 2026-11-13; docs/IDEA_BOX.md): checks a Cloudflare
 * Turnstile token before the api drafts a card for a signed-out visitor. Only the api asks (service token `svc: api`).
 *
 * Live: Cloudflare's siteverify with the platform's secret (`TURNSTILE_SECRET_KEY`, set on the gateway only), the
 * visitor's address and an idempotency key, within 5 s. Mock (no secret, on a development or test stack only): the
 * token `mock-fail` fails, any other non-empty token passes, and the answer says it was simulated. With no secret on
 * staging or production the answer is `unconfigured`: the api then refuses to draft (the bot check is not optional).
 *
 * The answer is `{ ok, reason, simulated }`, never Cloudflare's own words: `reason` is one of a fixed set. Nothing is
 * logged but the outcome and Cloudflare's error codes.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GatewayDeps } from "./pipeline";

export const TURNSTILE_ROUTE = "/v1/turnstile/verify";
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The token Cloudflare's test keys and the mock both refuse (docs: "dummy token"). */
export const TURNSTILE_MOCK_FAIL_TOKEN = "mock-fail";
export const TURNSTILE_TIMEOUT_MS = 5_000;

export const TurnstileVerifyRequest = z.strictObject({
  /** The widget's response token (Cloudflare caps it at 2048 characters). */
  token: z.string().min(1).max(2048),
  /** The visitor's address as the api saw it; Cloudflare uses it as one more signal. */
  remoteIp: z.string().max(64).nullable().optional(),
  /** The hostname the widget must have run on (foundmill.com); unchecked when absent. */
  hostname: z.string().max(253).nullable().optional(),
});
export type TurnstileVerifyRequest = z.infer<typeof TurnstileVerifyRequest>;

export type TurnstileReason = "ok" | "invalid" | "expired" | "hostname" | "unconfigured" | "unavailable";
export interface TurnstileVerifyResponse {
  ok: boolean;
  reason: TurnstileReason;
  simulated: boolean;
}

export interface TurnstileConfig {
  /** The secret key; null when not set. */
  secret: string | null;
  /** For tests. */
  fetch?: typeof fetch;
}

const SiteverifyAnswer = z.object({ success: z.boolean(), "error-codes": z.array(z.string()).default([]), hostname: z.string().optional() });

const devStack = (appEnv: string | undefined) => appEnv === undefined || appEnv === "development" || appEnv === "test";

export async function verifyTurnstile(deps: Pick<GatewayDeps, "appEnv" | "log"> & { turnstile?: TurnstileConfig }, input: TurnstileVerifyRequest): Promise<TurnstileVerifyResponse> {
  const secret = deps.turnstile?.secret?.trim() || null;
  if (!secret) {
    if (!devStack(deps.appEnv)) {
      deps.log.warn({}, "turnstile check refused: TURNSTILE_SECRET_KEY is not set on the gateway");
      return { ok: false, reason: "unconfigured", simulated: false };
    }
    const ok = input.token !== TURNSTILE_MOCK_FAIL_TOKEN;
    return { ok, reason: ok ? "ok" : "invalid", simulated: true };
  }
  const body = new URLSearchParams({ secret, response: input.token, idempotency_key: randomUUID() });
  if (input.remoteIp) body.set("remoteip", input.remoteIp);
  const doFetch = deps.turnstile?.fetch ?? fetch;
  let answer: z.infer<typeof SiteverifyAnswer>;
  try {
    const res = await doFetch(TURNSTILE_SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
    answer = SiteverifyAnswer.parse(await res.json());
  } catch (err) {
    deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "turnstile siteverify unavailable");
    return { ok: false, reason: "unavailable", simulated: false };
  }
  if (!answer.success) {
    const codes = answer["error-codes"];
    deps.log.info({ codes }, "turnstile token refused");
    if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret")) return { ok: false, reason: "unconfigured", simulated: false };
    return { ok: false, reason: codes.includes("timeout-or-duplicate") ? "expired" : "invalid", simulated: false };
  }
  if (input.hostname && answer.hostname && answer.hostname !== input.hostname && answer.hostname !== `www.${input.hostname}`) {
    deps.log.info({ hostname: answer.hostname }, "turnstile token from another hostname");
    return { ok: false, reason: "hostname", simulated: false };
  }
  return { ok: true, reason: "ok", simulated: false };
}
