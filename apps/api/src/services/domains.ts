/**
 * Domain availability for the Commit screen (audit 2026-10-13 #458): `idea.domainCheck` turns a business name (or up to
 * eight candidate domains) into the names to look up and asks the gateway, the one service that reaches registries. The
 * names a founder tries are neither stored nor logged here.
 */
import { mockDomainAnswer } from "@foundmill/connectors";
import { AppError, DOMAIN_CHECK_MAX, connectorMode, domainCandidates, parseDomain, type Env } from "@foundmill/shared";
import { z } from "zod";
import type { ApiGatewayClient, GatewayDomainAnswer } from "./gateway";

/** A business name, or the domains themselves: exactly one. */
export const DomainCheckInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    domains: z
      .array(z.string().trim().max(80))
      .min(1)
      .max(DOMAIN_CHECK_MAX)
      .refine((list) => list.every((d) => parseDomain(d) !== null), "Each domain must be a name like example.com, with an allowed top-level domain")
      .optional(),
  })
  .refine((v) => (v.name ? 1 : 0) + (v.domains ? 1 : 0) === 1, { message: "Give a business name or a list of domains", path: ["name"] });
export type DomainCheckInput = z.infer<typeof DomainCheckInput>;

/** What the founder is told when the gateway cannot answer; the Commit screen shows "Couldn't check" with a Retry. */
const UNAVAILABLE = "The domain check is not available right now. Try again in a minute.";

/** The domains `input` asks about, lower case and without repeats; none when a name cannot make a valid domain label. */
export function domainsToCheck(input: DomainCheckInput): string[] {
  const list = input.domains ?? domainCandidates(input.name ?? "");
  return [...new Set(list.map((d) => d.trim().toLowerCase()))];
}

/**
 * In mock mode (`INTEGRATIONS_MODE=mock` and `domains` not in `LIVE_CONNECTORS`) the deterministic mock answers right here:
 * it calls nobody, so the golden path needs no gateway, and every row says "Mock". Live, the gateway asks the registries.
 */
export async function checkDomainAvailability(deps: { env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">; gateway: ApiGatewayClient }, userId: string, input: DomainCheckInput): Promise<GatewayDomainAnswer[]> {
  const domains = domainsToCheck(input);
  if (domains.length === 0) return [];
  if (connectorMode(deps.env, "domains") === "mock") return domains.map(mockDomainAnswer);
  const { gateway } = deps;
  try {
    return await gateway.checkDomains(userId, domains);
  } catch (err) {
    // The gateway's own rate limit is the founder's to read; everything else is "not available right now".
    if (err instanceof AppError && err.code === "rate_limited") throw err;
    throw new AppError("domains_unavailable", UNAVAILABLE, 503);
  }
}
