/**
 * Live `opensrs`: XCP requests to OpenSRS (tools.ts), signed `md5(md5(xml + key) + key)` with the reseller's API key.
 * Service-only: the gateway's `POST /v1/domains/register` is its one live caller.
 */
import { randomBytes } from "node:crypto";
import { uuid } from "@foundmill/shared";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { opensrsMock } from "./mock";
import { OPENSRS_HOSTS, OPENSRS_KEY, OPENSRS_NAMESERVERS, OPENSRS_RATE_LIMITS, opsContact, opsRecords, opensrsTools } from "./tools";
import { opsRequest, opsSignature, parseOps, type OpsValue } from "./xml";

/** OpenSRS answers 485 to create_dns_zone for a zone that exists; set_dns_zone then replaces its records. */
const ZONE_EXISTS = "485";

/** A registration answers in seconds; past this the press fails instead of holding the request. */
const OPENSRS_TIMEOUT_MS = 30_000;

export function createOpensrsConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const call = async (action: string, object: string, attributes: Record<string, OpsValue>, okCodes: readonly string[] = []): Promise<Record<string, unknown>> => {
    if (!secrets.opensrsUsername || !secrets.opensrsApiKey) throw new ConfigError(OPENSRS_KEY, "OPENSRS_USERNAME and OPENSRS_API_KEY", "the reseller's username and API key, on the gateway");
    const xml = opsRequest(action, object, attributes);
    const res = await fetch(secrets.opensrsEnv === "live" ? OPENSRS_HOSTS.live : OPENSRS_HOSTS.test, {
      method: "POST",
      headers: { "content-type": "text/xml", "x-username": secrets.opensrsUsername, "x-signature": opsSignature(xml, secrets.opensrsApiKey) },
      body: xml,
      signal: AbortSignal.timeout(OPENSRS_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new VendorError(OPENSRS_KEY, res.status, `${action} → HTTP ${res.status}`);
    const body = parseOps(text);
    const code = String(body.response_code ?? "");
    // OpenSRS answered and said no: a definite refusal (409), unlike a transport failure (5xx) after which it may have acted.
    if (String(body.is_success) !== "1" && !okCodes.includes(code)) throw new VendorError(OPENSRS_KEY, 409, `${action} → ${code}: ${String(body.response_text ?? "").slice(0, 200)}`);
    return body;
  };
  const attrs = (body: Record<string, unknown>) => (body.attributes ?? {}) as Record<string, unknown>;

  return buildLiveConnector(
    {
      key: OPENSRS_KEY,
      displayName: "Domain registration",
      phase: 1,
      auth: { kind: "none" },
      tools: opensrsTools,
      rateLimits: OPENSRS_RATE_LIMITS,
      now,
      handlers: {
        lookup_domain: async ({ domain }) => {
          const status = String(attrs(await call("LOOKUP", "DOMAIN", { domain })).status ?? "");
          if (status !== "available") return { domain, available: false, costMinor: null };
          const price = Number(attrs(await call("GET_PRICE", "DOMAIN", { domain, period: 1 })).price);
          return { domain, available: true, costMinor: Number.isFinite(price) ? Math.round(price * 100) : null };
        },
        register_domain: async ({ domain, owner }) => {
          const contact = opsContact(owner);
          const at = now();
          const body = await call("SW_REGISTER", "DOMAIN", {
            domain,
            reg_type: "new",
            period: 1,
            // A profile per domain, never used again: the reseller account manages it.
            reg_username: `fm${randomBytes(8).toString("hex")}`.slice(0, 20),
            reg_password: randomBytes(12).toString("base64url").slice(0, 16),
            handle: "process",
            auto_renew: 0,
            custom_tech_contact: 0,
            custom_nameservers: 1,
            nameserver_list: OPENSRS_NAMESERVERS.map((name, i) => ({ name, sortorder: i + 1 })),
            contact_set: { owner: contact, admin: contact, billing: contact },
          });
          const id = attrs(body).id;
          return { orderId: String(id ?? ""), registeredAt: at.toISOString(), expiresAt: new Date(Date.UTC(at.getUTCFullYear() + 1, at.getUTCMonth(), at.getUTCDate())).toISOString() };
        },
        set_dns_zone: async ({ domain, records }) => {
          await call("CREATE_DNS_ZONE", "DOMAIN", { domain, dns_template: "*blank*" }, [ZONE_EXISTS]);
          const body = await call("SET_DNS_ZONE", "DOMAIN", { domain, records: opsRecords(records) });
          return { nameserversOk: String(attrs(body).nameservers_ok ?? "1") === "1" };
        },
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: OPENSRS_KEY, status: "connected", scopes: [], accountLabel: "Built in", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => healthResult(secrets.opensrsApiKey ? "connected" : "disconnected", now().getTime(), { now, ...(secrets.opensrsApiKey ? {} : { message: "OPENSRS_API_KEY is not set on the gateway" }) }),
    },
    opensrsMock,
  );
}

export { opensrsMock, MOCK_COM_COST_MINOR, MOCK_OTHER_COST_MINOR } from "./mock";
export { opsRequest, opsSignature, parseOps } from "./xml";
export * from "./tools";
export { quoteDomain, registerDomain, registeredZone, registrableDomain, setupRegisteredDomain, type DomainOrder, type DomainOrders, type DomainQuote, type RegisterFlowDeps, type RegisteredDomainStore } from "./flow";
