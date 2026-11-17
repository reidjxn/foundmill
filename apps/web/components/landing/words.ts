/**
 * Every string the landing page at `/` prints (DESIGN §9a; docs/holistic-plan/landing/DIRECTION.md §4), in one place.
 * `LANDING_WORDS` is what every page shares; `VARIANT_WORDS` is what each of the five pages changes
 * (lib/landing-variant.ts). Each line is true for a stranger on the free plan today; the claims table in DIRECTION §6
 * names the code behind each one. The rated result of the idea box is called the visitor's "idea", never a "card"
 * (founder, 2026-11-16: "card" reads as a payment card). A line marked [switch] is printed only when its switch is on
 * (flags.ts). `{INCLUDED}` is the free plan's monthly agent work, read from packages/config, never typed.
 */
import { APP_NAME, CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { formatMoney } from "@foundmill/dugout";
import type { LandingVariant } from "@/lib/landing-variant";

export const INCLUDED = formatMoney({ amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY }, { locale: "en-US" });

/** The three ways in, in the order a variant puts them (`ways`). */
export type WayId = "sentence" | "studio" | "bring";

/** What a variant changes: the hero, the idea box's label and typed examples, and which way in comes first. */
export interface VariantWords {
  title: string;
  lede: string;
  /** The idea field's visible label. */
  label: string;
  /** The ideas the placeholder types; absent: the first-timer's (idea-box/typing.ts). */
  ideas?: readonly string[];
  /** "Surprise me" starts open, its interests showing. */
  surpriseOpen?: boolean;
  ways: readonly [WayId, WayId, WayId];
}

const FREE = "free and before you sign up";

/**
 * One entry per page (lib/landing-variant.ts). Each line is true for a stranger today, like the rest of this file: a
 * variant chooses which true things to say first, it never promises more.
 */
export const VARIANT_WORDS: Record<LandingVariant, VariantWords> = {
  first: {
    title: "Turn one sentence into a business of your own.",
    lede: `Type your idea. A team of AI agents gives it a name, a pitch and ten honest ratings, ${FREE}.`,
    label: "What do you want to make?",
    ways: ["sentence", "studio", "bring"],
  },
  "no-idea": {
    title: "No idea yet? Start from something you like.",
    lede: `Pick an interest and your team drafts an idea around it, rated honestly, ${FREE}.`,
    label: "What are you into?",
    ideas: ["I fix up old bikes on weekends", "I am good at explaining math", "I know every thrift store in town", "I bake for my whole building", "I edit videos for my friends", "I grow more tomatoes than I can eat"],
    surpriseOpen: true,
    ways: ["studio", "sentence", "bring"],
  },
  "has-idea": {
    title: "You have the idea. Get it rated, then built.",
    lede: `Type it as it is. Your team rates it on ten things, gives the reason for each and names the one that would raise it most, ${FREE}.`,
    label: "What is your idea?",
    ways: ["sentence", "bring", "studio"],
  },
  running: {
    title: "Already running something? Give it a team of AI agents.",
    lede: `Say what you run in one sentence and see how a team of AI agents rates it, ${FREE}.`,
    label: "What do you run?",
    ideas: ["A two-person bakery with a waiting list", "An online shop selling hand-dyed yarn", "A tutoring business with twelve students", "A newsletter with 800 readers", "A mobile bike repair van"],
    ways: ["bring", "sentence", "studio"],
  },
  builder: {
    title: "Build your app with a team of AI agents.",
    lede: `Describe it in one sentence and get an honest rating, ${FREE}. Inside, your team builds it in your own GitHub account.`,
    label: "What do you want to build?",
    ideas: ["An app that splits rent and bills for roommates", "A booking tool for independent barbers", "A browser extension that sums up long threads", "A training log for climbers", "A tool that turns receipts into a spreadsheet"],
    ways: ["sentence", "studio", "bring"],
  },
};

export const LANDING_WORDS = {
  topBar: {
    home: `${APP_NAME} home`,
    signIn: "Sign in",
    /** [switch: TOUR_ENABLED], from 1280 px */
    tour: "Take the tour",
    /** [switch: peopleOpen] */
    findPeople: "Find people",
  },
  hero: {
    /** The default page's headline; a variant's own is in `VARIANT_WORDS`. */
    title: VARIANT_WORDS.first.title,
    landedTitle: (name: string) => `${name} is yours to keep.`,
    /**
     * The line over the rated examples beside the box (founder, 2026-11-17, their words exactly). "companies" is the one
     * exception to the project/business rule (CLAUDE.md "the words for people"); use it nowhere else.
     */
    exampleLabel: "Example companies you can create",
    /** [switch: signupOpen off] */
    ledeClosed: "Keep it, and once your place opens the team drafts a page for it and plans what comes next.",
    /** [switch: signupOpen on] */
    ledeOpen: "Keep it, and the team drafts a page for it and plans what comes next.",
    /** [switch: signupOpen off] */
    door: `${APP_NAME} lets new people in a few at a time. Signing in puts you on the list and keeps your idea for 90 days.`,
  },
  result: {
    title: "What comes back",
    points: [
      { lead: "A name and a one-line pitch", rest: ", written from your words." },
      { lead: "Ten ratings out of 20", rest: ", each with the reason behind it. Founder fit waits until you have answered a few questions about yourself." },
      { lead: "The one thing that would raise it most", rest: ", so you know where to start." },
    ],
  },
  ways: {
    title: "Three ways to start",
    /** [switch: signupOpen off] */
    closed: "The Ideation Studio and imports open with your place.",
    sentence: {
      title: "Start from one sentence",
      text: `Type it at the top of this page. It comes back with a name, a one-line pitch and ten ratings, ${FREE}.`,
    },
    studio: {
      title: "Let the Ideation Studio draft ideas",
      text: "Give it a rough brief, or nothing at all, and it drafts 6 to 12 ideas at a time. Steer the next set, compare up to four side by side, merge two into one, then choose.",
    },
    bring: {
      title: "Bring what you already have",
      text: "Use your idea exactly as you wrote it. Import a plan as a Markdown file. Or point your team at what you already run, read only, and get a report of what exists, what is missing and what to decide first.",
      sourcesLabel: "Read only, from",
      sources: ["Your website", "GitHub", "Google Drive", "Notion", "Stripe", "Shopify"],
    },
  },
  studio: {
    title: "Inside the Ideation Studio",
    lede: "Every idea arrives rated on the same ten things, so you can tell a strong one from a loud one.",
    label: "Example ideas",
    brief: "From the brief “Something with sneakers at my college”",
    steerLabel: "Steer the next set",
    steer: ["Cheaper to start", "B2B instead", "More defensible"],
    points: [
      { lead: "Steer the next set.", rest: " Ask for cheaper to start, B2B instead or more defensible, and the next ideas follow." },
      { lead: "Compare and merge.", rest: " Put up to four side by side, read your team's verdict, and merge two into one." },
      { lead: "Keep your own words.", rest: " Edit any idea, or use yours as written. Every change is a new version you can go back to." },
    ],
  },
  /** [switch: TOUR_ENABLED], from 1280 px: the tour is built for a wide screen. */
  tour: {
    text: "Want to see a whole team at work? The tour runs an example business from its first idea to its first customers.",
    link: "Take the tour",
  },
  people: {
    title: "On your own, or with people",
    lede: "You can build all of it by yourself. Your team of agents covers the work, and nothing waits on a second person.",
    intro: "If you want people to build it with, they are one step away.",
    points: [
      { lead: "Invite anyone.", rest: " Send an invitation link. They join your project as a cofounder, with the same standing as you, or as a collaborator who helps with the product and customers and sees nothing of the money or settings." },
      { lead: "People are free.", rest: " Add as many cofounders and collaborators as you like, on every plan." },
      { lead: "A page of your own.", rest: " At foundmill.com/u/your-name, say what you are good at and, if you like, that you are open to building with people, looking for a cofounder or looking to join a project." },
    ],
    /** [switch: peopleOpen] */
    findTitle: "Find people to build with",
    /** [switch: peopleOpen] */
    findText: "Meet other founders, connect, send a message and join communities.",
    /** [switch: peopleOpen] */
    findLink: "Find people",
  },
  firstWeek: {
    title: "A first week, from $0",
    lede: "An example of how a first project can go, using only what works today.",
    label: "Example project",
    project: "Sole Revival",
    pitch: "Sneaker cleaning for students at one college",
    days: {
      d1: "The idea is shaped and rated: 3 stars, with room to reach 4.",
      d2: `The team drafts the project's page. The founder changes two lines and publishes it at its own ${APP_NAME} address.`,
      d3: "The founder sends the link to two group chats.",
      /** [switch: platformMail] appended to day 3 */
      d3Follow: "Four people follow the page.",
      d4: "The team drafts a short post with a before-and-after photo idea. The founder posts it.",
      d5: "The project's story shows its first milestone: page live.",
      d7: "One decision is waiting, with the team's recommendation: clean the first pair free, or charge $5. Money the founder has spent: $0.",
    },
    another: "See another example",
    second: {
      project: "Cheap Eats Houston",
      pitch: "A weekly list of meals under $10",
      days: [
        { day: "Day 1", text: "Idea rated. Its weakest rating is standing out from other food lists." },
        { day: "Day 2", text: "Page published." },
        { day: "Day 4", text: "The founder posts the link in two neighborhood groups." },
        { day: "Day 6", text: "The team drafts the first list. The founder decides what goes on the page." },
        { day: "Day 7", text: "Money the founder has spent: $0." },
      ],
    },
  },
  control: {
    title: "You stay in charge",
    rules: "Your agents work inside house rules they cannot change. They never move money, sign anything, accept terms, file anything in your name, delete anything for good or change security settings.",
    yes: "Anything that reaches another person waits for your yes, unless you choose otherwise. One button stops every agent at once.",
  },
  cost: {
    title: "What it costs",
    free: "Starting is free, the free plan does not expire, and you never enter payment details.",
    allowance: `The free plan includes ${INCLUDED} of agent work a month for one project. If it runs out, your team pauses until the next month starts. Your page stays live and nothing you made is lost.`,
    people: `Your page's ${APP_NAME} address and every person you add are free on every plan.`,
  },
  questions: {
    title: "Questions",
    /** [switch: signupOpen off] */
    getIn: {
      id: "get-in",
      question: "When can I get in?",
      answer: `${APP_NAME} lets new people in a few at a time, so every project gets real agent work. Sign in to join the list, and your idea is kept for 90 days. If someone invites you to their project, you can join it right away.`,
    },
    always: [
      { id: "cost", question: "Does it cost anything?", answer: `Starting is free and you never enter payment details. The free plan includes ${INCLUDED} of agent work a month. If that runs out, your team pauses until the next month starts and your page stays live.` },
      { id: "no-idea", question: "I don't have an idea yet.", answer: "Tap Surprise me and pick something you like. You get one idea to react to. Once you are in, the Ideation Studio drafts 6 to 12 at a time." },
      { id: "bring", question: "I already have a plan or a business. Can I bring it?", answer: "Yes. Use your idea as you wrote it, import a plan as a Markdown file, or point your team at what you already run, read only, for a report of what exists and what is missing." },
      { id: "never", question: "I have never done this. Will I know what to do?", answer: "Yes. Your Chief of Staff, the agent that runs your team, plans the work, explains a new word the first time it comes up and tells you which decisions are yours." },
      { id: "my-name", question: "Can the agents do something in my name without asking?", answer: "No. They cannot move money, sign, accept terms, file anything in your name, delete anything for good or change security settings." },
      { id: "private", question: "Is my idea private?", answer: "Yes, until you publish your page. You choose what the page says, and you can take it down whenever you like." },
      { id: "company", question: "Do I need a company, a bank account or a website?", answer: `No. ${APP_NAME} hosts your page at a ${APP_NAME} address for free.` },
      { id: "phone", question: "Does it work on a phone?", answer: "You can shape and keep your idea on a phone, and answer what needs you. Publishing your page and the full workspace need a computer for now." },
      { id: "solo", question: "Can I do this on my own?", answer: "Yes, all of it." },
      { id: "together", question: "Can I build it with someone?", answer: "Yes. Invite as many cofounders and collaborators as you like, free on every plan." },
    ],
    limits: { id: "limits", question: "What can it not do yet?" },
    limitsEnd: "Building an app needs your own GitHub account. Your team says so when a step needs it.",
    adults: { id: "adults", question: `Who can use ${APP_NAME}?`, answer: "Anyone 18 or older." },
  },
  start: {
    title: "Start with one sentence.",
    text: "Shaping your first idea is free and needs no sign-up.",
  },
  footer: {
    whatTitle: `What ${APP_NAME} is`,
    what: `${APP_NAME} is a web app where one person, or a few people together, work with a team of AI agents to start a project of their own. The team shapes the idea, rates it honestly, drafts a public page for it and plans the next steps, and it asks before anything that spends money or acts in your name. It is free to start and for people 18 or older.`,
    terms: "Terms",
    privacy: "Privacy",
    /** [switch: TOUR_ENABLED], from 1280 px */
    tour: "Take the tour",
  },
} as const;

/**
 * Strings that must never return to `/` (DIRECTION §4 "Removed claims"): each was false for a stranger on the free
 * plan, or spoke to a reader the page no longer serves. `removed-claims.test.tsx` renders the page and fails on any.
 */
export const REMOVED_CLAIMS = [
  "checks it against real sources",
  "against real sources",
  "reconcile your Stripe",
  "Better every cycle",
  "Six departments work at once",
  "Nothing is spent until you approve it",
  "Start your business",
  "First company or fifth",
  "Or watch an example run",
  "1280 px wide or more",
  "Desktop only",
  "We will email you",
  "credits pool",
  "in one tap",
] as const;
