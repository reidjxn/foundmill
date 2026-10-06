/** A small manifest in the spirit of the Northwind Skincare seed (BUILD §17.2) for tests and stories. */
import { buildManifest } from "../manifest";
import type { Manifest, ManifestEntityInput } from "../types";
import { uuidFor } from "./generator";

export const FIXTURE_IDS = {
  meridian: uuidFor("fixture:meridian-labs"),
  saraLindqvist: uuidFor("fixture:sara-lindqvist"),
  saraNovak: uuidFor("fixture:sara-novak"),
  nordicPackaging: uuidFor("fixture:nordic-packaging"),
  stripe: uuidFor("fixture:stripe"),
  chiefOfStaff: uuidFor("fixture:chief-of-staff"),
  distributionLead: uuidFor("fixture:distribution-lead"),
  hiddenInvestor: uuidFor("fixture:hidden-investor"),
  johanBerg: uuidFor("fixture:johan-berg"),
  glowCollective: uuidFor("fixture:glow-collective"),
} as const;

export const FIXTURE_ENTITIES: readonly ManifestEntityInput[] = [
  { id: FIXTURE_IDS.meridian, kind: "organisation", name: "Meridian Labs", aliases: ["Meridian"], role: "supplier" },
  { id: FIXTURE_IDS.saraLindqvist, kind: "person", name: "Sara Lindqvist", aliases: [], role: "procurement lead", org: "Meridian Labs" },
  { id: FIXTURE_IDS.saraNovak, kind: "person", name: "Sara Novak", aliases: ["S. Novak"], role: "founder", org: "Glow Collective" },
  { id: FIXTURE_IDS.nordicPackaging, kind: "organisation", name: "Nordic Packaging AB", aliases: ["Nordic Packaging", "NPAB"] },
  { id: FIXTURE_IDS.stripe, kind: "organisation", name: "Stripe", aliases: [] },
  { id: FIXTURE_IDS.chiefOfStaff, kind: "agent", name: "Astrid", aliases: ["Chief of Staff"], role: "assistant manager" },
  { id: FIXTURE_IDS.distributionLead, kind: "agent", name: "Kofi", aliases: ["Distribution lead"], role: "distribution lead" },
  { id: FIXTURE_IDS.johanBerg, kind: "person", name: "Johan Berg", aliases: [], role: "advisor" },
  { id: FIXTURE_IDS.glowCollective, kind: "organisation", name: "Glow Collective", aliases: ["Glow"] },
  { id: FIXTURE_IDS.hiddenInvestor, kind: "person", name: "Hidden Investor", aliases: [], visible: false },
];

export function fixtureManifest(): Manifest {
  return buildManifest(FIXTURE_ENTITIES);
}
