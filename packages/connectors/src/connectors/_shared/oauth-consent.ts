/**
 * The first step of an OAuth connect (Google, Notion, Shopify). Consent is a founder click (a hard gate), so connect()
 * without a `code` changes nothing: it answers the vendor's consent page as `config.authorizeUrl`. The api signs
 * `state` for the founder, the business and the connector and sets `redirectUri` from APP_URL
 * (`<APP_URL>/integrations/oauth/callback`, apps/web); the vendor sends both back with the code, and the second
 * connect() exchanges the code with the same `redirectUri`.
 */
import { ValidationError } from "@foundmill/shared";
import type { IntegrationRecord } from "../../contract";

/** A state the api signed (`<base64url payload>.<base64url mac>`); the api verifies it, this only checks its shape. */
const SIGNED_STATE = /^[A-Za-z0-9_-]{1,600}\.[A-Za-z0-9_-]{1,100}$/;

export interface ConsentStart {
  state: string;
  redirectUri: string;
}

/** True when the connect input already carries the vendor's authorization code (the second step). */
export const hasAuthorizationCode = (input: unknown): boolean => typeof input === "object" && input !== null && typeof (input as { code?: unknown }).code === "string";

/** The signed state and the redirect URI of a first step; throws a 400 when the api did not supply them. */
export function consentStartOf(input: unknown, displayName: string): ConsentStart {
  const i = (typeof input === "object" && input ? input : {}) as { state?: unknown; redirectUri?: unknown };
  if (typeof i.state !== "string" || !SIGNED_STATE.test(i.state)) throw new ValidationError(`Connecting ${displayName} needs a signed state from the api`);
  if (typeof i.redirectUri !== "string" || !isRedirectUri(i.redirectUri)) throw new ValidationError(`Connecting ${displayName} needs the app's OAuth callback address`);
  return { state: i.state, redirectUri: i.redirectUri };
}

function isRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

/** The authorize URL with its query (values encoded). */
export function authorizeUrl(base: string, query: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

/** What a first step returns: nothing connected yet, only the consent page to open. */
export function consentRecord(connectorKey: string, businessId: string, url: string, opts: { now: () => Date; newId: () => string }): IntegrationRecord {
  const createdAt = opts.now().toISOString();
  return { id: opts.newId(), businessId, connectorKey, status: "disconnected", scopes: [], accountLabel: null, externalAccountId: null, config: { authorizeUrl: url }, credentialRef: null, expiresAt: null, lastHealthAt: null, createdAt };
}
