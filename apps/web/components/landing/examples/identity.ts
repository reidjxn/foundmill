/**
 * The picker's view of each example business: name, logo, brand colours, vertical and one line. Small and always in the
 * landing page's main bundle, so the picker draws every option (and themes a pending one) before its content loads.
 */
import { LEDGERLY_KIT } from "@foundmill/dugout/components/journey/fixtures";
import { GLITCHWICK_LOGO, LANDING_LOGOS, NORTHWIND_LOGO } from "../logos";
import type { ExampleId, ExampleIdentity } from "./types";

export const EXAMPLE_IDENTITIES: Readonly<Record<ExampleId, ExampleIdentity>> = {
  tutorlane: {
    id: "tutorlane",
    name: "Tutorlane",
    monogram: "TL",
    seed: "Tutorlane",
    logo: LANDING_LOGOS[0]!.src,
    // Deep teal and gold (the design system's second example kit).
    kit: LEDGERLY_KIT,
    vertical: "Education software",
    description: "An AI teaching assistant for independent tutors: lesson notes, practice sets and parent progress notes after every lesson.",
  },
  glitchwick: {
    id: "glitchwick",
    name: "Glitchwick",
    monogram: "GW",
    seed: "Glitchwick",
    logo: GLITCHWICK_LOGO,
    // Vermilion (white text passes APCA Lc 75 on it) and the logo's cyan.
    kit: { primary: "#c94a2c", secondary: "#5fd4e6" },
    vertical: "Developer tools",
    description: "AI playtesters that play every build of an indie game, file each bug to GitHub with a replay, and check every pull request.",
  },
  northwind: {
    id: "northwind",
    name: "Northwind Skincare",
    monogram: "NS",
    seed: "Northwind",
    logo: NORTHWIND_LOGO,
    // The founder's own Northwind (packages/db/src/seed/northwind.ts): forest green and gold.
    kit: { primary: "#2f6f5e", secondary: "#f2c94c" },
    vertical: "Consumer brand",
    description: "A skincare routine for reactive skin, made with contract labs and sold online and through retail partners.",
  },
};
