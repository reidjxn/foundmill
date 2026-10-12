import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness } from "../../mock-utils";
import { CF_RECORDS, CF_ZONES, recordId } from "./fixtures/zones";
import { analyseEmailAuth, CLOUDFLARE_KEY, CLOUDFLARE_RATE_LIMITS, cloudflareTools, type DnsRecordT } from "./tools";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

/**
 * In-memory zone store, one per business (the fixtures are copied for each): records one business's agents create,
 * change or delete, no other business sees. Ids are derived from (zone, type, name, content) so repeated identical
 * creates are idempotent.
 */
export function createCloudflareMock() {
  const world = perBusiness(() => new Map<string, DnsRecordT>(CF_RECORDS.map((r) => [r.id, { ...r }])));
  const zone = (zoneId: string) => {
    const z = CF_ZONES.find((x) => x.id === zoneId);
    if (!z) throw notFound(`zone ${zoneId}`);
    return z;
  };
  const inZone = (records: Map<string, DnsRecordT>, zoneId: string) => [...records.values()].filter((r) => r.zoneId === zoneId);

  const connector = buildMockConnector({
    key: CLOUDFLARE_KEY,
    displayName: "Cloudflare DNS",
    phase: 1,
    auth: { kind: "api_key" },
    tools: cloudflareTools,
    rateLimits: CLOUDFLARE_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      list_zones: async () => ({ items: CF_ZONES.map((z) => ({ ...z, nameServers: [...z.nameServers] })) }),
      list_records: async ({ zoneId, type, name }, ctx) => {
        zone(zoneId);
        return { items: inZone(world(ctx.businessId), zoneId).filter((r) => (!type || r.type === type) && (!name || r.name.toLowerCase() === name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)) };
      },
      create_record: async ({ zoneId, type, name, content, ttl, proxied, priority }, ctx) => {
        zone(zoneId);
        const id = recordId(zoneId, type, name, content);
        const rec: DnsRecordT = { id, zoneId, type, name, content, ttl, proxied, priority: priority ?? null, modifiedOn: MOCK_NOW.toISOString() };
        world(ctx.businessId).set(id, rec);
        return rec;
      },
      update_record: async ({ zoneId, recordId: id, ...patch }, ctx) => {
        zone(zoneId);
        const records = world(ctx.businessId);
        const rec = records.get(id);
        if (!rec || rec.zoneId !== zoneId) throw notFound(`record ${id}`);
        const updated: DnsRecordT = { ...rec, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), modifiedOn: MOCK_NOW.toISOString() };
        records.set(id, updated);
        return updated;
      },
      delete_record: async ({ zoneId, recordId: id }, ctx) => {
        zone(zoneId);
        const records = world(ctx.businessId);
        const rec = records.get(id);
        if (!rec || rec.zoneId !== zoneId) throw notFound(`record ${id}`);
        records.delete(id);
        return { deleted: true as const, recordId: id };
      },
      check_email_auth: async ({ zoneId, domain, dkimSelectors }, ctx) => analyseEmailAuth(domain ?? zone(zoneId).name, inZone(world(ctx.businessId), zoneId), dkimSelectors),
    },
    connect: async (businessId) => mockIntegrationRecord(CLOUDFLARE_KEY, businessId, { accountLabel: "Cloudflare (mock)", config: { zoneIds: CF_ZONES.map((z) => z.id) } }),
    healthcheck: async () => mockHealth(CLOUDFLARE_KEY, { zones: CF_ZONES.length }),
  });
  /** Forget every business's records (tests start again from the fixtures). */
  return Object.assign(connector, { reset: () => world.clear() });
}

export const cloudflareDnsMock = createCloudflareMock();
