/**
 * Live `sending_domain`: SendGrid's domain authentication on the platform's own key and DNS lookups, for a project's own
 * domain (tools.ts). Service-only: the gateway's `POST /v1/domains/own` calls it live, and the api its mock.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { SENDGRID_BASE_URL } from "../sendgrid/tools";
import { checkRecord, nodeRecordDns, type RecordDns } from "./dns";
import { sendingDomainMock } from "./mock";
import { recordsFromSendgrid, SENDING_DOMAIN_KEY, SENDING_DOMAIN_RATE_LIMITS, sendingDomainTools, type SgDomainDns } from "./tools";

export interface SendingDomainOptions extends LiveConnectorOptions {
  dns?: RecordDns;
}

export function createSendingDomainConnector(options: SendingDomainOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const dns = options.dns ?? nodeRecordDns();
  const http = () => {
    if (!secrets.sendgridApiKey) throw new ConfigError(SENDING_DOMAIN_KEY, "SENDGRID_API_KEY", "the platform's SendGrid key with Sender Authentication access, on the gateway");
    return createHttp({ connectorKey: SENDING_DOMAIN_KEY, baseUrl: SENDGRID_BASE_URL, fetch, headers: { authorization: `Bearer ${secrets.sendgridApiKey}` } });
  };
  return buildLiveConnector(
    {
      key: SENDING_DOMAIN_KEY,
      displayName: "Your own domain",
      phase: 1,
      auth: { kind: "none" },
      tools: sendingDomainTools,
      rateLimits: SENDING_DOMAIN_RATE_LIMITS,
      now,
      handlers: {
        authenticate_domain: async ({ domain, subdomain }) => {
          const res = await http().json<{ id: number | string; dns?: SgDomainDns }>("POST", "/v3/whitelabel/domains", { body: { domain, subdomain, automatic_security: true, custom_spf: false, default: false } });
          return { sendgridDomainId: String(res.id), records: recordsFromSendgrid(res.dns) };
        },
        validate_domain: async ({ sendgridDomainId }) => {
          const h = http();
          const [domain, res] = await Promise.all([
            h.json<{ dns?: SgDomainDns }>("GET", `/v3/whitelabel/domains/${sendgridDomainId}`),
            h.json<{ valid?: boolean; validation_results?: Record<string, { valid?: boolean; reason?: string | null } | undefined> }>("POST", `/v3/whitelabel/domains/${sendgridDomainId}/validate`),
          ]);
          const results = Object.entries(domain.dns ?? {}).flatMap(([name, r]) => {
            if (typeof r?.host !== "string") return [];
            const v = res.validation_results?.[name];
            return [{ host: r.host, found: v?.valid === true, ...(v?.valid === true ? {} : { reason: (v?.reason ?? "Not found yet.").slice(0, 300) }) }];
          });
          return { valid: res.valid === true, results };
        },
        delete_domain: async ({ sendgridDomainId }) => {
          await http().json("DELETE", `/v3/whitelabel/domains/${sendgridDomainId}`, { okStatuses: [404] });
          return { deleted: true };
        },
        check_records: async ({ records }) => ({ results: await Promise.all(records.map((r) => checkRecord(dns, r))) }),
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: SENDING_DOMAIN_KEY, status: "connected", scopes: [], accountLabel: "Built in", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => healthResult(secrets.sendgridApiKey ? "connected" : "disconnected", now().getTime(), { now, ...(secrets.sendgridApiKey ? {} : { message: "SENDGRID_API_KEY is not set on the gateway" }) }),
    },
    sendingDomainMock,
  );
}

export { sendingDomainMock, mockSendgridRecords, MOCK_NOT_YET_MARKER } from "./mock";
export { checkRecord, nodeRecordDns, type RecordDns } from "./dns";
export { ownershipRecord, runOwnDomain, type OwnDomainAction, type OwnDomainFlowDeps, type OwnDomainRow, type OwnDomainStore } from "./flow";
export * from "./tools";
