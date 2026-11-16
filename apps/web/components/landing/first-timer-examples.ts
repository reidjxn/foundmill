/**
 * The examples `/` shows inside `ScreenFrame`s (DESIGN §9a "Real screens only"): the props a real `IdeaCard`,
 * `PersonPage` and `ProjectPage` take, for one example project, Sole Revival, labeled Example wherever it appears.
 * Nothing here is a real person or project; every claim around them is in DIRECTION §6.
 */
import type { IdeaCardData, PersonPageProps, ProjectPageProps } from "@foundmill/dugout";

const RATINGS: ReadonlyArray<[key: string, value: number, evidence: string]> = [
  ["market_pull", 14, "Students already pay for laundry and shoe care near campus."],
  ["market_size", 7, "One college is a small market; nearby campuses are the next step."],
  ["competition", 9, "Dry cleaners take sneakers, but slowly and without pickup."],
  ["speed_to_first_customer", 17, "A first clean can be offered in a group chat this week."],
  ["capital_intensity", 18, "A brush kit and cleaner cost little."],
  ["agent_executability", 13, "The team can run the page, posts and bookings; the cleaning is by hand."],
  ["founder_fit", 10, "Measured after three questions about you."],
  ["defensibility", 6, "Easy to copy; regulars and reviews are the moat."],
  ["regulatory_load", 18, "No license is needed to clean shoes."],
  ["distribution_clarity", 15, "Campus group chats and one dorm board reach most buyers."],
];

export const EXAMPLE_CARD: IdeaCardData = {
  name: "Sole Revival",
  pitch: "Sneaker cleaning and restoring for students at one college, picked up and dropped off on campus.",
  archetype: "services",
  stars_current: 3,
  stars_potential: 4,
  attributes: RATINGS.map(([key, value, evidence]) => ({ key, value, evidence })),
};

const KEYS = RATINGS.map(([key]) => key);
/** Ten ratings in the card's order; `weakest` is the reason shown for the lowest one ("What would raise it most"). */
const rated = (values: readonly number[], weakest: string): IdeaCardData["attributes"] => KEYS.map((key, i) => ({ key, value: values[i] ?? 10, evidence: weakest }));

/**
 * Three ideas the Ideation Studio could draft from one brief ("Something with sneakers at my college"): the example
 * above and two others, so the section shows a set to compare, not one answer.
 */
export const EXAMPLE_STUDIO: readonly IdeaCardData[] = [
  EXAMPLE_CARD,
  {
    name: "Lace Lab",
    pitch: "Custom laces and charms for sneakers, made to order and sold at campus events and online.",
    archetype: "dtc_physical",
    stars_current: 2.5,
    stars_potential: 4,
    attributes: rated([11, 9, 8, 13, 15, 14, 10, 9, 17, 11], "Plenty of shops already sell laces; a campus-only design would set it apart."),
  },
  {
    name: "Kick Swap",
    pitch: "A monthly sneaker swap for students: bring a pair, trade a pair, with a small fee at the door.",
    archetype: "marketplace",
    stars_current: 2.5,
    stars_potential: 3.5,
    attributes: rated([12, 6, 13, 15, 17, 9, 10, 7, 14, 13], "One campus is a small market; a second campus doubles it."),
  },
];

export const EXAMPLE_PERSON: PersonPageProps = {
  name: "Ama Mensah",
  headline: "Shoe care, campus pickups, good with a sewing machine",
  place: "Austin, TX",
  lookingFor: "open_to_people",
  strengths: ["Sneaker restoring", "Short videos", "Talking to customers"],
  projects: [{ slug: "sole-revival", name: "Sole Revival", pitch: "Sneaker cleaning for students at one college.", href: "#first-week" }],
  titleLevel: 3,
  variant: "preview",
};

export const EXAMPLE_PROJECT: ProjectPageProps = {
  name: "Sole Revival",
  pitch: "Sneakers cleaned and restored, picked up from your dorm.",
  about: "Drop your pair at the front desk on Monday and get them back by Thursday, cleaned by hand.\n\nFirst pairs are cleaned for free while we learn what you need.",
  forWhom: "Students at one college who wear their sneakers every day.",
  stage: "idea",
  brandPrimary: "#1f6f5c",
  brandSecondary: "#f2efe6",
  founderNames: ["Ama"],
  // The founder's own view of their page: the mark as plain text (a visitor's mark lights as it scrolls in, and an
  // example that never scrolls in would show it at its dim start).
  mark: "member",
  titleLevel: 3,
  variant: "preview",
};
