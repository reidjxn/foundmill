/**
 * The business's own model key (BUILD §10.2 "Bring-your-own key").
 *
 * apps/api `keys.setAnthropic` seals the key as the connector credential shape `{ kind: "api_key", secret }` under the
 * default credential kind (`BYOK_CREDENTIAL_KIND`, "secret") on the `anthropic` integration, so the gateway's credential
 * loader (tool calls), the orchestrator (sessions, cycle, training) and this helper all read the same row. Decrypting is
 * reserved for the gateway and the orchestrator (§10.2 step 3): call `loadByokApiKey` only there, never from the api,
 * composer or a sandbox, and never log the result.
 *
 * Rows sealed before 2026-10-10 used the kind "api_key" and the payload `{ apiKey }`; that shape was never read back (the
 * orchestrator looked for "secret"), so it is still accepted here until every such row has been rotated.
 */
import { z } from "zod";
import { buildAad, decryptJson, type Vault } from "@foundmill/shared/crypto";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";

export const BYOK_CONNECTOR_KEY = "anthropic";
/** Credential kind the key is stored under: the gateway's default, so `loadCredential(..., integrationId)` finds it. */
export const BYOK_CREDENTIAL_KIND = "secret";
/** The kind and shape apps/api wrote before 2026-10-10. Read, never written. */
export const LEGACY_BYOK_CREDENTIAL_KIND = "api_key";

/** The connector credential shape the gateway seals (`DecryptedCredential`); only `secret` is read here. */
export const StoredApiKeySchema = z.object({ secret: z.string().min(1) }).loose();
const LegacyStoredApiKeySchema = z.object({ apiKey: z.string().min(1) }).loose();

export interface ByokApiKey {
  apiKey: string;
  credentialId: string;
  integrationId: string;
  /** `legacy` when the row still has the pre-2026-10-10 shape; rotating the key in Settings rewrites it. */
  shape: "current" | "legacy";
}

/**
 * The business's live Anthropic key, decrypted in memory, or null when none is stored (never set, or revoked: `keys.revoke`
 * archives every credential of the integration and disconnects it). Throws `VaultError` when a row cannot be decrypted.
 */
export async function loadByokApiKey(db: Executor, vault: Vault, businessId: string, connectorKey = BYOK_CONNECTOR_KEY): Promise<ByokApiKey | null> {
  const integration = await repos.integrations.getByKey(db, businessId, connectorKey);
  if (!integration || integration.archivedAt || integration.status === "disconnected") return null;
  const current = await repos.credentials.latest(db, businessId, integration.id, BYOK_CREDENTIAL_KIND);
  if (current) {
    const parsed = await decryptJson(vault, current.record, buildAad(businessId, "credentials", current.meta.id), StoredApiKeySchema);
    return { apiKey: parsed.secret, credentialId: current.meta.id, integrationId: integration.id, shape: "current" };
  }
  const legacy = await repos.credentials.latest(db, businessId, integration.id, LEGACY_BYOK_CREDENTIAL_KIND);
  if (!legacy) return null;
  const parsed = await decryptJson(vault, legacy.record, buildAad(businessId, "credentials", legacy.meta.id), LegacyStoredApiKeySchema);
  return { apiKey: parsed.apiKey, credentialId: legacy.meta.id, integrationId: integration.id, shape: "legacy" };
}
