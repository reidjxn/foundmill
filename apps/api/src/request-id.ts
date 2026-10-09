/**
 * Request ids: the `x-request-id` a caller sends is only used when it is a plain token (8–64 letters, digits and
 * hyphens); anything else is replaced by a fresh UUID. The id is echoed in response headers, written to logs and quoted
 * in error messages, so a caller must not be able to put arbitrary text (a forged log line, markup) into any of those.
 */
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function requestIdFrom(value: string | null | undefined): string {
  return value && REQUEST_ID_RE.test(value) ? value : crypto.randomUUID();
}
