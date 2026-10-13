/**
 * Per-business credentials (BUILD §10.2 steps 2–3, §14): sealed in `credentials` by the shared vault,
 * decrypted here in memory for one call and never logged, returned or stored anywhere else.
 *
 * AAD convention: `buildAad(businessId, "credentials", <row id>)`. The row id only exists after the first
 * insert, so `storeCredential` seals under a provisional AAD, inserts, then re-seals under the row-bound AAD
 * and rotates in the same transaction (DECISIONS "packages/db repositories").
 */
import { z } from "zod";
import { CONNECTOR_AUTH_KINDS } from "@foundmill/shared";
import { buildAad, decryptJson, encryptJson, VaultError, type Vault } from "@foundmill/shared/crypto";
import { INTEGRATION_CREDENTIAL_KIND, LEGACY_INTEGRATION_CREDENTIAL_KINDS, repos, type Db, type Integration } from "@foundmill/db";
import type { DecryptedCredential, IntegrationRecord } from "@foundmill/connectors";

/** The row kind of every integration credential (apps/api `integrations.connect` and `keys.*` store under it too). */
export const CREDENTIAL_KIND = INTEGRATION_CREDENTIAL_KIND;
export const PROVISIONAL_AAD_ROW = "pending";

export const DecryptedCredentialSchema = z.object({
  kind: z.enum(CONNECTOR_AUTH_KINDS),
  secret: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.string().optional(),
  accountId: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});

/** A row from before 2026-10-12: the connector credential shape, or the business's own model key as `{ apiKey }`. */
const LegacyCredentialSchema = z.union([DecryptedCredentialSchema, z.object({ apiKey: z.string().min(1) }).transform((v): DecryptedCredential => ({ kind: "api_key", secret: v.apiKey }))]);

export interface LoadedCredential {
  credential: DecryptedCredential;
  credentialId: string;
  expiresAt: string | null;
}

/**
 * The live credential of an integration, decrypted. `null` when none is stored. Throws `VaultError` on a bad record.
 * Without `kind` it reads the `secret` row every writer now uses and, when there is none, the newest row an older
 * `integrations.connect` stored under the connector's auth kind (`api_key` / `oauth`), so a founder who connected before
 * the fix is not told the integration is missing.
 */
export async function loadCredential(db: Db, vault: Vault, businessId: string, integrationId: string, kind?: string): Promise<LoadedCredential | null> {
  const current = await repos.credentials.latest(db, businessId, integrationId, kind ?? CREDENTIAL_KIND);
  const loaded = current ?? (kind === undefined ? await repos.credentials.latest(db, businessId, integrationId, LEGACY_INTEGRATION_CREDENTIAL_KINDS) : null);
  if (!loaded) return null;
  const aad = buildAad(businessId, "credentials", loaded.meta.id);
  const credential = current ? await decryptJson(vault, loaded.record, aad, DecryptedCredentialSchema) : await decryptJson(vault, loaded.record, aad, LegacyCredentialSchema);
  return { credential, credentialId: loaded.meta.id, expiresAt: loaded.meta.expiresAt ? loaded.meta.expiresAt.toISOString() : null };
}

/**
 * Re-seals a refreshed OAuth access token into the same credential row (same id, so the same AAD) after a connector
 * refreshed it during a call, so the next call does not refresh again. Never logged; the old ciphertext is replaced.
 */
export async function persistRefreshedCredential(db: Db, vault: Vault, businessId: string, loaded: LoadedCredential, refreshed: DecryptedCredential): Promise<void> {
  const parsed = DecryptedCredentialSchema.parse(refreshed);
  const sealed = await encryptJson(vault, parsed, buildAad(businessId, "credentials", loaded.credentialId));
  await repos.credentials.rotate(db, businessId, loaded.credentialId, sealed, refreshed.expiresAt ? { expiresAt: new Date(refreshed.expiresAt) } : {});
}

/** Seals and stores a credential for an integration (connect flow, BYOK key, refreshed OAuth token). Returns the row id. */
export async function storeCredential(
  db: Db,
  vault: Vault,
  businessId: string,
  integrationId: string,
  credential: DecryptedCredential,
  options: { kind?: string; expiresAt?: Date | null } = {},
): Promise<{ credentialId: string }> {
  const kind = options.kind ?? CREDENTIAL_KIND;
  const parsed = DecryptedCredentialSchema.parse(credential);
  return db.transaction(async (tx) => {
    const provisional = await encryptJson(vault, parsed, buildAad(businessId, "credentials", PROVISIONAL_AAD_ROW));
    const meta = await repos.credentials.store(tx, businessId, { integrationId, kind, record: provisional, expiresAt: options.expiresAt ?? null });
    const bound = await encryptJson(vault, parsed, buildAad(businessId, "credentials", meta.id));
    await repos.credentials.rotate(tx, businessId, meta.id, bound);
    return { credentialId: meta.id };
  });
}

/** Maps an `integrations` row onto the connector contract's `IntegrationRecord` (settings → config). */
export function toIntegrationRecord(row: Integration, credential: LoadedCredential | null): IntegrationRecord {
  return {
    id: row.id,
    businessId: row.businessId,
    connectorKey: row.connectorKey,
    status: row.status,
    scopes: row.scopes,
    accountLabel: row.accountLabel,
    externalAccountId: typeof row.settings["externalAccountId"] === "string" ? (row.settings["externalAccountId"] as string) : null,
    config: row.settings,
    credentialRef: credential?.credentialId ?? null,
    expiresAt: credential?.expiresAt ?? null,
    lastHealthAt: row.lastHealthAt ? row.lastHealthAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const isVaultError = (e: unknown): e is VaultError => e instanceof VaultError;
