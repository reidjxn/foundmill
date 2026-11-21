/**
 * The example founder each landing page shows (founder, 2026-11-19): their person page under "On your own, or with
 * people", their project's page and its first week under "A first week, from $0". The first-timer's page, and the
 * student's, show Sole Revival (first-timer-examples.ts); every profile page (lib/landing-variant.ts
 * `PROFILE_VARIANTS`) has its own. Each first week uses only what works today, like Sole Revival's: the idea shaped and
 * rated, the page drafted and published, the founder sharing it, a drafted post, the first milestone and one decision.
 * Nothing here is a real person or project; every one is labeled Example where it appears.
 */
import { APP_NAME } from "@foundmill/config";
import type { DayListItem, PersonPageProps, ProjectPageProps } from "@foundmill/dugout";
import type { LandingVariant } from "@/lib/landing-variant";
import { EXAMPLE_PERSON, EXAMPLE_PROJECT } from "./first-timer-examples";
import { LANDING_WORDS } from "./words";

export interface ExampleStory {
  person: PersonPageProps;
  project: ProjectPageProps;
  /** The first week's heading line: the project's name and a short pitch. */
  name: string;
  line: string;
  /** Day 3's follow-up is printed only with platform mail on (flags.ts), as on Sole Revival's week. */
  days: { d1: string; d2: string; d3: string; d3Follow: string; d4: string; d5: string; d7: string };
}

const W = LANDING_WORDS.firstWeek;
const PAGE_LIVE = W.days.d5;

/** Sole Revival, the default (words.ts `firstWeek`). */
export const SOLE_REVIVAL_STORY: ExampleStory = { person: EXAMPLE_PERSON, project: EXAMPLE_PROJECT, name: W.project, line: W.pitch, days: W.days };

interface Draft {
  founder: Pick<PersonPageProps, "name" | "headline" | "place" | "strengths" | "lookingFor">;
  name: string;
  line: string;
  pitch: string;
  about: string;
  forWhom: string;
  colors: [primary: string, secondary: string];
  stage?: ProjectPageProps["stage"];
  /** Days 1, 2, 3, 3's follow-up, 4 and 7; day 5 is always the first milestone. */
  days: [string, string, string, string, string, string];
}

const story = ({ founder, name, line, pitch, about, forWhom, colors, stage = "idea", days: [d1, d2, d3, d3Follow, d4, d7] }: Draft): ExampleStory => ({
  name,
  line,
  person: { ...founder, projects: [{ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, pitch: `${line}.`, href: "#first-week" }], titleLevel: 3, variant: "preview" },
  project: { name, pitch, about, forWhom, stage, brandPrimary: colors[0], brandSecondary: colors[1], founderNames: [founder.name.split(" ")[0]!], mark: "member", titleLevel: 3, variant: "preview" },
  days: { d1, d2, d3, d3Follow, d4, d5: PAGE_LIVE, d7 },
});

const published = (who: string, what: string) => `The team drafts the page. ${who} ${what} and publishes it at its own ${APP_NAME} address.`;

/** One story per profile page; a page with none shows Sole Revival. */
export const EXAMPLE_STORIES: Partial<Record<LandingVariant, ExampleStory>> = {
  graduate: story({
    founder: { name: "Priya Nair", headline: "English graduate, patient with first drafts", place: "Columbus, OH", strengths: ["Essay editing", "Explaining clearly", "Short videos"], lookingFor: "open_to_people" },
    name: "Essay Ready",
    line: "College essay coaching for high school seniors",
    pitch: "One-to-one college essay coaching over video, from the first draft to the final one.",
    about: "Three video sessions and written notes on every draft.\n\nThe first session is free while we learn what students need.",
    forWhom: "High school seniors writing their college essays.",
    colors: ["#2b4c7e", "#f4f1ea"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4. Its weakest rating is standing out from other essay tutors.",
      published("Priya", "rewrites the intro in her own voice"),
      "Priya sends the link to her old high school's parent group and two teachers she knows.",
      "Six people follow the page.",
      "The team drafts a short post with three essay openings that work. Priya posts it.",
      "One decision is waiting, with the team's recommendation: a first session free, or $40 for three. Money Priya has spent: $0.",
    ],
  }),
  "blank-box": story({
    founder: { name: "Marcus Reed", headline: "Cooks for six every Sunday, likes a good spreadsheet", place: "Raleigh, NC", strengths: ["Cooking for a crowd", "Planning", "Talking to neighbors"] },
    name: "Fridge Fill",
    line: "Ready-to-heat dinners for busy families",
    pitch: "Five dinners for the week, cooked on Sunday and delivered to your door in one neighborhood.",
    about: "Pick five from this week's menu by Friday. They arrive Sunday afternoon, ready to heat.\n\nWe start with ten families while the kitchen is set up.",
    forWhom: "Busy families in one neighborhood who want a home-cooked week.",
    colors: ["#9a3b26", "#fbf3e8"],
    days: [
      "Marcus types one rough sentence about food. It comes back as Fridge Fill, rated 3 stars with room to reach 4, with the rules a food business must plan for.",
      published("Marcus", "changes the menu"),
      "Marcus shares the link in his neighborhood group.",
      "Nine people follow the page.",
      "The team drafts a checklist for the licensed kitchen he needs before the first sale. Marcus calls one nearby.",
      "One decision is waiting, with the team's recommendation: rent a shared kitchen one day a week, or two. Money Marcus has spent: $0.",
    ],
  }),
  overwhelmed: story({
    founder: { name: "Dana Whitfield", headline: "Reactive skin since forever, reads every label", place: "Portland, OR", strengths: ["Ingredient lists", "Product photos", "Online communities"] },
    name: "Patch Test Box",
    line: "Sample boxes for reactive skin",
    pitch: "Sample sizes from fragrance-free brands in one box, so you can test before you buy.",
    about: "Each box holds five samples chosen for reactive skin, with notes from people who tried them.\n\nThe first boxes go to the people who follow this page.",
    forWhom: "People with reactive skin tired of buying full sizes that sting.",
    colors: ["#3f6b5a", "#f5f2ec"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4. Nothing to set up and no tools to connect.",
      published("Dana", "adds a photo of her own shelf"),
      "Dana shares the link in two online groups for sensitive skin.",
      "Fourteen people follow the page.",
      "The team drafts a list of fragrance-free brands to ask for samples, with the reason for each. Dana picks five.",
      "One decision is waiting, with the team's recommendation: a first box of five samples, or three. Money Dana has spent: $0.",
    ],
  }),
  evenings: story({
    founder: { name: "Tom Alvarez", headline: "Restores old chairs in the garage on weekends", place: "Tulsa, OK", strengths: ["Woodworking", "Refinishing", "Fixing what others throw out"] },
    name: "Second Seat",
    line: "Old chairs, restored and resold",
    pitch: "Old wooden chairs, restored by hand and sold one at a time.",
    about: "Each chair is sanded, repaired and refinished in a home workshop, and listed here when it's done.\n\nNew chairs go up on Sunday evenings.",
    forWhom: "People furnishing a home who want something with a past.",
    colors: ["#6b4a2b", "#f6efe4"],
    days: [
      "Tuesday evening, twenty minutes: the idea is shaped and rated, 3 stars with room to reach 3.5.",
      "The team drafts the page during the day. That evening Tom changes two lines and publishes it at its own " + APP_NAME + " address.",
      "Tom shares the link in his town's buy-and-sell group.",
      "Seven people follow the page.",
      "The team drafts a before-and-after post of the first chair. Tom posts it after dinner.",
      "One decision is waiting for the weekend, with the team's recommendation: price the first chair at $90, or $120. Money Tom has spent: $0.",
    ],
  }),
  parent: story({
    founder: { name: "Leah Okafor", headline: "Mom of two, plans a very good birthday party", place: "Charlotte, NC", strengths: ["Party planning", "Crafts", "Getting things done in short windows"], lookingFor: "open_to_people" },
    name: "Party Box",
    line: "Birthday parties in a box for ages 4 to 8",
    pitch: "Everything for a birthday party at home: decorations, games and a plan for the day.",
    about: "Pick a theme, and the box arrives a week before the party with a plan for every half hour.\n\nThe first boxes are for families at one school while we learn what works.",
    forWhom: "Parents of kids aged 4 to 8 who want a party at home without the planning.",
    colors: ["#c2456b", "#fff4f0"],
    days: [
      "During nap time, the idea is shaped and rated: 3 stars, with room to reach 3.5.",
      published("Leah", "changes the themes that evening"),
      "Leah sends the link to her class parents' group.",
      "Eleven people follow the page.",
      "The team drafts a post with three party themes. Leah posts it.",
      "One decision is waiting, with the team's recommendation: a first box at $45, or one free for a friend's party in return for photos. Money Leah has spent: $0.",
    ],
  }),
  expert: story({
    founder: { name: "Karen Liu", headline: "25 years in HR, from five-person startups to 5,000 people", place: "Minneapolis, MN", strengths: ["HR policy", "Hard conversations", "Plain writing"] },
    name: "First Ten",
    line: "HR policies for firms with their first ten people",
    pitch: "HR policies and contract templates for small firms, written by an HR lead and kept up to date.",
    about: "Everything a firm needs before its first ten people: policies, templates and a checklist for each new start.\n\nUpdated when the rules change, so you don't have to watch them.",
    forWhom: "Founders of small firms taking on their first people.",
    colors: ["#2f3e5c", "#f3f1ec"],
    days: [
      "Karen imports twenty years of notes as one Markdown file. The idea is rated: 3.5 stars, with room to reach 4.",
      published("Karen", "tightens the wording"),
      "Karen shares the link with ten founders she has advised over the years.",
      "Five people follow the page.",
      "The team drafts a post: the three policies most small firms forget. Karen posts it.",
      "One decision is waiting, with the team's recommendation: sell the set once at $149, or at $19 a month with updates. Money Karen has spent: $0.",
    ],
  }),
  trades: story({
    founder: { name: "Mike Brennan", headline: "Licensed electrician, 20 years in old houses", place: "Pittsburgh, PA", strengths: ["Old wiring", "Explaining it plainly", "Showing up on time"] },
    name: "Wired Right",
    line: "Electrical safety checks for older homes",
    pitch: "A fixed-price electrical safety check for older homes, with a written report you can keep.",
    about: "One visit, two hours, every outlet and panel checked, and a plain-language report the same day.\n\nBook online and pay one fixed price.",
    forWhom: "Owners and buyers of homes built before 1980.",
    colors: ["#1f3b57", "#f7c548"],
    days: [
      "The idea is shaped and rated: 3.5 stars, with room to reach 4. The team flags his license and insurance as the first things to check.",
      published("Mike", "adds his license number"),
      "Mike gives the link to three real estate agents he knows.",
      "Four people follow the page.",
      "The team drafts a post: five signs an old house needs its wiring checked. Mike posts it.",
      "One decision is waiting, with the team's recommendation: a fixed price of $189, or $229. Money Mike has spent: $0.",
    ],
  }),
  retired: story({
    founder: { name: "Ruth Feldman", headline: "Retired teacher, patient with phones and with people", place: "Sarasota, FL", strengths: ["Patience", "Explaining step by step", "Knowing the neighbors"] },
    name: "Tech Help at Home",
    line: "Phone and computer help at home for older neighbors",
    pitch: "Patient help with phones, tablets and computers, at your kitchen table.",
    about: "An hour at your home to set up, fix or explain whatever you need, at your pace.\n\nFirst visits are for neighbors in one community while we learn what helps most.",
    forWhom: "Older neighbors who want help with technology from someone patient.",
    colors: ["#35605a", "#f6f1e7"],
    days: [
      "Ruth types the idea in plain words. It comes back rated: 3.5 stars, with room to reach 4.",
      "The team drafts the page and explains what a pitch is the first time the word comes up. Ruth changes two lines and publishes it at its own " + APP_NAME + " address.",
      "Ruth pins the link to the community center's board and emails it to her book group.",
      "Eight people follow the page.",
      "The team drafts a flyer for the community center. Ruth prints it.",
      "One decision is waiting, with the team's recommendation: $35 an hour, or $25 for neighbors over 75. Money Ruth has spent: $0.",
    ],
  }),
  maker: story({
    founder: { name: "Elena Costa", headline: "Potter, throws mugs in a garage studio", place: "Asheville, NC", strengths: ["Wheel throwing", "Glazes", "Market stalls"] },
    name: "Fernhill Pottery",
    line: "Stoneware mugs in small seasonal runs",
    pitch: "Stoneware mugs made by hand in small seasonal runs.",
    about: "Twenty mugs each winter, each thrown, glazed and fired in a small home studio.\n\nThe winter run opens to the people who follow this page first.",
    forWhom: "People who want a mug made by a person, not a factory.",
    colors: ["#5b6b4a", "#f4efe6"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 3.5.",
      published("Elena", "adds photos of the winter glaze"),
      "Elena shares the link with the people who bought from her at last month's market.",
      "Twelve people follow the page.",
      "The team drafts a post showing one mug from wheel to kiln. Elena posts it.",
      "One decision is waiting, with the team's recommendation: $38 a mug, or a set of two for $70. Money Elena has spent: $0.",
    ],
  }),
  cook: story({
    founder: { name: "Sal Moretti", headline: "Makes his grandmother's sauce every Sunday", place: "Providence, RI", strengths: ["Cooking", "Family recipes", "Feeding a crowd"] },
    name: "Sunday Sauce Co.",
    line: "Small-batch pasta sauce from a family recipe",
    pitch: "Small-batch pasta sauce from a family recipe, made on Sundays.",
    about: "One recipe, slow-cooked in small batches and jarred by hand.\n\nThe first jars go to the people who follow this page.",
    forWhom: "People who want the sauce they would make if they had all Sunday.",
    colors: ["#a3271f", "#fbf4ea"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4. Its weakest rating is the food license it needs before the first sale.",
      published("Sal", "tells the story of the recipe in his own words"),
      "Sal sends the link to his family's group chat and to two friends who own delis.",
      "Fifteen people follow the page.",
      "The team drafts a checklist for selling food made at home in his state. Sal calls the county office.",
      "One decision is waiting, with the team's recommendation: start at the Saturday market, or with the two delis. Money Sal has spent: $0.",
    ],
  }),
  creator: story({
    founder: { name: "Jasmine Brooks", headline: "Posts about house plants to 5,000 followers", place: "Denver, CO", strengths: ["Plant care", "Short videos", "Answering questions"] },
    name: "The Plant Letter",
    line: "A weekly newsletter on keeping house plants alive",
    pitch: "A weekly letter on keeping house plants alive, with one reader's plant answered each week.",
    about: "Every Sunday: one plant, one problem, one fix, and a reader's question answered with photos.\n\nThe first month is free for the people who follow this page.",
    forWhom: "People with more plants than they know how to keep alive.",
    colors: ["#2e6b3f", "#f2f6ee"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4.",
      published("Jasmine", "adds her own plant photos"),
      "Jasmine puts the link in her profile and shares it with her followers.",
      "Forty people follow the page.",
      "The team drafts the first letter from her three most-asked questions. Jasmine edits it.",
      "One decision is waiting, with the team's recommendation: $4 a month, or $36 a year. Money Jasmine has spent: $0.",
    ],
  }),
  freelancer: story({
    founder: { name: "Owen Park", headline: "Freelance designer, ten years of brands for food businesses", place: "Philadelphia, PA", strengths: ["Brand design", "Packaging", "Working with shop owners"] },
    name: "Crumb Studio",
    line: "Brand templates for new bakeries",
    pitch: "Ready-made brand templates for new bakeries: logo, menu, signs and boxes.",
    about: "Pick a style, add your name, and get a logo, a menu, shop signs and box labels that match.\n\nMade by a designer who has branded thirty bakeries.",
    forWhom: "People opening their first bakery who want a brand before they can pay for a custom one.",
    colors: ["#8a5a3c", "#fdf6ec"],
    days: [
      "Owen describes what clients already pay him for. The idea is rated: 3 stars, with room to reach 4.",
      published("Owen", "adds three of his templates"),
      "Owen sends the link to two bakery owners he has worked with and asks what they would have paid.",
      "Six people follow the page.",
      "The team drafts a post: one bakery's brand, before and after. Owen posts it.",
      "One decision is waiting, with the team's recommendation: one template at $79, or three styles at $149. Money Owen has spent: $0.",
    ],
  }),
  developer: story({
    founder: { name: "Sam Kowalski", headline: "Writes backend code, ships side projects, avoids launch posts", place: "Seattle, WA", strengths: ["TypeScript", "APIs", "Shipping small tools"] },
    name: "Patchnote",
    line: "Patch notes written from a game's code history",
    pitch: "Patch notes written from your game's code history and posted to your community after every release.",
    about: "Patchnote drafts notes players can read from what changed in your code, ready for you to edit and post.\n\nFree for small studios while it's in testing.",
    forWhom: "Small game studios that ship every week.",
    colors: ["#20232a", "#61dafb"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4. Its weakest rating is how easy it would be to copy.",
      published("Sam", "cuts the page to four lines"),
      "Sam shares the link in two indie game communities.",
      "Nine people follow the page.",
      "The team drafts the launch post Sam never wants to write. He changes one line and posts it.",
      "One decision is waiting, with the team's recommendation: free for one game, or $9 a month. Money Sam has spent: $0.",
    ],
  }),
  "game-dev": story({
    founder: { name: "Riley Chen", headline: "Makes cozy pixel games at night", place: "Sacramento, CA", strengths: ["Pixel art", "Game design", "Game jams"], lookingFor: "looking_for_cofounder" },
    name: "Tiny Acre",
    line: "A cozy farming game for phones",
    pitch: "A small farming game for phones: one field, four months of crops, no timers.",
    about: "Plant, tend and harvest one field at your own pace, with no timers pushing you to come back.\n\nThe first playable build goes to the people who follow this page.",
    forWhom: "Players who want a calm game for ten minutes at a time.",
    colors: ["#4e7a3a", "#f7f0d8"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 3.5. Its weakest rating is standing out among farming games.",
      published("Riley", "adds three screenshots"),
      "Riley shares the link in a game-making community and with friends from the last game jam.",
      "Twenty people follow the page.",
      "The team drafts a short devlog post about the first crops in the game. Riley posts it.",
      "One decision is waiting, with the team's recommendation: a free demo first, or $3 from day one. Money Riley has spent: $0.",
    ],
  }),
  educator: story({
    founder: { name: "Angela Ruiz", headline: "Sixth-grade math teacher for 15 years", place: "El Paso, TX", strengths: ["Math", "Explaining it twice, differently", "Worksheets that work"] },
    name: "Grade Six Sets",
    line: "Weekly math practice for grade 6",
    pitch: "Weekly practice sets for grade 6 math, with answers and a short video for the hardest problem.",
    about: "Every Sunday, one set of ten problems that matches what most classes cover that week.\n\nWritten by a teacher who has taught grade 6 for fifteen years.",
    forWhom: "Parents and tutors of sixth graders who want practice that matches class.",
    colors: ["#2b6cb0", "#fdf8ec"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4.",
      published("Angela", "adds a sample set"),
      "Angela shares the link with tutors she knows and her neighborhood parents' group.",
      "Ten people follow the page.",
      "The team drafts the first week's set from her notes. Angela checks every answer.",
      "One decision is waiting, with the team's recommendation: $5 a month per family, or $15 for tutors with many students. Money Angela has spent: $0.",
    ],
  }),
  beauty: story({
    founder: { name: "Maya Thompson", headline: "Nail artist with skin that reacts to half the products she used", place: "Atlanta, GA", strengths: ["Nail care", "Ingredients", "Talking to clients"] },
    name: "Quiet Nails",
    line: "Nail care without harsh smells",
    pitch: "Polish remover and cuticle oil made without harsh smells, sold in small batches.",
    about: "Two products to start, both tried on the founder's own sensitive skin first.\n\nEvery ingredient is listed on every bottle.",
    forWhom: "People who love their nails but not the smell.",
    colors: ["#9b4f7a", "#fbf2f5"],
    days: [
      "The idea is shaped and rated: 3 stars, with room to reach 4. Its weakest rating is the cosmetics rules it must meet before the first sale.",
      published("Maya", "adds her own photos"),
      "Maya shares the link with her regular clients.",
      "Eighteen people follow the page.",
      "The team drafts a list of the labeling rules for cosmetics, with what to check first. Maya calls a small lab.",
      "One decision is waiting, with the team's recommendation: start with the cuticle oil alone, or both products. Money Maya has spent: $0.",
    ],
  }),
  "shop-owner": story({
    founder: { name: "Rosa Diaz", headline: "Owns a bakery with a line out the door on Saturdays", place: "San Antonio, TX", strengths: ["Baking", "Running a shop", "Knowing regulars by name"] },
    name: "Rosa's Preorders",
    line: "Online preorders for a bakery that sells out",
    pitch: "Order Rosa's bread and pastries by Thursday and pick them up Saturday morning, with no line.",
    about: "The shop sells out by ten every Saturday. Now you can reserve your order ahead.\n\nPickup at the counter, 8 to 11 AM.",
    forWhom: "Regulars who keep missing out.",
    colors: ["#b5562b", "#fdf3e6"],
    stage: "live",
    days: [
      "Rosa points her team at the bakery's website, read only, and gets a report of what exists, what is missing and what to decide first.",
      "The team drafts a preorder page. Rosa changes the menu and publishes it at its own " + APP_NAME + " address.",
      "Rosa puts the link on a card by the register.",
      "Twenty-two people follow the page.",
      "The team drafts a post for the bakery's own account: preorders open Thursday. Rosa posts it.",
      "One decision is waiting, with the team's recommendation: cap preorders at 40 loaves, or 60. Money Rosa has spent: $0.",
    ],
  }),
  "idea-collector": story({
    founder: { name: "Noor Haddad", headline: "Keeps a notebook of forty ideas, finally picked one", place: "Chicago, IL", strengths: ["Ideas", "Scents", "Book clubs"] },
    name: "Shelf Scent",
    line: "Candles that smell like old books",
    pitch: "Small-batch candles that smell like libraries, bookshops and reading by the fire.",
    about: "Three scents to start, poured by hand in small batches.\n\nEach one is named after the book that inspired it.",
    forWhom: "Readers who want their room to smell like a bookshop.",
    colors: ["#4a3b5c", "#f6f0e6"],
    days: [
      "Noor types five ideas from her notebook, one at a time. Each comes back rated on the same ten things; the candles rate highest, 3 stars with room to reach 3.5.",
      published("Noor", "changes the scent names"),
      "Noor shares the link with her book club and in a reading community.",
      "Sixteen people follow the page.",
      "The team drafts a post on which book each scent is named after. Noor posts it.",
      "One decision is waiting, with the team's recommendation: three scents at $24, or one to start. The other four ideas are kept for later. Money Noor has spent: $0.",
    ],
  }),
};

/** The story a page shows. */
export const exampleStory = (variant: LandingVariant): ExampleStory => EXAMPLE_STORIES[variant] ?? SOLE_REVIVAL_STORY;

/** The first week's days, as `DayList` takes them. */
export function storyDays(s: ExampleStory, platformMail: boolean): DayListItem[] {
  const d = s.days;
  return [
    { day: "Day 1", text: d.d1 },
    { day: "Day 2", text: d.d2 },
    { day: "Day 3", text: platformMail ? `${d.d3} ${d.d3Follow}` : d.d3 },
    { day: "Day 4", text: d.d4 },
    { day: "Day 5", text: d.d5, milestone: true },
    { day: "Day 7", text: d.d7 },
  ];
}
