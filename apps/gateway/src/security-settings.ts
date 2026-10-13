/**
 * Calls that change a security setting (BUILD §2.2 "change security settings"), recognised from their arguments.
 *
 * A connector's static policy hints cannot say that one `cloudflare_dns.update_record` call repoints the domain's mail
 * while the next only changes a preview CNAME. The gateway therefore reads the call: a DNS change that routes or
 * authenticates email or the zone itself (MX, NS, CAA records; SPF, DKIM and DMARC records) is a security-settings change.
 * The Cedar policy `hard-gate-security-settings` forbids it in every business mode and the gateway queues the work for
 * the founder, who makes the change in their DNS provider (audit GPC-08). The connector checks the record type and name an
 * agent states against the record itself, so what is read here is what the call changes.
 */

export interface SecuritySettingsChange {
  /** Why the call is held, in a founder's words. */
  reason: string;
  /** The founder's task title. */
  title: string;
  /** What the founder does instead. */
  instructions: string;
}

const DNS_TOOLS: ReadonlySet<string> = new Set(["create_record", "update_record", "delete_record"]);
/** Record types that route mail or decide who may issue certificates or serve the zone. */
const SECURITY_RECORD_TYPES: ReadonlySet<string> = new Set(["MX", "NS", "CAA"]);
const EMAIL_AUTH_NAME = /(^|\.)_dmarc(\.|$)|(^|\.)_domainkey(\.|$)|\._domainkey\b/i;
const EMAIL_AUTH_CONTENT = /^\s*"?\s*v=(spf1|dmarc1|dkim1)\b/i;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The change this call makes to a security setting, or null when it is an ordinary call. */
export function securitySettingsChange(connector: string, tool: string, args: unknown): SecuritySettingsChange | null {
  if (connector !== "cloudflare_dns" || !DNS_TOOLS.has(tool)) return null;
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const type = str(a["type"]).toUpperCase();
  const names = [str(a["recordName"]), str(a["name"])].filter(Boolean);
  const content = str(a["content"]);
  const shown = names[0] ?? "a record";

  // An update or delete that does not say what it changes cannot be read: held, never guessed at.
  const unknown = tool !== "create_record" && (!type || !str(a["recordName"]));
  const sensitive =
    unknown ||
    SECURITY_RECORD_TYPES.has(type) ||
    names.some((n) => EMAIL_AUTH_NAME.test(n)) ||
    EMAIL_AUTH_CONTENT.test(content) ||
    // A TXT record changed or deleted by id may be the domain's SPF or DMARC record; its content is not in the call.
    (type === "TXT" && tool !== "create_record");
  if (!sensitive) return null;

  const verb = tool === "create_record" ? "adding" : tool === "update_record" ? "changing" : "deleting";
  return {
    reason: `Hard gate: ${verb} ${type || "DNS"} record ${shown} changes how the domain's email is routed or authenticated`,
    title: `Change the ${type || "DNS"} record for ${shown} yourself`,
    instructions: `Agents never change DNS records that route or authenticate email, or that control the zone (MX, NS, CAA, SPF, DKIM, DMARC). Make this change in your DNS provider: ${verb} ${type || "the"} record ${shown}${content ? ` with the value ${content}` : ""}. Check the value first: a wrong record can send your email, including password resets and invoices, to someone else.`,
  };
}
