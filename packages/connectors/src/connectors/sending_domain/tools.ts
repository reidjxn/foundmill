/**
 * `sending_domain`: a project's own domain at Foundmill's SendGrid (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md,
 * Path B). SendGrid's domain authentication on the platform's own key (`SENDGRID_API_KEY`, gateway only), on the `em`
 * subdomain with automatic security, so the founder adds three CNAMEs and their own MX is never touched; and a DNS check
 * for the other records the founder adds (the site's `www` record, and in Path A the inbound MX and DMARC).
 *
 * Service-only (`SERVICE_ONLY_CONNECTORS`): only the gateway's `POST /v1/domains/own` calls it live, for the api (the api runs its mock itself), after the
 * founder pressed a button in Settings › Integrations. No agent session can reach it. Its mode follows `sendgrid`.
 */
import { z } from "zod";
import { defineTool } from "../../define";

export const SENDING_DOMAIN_KEY = "sending_domain";
export const SENDING_DOMAIN_RATE_LIMITS = { perMinute: 30 };

/** At most this many records are looked up in one check. */
export const DNS_CHECK_MAX = 10;

const Domain = z.string().trim().toLowerCase().max(253).regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/);
const Host = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/);
const SendgridId = z.string().regex(/^\d{1,20}$/);

export const DnsRecord = z.object({ type: z.enum(["CNAME", "MX", "TXT"]), host: Host, value: z.string().trim().min(1).max(500) });
export type DnsRecordT = z.infer<typeof DnsRecord>;

export const RecordCheck = z.object({ found: z.boolean(), reason: z.string().max(300).optional() });

export const sendingDomainTools = [
  defineTool({
    name: "authenticate_domain",
    description: "Platform only: start SendGrid's domain authentication for a project's own domain and return the CNAME records to add. Never available to agents.",
    input: z.object({ domain: Domain, subdomain: z.string().regex(/^[a-z0-9]{1,20}$/) }),
    output: z.object({ sendgridDomainId: SendgridId, records: z.array(DnsRecord) }),
    hints: {},
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  }),
  defineTool({
    name: "validate_domain",
    description: "Platform only: ask SendGrid to look up the domain's authentication records, and say which it found. Never available to agents.",
    input: z.object({ sendgridDomainId: SendgridId, domain: Domain }),
    output: z.object({ valid: z.boolean(), results: z.array(RecordCheck.extend({ host: z.string() })) }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }),
  defineTool({
    name: "delete_domain",
    description: "Platform only: remove a project's domain authentication from SendGrid once the founders removed the domain. Never available to agents.",
    input: z.object({ sendgridDomainId: SendgridId }),
    output: z.object({ deleted: z.boolean() }),
    hints: { irreversible: true },
  }),
  defineTool({
    name: "check_records",
    description: `Platform only: look up up to ${DNS_CHECK_MAX} DNS records (CNAME, MX, TXT) and say whether each has the expected value. Never available to agents.`,
    input: z.object({ records: z.array(DnsRecord).min(1).max(DNS_CHECK_MAX) }),
    output: z.object({ results: z.array(RecordCheck) }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }),
] as const;

/** SendGrid's DNS block, as `POST /v3/whitelabel/domains` returns it (automatic security: three CNAMEs). */
export interface SgDomainDns {
  [name: string]: { host?: string; type?: string; data?: string; valid?: boolean } | undefined;
}

/** The records in SendGrid's answer, in a stable order (mail CNAME first, then the DKIM keys). */
export function recordsFromSendgrid(dns: SgDomainDns | undefined): DnsRecordT[] {
  return Object.keys(dns ?? {})
    .sort((a, b) => (a === "mail_cname" ? -1 : b === "mail_cname" ? 1 : a.localeCompare(b)))
    .map((k) => dns![k])
    .filter((r): r is { host: string; type: string; data: string } => typeof r?.host === "string" && typeof r.data === "string" && typeof r.type === "string")
    .map((r) => DnsRecord.parse({ type: r.type.toUpperCase(), host: r.host, value: r.data }));
}

/** Host names compare without case or the trailing dot. */
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\.$/, "") === b.trim().toLowerCase().replace(/\.$/, "");

/** Whether what DNS answered for a record holds the expected value. */
export function recordMatches(record: DnsRecordT, answer: { cname?: string[]; mx?: { exchange: string; priority: number }[]; txt?: string[][] }): boolean {
  if (record.type === "CNAME") return (answer.cname ?? []).some((v) => sameName(v, record.value));
  if (record.type === "MX") return (answer.mx ?? []).some((m) => sameName(m.exchange, record.value));
  return (answer.txt ?? []).some((parts) => parts.join("").trim() === record.value.trim());
}
