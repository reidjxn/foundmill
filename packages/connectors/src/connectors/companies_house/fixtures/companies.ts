import type { ChCompanyProfile, ChOfficer } from "../tools";

/**
 * Mock Companies House register. Besides the fixtures the tests name, it holds the example number the Import form
 * shows (12345678) and the two demo businesses' own registrations (Northwind 15432198, Ledgerly 15106734), so a
 * founder trying the mock golden path finds a company.
 */
export const CH_COMPANIES: ChCompanyProfile[] = [
  {
    company_number: "14523871", company_name: "NORTHWIND SKINCARE LTD", company_status: "active", type: "ltd", date_of_creation: "2022-11-03", jurisdiction: "england-wales", sic_codes: ["20420", "47910"],
    registered_office_address: { address_line_1: "71-75 Shelton Street", locality: "London", postal_code: "WC2H 9JQ", country: "United Kingdom" },
    accounts: { next_due: "2027-08-03", overdue: false }, confirmation_statement: { next_due: "2026-11-17", overdue: false },
  },
  {
    company_number: "13245678", company_name: "LEDGERLY TECHNOLOGIES LIMITED", company_status: "active", type: "ltd", date_of_creation: "2021-03-09", jurisdiction: "england-wales", sic_codes: ["62012", "69201"],
    registered_office_address: { address_line_1: "20-22 Wenlock Road", locality: "London", postal_code: "N1 7GU", country: "England" },
    accounts: { next_due: "2026-12-31", overdue: false }, confirmation_statement: { next_due: "2026-03-23", overdue: true },
  },
  {
    company_number: "09876543", company_name: "ACME TRADING LIMITED", company_status: "dissolved", type: "ltd", date_of_creation: "2015-10-27", jurisdiction: "england-wales", sic_codes: ["46900"],
    registered_office_address: { address_line_1: "1 Dissolved Way", locality: "Manchester", postal_code: "M1 1AA", country: "England" },
    accounts: { overdue: false }, confirmation_statement: { overdue: false },
  },
  {
    company_number: "SC654321", company_name: "HIGHLAND HYDRATION LTD", company_status: "active", type: "ltd", date_of_creation: "2019-06-14", jurisdiction: "scotland", sic_codes: ["11070"],
    registered_office_address: { address_line_1: "5 Castle Terrace", locality: "Edinburgh", postal_code: "EH1 2DP", country: "Scotland" },
    accounts: { next_due: "2027-03-14", overdue: false }, confirmation_statement: { next_due: "2026-06-28", overdue: false },
  },
  {
    company_number: "12345678", company_name: "EXAMPLE TRADING LTD", company_status: "active", type: "ltd", date_of_creation: "2020-01-15", jurisdiction: "england-wales", sic_codes: ["62020"],
    registered_office_address: { address_line_1: "1 Example Street", locality: "London", postal_code: "EC1A 1BB", country: "England" },
    accounts: { next_due: "2027-01-31", overdue: false }, confirmation_statement: { next_due: "2027-01-29", overdue: false },
  },
  {
    company_number: "15432198", company_name: "NORTHWIND SKINCARE LTD", company_status: "active", type: "ltd", date_of_creation: "2024-02-05", jurisdiction: "england-wales", sic_codes: ["20420", "47910"],
    registered_office_address: { address_line_1: "14 Quill Street", locality: "Manchester", postal_code: "M4 5JW", country: "England" },
    accounts: { next_due: "2027-02-05", overdue: false }, confirmation_statement: { next_due: "2026-11-22", overdue: false },
  },
  {
    company_number: "15106734", company_name: "LEDGERLY LTD", company_status: "active", type: "ltd", date_of_creation: "2024-09-02", jurisdiction: "england-wales", sic_codes: ["62012"],
    registered_office_address: { address_line_1: "71 Beacon Lane", locality: "London", postal_code: "EC2A 4NE", country: "England" },
    accounts: { next_due: "2027-03-09", overdue: false }, confirmation_statement: { next_due: "2026-12-24", overdue: false },
  },
];

export const CH_OFFICERS: Record<string, ChOfficer[]> = {
  "12345678": [{ name: "EXAMPLE, Alex", officer_role: "director", appointed_on: "2020-01-15", nationality: "British", occupation: "Director" }],
  "15432198": [{ name: "REYES, Jamie", officer_role: "director", appointed_on: "2024-02-05", nationality: "British", occupation: "Founder" }],
  "15106734": [
    { name: "REYES, Jamie", officer_role: "director", appointed_on: "2024-09-02", nationality: "British", occupation: "Founder" },
    { name: "NANDAKUMAR, Priya", officer_role: "director", appointed_on: "2024-09-02", nationality: "British", occupation: "Engineer" },
  ],
  "14523871": [
    { name: "JACKSON, Reid", officer_role: "director", appointed_on: "2022-11-03", nationality: "British", occupation: "Company Director" },
    { name: "OKAFOR, Amara", officer_role: "director", appointed_on: "2023-05-15", nationality: "Nigerian", occupation: "Chief Scientist" },
    { name: "FORMATIONS LTD", officer_role: "corporate-secretary", appointed_on: "2022-11-03", resigned_on: "2022-11-04" },
  ],
  "13245678": [
    { name: "LINDQVIST, Sara", officer_role: "director", appointed_on: "2021-03-09", nationality: "Swedish", occupation: "Software Engineer" },
    { name: "PATEL, Dev", officer_role: "director", appointed_on: "2021-03-09", resigned_on: "2024-01-31", nationality: "British", occupation: "Accountant" },
  ],
  "09876543": [{ name: "SMITH, John", officer_role: "director", appointed_on: "2015-10-27", resigned_on: "2023-02-01", nationality: "British" }],
  SC654321: [{ name: "MACLEOD, Fiona", officer_role: "director", appointed_on: "2019-06-14", nationality: "British", occupation: "Entrepreneur" }],
};
