/**
 * Per-business webhook secrets (DECISIONS "Connectors: webhook verification is hand-rolled per vendor scheme"):
 * `LiveConnectorOptions.getBusinessSecret(businessId, name)` reads the integration's credential row of kind
 * `name` (`stripe_webhook_secret`, `shopify_webhook_secret`, `sendgrid_webhook_public_key`,
 * `sendgrid_inbound_token`, `dropbox_sign_api_key`), decrypts it in memory with the shared vault and returns
 * the secret string. Nothing is cached and nothing is logged. Without a vault (mock mode) every lookup is null
 * and the connectors fall back to the platform secret.
 */
import { z } from "zod";
import { repos, type Db } from "@foundmill/db";
import { buildAad, decryptJson, NotFoundError, VaultError, type Vault } from "@foundmill/shared";
import type { IngestLogger } from "./types";

/** Same shape the gateway seals (`DecryptedCredential`); only `secret` is read here. */
const StoredSecret = z.object({ secret: z.string().min(1) }).loose();

export const WEBHOOK_SECRET_NAMES = ["stripe_webhook_secret", "shopify_webhook_secret", "sendgrid_webhook_public_key", "sendgrid_inbound_token", "dropbox_sign_api_key"] as const;

/** Which connector a secret name belongs to (the credential hangs off that connector's integration row). */
export const connectorForSecretName = (name: string): string | null => {
  const i = name.indexOf("_webhook_");
  if (i > 0) return name.slice(0, i);
  if (name === "sendgrid_inbound_token") return "sendgrid";
  if (name === "dropbox_sign_api_key") return "dropbox_sign";
  return null;
};

export type BusinessSecretResolver = (businessId: string, name: string) => Promise<string | null>;

export function createBusinessSecretResolver(db: Db, vault: Vault | null, log?: IngestLogger): BusinessSecretResolver {
  return async (businessId, name) => {
    if (!vault) return null;
    const connectorKey = connectorForSecretName(name);
    if (!connectorKey) return null;
    try {
      const integration = await repos.integrations.getByKey(db, businessId, connectorKey);
      if (!integration) return null;
      const loaded = await repos.credentials.latest(db, businessId, integration.id, name);
      if (!loaded) return null;
      const parsed = await decryptJson(vault, loaded.record, buildAad(businessId, "credentials", loaded.meta.id), StoredSecret);
      return parsed.secret;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      if (e instanceof VaultError) {
        log?.warn({ businessId, name, code: e.code }, "webhook secret could not be decrypted; falling back to the platform secret");
        return null;
      }
      throw e;
    }
  };
}
