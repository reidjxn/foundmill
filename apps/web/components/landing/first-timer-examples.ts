/**
 * The examples `/` shows inside `ScreenFrame`s (DESIGN §9a "Real screens only"): the props a real `IdeaCard`,
 * `PersonPage` and `ProjectPage` take, for one example project, Sole Revival, labeled Example wherever it appears.
 * Nothing here is a real person or project; every claim around them is in DIRECTION §6.
 */
import type { IdeaCardData, PersonPageProps, ProjectPageProps } from "@foundmill/dugout";
import { EXAMPLE_IDENTITIES } from "./examples/identity";
import { SOLE_REVIVAL_LOGO } from "./logos";
import { LANDING_WORDS } from "./words";

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

/** The four hero examples, by id: a variant lists them in the order its page shows them, the first one chosen. */
export type ExampleIdeaId = "northwind" | "tutorlane" | "sole-revival" | "glitchwick";

/** The hero examples in a variant's order; absent: the default order above. */
export function exampleIdeasInOrder(order?: readonly ExampleIdeaId[]): readonly ExampleIdea[] {
  return order ? order.map((id) => EXAMPLE_IDEAS.find((x) => x.id === id)!) : EXAMPLE_IDEAS;
}

/** A hero example's card, for a Studio set that starts from it. */
const heroCard = (id: ExampleIdeaId): IdeaCardData => EXAMPLE_IDEAS.find((x) => x.id === id)!.card;

/** An Ideation Studio set for one kind of founder: its brief, the steer chips and three ideas from that brief. */
export interface StudioSet {
  brief: string;
  steer: readonly [string, string, string];
  cards: readonly IdeaCardData[];
}

type Card = [name: string, pitch: string, archetype: string, current: number, potential: number, values: readonly number[], weakest: string];
const card = ([name, pitch, archetype, stars_current, stars_potential, values, weakest]: Card): IdeaCardData => ({ name, pitch, archetype, stars_current, stars_potential, attributes: rated(values, weakest) });
const steer = (third: string): StudioSet["steer"] => ["Cheaper to start", third, "More defensible"];

/**
 * The Studio sets the profile pages show (founder, 2026-11-19): `sneakers` is the default above; the others are drafted
 * from a brief that kind of founder would write. Each set is three ideas to compare, rated like the rest, none real.
 */
export const STUDIO_SETS = {
  sneakers: { brief: "Something with sneakers at my college", steer: LANDING_WORDS.studio.steer, cards: EXAMPLE_STUDIO },
  skincare: {
    brief: "Skincare for people with sensitive skin",
    steer: steer("Sell to spas instead"),
    cards: [
      heroCard("northwind"),
      card(["Patch Test Box", "Sample sizes from fragrance-free brands in one box, so people with reactive skin can test before they buy.", "dtc_physical", 3, 4, [14, 12, 9, 15, 13, 13, 10, 8, 14, 13], "Sample boxes exist; one chosen for reactive skin, with notes from testers, is what stands apart."]),
      card(["Calm Skin Notes", "A weekly newsletter that tests fragrance-free products on reactive skin, paid for by its readers.", "content_media", 2.5, 3.5, [11, 10, 10, 16, 18, 15, 10, 7, 17, 14], "Free reviews are everywhere; long tests on real reactive skin would set it apart."]),
    ],
  },
  tutoring: {
    brief: "Something with what I'm good at teaching",
    steer: steer("Sell to schools instead"),
    cards: [
      heroCard("tutorlane"),
      card(["Study Circle", "Online study groups of four, led by one tutor, at a quarter of the price of one-to-one lessons.", "services", 3, 4, [15, 12, 11, 16, 17, 12, 10, 8, 14, 13], "Group lessons are easy to copy; a tutor's own results and reviews are the moat."]),
      card(["Practice Pack", "Printable practice sets for one exam, written by a tutor and sold as downloads.", "content_media", 2.5, 3.5, [12, 11, 8, 15, 18, 16, 10, 6, 18, 12], "Free worksheets are everywhere; one exam done better than anyone else would set it apart."]),
    ],
  },
  games: {
    brief: "A tool for small game studios",
    steer: steer("Sell to players instead"),
    cards: [
      heroCard("glitchwick"),
      card(["Trailer Cut", "Game trailers edited from a studio's own footage in one week, at a flat price.", "services", 3, 3.5, [14, 10, 11, 15, 17, 11, 10, 7, 18, 13], "Freelance editors already do this; a flat price and a one-week turnaround are what stand apart."]),
      card(["Patchnote", "Patch notes written from a game's code history and posted to its community after every release.", "b2b_saas", 3, 4, [13, 10, 12, 16, 16, 17, 10, 9, 18, 12], "A small tool is easy to copy; ties into each studio's own tools would make it stick."]),
    ],
  },
  trades: {
    brief: "Something from 20 years as an electrician",
    steer: steer("Sell to builders instead"),
    cards: [
      card(["Wired Right", "Electrical safety checks for older homes, booked online at a fixed price, with a written report.", "services", 3.5, 4, [16, 10, 11, 17, 16, 12, 10, 12, 8, 15], "Licensed work: the founder's own license and insurance must be in place before the first visit."]),
      card(["Panel Ready", "Short video courses that prepare first-year apprentices for their exams.", "content_media", 3, 4, [13, 11, 10, 14, 17, 15, 10, 10, 15, 12], "Trade schools cover the basics; a working electrician's real examples are what stand apart."]),
      card(["Quote Fast", "A quoting tool for one-person electrical firms: photos in, a priced quote out the same evening.", "b2b_saas", 3, 4, [15, 12, 10, 13, 15, 17, 10, 9, 17, 11], "Quoting apps exist; one built around a small firm's real prices is what stands apart."]),
    ],
  },
  food: {
    brief: "Something with food, not sure what yet",
    steer: steer("Sell to cafes instead"),
    cards: [
      card(["Sunday Sauce Co.", "Small-batch pasta sauce from a family recipe, sold at weekend markets and to local delis.", "dtc_physical", 3, 4, [14, 11, 8, 15, 13, 11, 10, 9, 10, 14], "The shelf is crowded; a family recipe with its story is what stands apart, and a food license comes first."]),
      card(["Fridge Fill", "Five ready-to-heat dinners delivered on Sundays to busy families in one neighborhood.", "services", 3, 4, [16, 12, 10, 14, 12, 11, 10, 8, 9, 15], "Meal plans are easy to copy; one neighborhood's regulars are the moat, and a licensed kitchen comes first."]),
      card(["Supper Table", "A monthly supper evening for twelve guests at the founder's home, booked online.", "services", 2.5, 3.5, [13, 6, 13, 16, 17, 10, 10, 9, 9, 12], "Twelve seats a month is a small market; a second evening doubles it."]),
    ],
  },
  expertise: {
    brief: "What I learned in 25 years of running HR",
    steer: steer("Sell to bigger firms"),
    cards: [
      card(["First Ten", "HR policies and contract templates for firms taking on their first ten people, kept up to date.", "content_media", 3.5, 4, [16, 12, 10, 15, 17, 14, 10, 9, 11, 13], "Templates are easy to find; ones kept current by a real HR lead are what stand apart."]),
      card(["People Desk", "Part-time HR help for small firms: one monthly fee, an answer within a day.", "services", 3, 4, [15, 13, 11, 14, 18, 10, 10, 10, 13, 12], "The team runs the page and the bookings; the advice is the founder's own time, which limits growth."]),
      card(["Exit Notes", "Exit interviews run by a neutral outsider, with a short report on what would make people stay.", "services", 2.5, 3.5, [12, 9, 13, 13, 18, 12, 10, 8, 15, 9], "Easy to copy; a track record and referrals are the moat."]),
    ],
  },
  creator: {
    brief: "Something for my 5,000 followers",
    steer: steer("Sell to brands instead"),
    cards: [
      card(["Golden Hour Presets", "Photo presets from the creator's own travels, sold as a download with a short how-to video.", "content_media", 3, 3.5, [14, 11, 7, 17, 19, 15, 10, 7, 18, 16], "Presets are everywhere; the creator's own look and audience are the only moat."]),
      card(["The Plant Letter", "A paid weekly newsletter on keeping house plants alive, answering one reader's question each week.", "content_media", 3, 4, [13, 12, 11, 16, 19, 16, 10, 10, 18, 15], "Free plant tips are everywhere; answers about readers' own plants are what stand apart."]),
      card(["Lettering Live", "Monthly live classes in hand lettering, with a practice sheet for each one.", "services", 3, 3.5, [14, 10, 11, 15, 18, 13, 10, 8, 18, 15], "Recorded classes are cheap online; live feedback is what stands apart."]),
    ],
  },
  making: {
    brief: "Something with the pottery I make",
    steer: steer("Sell to shops instead"),
    cards: [
      card(["Small Batch Mugs", "Stoneware mugs in small seasonal runs, sold online and at two local markets.", "dtc_physical", 3, 3.5, [14, 10, 8, 15, 14, 11, 10, 9, 17, 13], "Handmade mugs are many; a seasonal run that sells out is what stands apart."]),
      card(["Glaze Night", "Evening pottery classes for six people, with tea, clay and firing included.", "services", 3.5, 4, [16, 9, 12, 16, 13, 10, 10, 10, 15, 14], "One studio's evenings are a small market; a second night each week is the next step."]),
      card(["Seconds Shelf", "Pottery with small flaws, sold for less in a monthly online drop.", "dtc_physical", 2.5, 3.5, [11, 9, 10, 16, 18, 13, 10, 7, 18, 12], "Easy to copy; the maker's name and regulars are the moat."]),
    ],
  },
  family: {
    brief: "Something parents at my kids' school need",
    steer: steer("Sell to schools instead"),
    cards: [
      card(["Party Box", "Birthday parties in a box for ages 4 to 8: decorations, games and a plan for the day.", "dtc_physical", 3, 3.5, [14, 12, 9, 15, 13, 12, 10, 7, 17, 14], "Party supplies are everywhere; a planned day that works is what stands apart."]),
      card(["Uniform Swap", "A swap for outgrown uniforms at one school, run online with a pickup day each month.", "marketplace", 2.5, 3.5, [13, 6, 14, 15, 18, 13, 10, 9, 18, 16], "One school is a small market; the schools nearby are the next step."]),
      card(["Carpool Board", "A simple app where parents at one school share pickups and drop-offs for the week.", "consumer_app", 2.5, 3.5, [12, 10, 9, 13, 16, 16, 10, 8, 12, 15], "Easy to copy; being the board every parent at one school already uses is the moat."]),
    ],
  },
  local: {
    brief: "Something useful for my neighborhood",
    steer: steer("Sell to businesses instead"),
    cards: [
      card(["Tech Help at Home", "Patient phone and computer help for older neighbors, at their kitchen table, booked by the hour.", "services", 3.5, 4, [16, 11, 12, 17, 19, 10, 10, 10, 17, 14], "The team runs the page and the bookings; the visits are the founder's own time, which limits growth."]),
      card(["Old Town Walks", "Guided walks through the town's history on weekend mornings, booked online.", "services", 3, 3.5, [13, 8, 13, 16, 19, 12, 10, 9, 16, 14], "One town's visitors are a small market; a second route or private group walks add to it."]),
      card(["Orchard Jars", "Jam from local fruit, sold at the farmers market and to two nearby cafes.", "dtc_physical", 3, 3.5, [13, 9, 8, 15, 15, 11, 10, 9, 10, 14], "Jam is a crowded shelf; local fruit with its orchard named is what stands apart."]),
    ],
  },
} as const satisfies Record<string, StudioSet>;
export type StudioSetId = keyof typeof STUDIO_SETS;
