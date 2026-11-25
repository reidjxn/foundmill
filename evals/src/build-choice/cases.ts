/**
 * Golden cases for the Chief of Staff's build recommendation (founder, Nov 25, 2026; packages/agents `build-choice.ts`).
 * Each case is a founder's idea in their own words and what the note must do: the choice, the words of the idea it must
 * quote as the reason, and what it must never say. The rubric is deterministic, so these run offline on every test.
 */
import type { Archetype } from "@foundmill/shared";
import type { BuildChoice } from "@foundmill/agents";

export interface BuildChoiceCase {
  id: string;
  ideaText: string;
  archetype: Archetype | null;
  expect: BuildChoice;
  /** Words of the idea the note quotes as its reason. */
  quotes: readonly string[];
  /** Never in the note. */
  never: readonly RegExp[];
}

/** Never in any note: pressure, or a promise that something was built. */
export const NEVER_ANY: readonly RegExp[] = [/\bplease\b/i, /\bhurry\b|\bdon't miss\b|\blast chance\b/i, /\b(created|built|launched) (your|the) (app|project)\b/i];

/** A dollar figure outside an "(Estimate: …)" label: every non-real number is labeled. */
export const unlabeledMoney = (body: string): boolean => /\$\d/.test(body.replace(/\(Estimate:[^)]*\)/g, ""));

export const BUILD_CHOICE_CASES: readonly BuildChoiceCase[] = [
  {
    id: "lovable.tutor_dashboard",
    ideaText: "A web app where tutors log in and track each student's homework on a dashboard, so parents can see progress. I want to click through a prototype this week.",
    archetype: "b2b_saas",
    expect: "lovable",
    quotes: ["web app where tutors", "dashboard", "prototype"],
    never: [/Build it ourselves: .*recommend/],
  },
  {
    id: "lovable.gear_marketplace",
    ideaText: "A marketplace for renting camping gear between neighbors: listings with photos, people sign up, and an app where you can see what is free this weekend.",
    archetype: "marketplace",
    expect: "lovable",
    quotes: ["marketplace for renting", "sign up"],
    never: [],
  },
  {
    id: "ours.shopify_sync",
    ideaText: "A script that syncs my Shopify orders into Google Sheets every night and emails me a summary, with the code in my own GitHub repo.",
    archetype: "b2b_saas",
    expect: "ours",
    quotes: ["syncs my Shopify orders", "GitHub"],
    never: [/I recommend building it with Lovable/],
  },
  {
    id: "ours.waitlist_page",
    ideaText: "A landing page and waitlist for a meal-prep newsletter for new parents in Austin.",
    archetype: "content_media",
    expect: "ours",
    quotes: ["landing page"],
    never: [/I recommend building it with Lovable/],
  },
  {
    id: "none.etsy_candles",
    ideaText: "Handmade soy candles with scents from Pacific Northwest forests, sold on Etsy and at weekend markets.",
    archetype: "dtc_physical",
    expect: "none",
    quotes: ["Handmade soy candles"],
    never: [/Build it with Lovable/, /engineering agents build/],
  },
  {
    id: "none.dog_walking",
    ideaText: "Dog walking for busy owners in my neighborhood, mornings and lunchtimes.",
    archetype: "services",
    expect: "none",
    quotes: ["Dog walking"],
    never: [/Build it with Lovable/],
  },
];
