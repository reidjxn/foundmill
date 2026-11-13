import { AppError } from "@foundmill/shared";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { FIXTURE_ORGS, FIXTURE_PEOPLE, obfuscate, type FixtureOrg, type FixturePerson } from "./fixtures/people";
import { APOLLO_CONNECT_FIELDS, APOLLO_KEY, APOLLO_RATE_LIMITS, apolloTools, type EnrichPersonOutput, type SearchOrganizationsOutput, type SearchPeopleOutput } from "./tools";

export const MOCK_NOTICE = "Simulated: these are invented example people and companies, not real Apollo data. Nothing was looked up and no credit was used.";

const lc = (s: string) => s.toLowerCase();
const orgOf = (p: FixturePerson): FixtureOrg => FIXTURE_ORGS.find((o) => o.id === p.orgId) ?? FIXTURE_ORGS[0]!;
const anyMatch = (needles: string[] | undefined, hay: string[]) => !needles?.length || needles.some((n) => hay.some((h) => lc(h).includes(lc(n))));

const toLead = (p: FixturePerson): SearchPeopleOutput["people"][number] => {
  const o = orgOf(p);
  return { id: p.id, name: `${p.first} ${obfuscate(p.last)}`, title: p.title, organizationName: o.name, organizationDomain: o.domain, linkedinUrl: p.linkedin, location: `${p.city}, ${p.state}, ${p.country}`, hasEmail: p.hasEmail };
};

const toEnriched = (p: FixturePerson): EnrichPersonOutput => {
  const o = orgOf(p);
  // The mock always has a work email on example.com for an enriched person, so the golden path can run.
  return { id: p.id, name: `${p.first} ${p.last}`, title: p.title, email: p.email ?? `${lc(p.first)}.${lc(p.last)}@example.com`, emailStatus: p.emailStatus === "unavailable" ? "likely to engage" : (p.emailStatus ?? "verified"), organizationName: o.name, organizationDomain: o.domain, linkedinUrl: p.linkedin, location: `${p.city}, ${p.state}, ${p.country}`, matchConfidence: "high", simulated: true, notice: MOCK_NOTICE };
};

/** Deterministic leads, no network. */
export const apolloMock = buildMockConnector({
  key: APOLLO_KEY,
  displayName: "Apollo",
  phase: 2,
  auth: { kind: "api_key" },
  tools: apolloTools,
  rateLimits: APOLLO_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    search_people: async (a) => {
      const hits = FIXTURE_PEOPLE.filter((p) => {
        const o = orgOf(p);
        return (
          anyMatch(a.titles, [p.title]) &&
          (!a.seniorities?.length || a.seniorities.includes(p.seniority as never)) &&
          anyMatch(a.locations, [p.city, p.state, p.country]) &&
          (!a.organizationDomains?.length || a.organizationDomains.includes(o.domain)) &&
          (!a.organizationIds?.length || a.organizationIds.includes(o.id)) &&
          (!a.keywords || [p.title, o.name, o.industry].some((h) => lc(h).includes(lc(a.keywords as string))))
        );
      });
      const start = (a.page - 1) * a.perPage;
      return { people: hits.slice(start, start + a.perPage).map(toLead), page: a.page, totalEntries: hits.length, simulated: true as const, notice: MOCK_NOTICE } satisfies SearchPeopleOutput;
    },
    search_organizations: async (a) => {
      const hits = FIXTURE_ORGS.filter((o) => {
        const inRange = !a.employeeRanges?.length || a.employeeRanges.some((r) => { const [min = 0, max = 0] = r.split(",").map(Number); return o.employees >= min && o.employees <= max; });
        return (!a.name || lc(o.name).includes(lc(a.name))) && (!a.domains?.length || a.domains.includes(o.domain)) && anyMatch(a.locations, [o.city, o.state, o.country]) && inRange && anyMatch(a.keywords, [o.industry, o.name]);
      });
      const start = (a.page - 1) * a.perPage;
      const organizations = hits.slice(start, start + a.perPage).map((o) => ({ id: o.id, name: o.name, domain: o.domain, industry: o.industry, employeeCount: o.employees, location: `${o.city}, ${o.state}, ${o.country}`, linkedinUrl: o.linkedin }));
      return { organizations, page: a.page, totalEntries: hits.length, simulated: true as const, notice: MOCK_NOTICE } satisfies SearchOrganizationsOutput;
    },
    enrich_person: async (a) => {
      const found = FIXTURE_PEOPLE.find((p) => {
        if (a.id) return p.id === a.id;
        if (a.email) return lc(p.email ?? "") === lc(a.email);
        if (a.linkedinUrl) return lc(p.linkedin).replace(/^https?:\/\/(www\.)?/, "") === lc(a.linkedinUrl).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
        return lc(p.first) === lc(a.firstName ?? "") && lc(p.last) === lc(a.lastName ?? "") && orgOf(p).domain === a.organizationDomain;
      });
      if (!found) throw new AppError("not_found", "Apollo found no match for that person (simulated; no credit used).", 404);
      return toEnriched(found);
    },
  },
  connectFields: APOLLO_CONNECT_FIELDS,
  connect: async (businessId) => mockIntegrationRecord(APOLLO_KEY, businessId, { accountLabel: "Apollo (mock)" }),
  healthcheck: async () => mockHealth(APOLLO_KEY),
});
