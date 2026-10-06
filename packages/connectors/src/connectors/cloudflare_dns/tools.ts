/** Cloudflare DNS: zones and records (sending-domain setup for SendGrid: SPF/DKIM/DMARC). */
import { z } from "zod";
import { defineTool } from "../../define";

export const CLOUDFLARE_KEY = "cloudflare_dns";
export const CLOUDFLARE_BASE_URL = "https://api.cloudflare.com/client/v4";

export const RecordType = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "CAA"]);
export const ZoneId = z.string().regex(/^[a-f0-9]{32}$/, "Cloudflare zone id (32 hex chars)");
export const RecordId = z.string().regex(/^[a-f0-9]{32}$/, "Cloudflare record id (32 hex chars)");

export const Zone = z.object({ id: z.string(), name: z.string(), status: z.string(), nameServers: z.array(z.string()) });
export const DnsRecord = z.object({ id: z.string(), zoneId: z.string(), type: RecordType, name: z.string(), content: z.string(), ttl: z.number().int(), proxied: z.boolean(), priority: z.number().int().nullable(), modifiedOn: z.string() });
export type DnsRecordT = z.infer<typeof DnsRecord>;

const RecordFields = { type: RecordType, name: z.string().min(1).max(255), content: z.string().min(1).max(4096), ttl: z.number().int().min(1).max(86_400).default(1), proxied: z.boolean().default(false), priority: z.number().int().min(0).max(65_535).optional() };

export const cloudflareTools = [
  defineTool({ name: "list_zones", description: "Zones (domains) the token can manage.", input: z.object({}), output: z.object({ items: z.array(Zone) }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "list_records",
    description: "DNS records of a zone, optionally filtered by type and exact name.",
    input: z.object({ zoneId: ZoneId, type: RecordType.optional(), name: z.string().optional() }),
    output: z.object({ items: z.array(DnsRecord) }),
    hints: {},
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "create_record",
    description: "Create a DNS record. Used to add SPF/DKIM/DMARC/CNAME records for sending domains and preview deploys. Reversible (delete_record).",
    input: z.object({ zoneId: ZoneId, ...RecordFields }),
    output: DnsRecord,
    hints: {},
  }),
  defineTool({
    name: "update_record",
    description: "Change an existing DNS record's content, TTL, proxy flag or name.",
    input: z.object({ zoneId: ZoneId, recordId: RecordId, name: z.string().min(1).max(255).optional(), content: z.string().min(1).max(4096).optional(), ttl: z.number().int().min(1).max(86_400).optional(), proxied: z.boolean().optional() }),
    output: DnsRecord,
    hints: {},
  }),
  defineTool({
    name: "delete_record",
    description: "Delete a DNS record. Cannot be undone through the API (re-create instead); never used on NS or security-relevant records.",
    input: z.object({ zoneId: ZoneId, recordId: RecordId }),
    output: z.object({ deleted: z.literal(true), recordId: z.string() }),
    hints: { irreversible: true },
  }),
  defineTool({
    name: "check_email_auth",
    description: "Read the SPF, DKIM (common selectors) and DMARC records of a domain and report what is missing before any email channel goes live (BUILD §11.7 guardrails).",
    input: z.object({ zoneId: ZoneId, domain: z.string().min(3).max(253).optional(), dkimSelectors: z.array(z.string().min(1).max(63)).max(10).default(["s1", "s2", "em", "google", "default"]) }),
    output: z.object({
      domain: z.string(),
      spf: z.object({ found: z.boolean(), record: z.string().nullable(), includesSendgrid: z.boolean() }),
      dkim: z.object({ found: z.boolean(), selectors: z.array(z.string()) }),
      dmarc: z.object({ found: z.boolean(), record: z.string().nullable(), policy: z.enum(["none", "quarantine", "reject"]).nullable() }),
      ready: z.boolean(),
    }),
    hints: {},
    annotations: { readOnlyHint: true },
  }),
] as const;

export const CLOUDFLARE_RATE_LIMITS = { perMinute: 600, perDay: 50_000 };

/* ---- Vendor shapes (subset) ---- */
export interface CfEnvelope<T> { success: boolean; result: T; errors?: { code: number; message: string }[] }
export interface CfZone { id: string; name: string; status: string; name_servers?: string[] }
export interface CfRecord { id: string; zone_id?: string; type: string; name: string; content: string; ttl: number; proxied?: boolean; priority?: number; modified_on?: string }

export const mapZone = (z: CfZone): z.infer<typeof Zone> => ({ id: z.id, name: z.name, status: z.status, nameServers: z.name_servers ?? [] });
export const mapRecord = (zoneId: string, r: CfRecord): DnsRecordT => ({ id: r.id, zoneId: r.zone_id ?? zoneId, type: r.type as DnsRecordT["type"], name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied ?? false, priority: r.priority ?? null, modifiedOn: r.modified_on ?? new Date(0).toISOString() });

/** Shared SPF/DKIM/DMARC analysis over a record list (used by live and mock). */
export function analyseEmailAuth(domain: string, records: readonly DnsRecordT[], selectors: readonly string[]) {
  const txtAt = (name: string) => records.filter((r) => r.type === "TXT" && r.name.toLowerCase() === name.toLowerCase());
  const spf = txtAt(domain).find((r) => /^"?v=spf1/i.test(r.content)) ?? null;
  const dmarc = txtAt(`_dmarc.${domain}`).find((r) => /^"?v=DMARC1/i.test(r.content)) ?? null;
  const policy = dmarc ? (/p=(none|quarantine|reject)/i.exec(dmarc.content)?.[1]?.toLowerCase() as "none" | "quarantine" | "reject" | undefined) ?? null : null;
  const dkimSelectors = selectors.filter((s) => records.some((r) => r.name.toLowerCase() === `${s}._domainkey.${domain}`.toLowerCase() && (r.type === "CNAME" || r.type === "TXT")));
  return {
    domain,
    spf: { found: Boolean(spf), record: spf?.content ?? null, includesSendgrid: Boolean(spf && /include:sendgrid\.net/i.test(spf.content)) },
    dkim: { found: dkimSelectors.length > 0, selectors: dkimSelectors },
    dmarc: { found: Boolean(dmarc), record: dmarc?.content ?? null, policy },
    ready: Boolean(spf) && dkimSelectors.length > 0 && Boolean(dmarc),
  };
}
