import { Resolver } from "node:dns/promises";
import type { DnsRecordT } from "./tools";
import { recordMatches } from "./tools";

/** The lookups the check needs (tests inject one). */
export interface RecordDns {
  resolveCname(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(name: string): Promise<string[][]>;
}

export function nodeRecordDns(timeoutMs = 4_000): RecordDns {
  const r = new Resolver({ timeout: timeoutMs, tries: 2 });
  return { resolveCname: (n) => r.resolveCname(n), resolveMx: (n) => r.resolveMx(n), resolveTxt: (n) => r.resolveTxt(n) };
}

/** One record looked up: found, or not with the resolver's reason (a code such as ENOTFOUND, never anything secret). */
export async function checkRecord(dns: RecordDns, record: DnsRecordT): Promise<{ found: boolean; reason?: string }> {
  try {
    const answer = record.type === "CNAME" ? { cname: await dns.resolveCname(record.host) } : record.type === "MX" ? { mx: await dns.resolveMx(record.host) } : { txt: await dns.resolveTxt(record.host) };
    return recordMatches(record, answer) ? { found: true } : { found: false, reason: "The record is there with another value." };
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return { found: false, reason: code === "ENOTFOUND" || code === "ENODATA" ? "Not found yet." : "The lookup did not answer. Try again in a minute." };
  }
}
