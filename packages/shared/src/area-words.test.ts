import { describe, expect, it } from "vitest";
import {
  areaKindWords,
  areaWordsText,
  companyAreaWords,
  customersAreaWords,
  entityMention,
  moneyAreaWords,
  planAreaWords,
  productAreaWords,
  teamAreaWords,
  withProvenance,
  type MoneyAreaFacts,
} from "./area-words";
import { FILINGS_DUE_SOON_DAYS, deadlineWindow, filingDaysLeft, filingWindow } from "./filings";
import { goalPaceSentence, goalSentence } from "./goals";
import { usSpelling } from "./us-spelling";

const TODAY = "2026-11-09";
const base: MoneyAreaFacts = { currency: "GBP", cashMinor: 2_500_000, accounts: 1, netBurnMinor: 1_800_000, grossBurnMinor: 1_800_000, runwayMonths: 1.4, runwayState: null };

describe("withProvenance", () => {
  it("moves a closing label to the chip and keeps one in the middle of the words", () => {
    expect(withProvenance("Cash lasts about 8 months (Estimate).")).toEqual({ text: "Cash lasts about 8 months.", provenance: "estimate" });
    expect(withProvenance("4 of 10 so far: on pace (Forecast).")).toEqual({ text: "4 of 10 so far: on pace.", provenance: "forecast" });
    expect(withProvenance("On pace (Forecast). 3 things are in Now.")).toEqual({ text: "On pace (Forecast). 3 things are in Now.", provenance: null });
    expect(areaWordsText({ text: "Cash lasts about 8 months.", provenance: "estimate" })).toBe("Cash lasts about 8 months (Estimate).");
    expect(areaWordsText({ text: "Selling has not started yet.", provenance: null })).toBe("Selling has not started yet.");
  });
});

describe("moneyAreaWords", () => {
  it("says cash, spending and months of cash, labeled Estimate", () => {
    expect(moneyAreaWords(base)).toEqual({ text: "You have £25K and spend about £18K a month, so you have about 1.4 months of cash.", provenance: "estimate" });
  });

  it("says 'more than comes in' when money comes in too", () => {
    expect(moneyAreaWords({ ...base, grossBurnMinor: 3_000_000 }).text).toBe("You have £25K and spend about £18K a month more than comes in, so you have about 1.4 months of cash.");
  });

  it("reads each runway state", () => {
    expect(moneyAreaWords({ ...base, netBurnMinor: -400_000, runwayMonths: null, runwayState: "positive" })).toEqual({ text: "You have £25K and earn more than you spend, so cash is not running out.", provenance: "estimate" });
    expect(moneyAreaWords({ ...base, accounts: 0, cashMinor: 0, runwayMonths: null, runwayState: "no_bank" })).toEqual({ text: "Connect your bank and this line shows your cash and how long it lasts.", provenance: null });
    expect(moneyAreaWords({ ...base, runwayMonths: null, runwayState: "short_history" })).toEqual({ text: "You have £25K; how long it lasts shows once there are three months of bank history.", provenance: null });
    expect(moneyAreaWords({ ...base, cashMinor: -250_000, runwayMonths: null, runwayState: "negative" })).toEqual({ text: "Your bank balance is £2,500 below zero, so there is no cash left to spend.", provenance: "estimate" });
  });

  it("reads no bank from zero accounts whatever the state says", () => {
    expect(moneyAreaWords({ ...base, accounts: 0 }).text).toMatch(/^Connect your bank/);
  });

  it("rounds the months as the tile does and says less than a month", () => {
    expect(moneyAreaWords({ ...base, runwayMonths: 1 }).text).toMatch(/about 1 month of cash\.$/);
    expect(moneyAreaWords({ ...base, runwayMonths: 7.46 }).text).toMatch(/about 7\.5 months of cash\.$/);
    expect(moneyAreaWords({ ...base, runwayMonths: 0.6 }).text).toMatch(/less than a month of cash\.$/);
  });

  it("keeps the business's own currency and its narrow symbol", () => {
    expect(moneyAreaWords({ ...base, currency: "USD" }).text).toMatch(/^You have \$25K and spend about \$18K a month/);
    expect(moneyAreaWords({ ...base, currency: "EUR" }).text).toMatch(/^You have €25K and spend about €18K a month/);
    const sek = moneyAreaWords({ ...base, currency: "SEK", cashMinor: 25_000_000, netBurnMinor: 18_000_000, grossBurnMinor: 18_000_000 }).text;
    expect(sek).toMatch(/^You have kr\s?250K and spend about kr\s?180K a month/);
    expect(moneyAreaWords({ ...base, cashMinor: 950_000, netBurnMinor: 120_000, grossBurnMinor: 120_000 }).text).toMatch(/^You have £9,500 and spend about £1,200 a month/);
  });
});

describe("companyAreaWords", () => {
  const entity = { legalName: "Northwind Ltd", status: "active", today: TODAY };

  it("counts the filings due in the next 30 days (the Compliance tile's window) with the first date", () => {
    const deadlines = [
      { dueOn: "2026-12-01", open: true },
      { dueOn: "2026-11-20", open: true },
      { dueOn: "2027-01-20", open: true },
      { dueOn: "2026-10-01", open: false },
    ];
    expect(FILINGS_DUE_SOON_DAYS).toBe(30);
    expect(companyAreaWords({ ...entity, deadlines })).toEqual({ text: "Northwind Ltd: 2 filings are due in the next 30 days, the first on Nov 20.", provenance: null });
    expect(companyAreaWords({ ...entity, deadlines: deadlines.slice(0, 1) }).text).toBe("Northwind Ltd: 1 filing is due in the next 30 days, on Dec 1.");
  });

  it("counts the window's last day and not the day after, as the Compliance tile does", () => {
    // Nov 9 + 30 days is Dec 9.
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2026-12-09", open: true }] }).text).toBe("Northwind Ltd: 1 filing is due in the next 30 days, on Dec 9.");
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2026-12-10", open: true }] }).text).toBe("Northwind Ltd: nothing is due in the next 30 days; the next filing is Dec 10.");
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: TODAY, open: true }] }).text).toBe("Northwind Ltd: 1 filing is due in the next 30 days, on Nov 9.");
  });

  it("names the next filing when nothing falls inside the window", () => {
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2027-06-30", open: true }, { dueOn: "2027-01-20", open: true }] }).text).toBe("Northwind Ltd: nothing is due in the next 30 days; the next filing is Jan 20.");
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2027-11-30", open: true }] }).text).toBe("Northwind Ltd: nothing is due in the next 30 days; the next filing is Nov 30, 2027.");
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2026-12-20", open: false }] }).text).toBe("Northwind Ltd: nothing is due in the next 30 days, and no later filing is on the calendar.");
    expect(companyAreaWords({ ...entity, deadlines: [] }).text).toBe("Northwind Ltd: nothing is due in the next 30 days, and no later filing is on the calendar.");
  });

  it("says what is overdue first", () => {
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2026-11-01", open: true }, { dueOn: "2026-12-01T00:00:00.000Z", open: true }, { dueOn: "2027-01-20", open: true }] }).text).toBe("Northwind Ltd: 1 filing is overdue, and 1 more is due in the next 30 days.");
    expect(companyAreaWords({ ...entity, deadlines: [{ dueOn: "2026-11-01", open: true }, { dueOn: "2026-10-01", open: true }] }).text).toBe("Northwind Ltd: 2 filings are overdue.");
  });

  it("says when there is no company yet", () => {
    expect(companyAreaWords({ legalName: null, status: null, deadlines: [], today: TODAY }).text).toBe("Your company is not incorporated yet.");
    expect(companyAreaWords({ ...entity, status: "planned", deadlines: [] }).text).toBe("Your company is not incorporated yet.");
    expect(companyAreaWords({ ...entity, status: "forming", deadlines: [] }).text).toBe("Your company is being incorporated.");
    expect(companyAreaWords({ ...entity, status: "dissolved", deadlines: [] }).text).toBe("Northwind Ltd is dissolved.");
  });
});

describe("filingWindow", () => {
  it("is overdue before today, due soon up to the window's last day, upcoming after it", () => {
    expect([-1, 0, 30, 31].map(filingWindow)).toEqual(["overdue", "due", "due", "upcoming"]);
  });

  it("counts whole calendar days from the business's day, whatever the hour, and keeps a rolled filing's status", () => {
    expect(filingDaysLeft("2026-12-09", TODAY)).toBe(30);
    expect(filingDaysLeft("2026-12-09T23:00:00.000Z", TODAY)).toBe(30);
    expect(filingDaysLeft(new Date("2026-11-08T00:00:00.000Z"), TODAY)).toBe(-1);
    expect(deadlineWindow("2026-12-10", TODAY)).toBe("upcoming");
    expect(deadlineWindow("2026-12-10", TODAY, "due")).toBe("due");
    expect(deadlineWindow("2026-12-10", TODAY, "overdue")).toBe("overdue");
    expect(deadlineWindow("2026-12-09", TODAY, "upcoming")).toBe("due");
  });

  it("the Company line reads a deadline's given window", () => {
    expect(companyAreaWords({ legalName: "Northwind Ltd", status: "active", today: TODAY, deadlines: [{ dueOn: "2027-02-01", open: true, window: "due" }] }).text).toBe("Northwind Ltd: 1 filing is due in the next 30 days, on Feb 1.");
  });
});

describe("planAreaWords", () => {
  const shape = { kind: "paying_customers" as const, target: 10, currency: null, dueOn: "2026-12-19" };
  const sentence = goalSentence(shape, { today: TODAY, startValue: 0 });
  const pace = goalPaceSentence({ ...shape, current: 4, startValue: 0, startedOn: "2026-10-20", today: TODAY });
  const roadmap = [
    { horizon: "now", targetEnd: "2026-12-04", done: false },
    { horizon: "now", targetEnd: "2026-12-20", done: false },
    { horizon: "now", targetEnd: null, done: false },
    { horizon: "now", targetEnd: "2026-11-01", done: true },
    { horizon: "next", targetEnd: "2026-11-20", done: false },
  ];

  it("says the goal, its pace (Forecast) and what is in Now with the next date (Estimate)", () => {
    const words = planAreaWords({ goal: { sentence, pace }, proposedGoal: null, roadmap, today: TODAY });
    expect(words).toEqual({ text: "Your goal: get the first 10 paying customers by Dec 19. 4 of 10 so far, 40 days left: on pace (Forecast). 3 things are in Now; the next is due Dec 4.", provenance: "estimate" });
  });

  it("moves the pace's Forecast to the chip when the roadmap is not readable", () => {
    expect(planAreaWords({ goal: { sentence, pace }, proposedGoal: null, roadmap: null, today: TODAY })).toEqual({ text: "Your goal: get the first 10 paying customers by Dec 19. 4 of 10 so far, 40 days left: on pace.", provenance: "forecast" });
  });

  it("reads a proposal, no goal and the roadmap's empty states", () => {
    expect(planAreaWords({ goal: null, proposedGoal: { sentence }, roadmap: [], today: TODAY }).text).toBe("A goal waits for your answer: get the first 10 paying customers by Dec 19. Nothing is in Now on the roadmap yet.");
    expect(planAreaWords({ goal: null, proposedGoal: null, roadmap: [roadmap[3]!], today: TODAY }).text).toBe("No goal is set yet. 1 thing in Now is done.");
    expect(planAreaWords({ goal: null, proposedGoal: null, roadmap: [roadmap[0]!], today: TODAY })).toEqual({ text: "No goal is set yet. 1 thing is in Now, due Dec 4.", provenance: "estimate" });
    expect(planAreaWords({ goal: null, proposedGoal: null, roadmap: [{ horizon: "now", targetEnd: "2026-11-02", done: false }], today: TODAY })).toEqual({ text: "No goal is set yet. 1 thing is in Now; the next was due Nov 2.", provenance: null });
    expect(planAreaWords({ goal: null, proposedGoal: null, roadmap: [{ horizon: "now", targetEnd: null, done: false }], today: TODAY }).text).toBe("No goal is set yet. 1 thing is in Now.");
  });

  it("leaves the goal out when it is not readable here", () => {
    expect(planAreaWords({ goal: null, proposedGoal: null, goalUnknown: true, roadmap: [roadmap[0]!], today: TODAY }).text).toBe("1 thing is in Now, due Dec 4.");
    expect(planAreaWords({ goal: null, proposedGoal: null, goalUnknown: true, roadmap: null, today: TODAY }).text).toBe("Nothing is planned yet.");
  });

  it("keeps an acronym's capitals", () => {
    expect(planAreaWords({ goal: { sentence: "MRR of £5,000 by Dec 19", pace: null }, proposedGoal: null, roadmap: null, today: TODAY }).text).toBe("Your goal: MRR of £5,000 by Dec 19.");
  });
});

describe("customersAreaWords", () => {
  const f = { selling: true, days: 35, leads: 42, customers: 6, topChannel: "Lead generation", liveCampaigns: 2 };

  it("says the window's leads and customers, where most came from and the live campaigns", () => {
    expect(customersAreaWords(f)).toEqual({ text: "In the last 35 days: 42 new leads and 6 new paying customers, most from Lead generation. 2 campaigns are live.", provenance: null });
    expect(customersAreaWords({ ...f, leads: 1, customers: 1, liveCampaigns: 1 }).text).toBe("In the last 35 days: 1 new lead and 1 new paying customer, most from Lead generation. 1 campaign is live.");
    expect(customersAreaWords({ ...f, leads: 1_250 }).text).toMatch(/^In the last 35 days: 1,250 new leads/);
  });

  it("reads the empty states", () => {
    expect(customersAreaWords({ ...f, selling: false }).text).toBe("Selling has not started yet.");
    expect(customersAreaWords({ ...f, customers: 0 }).text).toBe("In the last 35 days: 42 new leads, most from Lead generation, and no new paying customers yet. 2 campaigns are live.");
    expect(customersAreaWords({ ...f, leads: 0, customers: 0, topChannel: null, liveCampaigns: 0 }).text).toBe("In the last 35 days: no new leads or paying customers yet. No campaign is live.");
    expect(customersAreaWords({ ...f, liveCampaigns: null, topChannel: null }).text).toBe("In the last 35 days: 42 new leads and 6 new paying customers.");
  });
});

describe("productAreaWords", () => {
  const f = { stage: "building" as const, liveInWindow: 3, waiting: 2, lastLiveOn: null, today: TODAY };

  it("says what went live in the last 7 days and what waits for the founder", () => {
    expect(productAreaWords(f)).toEqual({ text: "3 changes went live in the last 7 days and 2 wait for your go-ahead.", provenance: null });
    expect(productAreaWords({ ...f, stage: "selling", liveInWindow: 1, waiting: 1 }).text).toBe("1 change went live in the last 7 days and 1 waits for your go-ahead.");
    expect(productAreaWords({ ...f, liveInWindow: 0, waiting: 0, lastLiveOn: "2026-10-30T10:00:00.000Z" }).text).toBe("Nothing went live in the last 7 days and nothing waits for your go-ahead. Your live product last changed on Oct 30.");
    expect(productAreaWords({ ...f, waiting: null }).text).toBe("3 changes went live in the last 7 days.");
  });

  it("reads the stages before building", () => {
    expect(productAreaWords({ ...f, stage: "drafting" }).text).toBe("Your specification and roadmap are being drafted.");
    expect(productAreaWords({ ...f, stage: "awaiting_signoff" }).text).toBe("Your specification and roadmap wait for your sign-off.");
    expect(productAreaWords({ ...f, liveInWindow: null }).text).toBe("The team builds from your signed-off specification and roadmap.");
  });
});

describe("teamAreaWords", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("names the Chief of Staff with markup and counts leads and specialists", () => {
    expect(teamAreaWords({ chief: { id, name: "Ines Park", named: true }, leads: 6, specialists: 23, needYou: 2 })).toEqual({ text: `[[ent:${id}|Ines Park]], your Chief of Staff, runs 6 leads and 23 specialists; 2 are down or failing.`, provenance: null });
    expect(teamAreaWords({ chief: { id, name: "Chief of Staff", named: false }, leads: 1, specialists: 1, needYou: 0 }).text).toBe(`Your [[ent:${id}|Chief of Staff]] runs 1 lead and 1 specialist.`);
    expect(teamAreaWords({ chief: { id, name: "Chief of Staff", named: false }, leads: 0, specialists: 0, needYou: 1 }).text).toBe(`Your [[ent:${id}|Chief of Staff]] runs the team on its own so far; 1 is down or failing.`);
  });

  it("reads a team without a Chief of Staff and an empty one", () => {
    expect(teamAreaWords({ chief: null, leads: 2, specialists: 3, needYou: 0 }).text).toBe("2 leads and 3 specialists work for you.");
    expect(teamAreaWords({ chief: null, leads: 0, specialists: 0, needYou: 0 }).text).toBe("No agents are hired yet.");
  });

  it("keeps the markup's reserved characters out of a name", () => {
    expect(entityMention(id, "A|B]] [x")).toBe(`[[ent:${id}|AB x]]`);
  });
});

describe("areaKindWords", () => {
  it("says which area a department with its own name is part of", () => {
    expect(areaKindWords({ departmentName: "Formulation Lab", area: "product" })).toBe("Formulation Lab is part of Product.");
    expect(areaKindWords({ departmentName: "Retail Partnerships", area: "customers" })).toBe("Retail Partnerships is part of Customers.");
    expect(areaKindWords({ departmentName: "Legal", area: "money", section: "company" })).toBe("Legal is part of Money, in its Company section.");
    expect(areaKindWords({ departmentName: "Company", area: "money", section: "company" })).toBe("Company is part of Money.");
  });

  it("says nothing when the department has the area's name", () => {
    expect(areaKindWords({ departmentName: "Team", area: "team" })).toBeNull();
    expect(areaKindWords({ departmentName: " product ", area: "product" })).toBeNull();
  });
});

describe("every sentence is US English", () => {
  it("has no British spelling", () => {
    const all = [
      moneyAreaWords(base).text,
      companyAreaWords({ legalName: "Northwind Ltd", status: "active", deadlines: [], today: TODAY }).text,
      customersAreaWords({ selling: true, days: 35, leads: 4, customers: 1, topChannel: "Lead generation", liveCampaigns: 1 }).text,
      productAreaWords({ stage: "awaiting_signoff", liveInWindow: 0, waiting: 0, lastLiveOn: null, today: TODAY }).text,
      teamAreaWords({ chief: null, leads: 1, specialists: 1, needYou: 0 }).text,
    ];
    for (const s of all) expect(usSpelling(s)).toBe(s);
  });
});
