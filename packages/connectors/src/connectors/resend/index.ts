/**
 * Live Resend connector over the injected fetch (no SDK). The founder's own Resend account only: the key comes from the
 * connect form and then from `ctx.credential`; there is no platform key and `secrets` is never read. The key travels in
 * the Authorization header and nowhere else.
 *
 * NO WEBHOOKS IN THIS VERSION. Opt-outs through the unsubscribe link do reach the project's suppression list, because
 * the link is Foundmill's own (the gateway's signed one-click link in `ctx.unsubscribeUrl`, never an agent argument).
 * Bounces and spam complaints at Resend do not reach it yet (nothing ingests them); only what the host's `isSuppressed`
 * already knows is honored before a send. Resend's own suppression of a bounced address still applies on its side.
 */
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { assertNoneSuppressed } from "../sendgrid/tools";
import { resendMock } from "./mock";
import { assertContent, assertVerifiedFromDomain, assertVerifiedReplyTo, buildSendBody, idempotencyKeyFor, isVerifiedDomain, mapDomain, publicDomain, requireUnsubscribeUrl, RESEND_BASE_URL, RESEND_CONNECT_FIELDS, RESEND_KEY, RESEND_RATE_LIMITS, resendTools, type ResendDomainRaw } from "./tools";

const MACHINE_CODE = /^[a-z0-9_]{1,40}$/;

/** Resend keys start `re_`. Anything key-shaped, and the key in hand, is masked out of text. */
export const redactKeys = (text: string, secret?: string): string => {
  const masked = secret ? text.split(secret).join("re_…") : text;
  return masked.replace(/\bre_[A-Za-z0-9_*.-]+/g, "re_…");
};

const RESTRICTED_MESSAGE = "This Resend key can only send email, so your sending domain cannot be checked. Connect a key with Full access in Settings › Integrations (Resend: API Keys).";

export function createResendConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now, isSuppressed } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(RESEND_KEY, "the business's own Resend API key", "connect Resend in Settings › Integrations");

  /**
   * One call with the given key. A vendor failure is rebuilt from its status and, when Resend's error name is a short
   * machine code, that code; the vendor's free text is dropped (an error message reaches the agent outside the untrusted
   * envelope, and a vendor body could echo the key).
   */
  const call = async <T>(secret: string, method: "GET" | "POST", path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<T | undefined> => {
    const http = createHttp({ connectorKey: RESEND_KEY, baseUrl: RESEND_BASE_URL, fetch, headers: { authorization: bearer(secret) } });
    try {
      return await http.json<T>(method, path, opts);
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      const name = (e.body as { name?: unknown } | undefined)?.name;
      const code = typeof name === "string" && MACHINE_CODE.test(name) ? name : null;
      throw new VendorError(RESEND_KEY, e.httpStatus, `${method} ${path} → ${e.httpStatus}${code ? ` (${code})` : ""}`);
    }
  };

  const isRestricted = (e: unknown): boolean => e instanceof VendorError && e.httpStatus === 401 && e.message.includes("(restricted_api_key)");

  /** All domains on the account. A sending-only key is told apart from a bad key and explained in plain words. */
  const domains = async (secret: string) => {
    try {
      const res = await call<{ data?: ResendDomainRaw[] }>(secret, "GET", "/domains");
      return (res?.data ?? []).map(mapDomain).filter((d): d is NonNullable<typeof d> => d !== null);
    } catch (e) {
      if (isRestricted(e)) throw new AppError("restricted_api_key", RESTRICTED_MESSAGE, 401);
      throw e;
    }
  };

  return buildLiveConnector(
    {
      key: RESEND_KEY,
      displayName: "Resend",
      phase: 2,
      auth: { kind: "api_key" },
      tools: resendTools,
      rateLimits: RESEND_RATE_LIMITS,
      now,
      handlers: {
        list_domains: async (_a, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          return { items: (await domains(secret)).map(publicDomain) };
        },
        send_mail: async (mail, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const unsubscribeUrl = requireUnsubscribeUrl(ctx.unsubscribeUrl);
          // In this order, all before the send: the content, the sender's and reply-to domains, the suppression list.
          assertContent(mail);
          const verified = await domains(secret);
          assertVerifiedFromDomain(mail.from.email, verified);
          assertVerifiedReplyTo(mail.replyTo, verified);
          await assertNoneSuppressed([mail.to.email.toLowerCase()], async (email) => (isSuppressed ? await isSuppressed(ctx.businessId, email) : false));
          const res = await call<{ id?: unknown }>(secret, "POST", "/emails", { body: buildSendBody(mail, unsubscribeUrl), headers: { "Idempotency-Key": idempotencyKeyFor(ctx.businessId, mail) } });
          if (typeof res?.id !== "string" || !res.id) throw new VendorError(RESEND_KEY, 502, "POST /emails answered without an id");
          return { id: res.id, to: mail.to.email, from: mail.from.email, subject: mail.subject };
        },
      },
      connectFields: RESEND_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(RESEND_KEY, "apiKey", "Enter your Resend API key to connect Resend");
        let list;
        try {
          list = await domains(apiKey);
        } catch (e) {
          if (e instanceof AppError && e.code === "restricted_api_key") throw new ConnectInputError(RESEND_KEY, "apiKey", RESTRICTED_MESSAGE);
          throw e;
        }
        const verified = list.filter(isVerifiedDomain).map((d) => d.name);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: RESEND_KEY,
          status: verified.length ? "connected" : "degraded",
          scopes: ["mail.send", "domains.read"],
          accountLabel: verified.length ? verified.join(", ") : "Resend",
          externalAccountId: null,
          config: { verifiedDomains: verified },
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        const secret = credential?.secret;
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No Resend API key is connected" });
        try {
          const verified = (await domains(secret)).filter(isVerifiedDomain);
          return verified.length ? healthResult("connected", startedAt, { now, details: { verifiedDomains: verified.length } }) : healthResult("degraded", startedAt, { now, message: "no verified sending domain", details: { verifiedDomains: 0 } });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    resendMock,
  );
}

export { resendMock, createResendMock } from "./mock";
export { resendTools, RESEND_KEY, assertVerifiedFromDomain, idempotencyKeyFor, buildSendBody } from "./tools";
