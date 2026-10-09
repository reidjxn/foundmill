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
import { repos, type Db, type Integration } from "@foundmill/db";
import type { DecryptedCredential, IntegrationRecord } from "@foundmill/connectors";

export const CREDENTIAL_KIND = "secret";
export const PROVISIONAL_AAD_ROW = "pending";

export const DecryptedCredentialSchema = z.object({
  kind: z.enum(CONNECTOR_AUTH_KINDS),
  secret: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.string().optional(),
  accountId: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});

export interface LoadedCredential {
  credential: DecryptedCredential;
  credentialId: string;
  expiresAt: string | null;
}

/** The live credential of an integration, decrypted. `null` when none is stored. Throws `VaultError` on a bad record. */
export async function loadCredential(db: Db, vault: Vault, businessId: string, integrationId: string, kind = CREDENTIAL_KIND): Promise<LoadedCredential | null> {
  const loaded = await repos.credentials.latest(db, businessId, integrationId, kind);
  if (!loaded) return null;
  const aad = buildAad(businessId, "credentials", loaded.meta.id);
  const credential = await decryptJson(vault, loaded.record, aad, DecryptedCredentialSchema);
  return { credential, credentialId: loaded.meta.id, expiresAt: loaded.meta.expiresAt ? loaded.meta.expiresAt.toISOString() : null };
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
