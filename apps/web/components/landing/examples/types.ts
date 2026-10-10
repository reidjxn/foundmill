/**
 * The shape of an example business on the signed-out landing page. One `ExampleBusiness` carries everything any section
 * of the page reads (the hero deck, the ticker, How it works, Your team, Live sessions, the Journey, the Customer
 * Update, the milestones, the Channel Board and the Inbox note), so the picker can swap the whole page by swapping one
 * object.
 *
 * It is plain data (no functions, dates or class instances): the server passes a deep-linked business to the page as a
 * prop, and React serialises it. Anything computed (the two-year Journey, the channel roster, money) is built from it by
 * the pure helpers in `./helpers`.
 *
 * Writing a business (see `./index.ts` for registering one): every figure that is not a measurement is labelled
 * Forecast or Estimate where the page shows it; prices are US dollars and copy is US English; agent prose uses the
 * product's vocabulary (team, Chief of Staff, chapter, Customer Update, win, standout agent).
 */
import type { Concept, Kit, MockSessionScript, RibbonDepartment, SkillRow, Trait, TrophyCard } from "@foundmill/dugout";
import type { ChannelKey, DeptColourToken, ModuleKey } from "@foundmill/shared/constants";

/** The businesses the picker offers, in its order. */
export const EXAMPLE_IDS = ["tutorlane", "glitchwick", "northwind"] as const;
export type ExampleId = (typeof EXAMPLE_IDS)[number];

/** What the picker shows before a business's content has loaded: enough to draw its option and its brand. */
export interface ExampleIdentity {
  id: ExampleId;
  name: string;
  /** One or two letters, for the concept card's initials. */
  monogram: string;
  /** Seed for generated parts (the brand picker's option keys). */
  seed: string;
  /** The logo mark: a checked SVG data URL from `../logos`. */
  logo: string;
  /** Brand colours: the whole page is themed with them (`kitStyle`) while the business is shown. */
  kit: Kit;
  /** Two or three words under the name in the picker: "Education software". */
  vertical: string;
  /** One line: what the business does. Read by screen readers with the picker's option. */
  description: string;
}

/** An agent named in example content: portrait seed and department colour. */
export interface ExampleAgentRef {
  name: string;
  seed: string;
  dept: DeptColourToken;
}

/** Icons a department tab can carry (the module's own icon when absent). */
export const EXAMPLE_DEPARTMENT_ICONS = ["product", "development", "distribution", "finance", "legal", "team", "lab", "retail", "playtest"] as const;
export type ExampleDepartmentIcon = (typeof EXAMPLE_DEPARTMENT_ICONS)[number];

/**
 * A department is a label over a module (CLAUDE.md: never hard-code a department name). Northwind calls its lab
 * "Formulation Lab" over the development module's Specialists screen and its channels "Retail Partnerships".
 */
export interface ExampleDepartment {
  /** Unique within the business; leads and the cycle plan refer to it. Tutorlane's are the module keys. */
  id: string;
  /** The module it is a label over: its real screens (and default icon) come from here. */
  module: ModuleKey;
  /** The display name, as the founder named it. */
  label: string;
  dept: DeptColourToken;
  icon?: ExampleDepartmentIcon;
  /** Slugs of the module's tabs to list as this department's screens (all of them when absent). */
  screens?: readonly string[];
  /** The agents in the team orbit's outer ring for this department (the lead sits on the inner ring). */
  workers: ReadonlyArray<{ name: string; seed: string }>;
}

export interface ExampleLead {
  /** `ExampleDepartment.id`. */
  department: string;
  name: string;
  seed: string;
  role: string;
  model: "Opus" | "Sonnet";
  stars: { current: number; potential: number };
  /** What the department does, in one sentence. */
  remit: string;
  now: string;
  training: string;
  skills: readonly SkillRow[];
  traits: readonly Trait[];
}

/** One line of what the team did: the hero's live feed and the ticker. */
export interface ActivityLine {
  who: string;
  dept: DeptColourToken;
  text: string;
}

export interface ExampleDecision {
  kind: "decision";
  id: string;
  from: { name: string; seed: string; dept: DeptColourToken; role: string };
  department: string;
  subject: string;
  body: string;
  /** What the choice commits, already labelled. */
  stake: string;
  /** Each option: the button label, the Inbox line once chosen (`done`) and what happens next (`outcome`). */
  options: ReadonlyArray<{ id: string; label: string; recommended?: boolean; done: string; outcome: string }>;
}

export interface ExampleWin {
  kind: "win";
  id: string;
  customer: string;
  plan: string;
  firstTouch: string;
  standout: ExampleAgentRef;
  involved: readonly ExampleAgentRef[];
}

export type CycleOutcome = ExampleDecision | ExampleWin;

/** The hero deck: where the business is when the page opens and what each press of Continue brings back. */
export interface ExampleDeck {
  /** The last cycle that finished when the page opens. */
  startCycle: number;
  chapter: string;
  runwayMonths: number;
  /** Agent spend per task in minor units, for the deck's and the cycle plan's Estimate figures. */
  costPerTaskMinor: number;
  /** The Inbox's second line when the page opens: a decision the founder already made. */
  earlierDecision: { title: string; detail: string; from: ExampleAgentRef };
  /** In order, then round again: the first press brings a decision, the second a customer. */
  outcomes: readonly CycleOutcome[];
}

export interface ExampleCyclePlanItem {
  /** `ExampleDepartment.id`; the row shows that department's lead. */
  department: string;
  task: string;
  tasks: number;
  /** Percent done, 0–100. */
  done: number;
}

export interface ExampleChannels {
  /** Seed for the board's generated channel performance. */
  seed: string;
  fits: Record<ChannelKey, number>;
  /** Four channels, in budget order. */
  recommended: readonly ChannelKey[];
  /** Why the strategist put a channel on the board; `{channel}` is replaced with its name. */
  why: string;
}

/** How the design system's two-year Journey fixture is relabelled for this business. */
export interface ExampleJourney {
  /** The Ribbon's departments: ids are the fixture's (`d-product` … `d-operations`), names and colours are this business's. */
  ribbonDepartments: readonly RibbonDepartment[];
  /** Fixture milestone label → this business's label. Unmapped labels keep the fixture's text with € shown as $. */
  milestoneLabels: Readonly<Record<string, string>>;
  /** One title per chapter (quarter), oldest first. */
  chapterTitles: readonly string[];
  /** Customer names for the Ribbon's conversions. */
  customerNames: readonly string[];
  /** The three roadmap items after Today. */
  roadmap: readonly string[];
}

export interface ExampleCustomerUpdate {
  /** The update level's display name: "Brief update", "Standard update" or "Featured update". */
  level: string;
  customer: { name: string; entityId: string; facts: ReadonlyArray<{ label: string; value: string }> };
  plan: string;
  stats: { touches: number; channels: number; days: number; acquisitionCostMinor: number };
  /** The narrated touches; the customer is mentioned as `[[ent:<entityId>|Name]]`. */
  commentary: ReadonlyArray<{ text: string; highlight?: boolean }>;
  agents: ReadonlyArray<ExampleAgentRef & { role: string; rating: number; standout: boolean }>;
}

export interface ExampleInboxNote {
  from: ExampleAgentRef & { role: string };
  /** The department label on the note's chip. */
  department: string;
  subject: string;
  /** When the note arrived: today on the example business ("Wed, Oct 7"). */
  sentOn: string;
  paragraphs: readonly string[];
  costMinor: number;
  fit: string;
  /** The Runway after tile ("14 months"), labelled Estimate. */
  runwayAfter: string;
  /** The DecisionBar's options; `costMinor` null when the option costs nothing. */
  options: ReadonlyArray<{ id: string; label: string; recommended?: boolean; consequence: string; costMinor: number | null; reversible: boolean }>;
}

export interface ExampleBusiness {
  identity: ExampleIdentity;
  /** ISO 4217; the landing page's examples are US businesses. */
  currency: string;
  /** The locale the example's own figures print in ("en-US" prints "$42.00", never "US$42.00"). */
  locale: string;
  chief: ExampleAgentRef;
  /** Six departments, in tab order. */
  departments: readonly ExampleDepartment[];
  /** One lead per department, in the same order. */
  leads: readonly ExampleLead[];
  deck: ExampleDeck;
  activity: readonly ActivityLine[];
  /** How it works: the concept cards (this business in front), the brand picker's six options and the cycle 1 plan. */
  howItWorks: {
    concepts: readonly Concept[];
    brandOptions: ReadonlyArray<{ logo: string; kit: Kit }>;
    firstCyclePlan: readonly ExampleCyclePlanItem[];
  };
  /** What the four replayed agents in Live sessions are building. */
  sessions: MockSessionScript;
  channels: ExampleChannels;
  journey: ExampleJourney;
  customerUpdate: ExampleCustomerUpdate;
  milestones: readonly TrophyCard[];
  inboxNote: ExampleInboxNote;
}
