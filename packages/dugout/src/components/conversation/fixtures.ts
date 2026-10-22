/**
 * Story and test content for the conversation components: Northwind Skincare's team on 9 October 2026. Not exported
 * from the package barrel.
 */
import type {
  LiveRunActivity,
  LiveRunItem,
  LiveRunLog,
  LiveRunPerson,
  LiveRunStep,
} from "./LiveRun";
import type { DeskMessage, DeskPersona, QuickReplyItem } from "./types";

export const DESK_ENTITY_IDS = {
  bootsUk: "8b0f4c2e-6d1a-4f3b-9c27-1e5d7a90b311",
  priya: "2c7d9e41-3b8a-4c5f-a6d2-7f0e1b2c3d42",
  pennine: "5e1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a53",
  adaHolm: "7f2b3c4d-5e6f-4a71-9b8c-0d1e2f3a4b64",
  shelfproof: "9a3c4d5e-6f70-4b82-8c9d-1e2f3a4b5c75",
} as const;

const ent = (id: keyof typeof DESK_ENTITY_IDS, name: string) =>
  `[[ent:${DESK_ENTITY_IDS[id]}|${name}]]`;

/** 14:01 on 9 October 2026, local time. */
export const DESK_T0 = new Date(2026, 9, 9, 14, 1, 0);
export const deskAt = (minutes: number) => new Date(DESK_T0.getTime() + minutes * 60_000);

/** Juno, Head of Retail Partnerships: in a session on the Boots UK trial model. */
export const JUNO: DeskPersona = {
  id: "agent-juno",
  name: "Juno",
  role: "Head of Retail Partnerships",
  avatarSeed: "juno",
  dept: "dept-3",
  status: "healthy",
  presence: "working",
  presenceLabel: "In a session · Boots UK trial model, v3",
  doingNow: "Boots UK trial model, v3",
  progress: 0.62,
  voice: {
    greeting: "I've modeled the Boots UK trial. Ask me anything about it before you decide.",
    thinking: ["Reading Boots UK's supplier terms", "Rerunning the December cash line"],
    ack: ["Noted.", "On it once you confirm."],
  },
};

/** The Inbox decision's openers (no model call). */
export const DECISION_STARTERS: QuickReplyItem[] = [
  {
    id: "go_with",
    label: "Go with: Approve the trial",
    say: "Go with: Approve the trial",
    kind: "choose_option",
    option_id: "approve",
    recommended: true,
  },
  {
    id: "why_that_one",
    label: "Why that one?",
    say: "Why that one?",
    kind: "ask",
    option_id: null,
    recommended: false,
  },
  {
    id: "whats_the_risk",
    label: "What's the risk?",
    say: "What's the risk?",
    kind: "ask",
    option_id: null,
    recommended: false,
  },
  {
    id: "something_else",
    label: "Something else…",
    say: "",
    kind: "write",
    option_id: null,
    recommended: false,
  },
];

/** A conversation about the Boots UK trial, with the agent's reaction and the next replies. */
export const JUNO_MESSAGES: DeskMessage[] = [
  {
    id: "m1",
    author: "founder",
    bubbles: ["What if only 40% sells through?"],
    at: deskAt(0),
    state: "seen",
  },
  {
    id: "m2",
    author: "agent",
    bubbles: [
      "Still positive. At 40% we clear about £6,100 by my estimate, and the unsold units come back in time for Ireland.",
      `The bigger lever is the 60-day terms. If ${ent("bootsUk", "Boots UK")} agrees to 45, December stays above £50K on my forecast.`,
    ],
    at: deskAt(1),
    reaction: "noted",
    quickReplies: [
      {
        id: "ask_for_45",
        label: "Yes, ask for 45 days",
        say: "Yes, ask Boots UK for 45-day terms",
        kind: "hand_off",
        option_id: null,
        recommended: true,
      },
      {
        id: "show_december",
        label: "Show me December",
        say: "Show me December",
        kind: "ask",
        option_id: null,
        recommended: false,
      },
      {
        id: "boots_risk",
        label: "What does Boots risk?",
        say: "What does Boots risk?",
        kind: "ask",
        option_id: null,
        recommended: false,
      },
      {
        id: "something_else",
        label: "Something else…",
        say: "",
        kind: "write",
        option_id: null,
        recommended: false,
      },
    ],
  },
];

/** The founder has just asked; the reply is in flight. */
export const JUNO_WAITING: DeskMessage[] = [
  ...JUNO_MESSAGES,
  { id: "m3", author: "founder", bubbles: ["What does Boots risk?"], at: deskAt(2), state: "seen" },
];

/** The agent offers to hand work off: nothing runs until the founder confirms the plan. */
export const JUNO_HANDOFF: DeskMessage[] = [
  ...JUNO_MESSAGES,
  {
    id: "m3",
    author: "founder",
    bubbles: ["Yes, ask Boots UK for 45-day terms"],
    at: deskAt(2),
    state: "seen",
  },
  {
    id: "m4",
    author: "agent",
    bubbles: [
      `I'll draft the request to ${ent("priya", "Priya Shah")} for 45-day terms, citing the batch 002 results.`,
    ],
    at: deskAt(3),
    reaction: "pleased",
    handOff: {
      instruction:
        "Draft an email to Priya Shah at Boots UK asking for 45-day payment terms on the 40-store trial.",
      gated: false,
    },
    quickReplies: [
      {
        id: "review_plan",
        label: "Review the plan",
        say: "Review the plan",
        kind: "hand_off",
        option_id: null,
        recommended: true,
      },
      {
        id: "not_now",
        label: "Not now",
        say: "Not now",
        kind: "decline",
        option_id: null,
        recommended: false,
      },
      {
        id: "whats_next",
        label: "What happens after?",
        say: "What happens after?",
        kind: "ask",
        option_id: null,
        recommended: false,
      },
    ],
  },
];

/** The Research agent on the Ideation Studio's Ask (no business yet). */
export const RESEARCH_AGENT: DeskPersona = {
  id: "research-agent",
  name: "Research agent",
  role: "Rivals, market size and prices",
  avatarSeed: "research-agent",
  dept: "dept-6",
  status: "healthy",
  presence: "available",
  doingNow: null,
  voice: {
    greeting: "I grounded Shelfproof against rivals, size and prices. What would you like to know?",
    thinking: ["Checking Shelfproof's pricing comparables"],
  },
};

export const CONCEPT_STARTERS: QuickReplyItem[] = [
  {
    id: "biggest_risk",
    label: "Biggest risk?",
    say: "What is the biggest risk?",
    kind: "ask",
    option_id: null,
    recommended: true,
  },
  {
    id: "who_pays_first",
    label: "Who pays first?",
    say: "Who pays first?",
    kind: "ask",
    option_id: null,
    recommended: false,
  },
  {
    id: "closest_competitors",
    label: "Closest competitors?",
    say: "Who are the closest competitors?",
    kind: "ask",
    option_id: null,
    recommended: false,
  },
  {
    id: "first_customer",
    label: "First paying customer?",
    say: "Who is the first paying customer?",
    kind: "ask",
    option_id: null,
    recommended: false,
  },
];

export const RESEARCH_MESSAGES: DeskMessage[] = [
  { id: "r1", author: "founder", bubbles: ["Who pays first?"], at: deskAt(4), state: "seen" },
  {
    id: "r2",
    author: "agent",
    bubbles: [
      `Indie skincare brands chasing a pharmacy listing. ${ent("bootsUk", "Boots UK")} asks for stability and patch-test data before it lists a brand.`,
      "A contract lab charges about £2–4K per product line by my estimate, so a brand with three products feels the cost first.",
    ],
    at: deskAt(5),
    reaction: "thinking",
    quickReplies: [
      {
        id: "biggest_risk",
        label: "Biggest risk?",
        say: "What is the biggest risk?",
        kind: "ask",
        option_id: null,
        recommended: true,
      },
      {
        id: "closest_competitors",
        label: "Closest competitors?",
        say: "Who are the closest competitors?",
        kind: "ask",
        option_id: null,
        recommended: false,
      },
      {
        id: "first_customer",
        label: "First paying customer?",
        say: "Who is the first paying customer?",
        kind: "ask",
        option_id: null,
        recommended: false,
      },
    ],
  },
];

/** A specialist who is down, on their profile. */
export const CERTIFICATION: DeskPersona = {
  id: "agent-cert",
  name: "Certification Specialist",
  role: "Formulation Lab",
  avatarSeed: "certification",
  dept: "dept-7",
  status: "injured",
  presence: "down",
  expectedBack: "2:30 PM",
  doingNow: "Serum stability, day 21 of 28",
  progress: 0.75,
  voice: { thinking: ["Pulling up the stability log"] },
};

export const CERTIFICATION_MESSAGES: DeskMessage[] = [
  {
    id: "c1",
    author: "founder",
    bubbles: ["When will the serum stability results be ready?"],
    at: deskAt(-40),
    state: "seen",
  },
  {
    id: "c2",
    author: "agent",
    bubbles: [
      "Day 21 of 28. If the last week holds, the results are ready on October 16 by my forecast.",
      "I'm down until 2:30 PM; the log keeps running without me.",
    ],
    at: deskAt(-39),
    quickReplies: [
      {
        id: "whats_blocking",
        label: "What's blocking you?",
        say: "What's blocking you?",
        kind: "ask",
        option_id: null,
        recommended: true,
      },
      {
        id: "thanks",
        label: "Thanks",
        say: "Thanks",
        kind: "acknowledge",
        option_id: null,
        recommended: false,
      },
    ],
  },
];

/* ---------- Generation: the Ideation Studio drafting twelve concepts ---------- */
export const ISOLDE: LiveRunPerson = {
  id: "isolde",
  name: "Isolde",
  avatarSeed: "isolde",
  dept: "dept-1",
};
export const PIKE: LiveRunPerson = { id: "pike", name: "Pike", avatarSeed: "pike", dept: "dept-6" };
export const MARLOW: LiveRunPerson = {
  id: "marlow",
  name: "Marlow",
  avatarSeed: "marlow",
  dept: "dept-7",
};
export const TEODOR: LiveRunPerson = {
  id: "teodor",
  name: "Teodor",
  avatarSeed: "teodor",
  dept: "dept-2",
};
export const NOOR: LiveRunPerson = { id: "noor", name: "Noor", avatarSeed: "noor", dept: "dept-8" };

export const RUN_STEPS: LiveRunStep[] = [
  {
    id: "profile",
    label: "Read your profile",
    detail: "Skills, time, budget · 0.3 s",
    state: "done",
  },
  { id: "slate", label: "Slate of 12 angles", detail: "Isolde · 2.1 s", state: "done" },
  {
    id: "draft",
    label: "Drafting cards",
    detail: "2 landed · 1 in progress",
    state: "current",
    people: [ISOLDE, PIKE, MARLOW],
  },
  { id: "ground", label: "Grounding", detail: "Noor: rivals, size, prices", state: "pending" },
  { id: "rank", label: "Rank and explain", detail: "Best fit for you first", state: "pending" },
];

export const RUN_ITEMS: LiveRunItem[] = [
  { id: "c1", state: "landed", label: "Patchwise" },
  { id: "c2", state: "landed", label: "Northwind" },
  { id: "c3", state: "drafting", progress: 0.45, dept: "dept-7", label: "Shelfproof" },
  { id: "c4", state: "queued", label: "Teodor's next" },
  { id: "c5", state: "queued", label: "Isolde's next" },
  ...Array.from({ length: 7 }, (_, i): LiveRunItem => ({ id: `c${i + 6}`, state: "empty" })),
];

export const RUN_ACTIVITY: LiveRunActivity[] = [
  { person: MARLOW, verb: "drafting", object: "Shelfproof" },
  { person: TEODOR, verb: "up next", active: false },
];

export const RUN_LOG: LiveRunLog = {
  person: MARLOW,
  atLabel: "14:06:21",
  text: "Capital intensity: one stability study per product line runs £2–4K at a contract lab",
  open: true,
};
