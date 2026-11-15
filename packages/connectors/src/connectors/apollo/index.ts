/**
 * Live Apollo connector over the injected fetch (no SDK). The founder's own account only: the key comes from the connect
 * form and then from `ctx.credential`; there is no platform key and `secrets` is never read. The key travels in the
 * `x-api-key` header and nowhere else, and any vendor failure is rebuilt from its status alone: Apollo's error text and
 * people data never reach an error message. Logs carry counts only (the harness logs tool name and cost), never names.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type RequestOptions } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { apolloMock } from "./mock";
import { APOLLO_BASE_URL, APOLLO_CONNECT_FIELDS, APOLLO_KEY, APOLLO_RATE_LIMITS, apolloTools, mapMatch, mapOrganizations, mapPeopleSearch, type ApMatchResponse, type ApOrgSearchResponse, type ApPeopleSearchResponse, type SearchOrganizationsInput, type SearchPeopleInput } from "./tools";

/** The key in hand is masked out of any text before it can reach a message; Apollo keys have no fixed prefix. */
export const redactKeys = (text: string, secret?: string): string => (secret ? text.split(secret).join("…") : text);

type Query = NonNullable<RequestOptions["query"]>;

/** Apollo takes every parameter in the query string, even on POST; list parameters are named with a trailing `[]`. */
const list = (v: readonly string[] | undefined): string[] | undefined => (v?.length ? [...v] : undefined);

export function peopleQuery(a: SearchPeopleInput): Query {
  return {
    "person_titles[]": list(a.titles),
    "person_seniorities[]": list(a.seniorities),
    "person_locations[]": list(a.locations),
    "q_organization_domains_list[]": list(a.organizationDomains),
    "organization_ids[]": list(a.organizationIds),
    q_keywords: a.keywords,
    page: a.page,
    per_page: a.perPage,
  };
}

export function organizationsQuery(a: SearchOrganizationsInput): Query {
  return {
    q_organization_name: a.name,
    "q_organization_domains_list[]": list(a.domains),
    "organization_locations[]": list(a.locations),
    "organization_num_employees_ranges[]": list(a.employeeRanges),
    "q_organization_keyword_tags[]": list(a.keywords),
    page: a.page,
    per_page: a.perPage,
  };
}

export function createApolloConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(APOLLO_KEY, "the business's own Apollo API key", "connect Apollo in Settings › Integrations");

  /** One call with the given key. A vendor failure is rebuilt from its status; the raw body and text are dropped. */
  const call = async <T>(secret: string, path: string, query?: Query): Promise<T | undefined> => {
    const http = createHttp({ connectorKey: APOLLO_KEY, baseUrl: APOLLO_BASE_URL, fetch, headers: { "x-api-key": secret } });
    try {
      return await http.json<T>("POST", path, query ? { query } : {});
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      throw new VendorError(APOLLO_KEY, e.httpStatus, `POST ${path} → ${e.httpStatus}`);
    }
  };

  /**
   * Reading the API usage stats spends no credit and is the check used for connecting and for health. A 403 means Apollo
   * knew the key but it is not allowed this endpoint (a key limited to certain endpoints), which still proves the key is
   * real; only a 401 is "wrong key".
   */
  const checkKey = async (secret: string): Promise<{ limitedScope: boolean }> => {
    try {
      await call(secret, "/api/v1/usage_stats/api_usage_stats");
      return { limitedScope: false };
    } catch (e) {
      if (e instanceof VendorError && e.httpStatus === 403) return { limitedScope: true };
      throw e;
    }
  };

  return buildLiveConnector(
    {
      key: APOLLO_KEY,
      displayName: "Apollo",
      phase: 2,
      auth: { kind: "api_key" },
      tools: apolloTools,
      rateLimits: APOLLO_RATE_LIMITS,
      now,
      handlers: {
        search_people: async (a, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const res = await call<ApPeopleSearchResponse>(secret, "/api/v1/mixed_people/api_search", peopleQuery(a));
          const out = mapPeopleSearch(res, a.page);
          ctx.log.info({ connector: APOLLO_KEY, tool: "search_people", count: out.people.length }, "apollo people search");
          return out;
        },
        search_organizations: async (a, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const res = await call<ApOrgSearchResponse>(secret, "/api/v1/mixed_companies/search", organizationsQuery(a));
          const out = mapOrganizations(res, a.page);
          ctx.log.info({ connector: APOLLO_KEY, tool: "search_organizations", count: out.organizations.length }, "apollo company search");
          return out;
        },
        enrich_person: async (a, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          // Work details only: personal emails and phone numbers are never revealed, and no webhook, polling or waterfall
          // is ever requested, so one match is one credit at most.
          const res = await call<ApMatchResponse>(secret, "/api/v1/people/match", {
            id: a.id,
            email: a.email,
            first_name: a.firstName,
            last_name: a.lastName,
            domain: a.organizationDomain,
            linkedin_url: a.linkedinUrl,
            reveal_personal_emails: false,
            reveal_phone_number: false,
          });
          const out = mapMatch(res);
          ctx.log.info({ connector: APOLLO_KEY, tool: "enrich_person", matched: out !== null }, "apollo person lookup");
          if (!out) throw new VendorError(APOLLO_KEY, 404, "POST /api/v1/people/match → 404 (no match found)");
          return out;
        },
      },
      connectFields: APOLLO_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(APOLLO_KEY, "apiKey", "Enter your Apollo API key to connect Apollo");
        await checkKey(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: APOLLO_KEY,
          status: "connected",
          scopes: [],
          accountLabel: "Apollo",
          externalAccountId: null,
          config: {},
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        const secret = credential?.secret;
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No Apollo API key is connected" });
        try {
          const { limitedScope } = await checkKey(secret);
          return healthResult("connected", startedAt, { now, ...(limitedScope ? { details: { usageStats: "not permitted for this key" } } : {}) });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    apolloMock,
  );
}

export { apolloMock } from "./mock";
export { apolloTools, APOLLO_KEY } from "./tools";
