/**
 * Document names on the collab server (BUILD §11.5): `spec:<businessId>:<specBlockId>`.
 *
 * The business id is part of the name so authorisation can run before the document is loaded and so a
 * client can never reach a block through another business's membership.
 */
export const SPEC_DOCUMENT_PREFIX = "spec" as const;

/** 8-4-4-4-12 hex (GUID), not strict RFC-4122: seeded fixtures use ids whose version nibble is not v4 (DECISIONS). */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (s: string): boolean => GUID_RE.test(s);
const isUuid = isGuid;

export interface SpecDocumentName {
  kind: typeof SPEC_DOCUMENT_PREFIX;
  businessId: string;
  specBlockId: string;
}

export class InvalidDocumentNameError extends Error {
  readonly reason = "invalid-document-name";
  constructor(name: string) {
    super(`Invalid collab document name: ${JSON.stringify(name)} (expected spec:<businessId>:<specBlockId>)`);
    this.name = "InvalidDocumentNameError";
  }
}

export function specDocumentName(businessId: string, specBlockId: string): string {
  if (!isUuid(businessId) || !isUuid(specBlockId)) throw new InvalidDocumentNameError(`${SPEC_DOCUMENT_PREFIX}:${businessId}:${specBlockId}`);
  return `${SPEC_DOCUMENT_PREFIX}:${businessId.toLowerCase()}:${specBlockId.toLowerCase()}`;
}

/** Parses a document name; throws `InvalidDocumentNameError` for anything that is not a spec block name. */
export function parseDocumentName(name: string): SpecDocumentName {
  const parts = name.split(":");
  if (parts.length !== 3) throw new InvalidDocumentNameError(name);
  const [prefix, businessId, specBlockId] = parts as [string, string, string];
  if (prefix !== SPEC_DOCUMENT_PREFIX || !isUuid(businessId) || !isUuid(specBlockId)) throw new InvalidDocumentNameError(name);
  return { kind: SPEC_DOCUMENT_PREFIX, businessId: businessId.toLowerCase(), specBlockId: specBlockId.toLowerCase() };
}

export function tryParseDocumentName(name: string): SpecDocumentName | null {
  try {
    return parseDocumentName(name);
  } catch {
    return null;
  }
}
