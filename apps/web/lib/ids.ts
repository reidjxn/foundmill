/** Ids in addresses: the API takes RFC 4122-shaped GUIDs (`z.guid()`), so a route id is checked before any query uses it. */
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string | null | undefined): value is string {
  return typeof value === "string" && GUID_RE.test(value);
}
