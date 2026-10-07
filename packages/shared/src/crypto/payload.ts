/**
 * Payload AEAD shared by every vault: XChaCha20-Poly1305 (IETF) from libsodium with the caller's AAD.
 * Wire form of a sealed payload: `nonce (24 bytes) || ciphertext || tag (16 bytes)`.
 *
 * libsodium's primitives are constant-time; the only secret-dependent branch here is the decrypt failure,
 * which libsodium reports after a full constant-time tag comparison.
 */
import sodium from "libsodium-wrappers";
import { concatBytes, utf8Encode, zeroize } from "./encoding";
import { assertAad, VaultError } from "./types";

let readyPromise: Promise<typeof sodium> | undefined;

/** Resolves once libsodium's WASM is initialised; every primitive below awaits it. */
export function sodiumReady(): Promise<typeof sodium> {
  readyPromise ??= sodium.ready.then(() => sodium);
  return readyPromise;
}

export const DATA_KEY_BYTES = 32; // crypto_aead_xchacha20poly1305_ietf_KEYBYTES
export const PAYLOAD_NONCE_BYTES = 24; // crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
export const PAYLOAD_TAG_BYTES = 16; // crypto_aead_xchacha20poly1305_ietf_ABYTES

/** A fresh random 256-bit data key. The caller owns it and must `zeroize` it when done. */
export async function generateDataKey(): Promise<Uint8Array> {
  const s = await sodiumReady();
  return s.crypto_aead_xchacha20poly1305_ietf_keygen();
}

export function assertDataKey(dataKey: Uint8Array): void {
  if (!(dataKey instanceof Uint8Array) || dataKey.byteLength !== DATA_KEY_BYTES) {
    throw new VaultError("invalid_record", `data key must be ${DATA_KEY_BYTES} bytes`);
  }
}

/**
 * Seals `plaintext` with `dataKey` and `aad`. When `plaintext` is a string it is UTF-8 encoded into a
 * temporary buffer that is zeroised before returning.
 */
export async function sealPayload(dataKey: Uint8Array, plaintext: Uint8Array | string, aad: string): Promise<Uint8Array> {
  assertDataKey(dataKey);
  assertAad(aad);
  const s = await sodiumReady();
  const owned = typeof plaintext === "string";
  const message = owned ? utf8Encode(plaintext) : plaintext;
  try {
    const nonce = s.randombytes_buf(PAYLOAD_NONCE_BYTES);
    const sealed = s.crypto_aead_xchacha20poly1305_ietf_encrypt(message, utf8Encode(aad), null, nonce, dataKey);
    return concatBytes(nonce, sealed);
  } finally {
    if (owned) zeroize(message);
  }
}

/** Opens a sealed payload. Throws `VaultError("decrypt_failed")` on any authentication failure. */
export async function openPayload(dataKey: Uint8Array, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  assertDataKey(dataKey);
  assertAad(aad);
  const s = await sodiumReady();
  if (sealed.byteLength < PAYLOAD_NONCE_BYTES + PAYLOAD_TAG_BYTES) {
    throw new VaultError("decrypt_failed", "ciphertext is too short to be a sealed payload");
  }
  const nonce = sealed.subarray(0, PAYLOAD_NONCE_BYTES);
  const body = sealed.subarray(PAYLOAD_NONCE_BYTES);
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, body, utf8Encode(aad), nonce, dataKey);
  } catch {
    throw new VaultError("decrypt_failed", "authentication failed: wrong key, wrong aad or tampered ciphertext");
  }
}
