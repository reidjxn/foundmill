import type { BvDocument, BvOrganisation } from "../tools";

export const BV_ORGANISATIONS: Record<string, BvOrganisation> = {
  "5591234567": {
    organisationsidentitet: { identitetsbeteckning: "5591234567" },
    organisationsnamn: { organisationsnamnLista: [{ namn: "Nordlicht AB" }] },
    organisationsform: { kod: "AB", klartext: "Aktiebolag" },
    registreringsland: { kod: "SE", klartext: "Sverige" },
    organisationsdatum: { registreringsdatum: "2017-02-20" },
    postadressOrganisation: { postadress: { utdelningsadress: "Sveavägen 44", postnummer: "11134", postort: "Stockholm", land: "Sverige" } },
    verksamhetsbeskrivning: { beskrivning: "Bolaget ska utveckla och sälja programvara för bokföring samt därmed förenlig verksamhet." },
  },
  "5566778899": {
    organisationsidentitet: { identitetsbeteckning: "5566778899" },
    organisationsnamn: { organisationsnamnLista: [{ namn: "Hallbergs Hud AB" }] },
    organisationsform: { kod: "AB", klartext: "Aktiebolag" },
    registreringsland: { kod: "SE" },
    organisationsdatum: { registreringsdatum: "2011-09-05" },
    postadressOrganisation: { postadress: { utdelningsadress: "Storgatan 12", postnummer: "41124", postort: "Göteborg", land: "Sverige" } },
    verksamhetsbeskrivning: { beskrivning: "Tillverkning och försäljning av hudvårdsprodukter." },
  },
  "5590001122": {
    organisationsidentitet: { identitetsbeteckning: "5590001122" },
    organisationsnamn: { organisationsnamnLista: [{ namn: "Ledgerly Nordic AB" }] },
    organisationsform: { kod: "AB", klartext: "Aktiebolag" },
    registreringsland: { kod: "SE" },
    organisationsdatum: { registreringsdatum: "2020-01-15" },
    avregistreradOrganisation: { avregistreringsdatum: "2025-06-30" },
    postadressOrganisation: { postadress: { utdelningsadress: "Box 100", postnummer: "22100", postort: "Lund", land: "Sverige" } },
  },
};

export const BV_DOCUMENTS: Record<string, BvDocument[]> = {
  "5591234567": [
    { dokumentId: "doc-nl-2025-ar", dokumenttyp: "Årsredovisning", rapporteringsperiodTom: "2025-12-31", registreringstidpunkt: "2026-05-12T09:14:00Z" },
    { dokumentId: "doc-nl-2024-ar", dokumenttyp: "Årsredovisning", rapporteringsperiodTom: "2024-12-31", registreringstidpunkt: "2025-05-20T10:02:00Z" },
    { dokumentId: "doc-nl-bo", dokumenttyp: "Bolagsordning", registreringstidpunkt: "2017-02-20T08:00:00Z" },
  ],
  "5566778899": [{ dokumentId: "doc-hh-2025-ar", dokumenttyp: "Årsredovisning", rapporteringsperiodTom: "2025-12-31", registreringstidpunkt: "2026-04-28T11:30:00Z" }],
  "5590001122": [],
};
