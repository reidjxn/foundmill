/**
 * Going live must be configurable from the environment (GPC-12, CDD-9): every platform secret a live connector reads has
 * a variable in the shared env schema, `platformSecretsFromEnv` maps it, and every variable a connector's ConfigError
 * tells the operator to set is one the schema reads.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENV_KEYS, loadEnv } from "@foundmill/shared";
import { platformSecretsFromEnv, type PlatformSecrets } from "../platform";

/** Every key of PlatformSecrets (the type makes this list complete: a new key fails typecheck until it is added here). */
const EVERY_SECRET: Record<keyof Required<PlatformSecrets>, true> = {
  anthropicApiKey: true,
  voyageApiKey: true,
  openaiApiKey: true,
  onesignalAppId: true,
  onesignalApiKey: true,
  e2bApiKey: true,
  stripeSecretKey: true,
  stripeWebhookSecret: true,
  stripeConnectClientId: true,
  sendgridApiKey: true,
  sendgridWebhookPublicKey: true,
  sendgridInboundToken: true,
  githubAppId: true,
  githubAppPrivateKey: true,
  githubWebhookSecret: true,
  githubAppSlug: true,
  githubAppClientId: true,
  githubAppClientSecret: true,
  shopifyClientId: true,
  shopifyClientSecret: true,
  tinkClientId: true,
  tinkClientSecret: true,
  plaidClientId: true,
  plaidSecret: true,
  plaidEnv: true,
  companiesHouseApiKey: true,
  bolagsverketClientId: true,
  bolagsverketClientSecret: true,
  opencorporatesApiToken: true,
  cloudflareApiToken: true,
  googleClientId: true,
  googleClientSecret: true,
  notionClientId: true,
  notionClientSecret: true,
  dropboxSignApiKey: true,
};

const CONNECTORS_DIR = fileURLToPath(new URL("../connectors", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("platform secrets from the environment", () => {
  it("maps every platform secret from a declared variable", () => {
    // Every string variable set: PLAID_ENV takes one of its values.
    const overrides = Object.fromEntries(ENV_KEYS.filter((k) => /(KEY|SECRET|TOKEN|_ID|_SLUG)$/.test(k) || k === "PLAID_ENV").map((k) => [k, k === "PLAID_ENV" ? "sandbox" : `value-of-${k}`]));
    const secrets = platformSecretsFromEnv(loadEnv(overrides));
    expect(Object.keys(secrets).sort()).toEqual(Object.keys(EVERY_SECRET).sort());
    expect(secrets).toMatchObject({ tinkClientId: "value-of-TINK_CLIENT_ID", companiesHouseApiKey: "value-of-COMPANIES_HOUSE_API_KEY", googleClientSecret: "value-of-GOOGLE_CLIENT_SECRET", plaidEnv: "sandbox" });
  });

  it("leaves unset secrets out", () => {
    const empty = Object.fromEntries(ENV_KEYS.filter((k) => /(KEY|SECRET|TOKEN|_ID|_SLUG)$/.test(k) || k === "PLAID_ENV").map((k) => [k, undefined]));
    expect(platformSecretsFromEnv(loadEnv({ ...empty, TINK_CLIENT_ID: "tink-id" }))).toEqual({ tinkClientId: "tink-id" });
  });

  it("every variable a connector's ConfigError names is declared in the env schema", () => {
    const declared = new Set<string>(ENV_KEYS);
    const named = new Set<string>();
    for (const file of sourceFiles(CONNECTORS_DIR)) {
      for (const call of readFileSync(file, "utf8").matchAll(/new ConfigError\(([^;]*?)\)(?:;|\s*\)|,)/g)) {
        for (const literal of call[1]!.matchAll(/"([^"]*)"/g)) for (const v of literal[1]!.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) named.add(v[0]);
      }
    }
    // The check reads real messages (Tink, Plaid, Google, Notion, Companies House, GitHub...).
    expect(named.size).toBeGreaterThan(15);
    expect([...named].filter((v) => !declared.has(v))).toEqual([]);
  });
});
