import { stableHash } from "../../../mock-utils";
import type { DnsRecordT } from "../tools";

export const CF_ZONES = [
  { id: "0b5b1a2c3d4e5f60718293a4b5c6d7e8", name: "northwindskincare.com", status: "active", nameServers: ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"] },
  { id: "1c6c2b3d4e5f60718293a4b5c6d7e8f9", name: "ledgerly.app", status: "active", nameServers: ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"] },
] as const;

export const recordId = (zoneId: string, type: string, name: string, content: string): string => stableHash([zoneId, type, name.toLowerCase(), content], 32);

const mk = (zoneId: string, type: DnsRecordT["type"], name: string, content: string, extra: Partial<DnsRecordT> = {}): DnsRecordT => ({ id: recordId(zoneId, type, name, content), zoneId, type, name, content, ttl: 1, proxied: false, priority: null, modifiedOn: "2026-09-01T10:00:00.000Z", ...extra });

const NW = CF_ZONES[0].id;
const LG = CF_ZONES[1].id;

export const CF_RECORDS: DnsRecordT[] = [
  mk(NW, "A", "northwindskincare.com", "76.76.21.21", { proxied: true }),
  mk(NW, "CNAME", "www.northwindskincare.com", "cname.vercel-dns.com", { proxied: true }),
  mk(NW, "TXT", "northwindskincare.com", "v=spf1 include:sendgrid.net include:_spf.google.com ~all"),
  mk(NW, "CNAME", "s1._domainkey.northwindskincare.com", "s1.domainkey.u1234567.wl123.sendgrid.net"),
  mk(NW, "CNAME", "s2._domainkey.northwindskincare.com", "s2.domainkey.u1234567.wl123.sendgrid.net"),
  mk(NW, "TXT", "_dmarc.northwindskincare.com", "v=DMARC1; p=quarantine; rua=mailto:dmarc@northwindskincare.com"),
  mk(NW, "MX", "northwindskincare.com", "aspmx.l.google.com", { priority: 1 }),
  mk(LG, "A", "ledgerly.app", "76.76.21.21", { proxied: true }),
  mk(LG, "TXT", "ledgerly.app", "v=spf1 include:_spf.google.com ~all"),
];
