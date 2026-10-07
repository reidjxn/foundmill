/**
 * Envelope encryption for `@founder-manager/shared` (BUILD §3.1 "Secrets", §10.2, §14; ARCHITECTURE §1).
 *
 *   const vault = createVault(loadEnv());                       // KMS when KMS_KEY_ID is set, else libsodium
 *   const aad = buildAad(businessId, "credentials", credentialId);
 *   const record = await encryptJson(vault, { apiKey }, aad);   // → credentials row columns
 *   const { apiKey } = await decryptJson(vault, record, aad, Schema);
 *
 * Only `apps/gateway` and `apps/orchestrator` decrypt, in memory, per call (BUILD §10.2). Never log a
 * record's plaintext; log `redactSecret(value)` if a secret must be mentioned at all.
 */
import { KMSClient } from "@aws-sdk/client-kms";
import type { z } from "zod";
import { toBase64, utf8Decode, zeroize } from "./encoding";
import { KmsVault, type KmsClientLike } from "./kms";
import { LocalVault, MASTER_KEY_BYTES } from "./libsodium";
import { VaultError, type EncryptedRecord, type Vault } from "./types";

export * from "./types";
export { LocalVault, MASTER_KEY_BYTES } from "./libsodium";
export { KmsVault, type KmsClientLike, type KmsVaultOptions } from "./kms";
export { DATA_KEY_BYTES, PAYLOAD_NONCE_BYTES, PAYLOAD_TAG_BYTES, sodiumReady } from "./payload";
export { toBase64, fromBase64, zeroize } from "./encoding";

/** The environment keys `createVault` reads (a subset of `Env` from `../env`). */
export interface VaultEnv {
  KMS_KEY_ID?: string | undefined;
  DEV_MASTER_KEY?: string | undefined;
  APP_ENV?: "development" | "test" | "staging" | "production" | undefined;
  AWS_REGION?: string | undefined;
}

export interface CreateVaultOptions {
  /** Injected KMS client (tests, or a client with custom credentials). Defaults to `new KMSClient({})` (region from the AWS env). */
  kmsClient?: KmsClientLike;
}

/**
 * Picks the vault for this process: `KmsVault` when `KMS_KEY_ID` is set, otherwise `LocalVault` from
 * `DEV_MASTER_KEY`. Production refuses to run on a dev master key (BUILD §3.1 pins KMS for production;
 * staging may use libsodium per docs/DECISIONS.md). Throws `VaultError("config")` with the fix when neither is set.
 */
export function createVault(env: VaultEnv, options: CreateVaultOptions = {}): Vault {
  const kmsKeyId = env.KMS_KEY_ID?.trim();
  const masterKey = env.DEV_MASTER_KEY?.trim();
  if (kmsKeyId) {
    return new KmsVault(kmsKeyId, { client: options.kmsClient ?? new KMSClient(env.AWS_REGION ? { region: env.AWS_REGION } : {}) });
  }
  if (masterKey) {
    if (env.APP_ENV === "production") {
      throw new VaultError("config", "APP_ENV=production requires KMS_KEY_ID; DEV_MASTER_KEY is only accepted in development, test and staging");
    }
    return new LocalVault(masterKey);
  }
  throw new VaultError(
    "config",
    "No vault configured: set KMS_KEY_ID (AWS KMS key id, ARN or alias) or DEV_MASTER_KEY (base64 32 bytes; run generateMasterKey() to make one)",
  );
}

/** A new random 256-bit master key for `DEV_MASTER_KEY`, base64 (44 characters). */
export function generateMasterKey(): string {
  const key = new Uint8Array(MASTER_KEY_BYTES);
  globalThis.crypto.getRandomValues(key);
  const out = toBase64(key);
  zeroize(key);
  return out;
}

/** Encrypts `JSON.stringify(value)`. */
export async function encryptJson(vault: Vault, value: unknown, aad: string): Promise<EncryptedRecord> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new VaultError("invalid_record", "value is not JSON-serialisable");
  return vault.encrypt(json, aad);
}

/** Decrypts and parses JSON; with `schema` the value is validated (and typed) before it is returned. */
export async function decryptJson<T = unknown>(vault: Vault, record: EncryptedRecord, aad: string, schema?: z.ZodType<T>): Promise<T> {
  const bytes = await vault.decrypt(record, aad);
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new VaultError("invalid_record", "decrypted payload is not JSON");
  } finally {
    zeroize(bytes);
  }
  if (!schema) return parsed as T;
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new VaultError("invalid_record", `decrypted payload does not match the expected schema: ${result.error.issues.map((i) => i.path.join(".") || "value").join(", ")}`);
  }
  return result.data;
}

/** Decrypts to a UTF-8 string (for secrets stored as plain strings rather than JSON). */
export async function decryptText(vault: Vault, record: EncryptedRecord, aad: string): Promise<string> {
  const bytes = await vault.decrypt(record, aad);
  try {
    return utf8Decode(bytes);
  } finally {
    zeroize(bytes);
  }
}

/**
 * Log-safe form of a secret: the first four characters followed by `***` (`sk-a***`), so a founder can tell
 * which key is meant without the key leaking. Anything shorter than 8 characters, empty or non-string is `***`.
 */
export function redactSecret(secret: unknown): string {
  if (typeof secret !== "string" || secret.length < 8) return "***";
  return `${secret.slice(0, 4)}***`;
}
