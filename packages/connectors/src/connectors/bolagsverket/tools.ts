/**
 * Bolagsverket (Swedish Companies Registration Office) — "Värdefulla datamängder" API: organisation lookup
 * and document lists. Thin client; endpoints as published on portal.api.bolagsverket.se (OAuth 2.0 client
 * credentials). HUMAN CHECKPOINT before live use: confirm field names against the current OpenAPI spec,
 * the public docs sit behind a bot check and could not be fetched during the build.
 */
import { z } from "zod";
import { defineTool } from "../../define";

export const BOLAGSVERKET_KEY = "bolagsverket";
export const BOLAGSVERKET_BASE_URL = "https://gw.api.bolagsverket.se/vardefulla-datamangder/v1";
export const BOLAGSVERKET_TOKEN_URL = "https://portal.api.bolagsverket.se/oauth2/token";
export const BOLAGSVERKET_SCOPE = "vardefulla-datamangder:read";

/** Swedish organisation number: 10 digits, optionally with a hyphen (`559123-4567`). Normalised to digits. */
export const OrganisationNumber = z.string().regex(/^\d{6}-?\d{4}$/, "organisationsnummer like 559123-4567").transform((s) => s.replace("-", ""));

export const Organisation = z.object({
  organisationNumber: z.string(),
  name: z.string(),
  legalForm: z.string().nullable(),
  legalFormCode: z.string().nullable(),
  registeredAt: z.string().nullable(),
  deregisteredAt: z.string().nullable(),
  status: z.enum(["active", "deregistered", "unknown"]),
  registrationCountry: z.string().nullable(),
  address: z.object({ street: z.string().nullable(), postalCode: z.string().nullable(), city: z.string().nullable(), country: z.string().nullable() }),
  businessDescription: z.string().nullable(),
});

export const bolagsverketTools = [
  defineTool({
    name: "get_organisation",
    description: "Look up a Swedish organisation (company, association) by organisationsnummer in Bolagsverket's register.",
    input: z.object({ organisationNumber: OrganisationNumber }),
    output: Organisation,
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `org:${a.organisationNumber}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "list_documents",
    description: "List registered documents (annual reports, articles of association) for a Swedish organisation.",
    input: z.object({ organisationNumber: OrganisationNumber }),
    output: z.object({ items: z.array(z.object({ documentId: z.string(), type: z.string(), period: z.string().nullable(), registeredAt: z.string().nullable() })) }),
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `docs:${a.organisationNumber}`,
    annotations: { readOnlyHint: true },
  }),
] as const;

export const BOLAGSVERKET_RATE_LIMITS = { perMinute: 30, perDay: 2_000 };

/* ---- Vendor shapes (tolerant subset) ---- */
export interface BvOrganisation {
  organisationsidentitet?: { identitetsbeteckning?: string };
  organisationsnamn?: { organisationsnamnLista?: { namn?: string }[] };
  organisationsform?: { kod?: string; klartext?: string };
  registreringsland?: { kod?: string; klartext?: string };
  organisationsdatum?: { registreringsdatum?: string };
  avregistreradOrganisation?: { avregistreringsdatum?: string };
  postadressOrganisation?: { postadress?: { utdelningsadress?: string; postnummer?: string; postort?: string; land?: string } };
  verksamhetsbeskrivning?: { beskrivning?: string };
}
export interface BvOrganisationResponse { organisationer?: BvOrganisation[] }
export interface BvDocument { dokumentId?: string; dokumenttyp?: string; rapporteringsperiodTom?: string; registreringstidpunkt?: string }
export interface BvDocumentListResponse { dokument?: BvDocument[] }

export function mapOrganisation(o: BvOrganisation, requested: string): z.infer<typeof Organisation> {
  const deregisteredAt = o.avregistreradOrganisation?.avregistreringsdatum ?? null;
  return {
    organisationNumber: o.organisationsidentitet?.identitetsbeteckning ?? requested,
    name: o.organisationsnamn?.organisationsnamnLista?.[0]?.namn ?? "(namn saknas)",
    legalForm: o.organisationsform?.klartext ?? null,
    legalFormCode: o.organisationsform?.kod ?? null,
    registeredAt: o.organisationsdatum?.registreringsdatum ?? null,
    deregisteredAt,
    status: deregisteredAt ? "deregistered" : o.organisationsnamn ? "active" : "unknown",
    registrationCountry: o.registreringsland?.kod ?? null,
    address: { street: o.postadressOrganisation?.postadress?.utdelningsadress ?? null, postalCode: o.postadressOrganisation?.postadress?.postnummer ?? null, city: o.postadressOrganisation?.postadress?.postort ?? null, country: o.postadressOrganisation?.postadress?.land ?? null },
    businessDescription: o.verksamhetsbeskrivning?.beskrivning ?? null,
  };
}

export const mapDocument = (d: BvDocument) => ({ documentId: d.dokumentId ?? "", type: d.dokumenttyp ?? "okänd", period: d.rapporteringsperiodTom ?? null, registeredAt: d.registreringstidpunkt ?? null });
