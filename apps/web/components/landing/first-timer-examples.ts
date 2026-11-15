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
