/**
 * Domain-name availability (audit 2026-10-13 #458): the Commit screen asks whether a business's `name.tld` candidates are
 * registered. The answer comes from the registry itself (RDAP, the keyless successor of whois), never from a guess:
 * a name the connector cannot look up is `unknown` with a reason. Availability is a snapshot; nothing here registers,
 * reserves or buys a domain, and RDAP cannot tell premium pricing, so there is no such status.
 */
import { z } from "zod";
import { DOMAIN_CHECK_MAX, parseDomain } from "@foundmill/shared";
import { defineTool } from "../../define";

export const DOMAINS_KEY = "domains";

/** One call is at most this many candidates, one registry request each. */
export const DOMAINS_MAX_PER_CALL = DOMAIN_CHECK_MAX;

export const DomainStatus = z.enum(["available", "taken", "unknown"]);
export type DomainStatus = z.infer<typeof DomainStatus>;

/** Where an answer came from: the registry's RDAP server, a DNS lookup (an estimate), or the mock. */
export const DomainProvenance = z.enum(["Registry", "DNS", "Mock"]);
export type DomainProvenance = z.infer<typeof DomainProvenance>;

export const DomainAnswer = z.object({
  domain: z.string(),
  status: DomainStatus,
  provenance: DomainProvenance,
  /** True when the answer is an estimate (the DNS fallback); a registry answer is not. */
  estimate: z.boolean(),
  checkedAt: z.string(),
  /** Registry answers only, when the registry shares them. */
  registrar: z.string().optional(),
  expires: z.string().optional(),
  /** Why the status is `unknown`, or what the estimate rests on. */
  reason: z.string().optional(),
});
export type DomainAnswer = z.infer<typeof DomainAnswer>;

export const domainsTools = [
  defineTool({
    name: "check_domains",
    title: "Check domain availability",
    description: `Ask the registry (RDAP) whether up to ${DOMAINS_MAX_PER_CALL} domain names are registered. Each answer is available, taken or unknown (with a reason), with where it came from. Only label.tld names with a letter, digit and hyphen label and a TLD in the allow-list (.com .io .co .app .ai .org .net .dev) are looked up. A snapshot: it does not register or reserve anything.`,
    input: z.object({
      domains: z
        .array(z.string().trim().max(80))
        .min(1)
        .max(DOMAINS_MAX_PER_CALL)
        .refine((list) => list.every((d) => parseDomain(d) !== null), "Each domain must be a name like example.com, with an allowed top-level domain"),
    }),
    output: z.object({ results: z.array(DomainAnswer) }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }),
] as const;

/** Per founder (the gateway keys the window on whoever asked): a call is up to eight registry requests. */
export const DOMAINS_RATE_LIMITS = { perMinute: 20, perDay: 400 };
