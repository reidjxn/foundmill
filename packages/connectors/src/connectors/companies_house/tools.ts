/** Companies House Public Data API (UK register): company lookup and officers. Read-only public data. */
import { z } from "zod";
import { defineTool } from "../../define";

export const COMPANIES_HOUSE_KEY = "companies_house";
export const COMPANIES_HOUSE_BASE_URL = "https://api.company-information.service.gov.uk";

export const CompanyNumber = z.string().regex(/^[A-Z0-9]{8}$/i, "Companies House numbers are 8 characters, e.g. 09876543 or SC123456").transform((s) => s.toUpperCase());

export const Address = z.object({ line1: z.string().nullable(), line2: z.string().nullable(), locality: z.string().nullable(), postalCode: z.string().nullable(), country: z.string().nullable() });

export const CompanySummary = z.object({ companyNumber: z.string(), title: z.string(), status: z.string().nullable(), dateOfCreation: z.string().nullable(), addressSnippet: z.string().nullable() });

export const CompanyProfile = z.object({
  companyNumber: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  type: z.string().nullable(),
  dateOfCreation: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  sicCodes: z.array(z.string()),
  registeredOfficeAddress: Address,
  accounts: z.object({ nextDueOn: z.string().nullable(), overdue: z.boolean() }),
  confirmationStatement: z.object({ nextDueOn: z.string().nullable(), overdue: z.boolean() }),
});

export const Officer = z.object({ name: z.string(), role: z.string(), appointedOn: z.string().nullable(), resignedOn: z.string().nullable(), nationality: z.string().nullable(), occupation: z.string().nullable() });

export const companiesHouseTools = [
  defineTool({
    name: "search_companies",
    description: "Search the UK Companies House register by name or number.",
    input: z.object({ q: z.string().min(2).max(200), itemsPerPage: z.number().int().min(1).max(100).default(20) }),
    output: z.object({ items: z.array(CompanySummary), totalResults: z.number().int() }),
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `search:${a.q}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "get_company",
    description: "Company profile from Companies House: status, type, SIC codes, registered office, filing due dates.",
    input: z.object({ companyNumber: CompanyNumber }),
    output: CompanyProfile,
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `company:${a.companyNumber}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "list_officers",
    description: "Current and resigned officers of a UK company.",
    input: z.object({ companyNumber: CompanyNumber, itemsPerPage: z.number().int().min(1).max(100).default(35) }),
    output: z.object({ items: z.array(Officer), activeCount: z.number().int(), resignedCount: z.number().int() }),
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `officers:${a.companyNumber}`,
    annotations: { readOnlyHint: true },
  }),
] as const;

/** Companies House allows 600 requests per 5 minutes per key. */
export const COMPANIES_HOUSE_RATE_LIMITS = { perMinute: 100, perDay: 20_000 };

/* ---- Vendor shapes (subset) ---- */
export interface ChAddress { address_line_1?: string; address_line_2?: string; locality?: string; postal_code?: string; country?: string }
export interface ChSearchItem { company_number: string; title: string; company_status?: string; date_of_creation?: string; address_snippet?: string }
export interface ChSearchResponse { items?: ChSearchItem[]; total_results?: number }
export interface ChCompanyProfile {
  company_number: string; company_name: string; company_status?: string; type?: string; date_of_creation?: string; jurisdiction?: string; sic_codes?: string[];
  registered_office_address?: ChAddress; accounts?: { next_due?: string; overdue?: boolean }; confirmation_statement?: { next_due?: string; overdue?: boolean };
}
export interface ChOfficer { name: string; officer_role: string; appointed_on?: string; resigned_on?: string; nationality?: string; occupation?: string }
export interface ChOfficersResponse { items?: ChOfficer[]; active_count?: number; resigned_count?: number }

export const mapAddress = (a: ChAddress | undefined): z.infer<typeof Address> => ({ line1: a?.address_line_1 ?? null, line2: a?.address_line_2 ?? null, locality: a?.locality ?? null, postalCode: a?.postal_code ?? null, country: a?.country ?? null });
export const mapSearchItem = (i: ChSearchItem): z.infer<typeof CompanySummary> => ({ companyNumber: i.company_number, title: i.title, status: i.company_status ?? null, dateOfCreation: i.date_of_creation ?? null, addressSnippet: i.address_snippet ?? null });
export const mapProfile = (p: ChCompanyProfile): z.infer<typeof CompanyProfile> => ({
  companyNumber: p.company_number, name: p.company_name, status: p.company_status ?? null, type: p.type ?? null, dateOfCreation: p.date_of_creation ?? null, jurisdiction: p.jurisdiction ?? null,
  sicCodes: p.sic_codes ?? [], registeredOfficeAddress: mapAddress(p.registered_office_address),
  accounts: { nextDueOn: p.accounts?.next_due ?? null, overdue: p.accounts?.overdue ?? false },
  confirmationStatement: { nextDueOn: p.confirmation_statement?.next_due ?? null, overdue: p.confirmation_statement?.overdue ?? false },
});
export const mapOfficer = (o: ChOfficer): z.infer<typeof Officer> => ({ name: o.name, role: o.officer_role, appointedOn: o.appointed_on ?? null, resignedOn: o.resigned_on ?? null, nationality: o.nationality ?? null, occupation: o.occupation ?? null });
