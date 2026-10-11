/**
 * The product reads in US English, but some stored keys and enum values keep their original British spelling
 * ("organisation", "uncategorised", "cancelled", "judgement"): identifiers do not change, only what people read. Any
 * helper that turns a stored key into words ("plain words", "humanise") runs the result through `usSpelling` so a key
 * never leaks a British spelling onto a screen. Whole words only; the case of each word is kept.
 */
const US_WORDS: Readonly<Record<string, string>> = {
  organisation: "organization",
  organisations: "organizations",
  organisational: "organizational",
  uncategorised: "uncategorized",
  categorised: "categorized",
  categorisation: "categorization",
  cancelled: "canceled",
  cancelling: "canceling",
  judgement: "judgment",
  defence: "defense",
  fulfilment: "fulfillment",
  colour: "color",
  colours: "colors",
  behaviour: "behavior",
  catalogue: "catalog",
  licence: "license",
  licences: "licenses",
  programme: "program",
  programmes: "programs",
  authorised: "authorized",
  authorisation: "authorization",
  unauthorised: "unauthorized",
  labelled: "labeled",
  labelling: "labeling",
  modelling: "modeling",
  centre: "center",
  optimisation: "optimization",
  prioritisation: "prioritization",
  personalisation: "personalization",
  analyse: "analyze",
  enrolment: "enrollment",
  travelling: "traveling",
  grey: "gray",
};

function matchCase(original: string, us: string): string {
  if (original === original.toUpperCase()) return us.toUpperCase();
  if (original[0] === original[0]!.toUpperCase()) return us[0]!.toUpperCase() + us.slice(1);
  return us;
}

/** "Organisation" → "Organization", "uncategorised items" → "uncategorized items"; anything else is unchanged. */
export function usSpelling(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const us = US_WORDS[word.toLowerCase()];
    return us ? matchCase(word, us) : word;
  });
}
