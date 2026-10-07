/**
 * Envelope encryption contract (BUILD §3.1 "Secrets", §7.2 `credentials`, §10.2, §14).
 *
 * Every secret is sealed with its own random 256-bit data key under XChaCha20-Poly1305 (libsodium's
 * `crypto_aead_xchacha20poly1305_ietf`) with the caller's AAD bound into the tag. The data key is then
 * wrapped by a master key: AWS KMS (`KmsVault`) in production, a libsodium secretbox under `DEV_MASTER_KEY`
 * (`LocalVault`) in development and staging. Both vaults produce the same `EncryptedRecord` shape, which maps
 * 1:1 onto the `credentials` columns `ciphertext`, `data_key_ciphertext`, `kms_key_id`.
 */
import { z } from "zod";
import { AppError } from "../errors";
import { fromBase64, isBase64, toBase64 } from "./encoding";

/** Payload AEAD. The `alg` field on a record is the format version: a new algorithm gets a new string. */
export const ENVELOPE_ALG = "xchacha20poly1305-ietf" as const;
export type EnvelopeAlg = typeof ENVELOPE_ALG;

/** `kms_key_id` values written by `LocalVault` start with this prefix followed by a master-key fingerprint. */
export const LOCAL_KEY_ID_PREFIX = "local:" as const;

/** KMS encryption-context key carrying the AAD, so the wrapped data key is bound to the record context at KMS too. */
export const KMS_ENCRYPTION_CONTEXT_KEY = "fm:aad" as const;

export const EncryptedRecordSchema = z.object({
  /** base64: 24-byte XChaCha nonce || AEAD ciphertext (payload + 16-byte tag). */
  ciphertext: z.string().refine(isBase64, "ciphertext must be base64"),
  /** base64: the per-record data key wrapped by the master key (KMS `CiphertextBlob`, or secretbox nonce || box). */
  dataKeyCiphertext: z.string().refine(isBase64, "dataKeyCiphertext must be base64"),
  /** KMS key ARN/id, or `local:<fingerprint>` for the libsodium vault. */
  kmsKeyId: z.string().min(1),
  alg: z.literal(ENVELOPE_ALG),
});
export type EncryptedRecord = z.infer<typeof EncryptedRecordSchema>;

export type VaultKind = "local" | "kms";

export interface Vault {
  readonly kind: VaultKind;
  /**
   * The configured master key identifier. `LocalVault` records carry exactly this (`local:<fingerprint>`);
   * `KmsVault` records carry the key ARN KMS resolved the configured id or alias to.
   */
  readonly kmsKeyId: string;
  /**
   * Seals `plaintext` under a fresh data key. `aad` (additional authenticated data) is not encrypted but is
   * bound into the authentication tag: `decrypt` with a different `aad` fails. Use `buildAad` to derive it
   * from the owning row (business id, table, row id) so a ciphertext cannot be moved between rows or tenants.
   * A string plaintext is UTF-8 encoded; pass a `Uint8Array` when you want the plaintext buffer zeroised by
   * the caller afterwards (JavaScript strings cannot be wiped).
   */
  encrypt(plaintext: Uint8Array | string, aad: string): Promise<EncryptedRecord>;
  /** Returns the plaintext bytes. Throws `VaultError` (`decrypt_failed`) on a wrong key, wrong AAD or any tampering. */
  decrypt(record: EncryptedRecord, aad: string): Promise<Uint8Array>;
  /** Re-seals the same plaintext under a brand-new data key (same AAD). The old record stays valid until it is overwritten. */
  rotateDataKey(record: EncryptedRecord, aad: string): Promise<EncryptedRecord>;
}

export type VaultErrorCode =
  | "config" // missing or malformed key material / environment
  | "invalid_record" // record shape, algorithm or key id does not match this vault
  | "decrypt_failed" // authentication failed: wrong key, wrong AAD or tampered bytes
  | "kms_failed" // the KMS call itself failed (network, permissions, disabled key)
  | "invalid_aad";

/** Never carries plaintext or key material in `message` or `details`. */
export class VaultError extends AppError {
  constructor(
    public override readonly code: VaultErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(code, message, 500, details);
    this.name = "VaultError";
  }
}

/** Interface the libsodium module needs from AAD inputs: non-empty, no control characters. */
export function assertAad(aad: string): asserts aad is string {
  if (typeof aad !== "string" || aad.length === 0) throw new VaultError("invalid_aad", "aad must be a non-empty string");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(aad)) throw new VaultError("invalid_aad", "aad must not contain control characters");
}

/**
 * Builds the conventional AAD `part1:part2:…` (e.g. `buildAad(businessId, "credentials", credentialId)`).
 * Parts may not be empty or contain `:` so two different part lists can never collide.
 */
export function buildAad(...parts: string[]): string {
  if (parts.length === 0) throw new VaultError("invalid_aad", "buildAad needs at least one part");
  for (const p of parts) {
    if (typeof p !== "string" || p.length === 0) throw new VaultError("invalid_aad", "aad parts must be non-empty strings");
    if (p.includes(":")) throw new VaultError("invalid_aad", "aad parts must not contain ':'");
  }
  const aad = parts.join(":");
  assertAad(aad);
  return aad;
}

/** Validates an untyped value (a DB row, JSON) as an `EncryptedRecord` or throws `invalid_record`. */
export function parseEncryptedRecord(value: unknown): EncryptedRecord {
  const parsed = EncryptedRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new VaultError(
      "invalid_record",
      `encrypted record is malformed: ${parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** The `credentials` bytea columns for a record (`nonce` stays null: the nonce is inside `ciphertext`). */
export interface EncryptedRecordBytes {
  ciphertext: Uint8Array;
  dataKeyCiphertext: Uint8Array;
  kmsKeyId: string;
  nonce: null;
}

export function encryptedRecordToBytes(record: EncryptedRecord): EncryptedRecordBytes {
  const r = parseEncryptedRecord(record);
  return { ciphertext: fromBase64(r.ciphertext), dataKeyCiphertext: fromBase64(r.dataKeyCiphertext), kmsKeyId: r.kmsKeyId, nonce: null };
}

export function encryptedRecordFromBytes(row: { ciphertext: Uint8Array; dataKeyCiphertext: Uint8Array; kmsKeyId: string }): EncryptedRecord {
  return parseEncryptedRecord({
    ciphertext: toBase64(row.ciphertext),
    dataKeyCiphertext: toBase64(row.dataKeyCiphertext),
    kmsKeyId: row.kmsKeyId,
    alg: ENVELOPE_ALG,
  });
}
