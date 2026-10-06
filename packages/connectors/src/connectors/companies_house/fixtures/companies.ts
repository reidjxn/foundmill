import type { ChCompanyProfile, ChOfficer } from "../tools";

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
];

export const CH_OFFICERS: Record<string, ChOfficer[]> = {
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
