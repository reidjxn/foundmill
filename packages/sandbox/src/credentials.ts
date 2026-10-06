/**
 * AC-11.6.6 — sandboxes contain no long-lived credentials (BUILD §9.3 "No long-lived credentials inside the
 * sandbox", §14 "sandboxes get short-lived scoped tokens").
 *
 * The orchestrator calls `assertNoLongLivedCredentials(env)` on the environment it is about to hand a
 * sandbox; every provider in this package calls it again in `create()`. Detection works on both the
 * variable **name** (ANTHROPIC_API_KEY, *_PRIVATE_KEY, DATABASE_URL...) and the **value** (sk_live_, ghp_,
 * AKIA..., PEM blocks, connection strings with passwords...). Findings never include the value.
 *
 * What is allowed through: JWTs that expire within `maxJwtTtlSeconds` (gateway session tokens), GitHub App
 * installation tokens (`ghs_`, one hour), AWS STS triples (`ASIA…` key + session token) and anything that
 * matches no pattern.
 */
import { LongLivedCredentialError, type CredentialFinding } from "./errors";

export interface CredentialPattern {
  id: string;
  reason: string;
  /** Matches the environment variable name. */
  name?: RegExp;
  /** Matches the value. */
  value?: RegExp;
}

/** Names that always denote a long-lived secret, whatever the value looks like. */
export const LONG_LIVED_NAME_PATTERNS: readonly CredentialPattern[] = [
  {
    id: "name.platform_secret",
    reason: "platform secret from .env (BUILD §4.6) must never enter a sandbox",
    name: /^(ANTHROPIC_API_KEY|VOYAGE_API_KEY|E2B_API_KEY|BROWSERBASE_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|DATABASE_URL|REDIS_URL|SESSION_TOKEN_SECRET|DEV_MASTER_KEY|KMS_KEY_ID|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SENDGRID_API_KEY|SENDGRID_WEBHOOK_PUBLIC_KEY|GITHUB_APP_ID|GITHUB_APP_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)$/,
  },
  {
    id: "name.api_key",
    reason: "API keys do not expire; mint a scoped session token instead",
    name: /(^|_)(API_KEY|APIKEY|API_TOKEN|SECRET_KEY|SECRET_ACCESS_KEY|ACCESS_KEY_ID|PRIVATE_KEY|SERVICE_ROLE_KEY|SERVICE_ACCOUNT_KEY|MASTER_KEY|SIGNING_KEY|WEBHOOK_SECRET|CLIENT_SECRET|REFRESH_TOKEN|PERSONAL_ACCESS_TOKEN|PASSWORD|PASSWD|CONNECTION_STRING)$/i,
  },
  {
    id: "name.database_url",
    reason: "database/cache connection strings carry standing passwords",
    name: /^(DATABASE|POSTGRES|PG|MYSQL|MONGO|MONGODB|REDIS|SUPABASE_DB)_?(URL|URI|DSN)$/i,
  },
];

/** Value shapes of well-known long-lived credentials. */
export const LONG_LIVED_VALUE_PATTERNS: readonly CredentialPattern[] = [
  { id: "value.stripe_secret", reason: "Stripe secret/restricted key", value: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/ },
  { id: "value.stripe_webhook", reason: "Stripe webhook signing secret", value: /\bwhsec_[A-Za-z0-9]{10,}/ },
  { id: "value.github_pat", reason: "GitHub personal/OAuth/user token", value: /\b(ghp|gho|ghu|ghr)_[A-Za-z0-9]{20,}/ },
  { id: "value.github_fine_grained_pat", reason: "GitHub fine-grained personal access token", value: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { id: "value.gitlab_pat", reason: "GitLab personal access token", value: /\bglpat-[A-Za-z0-9_-]{15,}/ },
  { id: "value.aws_access_key", reason: "AWS long-term access key id", value: /\b(AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/ },
  { id: "value.anthropic_api_key", reason: "Anthropic API key", value: /\bsk-ant-(api|admin)[0-9]{2}-[A-Za-z0-9_-]{20,}/ },
  { id: "value.openai_style_key", reason: "OpenAI-style secret key", value: /\bsk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/ },
  { id: "value.google_api_key", reason: "Google API key", value: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "value.slack_token", reason: "Slack bot/user/app token", value: /\bxox[bpas]-[A-Za-z0-9-]{10,}/ },
  { id: "value.sendgrid_key", reason: "SendGrid API key", value: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { id: "value.supabase_pat", reason: "Supabase personal access token", value: /\bsbp_[A-Za-z0-9]{20,}/ },
  { id: "value.shopify_token", reason: "Shopify admin/app token", value: /\bshp(at|ca|pa|ss)_[A-Fa-f0-9]{20,}/ },
  { id: "value.npm_token", reason: "npm access token", value: /\bnpm_[A-Za-z0-9]{30,}/ },
  { id: "value.pypi_token", reason: "PyPI API token", value: /\bpypi-[A-Za-z0-9_-]{40,}/ },
  { id: "value.e2b_key", reason: "E2B API key", value: /\be2b_[A-Za-z0-9]{20,}/ },
  { id: "value.digitalocean_token", reason: "DigitalOcean token", value: /\bdop_v1_[a-f0-9]{40,}/ },
  { id: "value.twilio_key", reason: "Twilio API key SID", value: /\bSK[a-f0-9]{32}\b/ },
  { id: "value.private_key_pem", reason: "PEM private key", value: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  {
    id: "value.connection_string_password",
    reason: "connection string with an embedded password",
    value: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql):\/\/[^\s/:@]+:[^\s@]+@/i,
  },
];

export interface CredentialCheckOptions {
  /** Variable names exempt from name-based checks (values are still checked). */
  allowNames?: readonly string[];
  /** A JWT is "short-lived" when it expires within this many seconds of `now`. Default 24 h. */
  maxJwtTtlSeconds?: number;
  /** Clock for JWT expiry checks (tests). */
  now?: () => Date;
}

const DEFAULT_MAX_JWT_TTL_SECONDS = 24 * 60 * 60;

/** Decode a JWT payload without verifying it (we only look at `exp`/`role`; verification is the gateway's job). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload] = parts;
  if (!header || !payload || !/^[A-Za-z0-9_-]+$/.test(header) || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type JwtVerdict =
  | { kind: "not_jwt" }
  | { kind: "short_lived"; expiresAt: Date }
  | { kind: "long_lived"; reason: string; expiresAt: Date | null };

/** Classify a JWT by its `exp` claim (and `role`, so a Supabase service-role key is never "short-lived"). */
export function classifyJwt(token: string, opts: CredentialCheckOptions = {}): JwtVerdict {
  const payload = decodeJwtPayload(token);
  if (!payload) return { kind: "not_jwt" };
  const role = typeof payload.role === "string" ? payload.role : null;
  if (role === "service_role") return { kind: "long_lived", reason: "Supabase service-role key", expiresAt: null };
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp === null) return { kind: "long_lived", reason: "JWT without an exp claim never expires", expiresAt: null };
  const expiresAt = new Date(exp * 1000);
  const now = (opts.now ?? (() => new Date()))();
  const ttl = (expiresAt.getTime() - now.getTime()) / 1000;
  const max = opts.maxJwtTtlSeconds ?? DEFAULT_MAX_JWT_TTL_SECONDS;
  if (ttl > max) return { kind: "long_lived", reason: `JWT expires in ${Math.round(ttl / 3600)} h (limit ${Math.round(max / 3600)} h)`, expiresAt };
  return { kind: "short_lived", expiresAt };
}

function isAwsStsTriple(env: Record<string, string>, name: string): boolean {
  // Temporary STS credentials: ASIA… key id + session token. Only the triple is allowed, never a bare key.
  const keyId = env.AWS_ACCESS_KEY_ID ?? "";
  const hasSessionToken = typeof env.AWS_SESSION_TOKEN === "string" && env.AWS_SESSION_TOKEN.length > 0;
  if (!keyId.startsWith("ASIA") || !hasSessionToken) return false;
  return name === "AWS_ACCESS_KEY_ID" || name === "AWS_SECRET_ACCESS_KEY" || name === "AWS_SESSION_TOKEN";
}

/** Non-throwing scan. One finding per variable (the first pattern that matches). */
export function findLongLivedCredentials(env: Record<string, string | undefined>, opts: CredentialCheckOptions = {}): CredentialFinding[] {
  const findings: CredentialFinding[] = [];
  const allow = new Set(opts.allowNames ?? []);
  const defined: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") defined[k] = v;

  for (const [name, value] of Object.entries(defined)) {
    if (isAwsStsTriple(defined, name)) continue;
    if (!allow.has(name)) {
      const byName = LONG_LIVED_NAME_PATTERNS.find((p) => p.name?.test(name));
      if (byName) {
        findings.push({ name, patternId: byName.id, reason: byName.reason });
        continue;
      }
    }
    const jwt = classifyJwt(value, opts);
    if (jwt.kind === "long_lived") {
      findings.push({ name, patternId: "value.long_lived_jwt", reason: jwt.reason });
      continue;
    }
    if (jwt.kind === "short_lived") continue;
    const byValue = LONG_LIVED_VALUE_PATTERNS.find((p) => p.value?.test(value));
    if (byValue) findings.push({ name, patternId: byValue.id, reason: byValue.reason });
  }
  return findings;
}

/** Throw `LongLivedCredentialError` when the environment carries anything long-lived (AC-11.6.6). */
export function assertNoLongLivedCredentials(env: Record<string, string | undefined>, opts: CredentialCheckOptions = {}): void {
  const findings = findLongLivedCredentials(env, opts);
  if (findings.length > 0) throw new LongLivedCredentialError(findings);
}

/** Convenience for logs and tool-call summaries: the names present, never the values. */
export function describeEnvForAudit(env: Record<string, string | undefined>): string {
  return Object.keys(env).sort().join(",");
}
