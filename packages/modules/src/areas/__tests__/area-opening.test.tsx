import "../../finance/__tests__/setup";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { AgentPersonaProvider } from "@foundmill/dugout";
import { createFakeSource, renderScreen } from "../../finance/__tests__/fake-source";
import { AreaOpening, companyFacts, productFacts, teamFacts, topChannelOf } from "../AreaOpening";

const BID = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-11-09";
const COS = "11111111-1111-4111-8111-111111111111";

const overview = {
  cash: { amountMinor: 2_500_000, currency: "GBP", accounts: 1, asOf: null, label: "Measured" },
  burn: { netBurnMinor: 1_800_000, grossBurnMinor: 2_400_000, months: 3, label: "Estimate" },
  runway: { months: 1.4, label: "Estimate", warnings: [3], blocksContinue: false },
  revenue: { monthly: [], basis: "cash", label: "Cash" },
  customers30d: 0,
  forecasts: {},
};
const legalStatus = { incorporation: null, entity: { id: "le-1", legalName: "Northwind Ltd", status: "active" }, history: [] };
const compliance = {
  events: [{ id: "c1", kind: "confirmation_statement", title: "Confirmation statement", dueAt: "2026-12-01T00:00:00.000Z", recurrence: null, completedAt: null }],
  upcoming: { filings: [{ id: "f1", legalEntityId: "le-1", kind: "annual_accounts", title: "Annual accounts", dueAt: "2027-01-20T00:00:00.000Z", filedAt: null, status: "pending", ref: null }], compliance: [{ id: "c1", kind: "confirmation_statement", title: "Confirmation statement", dueAt: "2026-12-01T00:00:00.000Z", recurrence: null, completedAt: null }] },
  filings: [{ id: "f0", legalEntityId: "le-1", kind: "vat", title: "VAT return", dueAt: "2026-10-01T00:00:00.000Z", filedAt: "2026-09-30T00:00:00.000Z", status: "filed", ref: null }],
};
const goals = {
  active: { id: "g1", sentence: "Get the first 10 paying customers by Dec 19", progress: { current: 4, pace: "4 of 10 so far, 40 days left: on pace (Forecast)." } },
  proposed: null,
  canDecide: true,
};
const roadmap = {
  items: [
    { id: "r1", title: "Checkout", horizon: "now", targetStart: null, targetEnd: "2026-12-04", confidence: 0.7, status: "planned", position: 0, tasks: [] },
    { id: "r2", title: "Accounts", horizon: "now", targetStart: null, targetEnd: "2026-12-20", confidence: 0.5, status: "planned", position: 1, tasks: [] },
    { id: "r3", title: "Later thing", horizon: "later", targetStart: null, targetEnd: null, confidence: 0.5, status: "planned", position: 0, tasks: [] },
  ],
  dependencies: [],
};
const channels = {
  channels: [
    { id: "ch1", channelKey: "lead_generation", enabled: true, line: "attack", fit: 80, potential: 1, recommended: true, budgetMinor: 0, currency: "GBP", meta: { label: "Lead generation", line: "attack", coreMetric: "" }, form: { channelId: "ch1", channelKey: "lead_generation", line: "attack", spendMinor: 0, impressions: 0, leads: 30, signups: 0, activations: 0, customers: 5, days: 35 } },
    { id: "ch2", channelKey: "content_seo", enabled: true, line: "wings", fit: 60, potential: 1, recommended: false, budgetMinor: 0, currency: "GBP", meta: { label: "Content and SEO", line: "wings", coreMetric: "" }, form: { channelId: "ch2", channelKey: "content_seo", line: "wings", spendMinor: 0, impressions: 0, leads: 12, signups: 0, activations: 0, customers: 1, days: 35 } },
  ],
  lines: {},
  blended: { spendMinor: 0, impressions: 0, leads: 42, signups: 0, activations: 0, customers: 6, days: 35 },
};
const campaigns = { items: [{ id: "k1", status: "live" }, { id: "k2", status: "live" }, { id: "k3", status: "draft" }] };
const prs = {
  open: [{ taskId: "t1", title: "Add checkout", status: "review", branch: "agent/t1", agentId: null, kind: "code" }, { taskId: "t2", title: "Fix login", status: "merging", branch: "agent/t2", agentId: null, kind: "code" }],
  merged: [{ eventId: "e1", occurredAt: "2026-11-08T10:00:00.000Z" }, { eventId: "e2", occurredAt: "2026-11-05T10:00:00.000Z" }, { eventId: "e3", occurredAt: "2026-11-03T10:00:00.000Z" }, { eventId: "e4", occurredAt: "2026-10-20T10:00:00.000Z" }],
};
const deployments = { items: [{ eventId: "d1", occurredAt: "2026-11-08T10:00:00.000Z", taskId: null, environment: "production", provider: "vercel", url: "https://example.com", commitSha: "abc", branch: "main" }] };
const agent = (id: string, extra: Record<string, unknown>) => ({ id, name: `Agent ${id}`, role: "Specialist", status: "healthy", modelKey: "sonnet", departmentIds: [], departments: [], ...extra });
const agents = {
  agents: [
    agent(COS, { name: "Chief of Staff", role: "Chief of Staff", agentType: "chief_of_staff", layer: "assistant", chiefOfStaff: true, personaKey: "malik", tier: "chief" }),
    agent("l1", { name: "Product lead", role: "Product lead", layer: "lead", tier: "lead" }),
    agent("l2", { name: "Finance lead", role: "Finance lead", layer: "lead", tier: "lead", status: "injured" }),
    agent("s1", { tier: "specialist" }),
    agent("s2", { tier: "specialist", status: "failing" }),
    agent("s3", { tier: "specialist" }),
    agent("b1", { name: "Entity linker", layer: "utility", tier: "background" }),
  ],
};
const business = (extra: Record<string, unknown>) => ({ role: "owner", productStage: "building", distributionStartedAt: "2026-10-01T00:00:00.000Z", business: { id: BID, name: "Northwind" }, ...extra });

const responses = {
  "finance.overview": overview,
  "legal.incorporate.status": legalStatus,
  "legal.compliance.list": compliance,
  "goal.current": goals,
  "product.roadmap.list": roadmap,
  "business.get": business({}),
  "distribution.channels.list": channels,
  "distribution.campaigns.list": campaigns,
  "dev.prs.list": prs,
  "dev.deployments.list": deployments,
  "team.agents.list": agents,
  "department.list": [],
};

const line = () => screen.getByTestId("area-line");
const sentence = () => line().querySelector("[data-area-sentence]")?.textContent ?? "";

describe("AreaOpening", () => {
  it("opens Money on cash, spending and months (Estimate) with the Company line", () => {
    const fake = createFakeSource({ businessId: BID, responses, currency: "GBP" });
    renderScreen(fake, <AreaOpening area="money" today={TODAY} departmentName="Finance" />);
    expect(screen.getByRole("region", { name: "Money at a glance" })).toBeTruthy();
    expect(sentence()).toBe("You have £25K and spend about £18K a month more than comes in, so you have about 1.4 months of cash.Estimate");
    expect(line().querySelector("[data-area-sentence] [data-provenance='estimate']")).toBeTruthy();
    expect(line().querySelector("[data-area-section='company']")?.textContent).toBe("Company: Northwind Ltd: 1 filing is due in the next 30 days, on Dec 1.");
    expect(line().querySelector("[data-area-kind]")?.textContent).toBe("Finance is part of Money.");
    // The same reads as the tabs, so the line shares their cache entries.
    expect(fake.queried.get("finance.overview")).toEqual({});
    expect(fake.queried.get("legal.compliance.list")).toEqual({ pendingOnly: false, days: 365 });
  });

  it("says when no bank is connected and the company is not incorporated", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "finance.overview": { ...overview, cash: { ...overview.cash, accounts: 0, amountMinor: 0 }, runway: { ...overview.runway, months: null } }, "legal.incorporate.status": { incorporation: null, entity: null, history: [] } }, currency: "GBP" });
    renderScreen(fake, <AreaOpening area="money" today={TODAY} />);
    expect(sentence()).toBe("Connect your bank and this line shows your cash and how long it lasts.");
    expect(line().querySelector("[data-area-section='company']")?.textContent).toBe("Company: Your company is not incorporated yet.");
  });

  it("leaves the Company line out when the company is not readable here", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "legal.incorporate.status": new Error("No access to Legal") }, currency: "GBP" });
    renderScreen(fake, <AreaOpening area="money" today={TODAY} />);
    expect(line().querySelector("[data-area-section]")).toBeNull();
  });

  it("shows a skeleton while the figures load, and nothing when the read fails", () => {
    const loading = createFakeSource({ businessId: BID, responses: {}, currency: "GBP" });
    const { unmount } = renderScreen(loading, <AreaOpening area="money" today={TODAY} />);
    expect(line().getAttribute("aria-busy")).toBe("true");
    unmount();
    const failed = createFakeSource({ businessId: BID, responses: { "finance.overview": new Error("down"), "legal.incorporate.status": new Error("down") }, currency: "GBP" });
    const { container } = renderScreen(failed, <AreaOpening area="money" today={TODAY} />);
    expect(container.querySelector("[data-area-line]")).toBeNull();
  });

  it("opens Plan on the goal, its pace and what is in Now", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <AreaOpening area="plan" today={TODAY} departmentName="Product" />);
    expect(sentence()).toBe("Your goal: get the first 10 paying customers by Dec 19. 4 of 10 so far, 40 days left: on pace (Forecast). 2 things are in Now; the next is due Dec 4.Estimate");
    expect(line().querySelector("[data-area-kind]")?.textContent).toBe("Product is part of Plan.");
  });

  it("opens Customers on the channel window and the live campaigns, or says selling has not started", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    const { unmount } = renderScreen(fake, <AreaOpening area="customers" today={TODAY} departmentName="Retail Partnerships" />);
    expect(sentence()).toBe("In the last 35 days: 42 new leads and 6 new paying customers, most from Lead generation. 2 campaigns are live.");
    expect(line().querySelector("[data-area-kind]")?.textContent).toBe("Retail Partnerships is part of Customers.");
    unmount();
    const before = createFakeSource({ businessId: BID, responses: { ...responses, "business.get": business({ distributionStartedAt: null }) } });
    renderScreen(before, <AreaOpening area="customers" today={TODAY} />);
    expect(sentence()).toBe("Selling has not started yet.");
  });

  it("opens Product on what went live and what waits, or on the sign-off", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    const { unmount } = renderScreen(fake, <AreaOpening area="product" today={TODAY} departmentName="Formulation Lab" />);
    expect(sentence()).toBe("3 changes went live in the last 7 days and 2 wait for your go-ahead.");
    expect(line().querySelector("[data-area-kind]")?.textContent).toBe("Formulation Lab is part of Product.");
    unmount();
    const signoff = createFakeSource({ businessId: BID, responses: { ...responses, "business.get": business({ productStage: "awaiting_signoff", distributionStartedAt: null }) } });
    renderScreen(signoff, <AreaOpening area="product" today={TODAY} />);
    expect(sentence()).toBe("Your specification and roadmap wait for your sign-off.");
  });

  it("opens Team on the Chief of Staff as an EntityLink, the leads, the specialists and who is down", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    const { unmount } = renderScreen(fake, <AreaOpening area="team" today={TODAY} departmentName="Team" />);
    expect(sentence()).toBe("Your Chief of Staff runs 2 leads and 3 specialists; 2 are down or failing.");
    const link = screen.getByRole("link", { name: "Chief of Staff" });
    expect(link.getAttribute("href")).toBe(`/b/${BID}/agents/${COS}/overview`);
    expect(line().querySelector("[data-area-kind]")).toBeNull();
    unmount();
    // With anthropomorphic agents on, the reader sees the persona's name and the role in the words.
    renderScreen(
      createFakeSource({ businessId: BID, responses }),
      <AgentPersonaProvider anthropomorphic>
        <AreaOpening area="team" today={TODAY} />
      </AgentPersonaProvider>,
    );
    expect(sentence()).toMatch(/^Malik, your Chief of Staff, runs 2 leads and 3 specialists; 2 are down or failing\.$/);
    expect(sentence()).not.toMatch(/^Chief of Staff,/);
  });
});

describe("the facts behind the lines", () => {
  it("counts each deadline once and reads filed and waived filings as done", () => {
    const facts = companyFacts(legalStatus, compliance, TODAY);
    expect(facts.deadlines).toEqual([
      { dueOn: "2026-12-01", open: true, window: "due" },
      { dueOn: "2026-10-01", open: false },
      { dueOn: "2027-01-20", open: true, window: "upcoming" },
    ]);
    // A filing the nightly roll already moved to due counts as due, as on Compliance.
    const rolled = companyFacts(legalStatus, { filings: [{ id: "f2", dueAt: "2027-02-01T00:00:00.000Z", filedAt: null, status: "due" }] }, TODAY);
    expect(rolled.deadlines).toEqual([{ dueOn: "2027-02-01", open: true, window: "due" }]);
  });

  it("picks the channel most customers came from, else most leads", () => {
    expect(topChannelOf(channels.channels as never)).toBe("Lead generation");
    const noCustomers = channels.channels.map((c, i) => ({ ...c, form: { ...c.form, customers: 0, leads: i === 1 ? 50 : 1 } }));
    expect(topChannelOf(noCustomers as never)).toBe("Content and SEO");
    expect(topChannelOf([])).toBeNull();
  });

  it("counts the last 7 days of changes and the production deployments only", () => {
    const facts = productFacts("building", prs, { items: [...deployments.items, { eventId: "d2", occurredAt: "2026-11-09T01:00:00.000Z", environment: "preview" }] as never }, TODAY);
    expect(facts).toMatchObject({ liveInWindow: 3, waiting: 2, lastLiveOn: "2026-11-08" });
    expect(productFacts("building", null, null, TODAY)).toMatchObject({ liveInWindow: null, waiting: null, lastLiveOn: null });
  });

  it("reads the tiers and leaves the background helpers out", () => {
    const { facts } = teamFacts(agents.agents as never, [], (a) => a.name);
    expect(facts).toEqual({ chief: { id: COS, name: "Chief of Staff", named: false }, leads: 2, specialists: 3, needYou: 2 });
    expect(teamFacts(agents.agents as never, [], (a) => (a.id === COS ? "Ines" : a.name)).facts.chief).toEqual({ id: COS, name: "Ines", named: true });
  });
});
