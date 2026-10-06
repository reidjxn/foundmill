/** OpenCorporates: the open database of companies across jurisdictions (v0.4 API). */
import { z } from "zod";
import { defineTool } from "../../define";

export const OPENCORPORATES_KEY = "opencorporates";
export const OPENCORPORATES_BASE_URL = "https://api.opencorporates.com/v0.4";

export const JurisdictionCode = z.string().regex(/^[a-z]{2}(_[a-z]{2})?$/, "jurisdiction code like gb, se, us_de");

export const OcCompany = z.object({
  name: z.string(),
  companyNumber: z.string(),
  jurisdictionCode: z.string(),
  incorporationDate: z.string().nullable(),
  dissolutionDate: z.string().nullable(),
  companyType: z.string().nullable(),
  currentStatus: z.string().nullable(),
  registeredAddress: z.string().nullable(),
  registryUrl: z.string().nullable(),
  opencorporatesUrl: z.string(),
  officers: z.array(z.object({ name: z.string(), position: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable() })),
});

export const opencorporatesTools = [
  defineTool({
    name: "search_companies",
    description: "Search OpenCorporates across jurisdictions by company name (wildcards allowed, e.g. 'Northwind*').",
    input: z.object({ q: z.string().min(2).max(200), jurisdictionCode: JurisdictionCode.optional(), page: z.number().int().min(1).default(1), perPage: z.number().int().min(1).max(100).default(30) }),
    output: z.object({ items: z.array(OcCompany), totalCount: z.number().int(), page: z.number().int(), perPage: z.number().int() }),
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `search:${a.jurisdictionCode ?? "*"}:${a.q}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "get_company",
    description: "One company by jurisdiction code and registry number, with its officers.",
    input: z.object({ jurisdictionCode: JurisdictionCode, companyNumber: z.string().min(1).max(40) }),
    output: OcCompany,
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `company:${a.jurisdictionCode}/${a.companyNumber}`,
    annotations: { readOnlyHint: true },
  }),
] as const;

/** Free tier is 50/day; keep the platform well under it. */
export const OPENCORPORATES_RATE_LIMITS = { perMinute: 5, perDay: 40 };

/* ---- Vendor shapes (subset) ---- */
export interface OcVendorCompany {
  name: string; company_number: string; jurisdiction_code: string; incorporation_date?: string | null; dissolution_date?: string | null; company_type?: string | null; current_status?: string | null;
  registered_address_in_full?: string | null; registry_url?: string | null; opencorporates_url: string;
  officers?: { officer: { name: string; position?: string | null; start_date?: string | null; end_date?: string | null } }[];
}
export interface OcCompanyResponse { results: { company: OcVendorCompany } }
export interface OcSearchResponse { results: { companies: { company: OcVendorCompany }[]; total_count: number; page: number; per_page: number } }

export const mapOcCompany = (c: OcVendorCompany): z.infer<typeof OcCompany> => ({
  name: c.name, companyNumber: c.company_number, jurisdictionCode: c.jurisdiction_code, incorporationDate: c.incorporation_date ?? null, dissolutionDate: c.dissolution_date ?? null,
  companyType: c.company_type ?? null, currentStatus: c.current_status ?? null, registeredAddress: c.registered_address_in_full ?? null, registryUrl: c.registry_url ?? null, opencorporatesUrl: c.opencorporates_url,
  officers: (c.officers ?? []).map(({ officer }) => ({ name: officer.name, position: officer.position ?? null, startDate: officer.start_date ?? null, endDate: officer.end_date ?? null })),
});
