import { describe, expect, it } from "vitest";
import { assertNoLongLivedCredentials, classifyJwt, describeEnvForAudit, findLongLivedCredentials } from "../credentials";
import { LongLivedCredentialError } from "../errors";
import { gitAuthEnv } from "../worktree";

const NOW = new Date("2026-10-06T12:00:00.000Z");

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJl`;
}

const sessionToken = jwt({ sub: "agent-1", businessId: "b-1", sessionId: "s-1", exp: Math.floor(NOW.getTime() / 1000) + 30 * 60 });

describe("assertNoLongLivedCredentials (AC-11.6.6)", () => {
  it.each([
    ["STRIPE_SECRET_KEY", "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz", "name.platform_secret"],
    ["PAYMENTS_KEY", "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz", "value.stripe_secret"],
    ["PAYMENTS_KEY", "rk_test_51Hx8ZkLq9mN0pQrStUvWxYz", "value.stripe_secret"],
    ["GH_TOKEN", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "value.github_pat"],
    ["GH_TOKEN", "github_pat_11ABCDEFG0123456789abcdefghijklmnop", "value.github_fine_grained_pat"],
    ["AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE", "name.api_key"],
    ["CLOUD_KEY", "AKIAIOSFODNN7EXAMPLE", "value.aws_access_key"],
    ["ANTHROPIC_API_KEY", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "name.platform_secret"],
    ["MODEL_KEY", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "value.anthropic_api_key"],
    ["MODEL_KEY", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF", "value.openai_style_key"],
    ["MAPS", "AIzaSyA-abcdefghijklmnopqrstuvwxyz01234", "value.google_api_key"],
    ["SLACK", "xoxb-1234567890-abcdefghij", "value.slack_token"],
    ["MAIL", "SG.abcdefghijklmnopqrstu.vwxyz0123456789ABCDEFGH", "value.sendgrid_key"],
    ["SB", "sbp_abcdefghijklmnopqrstuvwxyz", "value.supabase_pat"],
    ["SHOP", "shpat_0123456789abcdef0123456789abcdef", "value.shopify_token"],
    ["E2B", "e2b_abcdefghijklmnopqrstuvwxyz", "value.e2b_key"],
    ["DEPLOY", "-----BEGIN RSA PRIVATE KEY-----\nMIIE...", "value.private_key_pem"],
    ["DATABASE_URL", "postgres://user:pw@db.example/app", "name.platform_secret"],
    ["POSTGRES_DSN", "postgres://db.example/app", "name.database_url"],
    ["REDIS_URL", "rediss://cache.example:6380", "name.platform_secret"],
    ["BACKEND", "postgresql://user:pw@db.example/app", "value.connection_string_password"],
    ["SERVICE_JWT", jwt({ role: "service_role", iss: "supabase" }), "value.long_lived_jwt"],
    ["NO_EXP_JWT", jwt({ sub: "x" }), "value.long_lived_jwt"],
    ["LONG_JWT", jwt({ sub: "x", exp: Math.floor(NOW.getTime() / 1000) + 30 * 24 * 3600 }), "value.long_lived_jwt"],
    ["APP_PASSWORD", "hunter2", "name.api_key"],
    ["GITHUB_APP_PRIVATE_KEY", "whatever", "name.platform_secret"],
  ])("rejects %s (%s) as %s", (name, value, patternId) => {
    const findings = findLongLivedCredentials({ [name]: value }, { now: () => NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ name, patternId });
    expect(JSON.stringify(findings)).not.toContain(value.slice(0, 12));
    expect(() => assertNoLongLivedCredentials({ [name]: value }, { now: () => NOW })).toThrow(LongLivedCredentialError);
  });

  it.each([
    ["GATEWAY_SESSION_TOKEN", sessionToken],
    ["GITHUB_TOKEN", "ghs_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["GIT_TOKEN", "ghs_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["FM_SESSION_ID", "session-7f21"],
    ["FM_BUSINESS_ID", "b-1"],
    ["NODE_ENV", "test"],
    ["CI", "1"],
    ["GATEWAY_URL", "http://gateway.railway.internal:4001"],
    ["TWILIO_SID_LOOKALIKE", "SKnotreallyhexnotreallyhexnotreally"],
  ])("allows %s", (name, value) => {
    expect(findLongLivedCredentials({ [name]: value }, { now: () => NOW })).toEqual([]);
    expect(() => assertNoLongLivedCredentials({ [name]: value }, { now: () => NOW })).not.toThrow();
  });

  it("allows an AWS STS triple but not a bare long-term AWS key", () => {
    const sts = { AWS_ACCESS_KEY_ID: "ASIAIOSFODNN7EXAMPLE", AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", AWS_SESSION_TOKEN: "FwoGZXIvYXdzEBYaD..." };
    expect(findLongLivedCredentials(sts)).toEqual([]);
    expect(findLongLivedCredentials({ AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE", AWS_SECRET_ACCESS_KEY: "x", AWS_SESSION_TOKEN: "y" }).map((f) => f.name)).toEqual(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
    expect(findLongLivedCredentials({ AWS_ACCESS_KEY_ID: "ASIAIOSFODNN7EXAMPLE" }).map((f) => f.patternId)).toEqual(["name.api_key"]);
  });

  it("reports every offending variable, never the values, and ignores undefined", () => {
    const env = { A_API_KEY: "aaaa", GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123456789", OK: "fine", MISSING: undefined };
    let caught: unknown;
    try {
      assertNoLongLivedCredentials(env);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LongLivedCredentialError);
    const err = caught as LongLivedCredentialError;
    expect(err.findings.map((f) => f.name).sort()).toEqual(["A_API_KEY", "GITHUB_TOKEN"]);
    expect(err.message).not.toContain("ghp_");
    expect(err.message).not.toContain("aaaa");
    expect(err.status).toBe(400);
    expect(describeEnvForAudit(env)).toBe("A_API_KEY,GITHUB_TOKEN,MISSING,OK");
  });

  it("honours allowNames for the name rule only and maxJwtTtlSeconds", () => {
    expect(findLongLivedCredentials({ DEPLOY_API_KEY: "short-lived-by-design" }, { allowNames: ["DEPLOY_API_KEY"] })).toEqual([]);
    expect(findLongLivedCredentials({ DEPLOY_API_KEY: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, { allowNames: ["DEPLOY_API_KEY"] }).map((f) => f.patternId)).toEqual(["value.github_pat"]);
    expect(classifyJwt(sessionToken, { now: () => NOW, maxJwtTtlSeconds: 60 }).kind).toBe("long_lived");
    expect(classifyJwt(sessionToken, { now: () => NOW }).kind).toBe("short_lived");
    expect(classifyJwt("not.a.jwt.at.all").kind).toBe("not_jwt");
  });

  it("passes the git auth env the worktree helper builds for a short-lived token", () => {
    const env = gitAuthEnv({ token: "ghs_abcdefghijklmnopqrstuvwxyz0123456789" });
    expect(() => assertNoLongLivedCredentials(env)).not.toThrow();
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
  });
});
