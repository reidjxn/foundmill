/**
 * `LocalVault`: envelope encryption with a libsodium master key (`DEV_MASTER_KEY`), for development and
 * staging (docs/DECISIONS.md "Staging topology"). Per-record random data keys seal the payload with
 * XChaCha20-Poly1305 + AAD (`payload.ts`); each data key is wrapped with `crypto_secretbox` under the
 * master key. `dataKeyCiphertext` wire form: `nonce (24 bytes) || secretbox (32 + 16 bytes)`.
 *
 * `kmsKeyId` is `local:<fingerprint>` where the fingerprint is the first 8 bytes of BLAKE2b over the master
 * key, so a record encrypted under a different master key is reported as `invalid_record` instead of as a
 * generic authentication failure, without revealing anything about the key itself.
 */
import { concatBytes, fromBase64, toBase64, utf8Encode, zeroize } from "./encoding";
import { DATA_KEY_BYTES, generateDataKey, openPayload, sealPayload, sodiumReady } from "./payload";
import {
  ENVELOPE_ALG,
  LOCAL_KEY_ID_PREFIX,
  parseEncryptedRecord,
  VaultError,
  type EncryptedRecord,
  type Vault,
} from "./types";

export const MASTER_KEY_BYTES = 32; // crypto_secretbox_KEYBYTES
const WRAP_NONCE_BYTES = 24; // crypto_secretbox_NONCEBYTES
const WRAP_MAC_BYTES = 16; // crypto_secretbox_MACBYTES
const FINGERPRINT_BYTES = 8;

function decodeMasterKey(masterKeyBase64: string): Uint8Array {
  if (typeof masterKeyBase64 !== "string" || masterKeyBase64.length === 0) {
    throw new VaultError("config", "master key is empty; generate one with generateMasterKey()");
  }
  let key: Uint8Array;
  try {
    key = fromBase64(masterKeyBase64.trim());
  } catch {
    throw new VaultError("config", "master key is not valid base64; generate one with generateMasterKey()");
  }
  if (key.byteLength !== MASTER_KEY_BYTES) {
    zeroize(key);
    throw new VaultError("config", `master key must decode to ${MASTER_KEY_BYTES} bytes (got ${key.byteLength})`);
  }
  return key;
}

export class LocalVault implements Vault {
  readonly kind = "local" as const;
  #masterKey: Uint8Array | null;
  #keyId: string | undefined;

  constructor(masterKeyBase64: string) {
    this.#masterKey = decodeMasterKey(masterKeyBase64);
  }

  /** `local:<fingerprint>`; computed on first use because the hash needs libsodium ready. Prefer `keyId()`. */
  get kmsKeyId(): string {
    if (!this.#keyId) throw new VaultError("config", "LocalVault.kmsKeyId is available after ready() (or after the first encrypt/decrypt)");
    return this.#keyId;
  }

  /** Waits for libsodium and returns the vault's `local:<fingerprint>` key id. */
  async ready(): Promise<string> {
    const masterKey = this.#key(); // throws once destroyed
    const s = await sodiumReady();
    if (!this.#keyId) {
      const fp = s.crypto_generichash(FINGERPRINT_BYTES, masterKey, null);
      this.#keyId = `${LOCAL_KEY_ID_PREFIX}${s.to_hex(fp)}`;
    }
    return this.#keyId;
  }

  async encrypt(plaintext: Uint8Array | string, aad: string): Promise<EncryptedRecord> {
    const keyId = await this.ready();
    const s = await sodiumReady();
    const dataKey = await generateDataKey();
    try {
      const sealed = await sealPayload(dataKey, plaintext, aad);
      const wrapNonce = s.randombytes_buf(WRAP_NONCE_BYTES);
      const wrapped = s.crypto_secretbox_easy(dataKey, wrapNonce, this.#key());
      return {
        ciphertext: toBase64(sealed),
        dataKeyCiphertext: toBase64(concatBytes(wrapNonce, wrapped)),
        kmsKeyId: keyId,
        alg: ENVELOPE_ALG,
      };
    } finally {
      zeroize(dataKey);
    }
  }

  async decrypt(record: EncryptedRecord, aad: string): Promise<Uint8Array> {
    const r = parseEncryptedRecord(record);
    const keyId = await this.ready();
    this.#assertKeyId(r.kmsKeyId, keyId);
    const dataKey = await this.#unwrap(fromBase64(r.dataKeyCiphertext));
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

  /** Wipes the master key from memory. The vault is unusable afterwards. */
  destroy(): void {
    zeroize(this.#masterKey);
    this.#masterKey = null;
  }

  #key(): Uint8Array {
    if (!this.#masterKey) throw new VaultError("config", "LocalVault has been destroyed");
    return this.#masterKey;
  }

  #assertKeyId(recordKeyId: string, ownKeyId: string): void {
    const a = utf8Encode(recordKeyId);
    const b = utf8Encode(ownKeyId);
    // Key ids are public identifiers; compared in constant time anyway so nothing about the fingerprint leaks through timing.
    const same = a.byteLength === b.byteLength && timingSafeEqualBytes(a, b);
    if (!same) {
      throw new VaultError("invalid_record", `record was encrypted under ${recordKeyId}, this vault holds ${ownKeyId}`);
    }
  }

  async #unwrap(blob: Uint8Array): Promise<Uint8Array> {
    if (blob.byteLength !== WRAP_NONCE_BYTES + DATA_KEY_BYTES + WRAP_MAC_BYTES) {
      throw new VaultError("decrypt_failed", "wrapped data key has the wrong length");
    }
    const s = await sodiumReady();
    const masterKey = this.#key(); // outside the try: a destroyed vault is a config error, not an authentication failure
    const nonce = blob.subarray(0, WRAP_NONCE_BYTES);
    const box = blob.subarray(WRAP_NONCE_BYTES);
    try {
      return s.crypto_secretbox_open_easy(box, nonce, masterKey);
    } catch {
      throw new VaultError("decrypt_failed", "data key unwrap failed: wrong master key or tampered data key");
    }
  }
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
