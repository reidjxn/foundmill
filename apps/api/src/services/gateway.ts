/**
 * The api's calls into apps/gateway, the one service that reaches vendors and holds their keys (BUILD §2.1 rule 2,
 * SEC-14), behind a one-minute service JWT of the same shape as apps/gateway `signServiceToken` (`iss foundmill-gateway`,
 * `aud foundmill-gateway/service`, `svc api`). Connecting an integration and checking its health run there for every
 * connector that runs live (`connect`, `health`: GitHub's installation check, an API key the founder entered, an OAuth
 * consent link or code exchange; the gateway seals any secret the vendor hands back). So do a founder's own Anthropic key
 * check (`validateKey`, live models only) and Legal › Import's registry lookups (`registryLookup`, live registries only).
 * Credit top-ups open their Stripe Checkout session there too (`createCheckout`): STRIPE_SECRET_KEY lives only in the
 * gateway. The Commit screen's domain checks go there too (`checkDomains`): registries are reached only from the gateway.
 * So do the AI-generated faces of anthropomorphic agents (`generatePortrait`): the api sends a persona catalog key and a character style, never a
 * prompt, and OPENAI_API_KEY lives only in the gateway. So do Team call's speech and transcription (`synthesizeSpeech`,
 * `transcribeSpeech`): ELEVENLABS_API_KEY lives only in the gateway, and the api names a speech accent, never the vendor's
 * id. Choosing the Code tab's repository asks there whether the
 * installation reaches it and whether it is private (`repository`).
 */
import { randomUUID } from "node:crypto";
import { ELEVENLABS_SPEECH_TIMEOUT_MS, ELEVENLABS_TRANSCRIPTION_TIMEOUT_MS, OPENAI_IMAGES_GENERATION_TIMEOUT_MS } from "@foundmill/connectors";
import { AppError, type AgentStyle, type EmailNotificationKind, type IntegrationStatus, type NotificationKind, type SpeechAccentKey, type TeamCallAudioMime } from "@foundmill/shared";
import { SignJWT } from "jose";

export const TOKEN_ISSUER = "foundmill-gateway";
export const SERVICE_AUDIENCE = "foundmill-gateway/service";

/** What the gateway's connect hands back: the connector's IntegrationRecord without any secret. */
export interface GatewayIntegrationRecord {
  status: IntegrationStatus;
  scopes: string[];
  accountLabel: string | null;
  externalAccountId: string | null;
  config: Record<string, unknown>;
  expiresAt: string | null;
}

/** What the gateway's connect answers: the record without any secret, and where a secret the vendor handed back was sealed. */
export interface GatewayConnectResult {
  /** The mode the gateway ran the connector in (it decides what the row's status becomes). */
  mode: "mock" | "live";
  record: GatewayIntegrationRecord;
  /** The integration row the gateway stored a credential with; null when it wrote nothing. */
  integrationId: string | null;
  /** The sealed credential: its row id and a four-character hint (`redactSecret`); null when there was none. */
  credential: { stored: true; credentialId: string; hint: string } | null;
}

/** A founder's own Anthropic key, checked by the gateway with Anthropic (apps/gateway keys.ts `ValidateKeyResponse`). */
export interface GatewayKeyValidation {
  mode: "live";
  valid: boolean;
  reason: string | null;
  routedModels: { key: string; modelId: string; available: boolean }[];
  checkedAt: string;
}

/** The registries Legal › Import looks companies up in; the gateway runs only their lookup tools (registry-lookup.ts). */
export type GatewayRegistryKey = "companies_house" | "bolagsverket" | "opencorporates";

export interface GatewayRegistryLookupRequest {
  businessId: string;
  connector: GatewayRegistryKey;
  tool: string;
  args: Record<string, unknown>;
}

export interface GatewayRegistryLookup {
  mode: "mock" | "live";
  ok: boolean;
  /** The untrusted envelope of the registry's answer (`{ untrusted: true, content, source, notice }`). */
  data?: unknown;
  /** The tool's code and the registry's HTTP status, never the registry's own words. */
  error?: { code: string; status: number | null };
  costMinor: number;
  simulated?: true;
}

export interface GatewayHealth {
  ok: boolean;
  status: string;
  message?: string;
  [k: string]: unknown;
}

/** A credit top-up's checkout, as the api asks for it (apps/gateway billing.ts `CreateCheckoutRequest`). */
export interface GatewayCheckoutRequest {
  businessId: string;
  checkoutId: string;
  kind: "credits";
  amountMinor: number;
  currency: "USD";
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/** The session the gateway opened: Stripe's hosted page in live mode, the success URL itself in mock mode. */
export interface GatewayCheckout {
  mode: "mock" | "live";
  session: { id: string; url: string; expiresAt: string | null; amountTotalMinor: number; currency: "USD" };
}

/** One domain's answer, as the `domains` connector gives it (packages/connectors `DomainAnswer`). */
export interface GatewayDomainAnswer {
  domain: string;
  status: "available" | "taken" | "unknown";
  provenance: "Registry" | "DNS" | "Mock";
  /** True for the DNS fallback, which is an estimate. */
  estimate: boolean;
  checkedAt: string;
  registrar?: string;
  expires?: string;
  reason?: string;
}

/** One generated portrait, as the gateway answers (apps/gateway portraits.ts `PortraitResponse`). */
export interface GatewayPortrait {
  mime: "image/webp" | "image/png";
  /** The image bytes, base64. */
  base64: string;
  /** The image model that made it ("mock-portrait" for the placeholder). */
  model: string;
}

/** A GitHub repository as the business's installation sees it (apps/gateway code-repository.ts `RepoMetadata`). */
export interface GatewayRepository {
  /** GitHub's numeric id: what the Code tab pins. */
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

/**
 * A portrait takes 10 to 60 seconds to render, so its call waits longer than the others: longer than the connector waits
 * for OpenAI (`OPENAI_IMAGES_GENERATION_TIMEOUT_MS`, 120 s) plus room for the gateway's own work, so the api never gives
 * up on an image the gateway is still about to return (and pay for).
 */
export const PORTRAIT_TIMEOUT_MS = OPENAI_IMAGES_GENERATION_TIMEOUT_MS + 30_000;

/** One spoken agent turn, as the api asks for it (apps/gateway speech.ts `SynthesizeSpeechRequest`). */
export interface GatewaySynthesizeSpeechRequest {
  businessId: string;
  callId: string;
  /** The turn being spoken: only attributes the gateway's audit row. */
  turnId: string;
  speechAccent: SpeechAccentKey;
  text: string;
}

/** The spoken turn: MP3 from the vendor, or the mock's silent WAV with `simulated` (apps/gateway speech.ts). */
export interface GatewaySpeech {
  mode: "mock" | "live";
  mime: "audio/mpeg" | "audio/wav";
  base64: string;
  simulated: boolean;
  notice?: string;
  characters: number;
  /** An Estimate, in US cents. */
  costMinor: number;
}

export interface GatewayTranscribeSpeechRequest {
  businessId: string;
  callId: string;
  mime: TeamCallAudioMime;
  base64: string;
}

export interface GatewayTranscript {
  mode: "mock" | "live";
  text: string;
  simulated: boolean;
  notice?: string;
  durationSeconds: number;
  costMinor: number;
}

/** A spoken turn waits for the gateway a little longer than the gateway waits for ElevenLabs. */
export const SPEECH_CLIENT_TIMEOUT_MS = ELEVENLABS_SPEECH_TIMEOUT_MS + 5_000;
/** A recording takes longer to transcribe; the same margin over the connector's wait. */
export const TRANSCRIBE_CLIENT_TIMEOUT_MS = ELEVENLABS_TRANSCRIPTION_TIMEOUT_MS + 10_000;

/** One push notification to registered phones, as the api's notifier asks for it (apps/gateway push.ts `SendPushRequest`). */
export interface GatewayPushRequest {
  businessId: string;
  kind: NotificationKind;
  /** OneSignal subscription ids (`founder_devices.token`), at most 2,000. */
  subscriptionIds: string[];
  title: string;
  body: string;
  /** What the app routes on when the notification is tapped. */
  data: Record<string, string | number | boolean>;
  collapseKey?: string;
}

export interface GatewayPushResult {
  mode: "mock" | "live";
  /** The provider's notification id; empty when it accepted nothing. */
  id: string;
  /** Subscriptions the provider accepted it for (Estimate). */
  recipients: number;
  errors: string[];
}

/** The one email asking a page signup to confirm (apps/gateway follow-confirm.ts `ConfirmFollowRequest`). */
export interface GatewayConfirmFollowRequest {
  businessId: string;
  consentId: string;
  email: string;
  /** The random nonce reserved on the consent record (its sha256 is stored there). */
  nonce: string;
}

/** Sent (on the mock: simulated, nothing left), or not, and why; never an error for "not sent". */
export type GatewayConfirmFollowResult = { sent: true; simulated: boolean } | { sent: false; reason: string };

/** One email from Foundmill to one of its users (apps/gateway notify-email.ts `NotifyEmailRequest`): ids only. */
export type GatewayNotifyEmailRequest =
  | {
      userId: string;
      kind: EmailNotificationKind;
      businessId: string;
      /** A note for every kind the api asks for but `invitation_accepted`, which names the invitation that was accepted. */
      data: { inboxItemId: string; invitationId?: undefined; auditId?: undefined } | { invitationId: string; inboxItemId?: undefined; auditId?: undefined };
    }
  | {
      userId: string;
      /** An account-safety notice (security review P2-3; apps/gateway notify-founder-notice.ts): the audit entry it is about. */
      kind: "founder_notice";
      businessId: string;
      /** The one-click cancel this person's email carries, minted by the api (only its hash is stored). */
      data: { auditId: string; cancelToken?: string; inboxItemId?: undefined; invitationId?: undefined };
    };

/**
 * The same sender's email to an address rather than an account (`ADDRESS_EMAIL_KINDS`: an invitation): the gateway
 * reads the address from the invitation. Its link carries the one-time token only the api saw; it is sent here, and the
 * gateway checks it against the invitation's hash before it builds the link.
 */
export type GatewayAddressEmailRequest = { kind: "invitation"; data: { invitationId: string; token: string } };

/** Sent (on the mock: simulated), or not, with the gateway's reason and a plain sentence; never an error for "not sent". */
export type GatewayNotifyEmailResult = { sent: true; simulated: boolean; eventId: string | null; /** A founder notice: whether the email that went carried a one-click cancel. */ offersCancel?: boolean } | { sent: false; reason: string; message: string };

/** A Turnstile token to check for the idea box (apps/gateway turnstile.ts `TurnstileVerifyRequest`). */
export interface GatewayTurnstileRequest {
  token: string;
  remoteIp: string | null;
  hostname: string | null;
  /** The widget's action; Cloudflare must report the same. */
  action?: string | null;
}

/** Passed or not, why (a fixed word, never Cloudflare's), and whether the mock answered. */
export interface GatewayTurnstileResult {
  ok: boolean;
  reason: "ok" | "invalid" | "expired" | "hostname" | "action" | "unconfigured" | "unavailable";
  simulated: boolean;
}

/** The bot check waits at most this long (the gateway gives Cloudflare 5 s). */
export const TURNSTILE_CLIENT_TIMEOUT_MS = 7_000;

/**
 * One tool call through the gateway's generic path (`POST /v1/session-tokens`, then `POST /v1/call`), for work the api
 * runs for a business outside any agent session: the showcase video's clips on the house business (connector `runway`).
 * The connector is named by its key and the tool by its name, so nothing here imports a connector's code; the gateway
 * runs the policy, the founder's own key, the approval in Needs you and the audit, as for any agent's call.
 */
export interface GatewayToolCallRequest {
  businessId: string;
  /** The agent the call is made as (its grants and its state are checked at mint). */
  agentId: string;
  connector: string;
  tool: string;
  args: Record<string, unknown>;
  context?: { amountMinor?: number; currency?: string };
}

/** The gateway's policy outcome, as it answered. A transport or request error throws instead. */
export type GatewayToolCallOutcome =
  | { outcome: "allow"; result: { ok: boolean; data?: unknown; error?: { code?: string; message?: string }; simulated?: true; notice?: string }; auditId: string }
  | { outcome: "ask"; approvalId: string; reasons: string[] }
  | { outcome: "deny"; reasons: string[]; approvalId?: string }
  | { outcome: "rate_limited"; reasons: string[]; retryAfterSeconds: number };

/** A follow confirmation waits at most this long: the visitor's form is waiting on it. */
export const CONFIRM_FOLLOW_TIMEOUT_MS = 10_000;

export interface ApiGatewayClient {
  /** Connects a live integration: an App installation verified, a vendor's secret sealed by the gateway and never returned. */
  connect(businessId: string, connector: string, input: Record<string, unknown>): Promise<GatewayConnectResult>;
  health(businessId: string, connector: string): Promise<GatewayHealth>;
  /** A founder's own Anthropic key, checked with Anthropic (a one-token call, then the routed models); asked only with live models. */
  validateKey(businessId: string, apiKey: string): Promise<GatewayKeyValidation>;
  /** A company-registry lookup for Legal › Import; asked only when the registry runs live. */
  registryLookup(input: GatewayRegistryLookupRequest): Promise<GatewayRegistryLookup>;
  createCheckout(input: GatewayCheckoutRequest): Promise<GatewayCheckout>;
  /** Registry answers for up to eight domain names, on behalf of one founder (the gateway's rate-limit scope). */
  checkDomains(ownerKey: string, domains: string[]): Promise<GatewayDomainAnswer[]>;
  /**
   * The AI-generated face for one persona catalog key in one character style (humans when not given). The gateway builds
   * the prompt from the style and the key (a key outside the catalog is a 400 `unknown_persona`, a style outside
   * `AGENT_STYLES` a 400 `unknown_style`), so the api cannot send one. `businessId` only attributes the gateway's audit row.
   */
  generatePortrait(personaKey: string, businessId?: string, style?: AgentStyle): Promise<GatewayPortrait>;
  /**
   * Whether the business's GitHub installation reaches `owner/repo`, and its id and visibility (before it is chosen on
   * Development › Code). 404 when the installation cannot reach it, 409 when GitHub is not connected.
   */
  repository(businessId: string, owner: string, repo: string): Promise<{ mode: "mock" | "live"; repository: GatewayRepository }>;
  /** One push notification to the mobile app's phones (docs/mobile): the gateway holds the OneSignal keys and runs the connector. */
  sendPush(input: GatewayPushRequest): Promise<GatewayPushResult>;
  /** The follow confirmation email (package 1.6): fixed words, from the project's Foundmill address, on a service path. */
  confirmFollow(input: GatewayConfirmFollowRequest): Promise<GatewayConfirmFollowResult>;
  /**
   * Email from Foundmill to a person about their own project (packages 1.5 and 5.1): the gateway resolves the address,
   * re-checks the person, the note and the day's counts, builds the words and sends; the api's notify pass asks.
   */
  notifyEmail(input: GatewayNotifyEmailRequest): Promise<GatewayNotifyEmailResult>;
  /** The same sender (`POST /v1/notify/email`) to an address rather than an account: an invitation. Absent (test doubles): not sent. */
  addressEmail?(input: GatewayAddressEmailRequest): Promise<GatewayNotifyEmailResult>;
  /**
   * One agent turn spoken in a speech accent (Team call). Asked only when `elevenlabs` runs live; the gateway checks the
   * accent (400 `unknown_speech_accent`), the words (1 to 600 characters) and the business's day of spoken characters
   * (429 `speech_daily_limit`), and answers 503 `speech_unconfigured` without its key.
   */
  synthesizeSpeech(input: GatewaySynthesizeSpeechRequest): Promise<GatewaySpeech>;
  /** One recording of the founder transcribed (Team call). Asked only when `elevenlabs` runs live. */
  transcribeSpeech(input: GatewayTranscribeSpeechRequest): Promise<GatewayTranscript>;
  /**
   * One agent turn spoken as a stream (`POST /v1/speech/stream`): the gateway's `audio/mpeg` answer as it arrives, for
   * the api to pipe to the listener. Same checks as `synthesizeSpeech`; a refusal before the first byte is an AppError
   * with the gateway's code and status. Optional so test doubles need not stream.
   */
  streamSpeech?(input: GatewaySynthesizeSpeechRequest, signal?: AbortSignal): Promise<Response>;
  /** The idea box's bot check (apps/gateway turnstile.ts). Optional so test doubles need not carry it; the HTTP client always does. */
  verifyTurnstile?(input: GatewayTurnstileRequest): Promise<GatewayTurnstileResult>;
  /** One tool call on the gateway's generic path (`GatewayToolCallRequest`). Optional so test doubles need not carry it. */
  toolCall?(input: GatewayToolCallRequest): Promise<GatewayToolCallOutcome>;
}

export interface CreateApiGatewayClientOptions {
  url: string;
  /** `SESSION_TOKEN_SECRET`; null makes every call fail with 412 `config`. */
  secret: string | null;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export async function signApiServiceToken(secret: string): Promise<string> {
  return new SignJWT({ svc: "api" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(TOKEN_ISSUER).setAudience(SERVICE_AUDIENCE).setIssuedAt().setExpirationTime("60s").setJti(randomUUID()).sign(new TextEncoder().encode(secret));
}

export function createApiGatewayClient(opts: CreateApiGatewayClientOptions): ApiGatewayClient {
  const baseUrl = opts.url.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const post = async <T>(path: string, body: unknown, callTimeoutMs = timeoutMs): Promise<T> => {
    if (!opts.secret || opts.secret.length < 16) throw new AppError("config", "SESSION_TOKEN_SECRET is not set on the api, so it cannot call the gateway", 412);
    const token = await signApiServiceToken(opts.secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      throw new AppError("gateway_unreachable", `The gateway did not answer: ${(e as Error).message}`, 503);
    } finally {
      clearTimeout(timer);
    }
    const parsed = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok) {
      // The gateway's own refusals (forbidden installation, unconfigured App, GitHub unreachable) pass through as-is.
      const status = res.status >= 400 && res.status < 600 ? res.status : 502;
      throw new AppError(parsed?.error?.code ?? "gateway_error", parsed?.error?.message ?? `The gateway answered ${res.status}`, status);
    }
    if (!parsed) throw new AppError("gateway_error", "The gateway sent no body", 502);
    return parsed;
  };

  /** Like `post`, but answers the gateway's streamed body; the timeout covers only the wait for the first byte. */
  const stream = async (path: string, body: unknown, signal?: AbortSignal): Promise<Response> => {
    if (!opts.secret || opts.secret.length < 16) throw new AppError("config", "SESSION_TOKEN_SECRET is not set on the api, so it cannot call the gateway", 412);
    const token = await signApiServiceToken(opts.secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, SPEECH_CLIENT_TIMEOUT_MS));
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "audio/mpeg, application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      throw new AppError("gateway_unreachable", `The gateway did not answer: ${(e as Error).message}`, 503);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").startsWith("audio/")) {
      const parsed = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const status = !res.ok && res.status >= 400 && res.status < 600 ? res.status : 502;
      throw new AppError(parsed?.error?.code ?? "gateway_error", parsed?.error?.message ?? `The gateway answered ${res.status}`, status);
    }
    return res;
  };

  return {
    streamSpeech: (input, signal) => stream("/v1/speech/stream", input, signal),
    connect: (businessId, connector, input) => post<GatewayConnectResult>("/v1/integrations/connect", { businessId, connector, input }),
    health: async (businessId, connector) => (await post<{ health: GatewayHealth }>("/v1/integrations/health", { businessId, connector })).health,
    createCheckout: (input) => post<GatewayCheckout>("/v1/billing/checkout-sessions", input),
    checkDomains: async (ownerKey, domains) => (await post<{ results: GatewayDomainAnswer[] }>("/v1/domains/check", { ownerKey, domains })).results,
    generatePortrait: (personaKey, businessId, style) => post<GatewayPortrait>("/v1/personas/portrait", { personaKey, ...(style ? { style } : {}), ...(businessId ? { businessId } : {}) }, Math.max(timeoutMs, PORTRAIT_TIMEOUT_MS)),
    repository: (businessId, owner, repo) => post<{ mode: "mock" | "live"; repository: GatewayRepository }>("/v1/github/repository", { businessId, owner, repo }),
    sendPush: (input) => post<GatewayPushResult>("/v1/push/send", input),
    confirmFollow: (input) => post<GatewayConfirmFollowResult>("/v1/platform-mail/confirm-follow", input, Math.min(timeoutMs, CONFIRM_FOLLOW_TIMEOUT_MS)),
    verifyTurnstile: (input) => post<GatewayTurnstileResult>("/v1/turnstile/verify", input, Math.min(timeoutMs, TURNSTILE_CLIENT_TIMEOUT_MS)),
    notifyEmail: (input) => post<GatewayNotifyEmailResult>("/v1/notify/email", input, Math.min(timeoutMs, CONFIRM_FOLLOW_TIMEOUT_MS)),
    addressEmail: (input) => post<GatewayNotifyEmailResult>("/v1/notify/email", input, Math.min(timeoutMs, CONFIRM_FOLLOW_TIMEOUT_MS)),
    synthesizeSpeech: (input) => post<GatewaySpeech>("/v1/speech/synthesize", input, Math.max(timeoutMs, SPEECH_CLIENT_TIMEOUT_MS)),
    transcribeSpeech: (input) => post<GatewayTranscript>("/v1/speech/transcribe", input, Math.max(timeoutMs, TRANSCRIBE_CLIENT_TIMEOUT_MS)),
    validateKey: (businessId, apiKey) => post<GatewayKeyValidation>("/v1/keys/validate", { businessId, apiKey }),
    registryLookup: (input) => post<GatewayRegistryLookup>("/v1/registry/lookup", input),
    toolCall: async (input) => {
      const { token } = await post<{ token: string }>("/v1/session-tokens", { businessId: input.businessId, agentId: input.agentId, sessionId: null, allowedTools: [`${input.connector}:${input.tool}`], ttlSeconds: 120 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/v1/call`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ connector: input.connector, tool: input.tool, args: input.args, context: input.context ?? {} }), signal: controller.signal });
      } catch (e) {
        throw new AppError("gateway_unreachable", `The gateway did not answer: ${(e as Error).message}`, 503);
      } finally {
        clearTimeout(timer);
      }
      const parsed = (await res.json().catch(() => null)) as (GatewayToolCallOutcome & { error?: { code?: string; message?: string } }) | null;
      // A policy outcome comes with its own status (403 deny, 429 rate limited) and is an answer, not an error.
      if (parsed && typeof (parsed as { outcome?: unknown }).outcome === "string") return parsed;
      throw new AppError(parsed?.error?.code ?? "gateway_error", parsed?.error?.message ?? `The gateway answered ${res.status}`, res.status >= 400 && res.status < 600 ? res.status : 502);
    },
  };
}
