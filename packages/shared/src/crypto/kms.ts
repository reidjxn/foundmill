/**
 * `KmsVault`: envelope encryption with an AWS KMS key (`KMS_KEY_ID`). KMS `GenerateDataKey` returns a fresh
 * 256-bit data key in plaintext plus the same key wrapped by the KMS key; the plaintext key seals the payload
 * with the shared XChaCha20-Poly1305 AEAD (`payload.ts`) and is zeroised, and the wrapped key becomes
 * `dataKeyCiphertext`. `Decrypt` unwraps it on read. The record AAD is also passed as the KMS encryption
 * context (`fm:aad`), so KMS itself refuses to unwrap a data key for a different record.
 *
 * API verified against `@aws-sdk/client-kms` 3.1146.0 types: `GenerateDataKeyCommand({ KeyId, KeySpec,
 * EncryptionContext })` → `{ Plaintext, CiphertextBlob, KeyId }`; `DecryptCommand({ CiphertextBlob, KeyId,
 * EncryptionContext })` → `{ Plaintext, KeyId }`.
 */
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  type DecryptCommandOutput,
  type GenerateDataKeyCommandOutput,
} from "@aws-sdk/client-kms";
import { fromBase64, toBase64, zeroize } from "./encoding";
import { DATA_KEY_BYTES, openPayload, sealPayload } from "./payload";
import {
  assertAad,
  ENVELOPE_ALG,
  KMS_ENCRYPTION_CONTEXT_KEY,
  parseEncryptedRecord,
  VaultError,
  type EncryptedRecord,
  type Vault,
} from "./types";

/** The slice of `KMSClient` the vault uses; a test double only needs `send`. */
export interface KmsClientLike {
  send(command: GenerateDataKeyCommand): Promise<GenerateDataKeyCommandOutput>;
  send(command: DecryptCommand): Promise<DecryptCommandOutput>;
}

export interface KmsVaultOptions {
  client: KmsClientLike;
}

export class KmsVault implements Vault {
  readonly kind = "kms" as const;
  readonly kmsKeyId: string;
  readonly #client: KmsClientLike;

  constructor(kmsKeyId: string, options: KmsVaultOptions) {
    if (typeof kmsKeyId !== "string" || kmsKeyId.trim().length === 0) {
      throw new VaultError("config", "KMS key id is empty (set KMS_KEY_ID to a key id, ARN or alias)");
    }
    if (!options?.client || typeof options.client.send !== "function") {
      throw new VaultError("config", "KmsVault needs a KMS client (new KMSClient({ region }))");
    }
    this.kmsKeyId = kmsKeyId.trim();
    this.#client = options.client;
  }

  async encrypt(plaintext: Uint8Array | string, aad: string): Promise<EncryptedRecord> {
    assertAad(aad);
    let out: GenerateDataKeyCommandOutput;
    try {
      out = await this.#client.send(
        new GenerateDataKeyCommand({ KeyId: this.kmsKeyId, KeySpec: "AES_256", EncryptionContext: encryptionContext(aad) }),
      );
    } catch (e) {
      throw kmsFailure("GenerateDataKey", e);
    }
    const dataKey = out.Plaintext;
    const wrapped = out.CiphertextBlob;
    if (!dataKey || !wrapped) {
      zeroize(dataKey);
      throw new VaultError("kms_failed", "KMS GenerateDataKey returned no key material");
    }
    try {
      if (dataKey.byteLength !== DATA_KEY_BYTES) {
        throw new VaultError("kms_failed", `KMS returned a ${dataKey.byteLength}-byte data key, expected ${DATA_KEY_BYTES}`);
      }
      const sealed = await sealPayload(dataKey, plaintext, aad);
      return { ciphertext: toBase64(sealed), dataKeyCiphertext: toBase64(wrapped), kmsKeyId: out.KeyId ?? this.kmsKeyId, alg: ENVELOPE_ALG };
    } finally {
      zeroize(dataKey);
    }
  }

  async decrypt(record: EncryptedRecord, aad: string): Promise<Uint8Array> {
    const r = parseEncryptedRecord(record);
    assertAad(aad);
    let out: DecryptCommandOutput;
    try {
      out = await this.#client.send(
        new DecryptCommand({ CiphertextBlob: fromBase64(r.dataKeyCiphertext), KeyId: r.kmsKeyId, EncryptionContext: encryptionContext(aad) }),
      );
    } catch (e) {
      // InvalidCiphertextException is what KMS returns for a tampered blob or a mismatched encryption context.
      if (errorName(e) === "InvalidCiphertextException") {
        throw new VaultError("decrypt_failed", "KMS refused the wrapped data key: wrong aad or tampered data key");
      }
      throw kmsFailure("Decrypt", e);
    }
    const dataKey = out.Plaintext;
    if (!dataKey) throw new VaultError("kms_failed", "KMS Decrypt returned no key material");
    try {
      return await openPayload(dataKey, fromBase64(r.ciphertext), aad);
    } finally {
      zeroize(dataKey);
    }
  }

  async rotateDataKey(record: EncryptedRecord, aad: string): Promise<EncryptedRecord> {
    const plaintext = await this.decrypt(record, aad);
    try {
      return await this.encrypt(plaintext, aad);
    } finally {
      zeroize(plaintext);
    }
  }
}

function encryptionContext(aad: string): Record<string, string> {
  return { [KMS_ENCRYPTION_CONTEXT_KEY]: aad };
}

function errorName(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "name" in e && typeof (e as { name: unknown }).name === "string"
    ? (e as { name: string }).name
    : undefined;
}

function kmsFailure(operation: string, e: unknown): VaultError {
  const name = errorName(e) ?? "Error";
  const message = e instanceof Error ? e.message : String(e);
  // Vendor error text never contains key material; the AAD is ours and non-secret.
  return new VaultError("kms_failed", `KMS ${operation} failed (${name}): ${message}`, { operation, name });
}
