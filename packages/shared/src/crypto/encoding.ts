/**
 * Byte/string helpers for the vault. Standard (padded) base64 is the wire form of every ciphertext field
 * so records survive JSON, Postgres `text` and log redaction untouched; the bytea columns in `credentials`
 * take the decoded bytes (see `encryptedRecordToBytes`).
 */

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** Strict decode: rejects anything that is not canonical padded base64 (Buffer would silently accept it). */
export function fromBase64(text: string): Uint8Array {
  if (typeof text !== "string" || !BASE64_RE.test(text)) throw new TypeError("not canonical base64");
  const buf = Buffer.from(text, "base64");
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

export function isBase64(text: unknown): text is string {
  return typeof text === "string" && BASE64_RE.test(text);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const utf8Encode = (s: string): Uint8Array => encoder.encode(s);
export const utf8Decode = (b: Uint8Array): string => decoder.decode(b);

/** Concatenates byte arrays into one fresh buffer. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Overwrites a buffer with zeros. Works on any Uint8Array and does not need libsodium to be ready. */
export function zeroize(bytes: Uint8Array | undefined | null): void {
  if (bytes) bytes.fill(0);
}
