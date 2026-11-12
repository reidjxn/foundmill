/**
 * Deterministic fixture leads for the mock connector: a fictional skincare brand's customers and a fictional fintech's.
 * Every person and company is invented; every email is on example.com (reserved, never delivers).
 */
export interface FixtureOrg {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employees: number;
  city: string;
  state: string;
  country: string;
  linkedin: string;
}
export interface FixturePerson {
  id: string;
  first: string;
  last: string;
  title: string;
  seniority: string;
  orgId: string;
  city: string;
  state: string;
  country: string;
  email: string | null;
  emailStatus: string | null;
  linkedin: string;
  hasEmail: boolean;
}

export const FIXTURE_ORGS: FixtureOrg[] = [
  { id: "org_fx_glowlab01", name: "Glow Lab Studio", domain: "glowlab.example.com", industry: "cosmetics", employees: 14, city: "Austin", state: "Texas", country: "United States", linkedin: "https://www.linkedin.com/company/glow-lab-studio" },
  { id: "org_fx_pureskin02", name: "Pure Skin Clinic", domain: "pureskin.example.com", industry: "health, wellness and fitness", employees: 32, city: "Denver", state: "Colorado", country: "United States", linkedin: "https://www.linkedin.com/company/pure-skin-clinic" },
  { id: "org_fx_botanica03", name: "Botanica Beauty Co", domain: "botanica.example.com", industry: "cosmetics", employees: 8, city: "Portland", state: "Oregon", country: "United States", linkedin: "https://www.linkedin.com/company/botanica-beauty-co" },
  { id: "org_fx_ledgerly04", name: "Ledgerly", domain: "ledgerly.example.com", industry: "financial services", employees: 45, city: "New York", state: "New York", country: "United States", linkedin: "https://www.linkedin.com/company/ledgerly" },
  { id: "org_fx_paystream05", name: "Paystream", domain: "paystream.example.com", industry: "financial services", employees: 120, city: "Chicago", state: "Illinois", country: "United States", linkedin: "https://www.linkedin.com/company/paystream" },
  { id: "org_fx_budgetbird06", name: "Budgetbird", domain: "budgetbird.example.com", industry: "information technology and services", employees: 22, city: "Seattle", state: "Washington", country: "United States", linkedin: "https://www.linkedin.com/company/budgetbird" },
];

export const FIXTURE_PEOPLE: FixturePerson[] = [
  { id: "ppl_fx_maya001", first: "Maya", last: "Okafor", title: "Founder", seniority: "founder", orgId: "org_fx_glowlab01", city: "Austin", state: "Texas", country: "United States", email: "maya.okafor@example.com", emailStatus: "verified", linkedin: "https://www.linkedin.com/in/maya-okafor-fixture", hasEmail: true },
  { id: "ppl_fx_lena002", first: "Lena", last: "Hartmann", title: "Head of Product", seniority: "head", orgId: "org_fx_pureskin02", city: "Denver", state: "Colorado", country: "United States", email: "lena.hartmann@example.com", emailStatus: "verified", linkedin: "https://www.linkedin.com/in/lena-hartmann-fixture", hasEmail: true },
  { id: "ppl_fx_priya003", first: "Priya", last: "Raman", title: "Owner", seniority: "owner", orgId: "org_fx_botanica03", city: "Portland", state: "Oregon", country: "United States", email: null, emailStatus: "unavailable", linkedin: "https://www.linkedin.com/in/priya-raman-fixture", hasEmail: false },
  { id: "ppl_fx_david004", first: "David", last: "Chen", title: "Chief Financial Officer", seniority: "c_suite", orgId: "org_fx_ledgerly04", city: "New York", state: "New York", country: "United States", email: "david.chen@example.com", emailStatus: "verified", linkedin: "https://www.linkedin.com/in/david-chen-fixture", hasEmail: true },
  { id: "ppl_fx_sofia005", first: "Sofia", last: "Alvarez", title: "VP of Partnerships", seniority: "vp", orgId: "org_fx_paystream05", city: "Chicago", state: "Illinois", country: "United States", email: "sofia.alvarez@example.com", emailStatus: "likely to engage", linkedin: "https://www.linkedin.com/in/sofia-alvarez-fixture", hasEmail: true },
  { id: "ppl_fx_tom006", first: "Tom", last: "Becker", title: "Director of Growth", seniority: "director", orgId: "org_fx_budgetbird06", city: "Seattle", state: "Washington", country: "United States", email: "tom.becker@example.com", emailStatus: "verified", linkedin: "https://www.linkedin.com/in/tom-becker-fixture", hasEmail: true },
];

/** `Ma***h`-style obfuscation, as Apollo shows in search results: first two characters, asterisks, last character. */
export const obfuscate = (last: string): string => (last.length <= 3 ? `${last[0] ?? ""}**` : `${last.slice(0, 2)}${"*".repeat(last.length - 3)}${last.slice(-1)}`);

/** Canned vendor answers, shaped as documented at docs.apollo.io (read Nov 12, 2026). */
export const PEOPLE_SEARCH_OK = {
  total_entries: 2,
  people: [
    { id: "ppl_fx_maya001", first_name: "Maya", last_name_obfuscated: "Ok***r", title: "Founder", last_refreshed_at: "2026-10-30T12:00:00.000+00:00", has_email: true, has_city: true, has_state: true, has_country: true, has_direct_phone: "Maybe: please request direct dial via people/bulk_match", organization: { name: "Glow Lab Studio", has_industry: true, has_phone: true, has_city: true, has_state: true, has_country: true, has_zip_code: true, has_revenue: false, has_employee_count: true } },
    { id: "ppl_fx_priya003", first_name: "Priya", last_name_obfuscated: "Ra**n", title: "Owner", last_refreshed_at: "2026-10-12T12:00:00.000+00:00", has_email: false, has_city: true, has_state: true, has_country: true, has_direct_phone: "Maybe: please request direct dial via people/bulk_match", organization: { name: "Botanica Beauty Co", has_industry: true, has_phone: false, has_city: true, has_state: true, has_country: true, has_zip_code: false, has_revenue: false, has_employee_count: true } },
  ],
};

export const ORG_SEARCH_OK = {
  pagination: { page: 1, per_page: 10, total_entries: 1, total_pages: 1 },
  organizations: [
    { id: "org_fx_glowlab01", name: "Glow Lab Studio", website_url: "http://www.glowlab.example.com", linkedin_url: "http://www.linkedin.com/company/glow-lab-studio", primary_domain: "glowlab.example.com", founded_year: 2019, industry: "cosmetics", estimated_num_employees: 14, city: "Austin", state: "Texas", country: "United States" },
  ],
};

export const MATCH_OK = {
  person: {
    id: "ppl_fx_maya001",
    first_name: "Maya",
    last_name: "Okafor",
    name: "Maya Okafor",
    linkedin_url: "http://www.linkedin.com/in/maya-okafor-fixture",
    title: "Founder",
    email: "maya.okafor@example.com",
    email_status: "verified",
    match_confidence: "high",
    city: "Austin",
    state: "Texas",
    country: "United States",
    organization: { id: "org_fx_glowlab01", name: "Glow Lab Studio", website_url: "http://www.glowlab.example.com", primary_domain: "glowlab.example.com" },
  },
};

export const MATCH_LOCKED = { person: { id: "ppl_fx_locked01", name: "Sam Ray", title: "Buyer", email: "email_not_unlocked@domain.com", email_status: null, organization: { name: "Acme Retail" } } };
export const MATCH_NONE = { person: null };

export const USAGE_STATS_OK = { '["api/v1/people", "match"]': { day: { limit: 600, consumed: 3, left_over: 597 }, hour: { limit: 100, consumed: 3, left_over: 97 }, minute: { limit: 50, consumed: 0, left_over: 50 } } };

export const UNAUTHORIZED = "Invalid access credentials.";
export const FORBIDDEN_NEED_MASTER = { error: "api/v1/usage_stats/api_usage_stats is not accessible with this api_key", error_code: "API_INACCESSIBLE" };
export const FORBIDDEN_PAID_ONLY = { message: "This endpoint is only available to Apollo users on paid plans.", error_details: { code: "paid_plan_only" } };
export const RATE_LIMITED = { message: "The maximum number of api calls allowed for api/v1/people/match is 600 times per hour.", error_details: { code: "USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED" } };
