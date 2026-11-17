/**
 * The examples `/` shows inside `ScreenFrame`s (DESIGN §9a "Real screens only"): the props a real `IdeaCard`,
 * `PersonPage` and `ProjectPage` take, for one example project, Sole Revival, labeled Example wherever it appears.
 * Nothing here is a real person or project; every claim around them is in DIRECTION §6.
 */
import type { IdeaCardData, PersonPageProps, ProjectPageProps } from "@foundmill/dugout";
import { EXAMPLE_IDENTITIES } from "./examples/identity";
import { SOLE_REVIVAL_LOGO } from "./logos";

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

/** Ten ratings in the card's order, each with its own reason (the evidence a rating's card opens to). */
const withReasons = (rows: ReadonlyArray<[value: number, evidence: string]>): IdeaCardData["attributes"] => KEYS.map((key, i) => ({ key, value: rows[i]![0], evidence: rows[i]![1] }));

export interface ExampleIdea {
  id: string;
  /** The name on the switcher: short, so the four fit on one line in the hero's 380 px example column. */
  label: string;
  /** A checked `data:` URL. */
  logo: string;
  card: IdeaCardData;
}

/**
 * The rated examples beside the idea box (founder, 2026-11-16): Northwind Skincare first, then Tutorlane, Sole Revival
 * and Glitchwick (founder, 2026-11-17), switched just under the "Example companies you can create" line. The three businesses are the tour's examples (examples/*.ts):
 * their pitch, stars and ratings are copied here so the landing page does not load the tour's data.
 */
export const EXAMPLE_IDEAS: readonly ExampleIdea[] = [
  {
    id: "northwind",
    label: "Northwind",
    logo: EXAMPLE_IDENTITIES.northwind.logo,
    card: {
      name: EXAMPLE_IDENTITIES.northwind.name,
      pitch: "A fragrance-free, three-step routine for reactive skin, with every batch's test results published.",
      archetype: "dtc_physical",
      stars_current: 3.5,
      stars_potential: 4.5,
      attributes: withReasons([
        [15, "People with reactive skin read every label and stay once a routine works."],
        [16, "Reactive skin is common, and skincare is a large market."],
        [8, "Skincare is crowded; one routine for one skin type, with test results published, is what stands apart."],
        [12, "A first batch from a contract lab takes weeks before anything can be sold."],
        [8, "Each batch ties up cash before it sells, so landed cost is the number to watch."],
        [12, "The team can run the page, the listings and the posts; making and shipping are the lab's and the founder's."],
        [10, "Measured after three questions about you."],
        [16, "A routine people trust keeps them buying; published test results are hard to copy quickly."],
        [11, "Cosmetics rules apply: safety assessments and labels before the first sale."],
        [14, "Communities for reactive skin are easy to find and talk about routines openly."],
      ]),
    },
  },
  {
    id: "tutorlane",
    label: EXAMPLE_IDENTITIES.tutorlane.name,
    logo: EXAMPLE_IDENTITIES.tutorlane.logo,
    card: {
      name: EXAMPLE_IDENTITIES.tutorlane.name,
      pitch: "An AI teaching assistant for independent tutors: lesson notes, practice sets and progress notes after every lesson.",
      archetype: "b2b_saas",
      stars_current: 3.5,
      stars_potential: 4.5,
      attributes: withReasons([
        [16, "Tutors write notes and practice sets every week and would hand the chore off gladly."],
        [13, "There are many independent tutors, and each brings the families they teach."],
        [10, "Tutoring tools are many; one built around each tutor's own method is what stands apart."],
        [15, "A tutor can try it on one lesson this week."],
        [16, "Software with no stock to buy."],
        [17, "The team can build and run most of it."],
        [10, "Measured after three questions about you."],
        [12, "A tutor's own materials and history make it harder to leave."],
        [10, "Children's data is the risk to plan for: consent and privacy rules apply."],
        [15, "Tutors gather in a few groups and recommend tools to each other."],
      ]),
    },
  },
  { id: "sole-revival", label: "Sole Revival", logo: SOLE_REVIVAL_LOGO, card: EXAMPLE_CARD },
  {
    id: "glitchwick",
    label: EXAMPLE_IDENTITIES.glitchwick.name,
    logo: EXAMPLE_IDENTITIES.glitchwick.logo,
    card: {
      name: EXAMPLE_IDENTITIES.glitchwick.name,
      pitch: "AI playtesters for indie games: every build played overnight, every bug filed to GitHub with a replay.",
      archetype: "b2b_saas",
      stars_current: 3.5,
      stars_potential: 4.5,
      attributes: withReasons([
        [16, "Small studios ship every week and nobody has time to play every build."],
        [11, "Indie studios are many but small; a few hundred paying teams is the realistic first market."],
        [12, "Testing tools exist, but few play the game the way a player does."],
        [16, "A studio can try it on tonight's build."],
        [13, "Each overnight run costs compute, so cost per run against a $29 plan is the number to watch."],
        [18, "The team can build and run it end to end."],
        [10, "Measured after three questions about you."],
        [13, "Replays and the bugs each game produces get better with every run."],
        [17, "No license is needed to test games."],
        [15, "Indie developers gather in a few communities and share tools there."],
      ]),
    },
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
  logo: SOLE_REVIVAL_LOGO,
  brandSecondary: "#f2efe6",
  founderNames: ["Ama"],
  // The founder's own view of their page: the mark as plain text (a visitor's mark lights as it scrolls in, and an
  // example that never scrolls in would show it at its dim start).
  mark: "member",
  titleLevel: 3,
  variant: "preview",
};
