/**
 * credentials — ciphertext only (BUILD §7.2 "never selectable by client roles", §10.2, §14).
 *
 * This repo stores and loads `EncryptedRecord`s from `@founder-manager/shared` (envelope encryption:
 * data key wrapped by KMS or the local master key, payload sealed with XChaCha20-Poly1305). It never
 * sees a plaintext: callers encrypt with a `Vault` before `store` and decrypt after `load`, in memory,
 * in the gateway or orchestrator only. The table has no RLS policy and no grants for app roles, so every
 * function here only works on a service-role connection; metadata reads (`listMetadata`, `expiring`)
 * omit the ciphertext columns so the credential-expiry scan never carries secrets around.
 */
import { encryptedRecordFromBytes, encryptedRecordToBytes, EncryptedRecordSchema, ValidationError, type EncryptedRecord } from "@founder-manager/shared";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { credentials, integrations, type Credential } from "../schema";
import { Id, IsoDateInput, one, parseInput, type Executor } from "./_shared";

export const StoreCredentialInput = z.object({
  integrationId: Id,
  /** What the secret is for: "secret" (API key), "oauth" (token set), "anthropic_key", "webhook_secret"… */
  kind: z.string().trim().min(1).max(40).default("secret"),
  record: EncryptedRecordSchema,
  expiresAt: IsoDateInput.nullable().optional(),
});
export type StoreCredentialInput = z.input<typeof StoreCredentialInput>;

/** A credential row without its ciphertext columns. */
export type CredentialMetadata = Omit<Credential, "ciphertext" | "dataKeyCiphertext" | "nonce">;

export interface LoadedCredential {
  meta: CredentialMetadata;
  /** Still encrypted; decrypt with the vault using `buildAad(businessId, "credentials", meta.id)`. */
  record: EncryptedRecord;
}

const META = {
  id: credentials.id,
  businessId: credentials.businessId,
  integrationId: credentials.integrationId,
  kind: credentials.kind,
  kmsKeyId: credentials.kmsKeyId,
  expiresAt: credentials.expiresAt,
  rotatedAt: credentials.rotatedAt,
  createdAt: credentials.createdAt,
  updatedAt: credentials.updatedAt,
  archivedAt: credentials.archivedAt,
};

const scoped = (businessId: string, credentialId: string) => and(eq(credentials.businessId, businessId), eq(credentials.id, credentialId));
const strip = (row: Credential): CredentialMetadata => {
  const { ciphertext: _c, dataKeyCiphertext: _d, nonce: _n, ...meta } = row;
  return meta;
};

export const credentialsRepo = {
  /**
   * Stores a sealed record for an integration. One live credential per (integration, kind): the previous
   * one is archived in the same transaction so `latest` is unambiguous. Returns metadata only.
   */
  async store(db: Executor, businessId: string, input: StoreCredentialInput): Promise<CredentialMetadata> {
    const v = parseInput(StoreCredentialInput, input, "credential");
    const bytes = encryptedRecordToBytes(v.record);
    return db.transaction(async (tx) => {
      const owner = await tx.select({ id: integrations.id }).from(integrations).where(and(eq(integrations.businessId, businessId), eq(integrations.id, v.integrationId))).limit(1);
      if (owner.length === 0) throw new ValidationError("integrationId is not an integration of this business", { integrationId: v.integrationId });
      await tx
        .update(credentials)
        .set({ archivedAt: new Date() })
        .where(and(eq(credentials.businessId, businessId), eq(credentials.integrationId, v.integrationId), eq(credentials.kind, v.kind), isNull(credentials.archivedAt)));
      const row = one(
        await tx
          .insert(credentials)
          .values({ businessId, integrationId: v.integrationId, kind: v.kind, ciphertext: bytes.ciphertext, dataKeyCiphertext: bytes.dataKeyCiphertext, kmsKeyId: bytes.kmsKeyId, nonce: null, expiresAt: v.expiresAt ?? null })
          .returning(),
        "credential",
      );
      return strip(row);
    });
  },

  /** Loads the ciphertext record for decryption. Archived credentials are never loaded. */
  async load(db: Executor, businessId: string, credentialId: string): Promise<LoadedCredential> {
    const row = one(await db.select().from(credentials).where(and(scoped(businessId, credentialId), isNull(credentials.archivedAt))).limit(1), "credential", credentialId);
    return { meta: strip(row), record: encryptedRecordFromBytes(row) };
  },

  /** The live credential of a kind for an integration, or null (e.g. the business's own Anthropic key). */
  async latest(db: Executor, businessId: string, integrationId: string, kind = "secret"): Promise<LoadedCredential | null> {
    const rows = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.businessId, businessId), eq(credentials.integrationId, integrationId), eq(credentials.kind, kind), isNull(credentials.archivedAt)))
      .orderBy(desc(credentials.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? { meta: strip(row), record: encryptedRecordFromBytes(row) } : null;
  },

  /** Metadata for every live credential of the business (no ciphertext). */
  async listMetadata(db: Executor, businessId: string, filter: { integrationId?: string; includeArchived?: boolean } = {}): Promise<CredentialMetadata[]> {
    return db
      .select(META)
      .from(credentials)
      .where(and(eq(credentials.businessId, businessId), filter.includeArchived ? undefined : isNull(credentials.archivedAt), filter.integrationId ? eq(credentials.integrationId, filter.integrationId) : undefined))
      .orderBy(asc(credentials.integrationId), asc(credentials.kind), desc(credentials.createdAt));
  },

  /** Replaces the ciphertext in place (key rotation or a refreshed OAuth token); the id and AAD stay the same. */
  async rotate(db: Executor, businessId: string, credentialId: string, record: EncryptedRecord, options: { expiresAt?: Date | null } = {}): Promise<CredentialMetadata> {
    const r = parseInput(EncryptedRecordSchema, record, "encrypted record");
    const bytes = encryptedRecordToBytes(r);
    const row = one(
      await db
        .update(credentials)
        .set({ ciphertext: bytes.ciphertext, dataKeyCiphertext: bytes.dataKeyCiphertext, kmsKeyId: bytes.kmsKeyId, nonce: null, rotatedAt: new Date(), ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}) })
        .where(and(scoped(businessId, credentialId), isNull(credentials.archivedAt)))
        .returning(),
      "credential",
      credentialId,
    );
    return strip(row);
  },

  async setExpiry(db: Executor, businessId: string, credentialId: string, expiresAt: Date | null): Promise<CredentialMetadata> {
    const row = one(await db.update(credentials).set({ expiresAt }).where(scoped(businessId, credentialId)).returning(), "credential", credentialId);
    return strip(row);
  },

  /** Revoke: archives the row. The ciphertext is kept (append-only history) but `load`/`latest` never return it again. */
  async revoke(db: Executor, businessId: string, credentialId: string): Promise<CredentialMetadata> {
    const row = one(await db.update(credentials).set({ archivedAt: new Date() }).where(and(scoped(businessId, credentialId), isNull(credentials.archivedAt))).returning(), "credential", credentialId);
    return strip(row);
  },

  /** Live credentials expiring before `before` (the nightly credentialExpiryScan → `credential.expiring` events). */
  async expiring(db: Executor, businessId: string, before: Date): Promise<CredentialMetadata[]> {
    return db
      .select(META)
      .from(credentials)
      .where(and(eq(credentials.businessId, businessId), isNull(credentials.archivedAt), sql`${credentials.expiresAt} is not null and ${credentials.expiresAt} <= ${before.toISOString()}`))
      .orderBy(asc(credentials.expiresAt));
  },
};
