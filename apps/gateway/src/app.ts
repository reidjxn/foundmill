/**
 * The gateway HTTP surface (docs/ARCHITECTURE.md §9). `createGatewayApp(deps)` returns a Hono app with no
 * listener so tests can run it on an ephemeral port and `index.ts` can bind it to PORT / GATEWAY_PORT.
 *
 *   GET  /health                   liveness + what this replica runs (mode, connectors, policy, vault)
 *   GET  /v1/connectors            catalogue: phase, auth kind, tools, policyHints (public within the private network)
 *   POST /v1/session-tokens        service JWT → session JWT for one agent session
 *   POST /v1/integrations/connect  service JWT (api) → connect a business's integration: App installations verified, a vendor's secret sealed here (integrations.ts)
 *   POST /v1/integrations/health   service JWT (api) → that integration's health check (integrations.ts)
 *   POST /v1/keys/validate         service JWT (api) → a founder's own Anthropic key checked with Anthropic, never logged or echoed (keys.ts)
 *   POST /v1/registry/lookup       service JWT (api) → an allow-listed company-registry lookup for Legal › Import (registry-lookup.ts)
 *   POST /v1/billing/checkout-sessions  service JWT (api) → a Stripe Checkout session on the platform account (billing.ts)
 *   POST /v1/domains/check         service JWT (api) → registry answers for up to 8 domain names (domains.ts)
 *   POST /v1/personas/portrait     service JWT (api) → the AI-generated portrait of one persona catalog key in one character style (portraits.ts)
 *   POST /v1/speech/synthesize     service JWT (api) → one agent turn spoken in a speech accent, for Team call (speech.ts)
 *   POST /v1/speech/transcribe     service JWT (api) → one recording of the founder transcribed, for Team call (speech.ts)
 *   POST /v1/push/send             service JWT (api) → one push notification to registered phones of the mobile app (push.ts)
 *   POST /v1/turnstile/verify              service JWT (api) → the idea box's bot check (turnstile.ts)
 *   POST /v1/platform-mail/confirm-follow  service JWT (api) → the one email asking a page signup to confirm (follow-confirm.ts)
 *   POST /v1/notify/email          service JWT (api, orchestrator) → one email from Foundmill to one of its users about their own project (notify-email.ts; an invitation: notify-address-email.ts; a founder notice: notify-founder-notice.ts; the waitlist's place is open: notify-account-email.ts)
 *   POST /v1/call                  session JWT → the pipeline (allow / ask / deny / rate_limited)
 *   POST /v1/github/archive        session JWT → the Code-tab repository's tarball for a code session's checkout (archive.ts)
 *   POST /v1/github/repository     service JWT (api) → a repository's id and visibility, before it is chosen on the Code tab (code-repository.ts)
 *   ALL  /mcp/:connector           session JWT → that connector's tools as an MCP streamable-HTTP server
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError, z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { AppError, UnauthorizedError } from "@foundmill/shared";
import { repos } from "@foundmill/db";
import { cedarVersion, getPolicyEngine } from "@foundmill/policy";
import { bearerToken, mintSessionToken, sessionKey, verifyServiceToken, verifySessionToken, type ServiceToken, type SessionToken } from "./tokens";
import { GatewayError, safeError, type GatewayDeps } from "./pipeline";
import { connectIntegration, integrationHealth } from "./integrations";
import { KEYS_VALIDATE_ROUTE, ValidateKeyRequest, validateFounderKey } from "./keys";
import { lookupRegistry, REGISTRY_LOOKUP_ROUTE, RegistryLookupRequest } from "./registry-lookup";
import { CreateCheckoutRequest, createPlatformCheckout } from "./billing";
import { CheckDomainsRequest, checkDomains } from "./domains";
import { generatePortrait, PortraitRequest } from "./portraits";
import { sendPush, SendPushRequest } from "./push";
import { MAX_TRANSCRIBE_BODY_BYTES, SPEECH_STREAM_ROUTE, SPEECH_SYNTHESIZE_ROUTE, SPEECH_TRANSCRIBE_ROUTE, streamSpeech, SynthesizeSpeechRequest, synthesizeSpeech, TranscribeSpeechRequest, transcribeSpeech } from "./speech";
import { CONFIRM_FOLLOW_ROUTE, ConfirmFollowRequest, sendFollowConfirmation } from "./follow-confirm";
import { TURNSTILE_ROUTE, TurnstileVerifyRequest, verifyTurnstile } from "./turnstile";
import { NOTIFY_EMAIL_ROUTE, NotifyEmailRequest, sendNotifyEmail } from "./notify-email";
import { AddressEmailRequest, isAddressEmailKind, sendAddressEmail } from "./notify-address-email";
import { AccountEmailRequest, isAccountEmailKind, sendAccountEmail } from "./notify-account-email";
import { FounderNoticeRequest, isAccountSafetyKind, sendFounderNotice } from "./notify-founder-notice";
import { handleMcpRequest } from "./mcp";
import { ARCHIVE_ROUTE, ArchiveRequest, routeOnlyCall, serveArchive } from "./archive";
import { checkRepository, REPOSITORY_CHECK_ROUTE, RepositoryCheckRequest } from "./code-repository";
import { callerTrace, tracedToolCall } from "./tracing";
import { toCandidates } from "./recipients";
import { STATE_ERROR_CODES, stateDenial } from "./state";
import { CallRequest, ConnectIntegrationRequest, IntegrationHealthRequest, MintSessionTokenRequest, type GatewayErrorBody, type HealthResponse, type MintSessionTokenResponse } from "./types";
import { DEFAULT_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS } from "./config";

export interface GatewayAppOptions {
  sessionTokenSecret: string;
  sessionTokenTtlSeconds?: number;
  sessionTokenMaxTtlSeconds?: number;
  /** For `/health`: the rate-limit store in use (a function reads it per request; memory while a Redis store falls back). */
  rateLimitStoreKind?: "memory" | "redis" | (() => "memory" | "redis");
  /** For `/health`: whether the database answered at boot (see db-boot.ts). Defaults to true. */
  dbReady?: () => boolean;
}

/** Largest body per route (see the limits in createGatewayApp). */
export const MAX_CALL_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_SERVICE_BODY_BYTES = 1024 * 1024;

type Variables = { session: SessionToken; service: ServiceToken };
export type GatewayApp = Hono<{ Variables: Variables }>;

const errorBody = (code: string, message: string, details?: unknown): GatewayErrorBody => ({ error: { code, message, ...(details !== undefined ? { details } : {}) } });

export function createGatewayApp(deps: GatewayDeps, options: GatewayAppOptions): GatewayApp {
  const app = new Hono<{ Variables: Variables }>();
  const now = deps.now ?? (() => new Date());
  const secret = options.sessionTokenSecret;
  const defaultTtl = options.sessionTokenTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const maxTtl = options.sessionTokenMaxTtlSeconds ?? MAX_SESSION_TTL_SECONDS;

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json(errorBody("validation", "Invalid request", err.issues), 400);
    if (err instanceof AppError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) deps.log.error({ err: safeError(err), code: err.code }, "gateway request failed");
      return c.json(errorBody(err.code, err.message, status < 500 ? err.details : undefined), status as 400);
    }
    // Never the error object: a failed query carries its parameters (tool arguments) and would put them in the log.
    deps.log.error({ err: safeError(err) }, "unhandled gateway error");
    return c.json(errorBody("internal", "Internal error"), 500);
  });

  app.notFound((c) => c.json(errorBody("not_found", `No route for ${c.req.method} ${c.req.path}`), 404));

  // Request bodies are bounded before anything parses them: a direct call can carry one commit_files push (10 MB of
  // files, base64 in JSON), an agent's MCP call far less, the service routes a few kilobytes.
  const limit = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => c.json(errorBody("payload_too_large", `Request body is larger than ${Math.round(maxSize / 1024)} KB`), 413) });
  app.use("/v1/call", limit(MAX_CALL_BODY_BYTES));
  app.use(ARCHIVE_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  app.use("/mcp/*", limit(MAX_MCP_BODY_BYTES));
  app.use("/v1/session-tokens", limit(MAX_SERVICE_BODY_BYTES));
  app.use("/v1/integrations/*", limit(MAX_SERVICE_BODY_BYTES));
  app.use("/v1/billing/*", limit(MAX_SERVICE_BODY_BYTES));
  app.use("/v1/domains/*", limit(MAX_SERVICE_BODY_BYTES));
  app.use("/v1/personas/*", limit(MAX_SERVICE_BODY_BYTES));
  app.use("/v1/push/*", limit(MAX_SERVICE_BODY_BYTES));
  app.use(SPEECH_SYNTHESIZE_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  app.use(SPEECH_STREAM_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  // A recording of up to 8 MiB travels as base64 in JSON.
  app.use(SPEECH_TRANSCRIBE_ROUTE, limit(MAX_TRANSCRIBE_BODY_BYTES));
  app.use(CONFIRM_FOLLOW_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  app.use(NOTIFY_EMAIL_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  app.use(KEYS_VALIDATE_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  app.use(REGISTRY_LOOKUP_ROUTE, limit(MAX_SERVICE_BODY_BYTES));
  app.use(REPOSITORY_CHECK_ROUTE, limit(MAX_SERVICE_BODY_BYTES));

  app.get("/health", (c) => {
    const engine = getPolicyEngine();
    const db = options.dbReady ? options.dbReady() : true;
    const body: HealthResponse = {
      ok: db,
      service: "gateway",
      app: APP_NAME,
      db,
      mode: deps.mode,
      liveConnectors: [...(deps.liveConnectors ?? [])],
      connectors: deps.registry.keys().length,
      policy: { cedar: cedarVersion(), policies: Object.keys(engine.policySet.byId).length },
      vault: deps.vault?.kind ?? "none",
      rateLimitStore: typeof options.rateLimitStoreKind === "function" ? options.rateLimitStoreKind() : (options.rateLimitStoreKind ?? "memory"),
      time: now().toISOString(),
    };
    // Readiness for Railway's healthcheck (railway/gateway.toml): 503 while the database is unavailable.
    return c.json(body, db ? 200 : 503);
  });

  app.get("/v1/connectors", (c) => c.json({ mode: deps.mode, connectors: deps.registry.catalogue(deps.mode) }));

  // --- service auth -------------------------------------------------------------------------------------------
  const requireService = async (c: { req: { header(name: string): string | undefined }; set(key: "service", value: ServiceToken): void }, next: () => Promise<void>) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) throw new UnauthorizedError("A service Bearer token is required");
    c.set("service", await verifyServiceToken(secret, token));
    await next();
  };
  app.use("/v1/session-tokens", requireService);
  app.use("/v1/integrations/*", requireService);
  // Connecting an integration is the api's job alone (it checked settings administration and the founder's signed state).
  app.use("/v1/integrations/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api connects integrations", 403);
    await next();
  });
  // Foundmill's own billing: only the api opens a checkout (after its owner check).
  app.use("/v1/billing/*", requireService);
  app.use("/v1/billing/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api opens checkouts", 403);
    await next();
  });

  // A founder's own Anthropic key, checked before Settings › Keys stores it (keys.ts), and Legal › Import's registry
  // lookups (registry-lookup.ts): the api asks; the gateway reaches Anthropic and the registries (SEC-14).
  for (const route of [KEYS_VALIDATE_ROUTE, REGISTRY_LOOKUP_ROUTE]) {
    app.use(route, requireService);
    app.use(route, async (c, next) => {
      if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api asks for this", 403);
      await next();
    });
  }
  app.post(KEYS_VALIDATE_ROUTE, async (c) => {
    // Never the Zod issues: they would put the pasted key back in the answer.
    const parsed = ValidateKeyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError("validation", "Send a business id and a key of at most 400 characters", 400);
    return c.json(await validateFounderKey(deps, parsed.data, c.var.service.svc, deps.validateModelKey));
  });
  app.post(REGISTRY_LOOKUP_ROUTE, async (c) => c.json(await lookupRegistry(deps, RegistryLookupRequest.parse(await c.req.json()), c.var.service.svc)));

  // Domain availability for the Commit screen: the api asks for a signed-in founder; the gateway reaches the registries.
  app.use("/v1/domains/*", requireService);
  app.use("/v1/domains/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api checks domains", 403);
    await next();
  });

  // Faces of anthropomorphic agents: the api asks for one catalog key in one character style; the gateway builds the prompt and holds OPENAI_API_KEY.
  app.use("/v1/personas/*", requireService);
  app.use(REPOSITORY_CHECK_ROUTE, requireService);
  app.use("/v1/personas/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api asks for persona portraits", 403);
    await next();
  });

  app.post("/v1/personas/portrait", async (c) => c.json(await generatePortrait(deps, PortraitRequest.parse(await c.req.json()), c.var.service.svc)));

  // Speech for Team call: only the api asks; the gateway holds ELEVENLABS_API_KEY and maps the speech accent to the vendor's id (speech.ts).
  app.use("/v1/speech/*", requireService);
  app.use("/v1/speech/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api asks for speech", 403);
    await next();
  });
  app.post(SPEECH_SYNTHESIZE_ROUTE, async (c) => {
    // Never the Zod issues: they could quote the words of a turn.
    const parsed = SynthesizeSpeechRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError("validation", "Send a business id, a call id, a turn id, a speech accent and the words", 400);
    return c.json(await synthesizeSpeech(deps, parsed.data, c.var.service.svc));
  });
  app.post(SPEECH_STREAM_ROUTE, async (c) => {
    const parsed = SynthesizeSpeechRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError("validation", "Send a business id, a call id, a turn id, a speech accent and the words", 400);
    return streamSpeech(deps, parsed.data, c.var.service.svc, c.req.raw.signal);
  });
  app.post(SPEECH_TRANSCRIBE_ROUTE, async (c) => {
    const parsed = TranscribeSpeechRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError("validation", "Send a business id, a call id, the recording's type and the recording", 400);
    return c.json(await transcribeSpeech(deps, parsed.data, c.var.service.svc));
  });

  // Push to the mobile app's phones: the api's notifier decided who gets what; the gateway holds the OneSignal keys.
  app.use("/v1/push/*", requireService);
  app.use("/v1/push/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api sends push notifications", 403);
    await next();
  });
  app.post("/v1/push/send", async (c) => c.json(await sendPush(deps, SendPushRequest.parse(await c.req.json()), c.var.service.svc)));

  // The idea box's bot check (docs/IDEA_BOX.md): only the api asks, before it drafts a card for a signed-out visitor.
  app.use(TURNSTILE_ROUTE, requireService);
  app.use(TURNSTILE_ROUTE, async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api checks a Turnstile token", 403);
    await next();
  });
  app.post(TURNSTILE_ROUTE, async (c) => {
    const parsed = TurnstileVerifyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError("validation", "Send a Turnstile token", 400);
    return c.json(await verifyTurnstile(deps, parsed.data));
  });

  // A follow confirmation (package 1.6): only the api asks, right after a signup on a public page (follow-confirm.ts).
  app.use(CONFIRM_FOLLOW_ROUTE, requireService);
  app.use(CONFIRM_FOLLOW_ROUTE, async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api asks for a follow confirmation", 403);
    await next();
  });
  app.post(CONFIRM_FOLLOW_ROUTE, async (c) => {
    // Never the Zod issues: they would put the address back in the answer and the log.
    const parsed = ConfirmFollowRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new GatewayError("validation", "Send a business id, a consent id, an address and the nonce", 400);
    return c.json(await sendFollowConfirmation(deps, parsed.data, c.var.service.svc));
  });

  // Foundmill's own email to one of its users (packages 1.5 and 5.1), the one sender of every kind: the api's notify
  // pass asks for a waiting decision, the orchestrator's notify sweep for the rest (notify-email.ts).
  app.use(NOTIFY_EMAIL_ROUTE, requireService);
  app.use(NOTIFY_EMAIL_ROUTE, async (c, next) => {
    if (c.var.service.svc !== "api" && c.var.service.svc !== "orchestrator") throw new GatewayError("forbidden_service", "Only the api and the orchestrator ask for an email to a person", 403);
    await next();
  });
  app.post(NOTIFY_EMAIL_ROUTE, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    // The same sender to an address rather than an account (an invitation): the api's only.
    if (isAddressEmailKind((body as { kind?: unknown } | null)?.kind)) {
      if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api asks for an email to an address", 403);
      const parsed = AddressEmailRequest.safeParse(body);
      if (!parsed.success) throw new GatewayError("validation", "Send a kind of email and the ids (and the token) that kind needs", 400);
      return c.json(await sendAddressEmail(deps, parsed.data, c.var.service.svc));
    }
    // An email to an account about the account itself (the waitlist's place is open): the orchestrator's only.
    if (isAccountEmailKind((body as { kind?: unknown } | null)?.kind)) {
      if (c.var.service.svc !== "orchestrator") throw new GatewayError("forbidden_service", "Only the orchestrator asks for an email about an account", 403);
      const parsed = AccountEmailRequest.safeParse(body);
      if (!parsed.success) throw new GatewayError("validation", "Send a kind of email, a user id and the ids that kind needs", 400);
      return c.json(await sendAccountEmail(deps, parsed.data, c.var.service.svc));
    }
    // An account-safety notice (a founder's role lowered, a founder removed, deletion asked for or canceled): the api's only.
    if (isAccountSafetyKind((body as { kind?: unknown } | null)?.kind)) {
      if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api asks for a founder notice", 403);
      const notice = FounderNoticeRequest.safeParse(body);
      if (!notice.success) throw new GatewayError("validation", "Send a user id, the kind, a business id and the audit entry's id", 400);
      return c.json(await sendFounderNotice(deps, notice.data, c.var.service.svc));
    }
    const parsed = NotifyEmailRequest.safeParse(body);
    if (!parsed.success) throw new GatewayError("validation", "Send a user id, a kind of email, a business id and the ids that kind needs", 400);
    return c.json(await sendNotifyEmail(deps, parsed.data, c.var.service.svc));
  });

  app.post("/v1/domains/check", async (c) => c.json(await checkDomains(deps, CheckDomainsRequest.parse(await c.req.json()))));

  app.post("/v1/billing/checkout-sessions", async (c) => {
    const input = CreateCheckoutRequest.parse(await c.req.json());
    return c.json(await createPlatformCheckout(deps, input, c.var.service.svc), 201);
  });

  app.post("/v1/session-tokens", async (c) => {
    const input = MintSessionTokenRequest.parse(await c.req.json());
    const ttl = Math.min(maxTtl, input.ttlSeconds ?? defaultTtl);
    const { ttlSeconds: _ttl, untrusted, ...claims } = input;
    // The business and the agent must exist: a token can only be minted for a real session of a real club.
    const business = await repos.businesses.get(deps.db, claims.businessId, { includeArchived: true }).catch(() => {
      throw new GatewayError("business_not_found", `business ${claims.businessId} is not available to this gateway`, 404);
    });
    const agent = await repos.agents.get(deps.db, claims.businessId, claims.agentId).catch(() => {
      throw new GatewayError("agent_not_found", `agent ${claims.agentId} is not in business ${claims.businessId}`, 404);
    });
    // ...and so must the session: usage, approvals and audit rows reference it, so a made-up id would let a vendor
    // action run and then fail on bookkeeping. A call outside any agent session says so with `sessionId: null`.
    if (claims.sessionId !== null) {
      const session = await repos.agents.getSession(deps.db, claims.businessId, claims.sessionId).catch(() => {
        throw new GatewayError("session_not_found", `session ${claims.sessionId} is not a session of business ${claims.businessId}; mint with sessionId null for a call outside an agent session`, 404);
      });
      if (session.agentId !== claims.agentId) throw new GatewayError("session_agent_mismatch", `session ${claims.sessionId} belongs to another agent`, 403);
    }
    // ...and be allowed to work (SEC-1): no token for an archived club, a released agent or a paused one.
    const denial = stateDenial(business, agent);
    if (denial) {
      await repos.audit.append(deps.db, claims.businessId, {
        actorKind: "system",
        action: "gateway.session_token.refused",
        target: { agentId: claims.agentId, sessionId: claims.sessionId },
        details: { service: c.var.service.svc, policyIds: [denial.policyId], reasons: denial.reasons, allowedTools: claims.allowedTools },
      });
      throw new GatewayError(STATE_ERROR_CODES[denial.policyId], denial.reasons[0] ?? denial.policyId, 403, { policyIds: [denial.policyId] });
    }
    // Recipients found in what an earlier session left behind are untrusted here from the first call (§9.8 step 4); the
    // token records that a seed exists, so a replica without it fails closed.
    const minted = await mintSessionToken(secret, { ...claims, untrustedSeeded: claims.untrustedSeeded || !!untrusted }, ttl, now);
    // Keyed by the session, or by the token when the call has none (an import, a plan action, a Source Watcher read).
    const seeded = untrusted ? await deps.recipients.seed(claims.businessId, sessionKey({ sessionId: claims.sessionId, jti: minted.jti }), toCandidates(untrusted), untrusted.all) : 0;
    await repos.audit.append(deps.db, claims.businessId, {
      actorKind: "system",
      action: "gateway.session_token.minted",
      target: { agentId: claims.agentId, sessionId: claims.sessionId },
      details: { service: c.var.service.svc, tokenId: minted.jti, allowedTools: claims.allowedTools, kitMode: claims.kitMode, expiresAt: minted.expiresAt, ...(untrusted ? { untrustedSeeded: seeded, untrustedAll: untrusted.all } : {}) },
    });
    const body: MintSessionTokenResponse = { token: minted.token, expiresAt: minted.expiresAt, jti: minted.jti };
    return c.json(body, 201);
  });

  // --- integrations: connect and health run here, where the vendors' keys are (BUILD §2.1 rule 2; integrations.ts) ------
  app.post("/v1/integrations/connect", async (c) => c.json(await connectIntegration(deps, ConnectIntegrationRequest.parse(await c.req.json()), c.var.service.svc)));

  // The repository the founder is choosing on Development › Code: reachable by the installation, its id and visibility.
  app.post(REPOSITORY_CHECK_ROUTE, async (c) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api checks the Code tab's repository", 403);
    const input = RepositoryCheckRequest.parse(await c.req.json());
    await repos.businesses.get(deps.db, input.businessId).catch(() => {
      throw new GatewayError("business_not_found", `business ${input.businessId} is not available to this gateway`, 404);
    });
    return c.json(await checkRepository(deps, input));
  });

  app.post("/v1/integrations/health", async (c) => c.json(await integrationHealth(deps, IntegrationHealthRequest.parse(await c.req.json()), c.var.service.svc)));

  // --- session auth -------------------------------------------------------------------------------------------
  const requireSession = async (c: { req: { header(name: string): string | undefined }; set(key: "session", value: SessionToken): void }, next: () => Promise<void>) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) throw new UnauthorizedError("A session Bearer token is required");
    c.set("session", await verifySessionToken(secret, token, now));
    await next();
  };
  app.use("/v1/call", requireSession);
  app.use("/mcp/*", requireSession);
  app.use(ARCHIVE_ROUTE, requireSession);
  app.use("/v1/call", callerTrace);
  app.use("/mcp/*", callerTrace);
  app.use(ARCHIVE_ROUTE, callerTrace);

  app.post(ARCHIVE_ROUTE, async (c) => serveArchive(deps, c.var.session, ArchiveRequest.parse(await c.req.json())));

  app.post("/v1/call", async (c) => {
    const req = CallRequest.parse(await c.req.json());
    // A route-only tool (a repository archive) is refused for an agent session; see archive.ts.
    const { status, body } = (await routeOnlyCall(deps, c.var.session, req)) ?? (await tracedToolCall(deps, c.var.session, req));
    if (status === 429 && body.outcome === "rate_limited") c.header("Retry-After", String(body.retryAfterSeconds));
    return c.json(body, status);
  });

  app.all("/mcp/:connector", async (c) => {
    const key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).parse(c.req.param("connector"));
    return handleMcpRequest(deps, c.var.session, key, c.req.raw);
  });

  return app;
}
