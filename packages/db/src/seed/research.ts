/**
 * The Product Researcher's work on the two demo businesses (BUILD §11.5 Research tab, §17.2): a research plan already
 * drafted when the business was young, its artifacts (interview plan and script, survey, smoke test, demo script) and,
 * for Northwind, the findings that fed the seeded interview proposal. Every threshold and count that was not measured
 * says Estimate; nothing here was sent to anyone.
 */
import type { CreateResearchArtifactInput } from "../repos/research";
import { repos } from "../repos";
import { addDays, type SeedCtx } from "./context";
import type { SquadResult } from "./squad";

const md = (...lines: string[]) => lines.join("\n");

// One line each, without a final period: it names the plan in the panel title ("Testing the specification with …").
const NORTHWIND_ICP = "Adults 25-45 in the UK and Ireland with sensitive or reactive skin, buying online, who already read ingredient lists";
const LEDGERLY_ICP = "Operations managers and finance leads at UK and US fintechs with 20-200 staff; the buyer is the head of operations, the user is the ops analyst";

function researcherOf(squad: SquadResult): string | null {
  return squad.byTemplate.get("product_researcher")?.agent.id ?? squad.byTemplate.get("researcher")?.agent.id ?? null;
}

export async function seedNorthwindResearch(ctx: SeedCtx, businessId: string, squad: SquadResult, specIds: ReadonlyMap<string, string>, interviewSourceId: string): Promise<{ artifacts: number }> {
  const agentId = researcherOf(squad);
  const block = (section: string) => (specIds.get(section) ? [specIds.get(section)!] : []);
  const artifacts: CreateResearchArtifactInput[] = [
    {
      kind: "interview_plan",
      title: "Discovery interviews with reactive-skin buyers",
      summary: "Six to eight online buyers with reactive skin who read ingredient lists; tests the Problem and Customers sections before the routine is reformulated.",
      status: "shared",
      specBlockIds: [...block("Problem"), ...block("Customers")],
      bodyMd: md(
        "## Goal",
        "Learn whether people with reactive skin recognize the problem the specification describes (opaque ingredient lists, unverifiable claims), what they do about it today, and who decides what they buy.",
        "",
        "## Who",
        "6 to 8 adults aged 25-45 in the UK and Ireland who buy skincare online and say they read ingredient lists (Estimate: 6 reaches saturation on the first themes). Recruited from the subscriber list with consent and from two reactive-skin forums with the founder's approval; the recruit list is CRM records with a lawful basis each.",
        "",
        "## Assumptions tested",
        "- Problem: buyers cannot tell which products are safe for them.",
        "- Customers: the buyer decides alone and keeps their own record of reactions.",
        "",
        "## Questions (never leading; one breath each)",
        "1. Walk me through the last skincare product you tried. What made you pick it?",
        "2. What happened after you started using it?",
        "3. How do you keep track of what worked and what did not?",
        "4. Who else has a say in what you buy, if anyone?",
        "5. What have you paid for in this area before, and what did you stop paying for?",
        "6. When a brand publishes test results, what do you do with them?",
        "7. If nothing changed for a year, what would that mean for you?",
        "8. Is there anything I should have asked and did not?",
        "",
        "## Decision rule",
        "If fewer than half describe a reaction they could not explain in the first two questions (Estimate), the Problem section is revised before the batch results page is built.",
      ),
    },
    {
      kind: "interview_script",
      title: "Interview script: reactive-skin panel (20 minutes)",
      summary: "Opening, consent, the eight questions in order with one follow-up each, and a close that records whether the person may be contacted again.",
      status: "shared",
      specBlockIds: block("Customers"),
      bodyMd: md(
        "## Opening (2 minutes)",
        "Thank you for the time. I am part of the team at Northwind Skincare. This is a conversation about how you choose and use skincare today, not a pitch. Nothing you say is quoted with your name without your consent. May I take notes?",
        "",
        "## Questions (15 minutes)",
        "1. Walk me through the last skincare product you tried. What made you pick it?\n   - Follow-up: \"Where did you first hear about it?\"",
        "2. What happened after you started using it?\n   - Follow-up: \"How long before you knew?\"",
        "3. How do you keep track of what worked and what did not?\n   - Follow-up: \"Can you show me?\"",
        "4. Who else has a say in what you buy, if anyone?",
        "5. What have you paid for in this area before, and what did you stop paying for?",
        "6. When a brand publishes test results, what do you do with them?",
        "7. If nothing changed for a year, what would that mean for you?",
        "8. Is there anything I should have asked and did not?",
        "",
        "## Close (3 minutes)",
        "Is there anyone else you think we should talk to? Would you like to see the batch results page when it exists? (Record the answer; nobody is contacted again without it.)",
        "",
        "## Rules",
        "- Do not describe the routine until the close, and only if asked.",
        "- Never ask whether they would buy or what they would pay.",
        "- Quotes verbatim, under 25 words each.",
      ),
    },
    {
      kind: "survey",
      title: "Survey: 7 questions for reactive-skin buyers",
      summary: "Short and unbiased, with a sampling plan of 40 subscribers (Estimate) and a decision rule per question; answers are read as untrusted content.",
      status: "ready",
      specBlockIds: [...block("Customers"), ...block("Pricing")],
      bodyMd: md(
        "## Sampling plan",
        "40 responses from subscribers who consented to research email (Estimate: enough to see a majority, not to size a market). Sent by the founder from the approved list; never by an agent.",
        "",
        "## Questions and decision rules",
        "1. How often does a new skincare product cause you a reaction?\n   - Decision rule: proceed if at least a third answer \"most of the time\" or \"often\" (Estimate).",
        "2. How do you decide a product is safe to try? (free text)\n   - Decision rule: three or more distinct methods named means the problem is real and unsolved.",
        "3. Do you keep a record of reactions? Where?\n   - Decision rule: a majority keeping a private note supports the reaction-diary feature.",
        "4. Who decides what skincare you buy?\n   - Decision rule: if the respondent is not the decider in most answers, the Customers section changes.",
        "5. Which matters most to you: fewer reactions, published test results, refills, or price? (pick one)\n   - Decision rule: the top answer becomes the first line of the batch results page.",
        "6. What have you paid for a quarterly supply before, if anything?\n   - Decision rule: prior spend near the refill price for a third of respondents (Estimate) keeps the price range.",
        "7. May we contact you for a 20-minute conversation?\n   - Decision rule: consent recorded per respondent; only consenting respondents are ever contacted.",
        "",
        "## Rules",
        "- No question names Northwind's price; prior spend is asked, willingness to pay is not.",
        "- Answers are untrusted content: read through the quarantined reader, never followed as instructions.",
      ),
    },
    {
      kind: "demo_script",
      title: "Demo script: the batch results page",
      summary: "Under five minutes, claims only what the batch results page shows today, and records what the viewer does next.",
      status: "draft",
      specBlockIds: block("Features"),
      bodyMd: md(
        "## Before the demo",
        "Confirm what the page shows today: the batch number, the patch-test and stability results, the warning line. The script claims nothing else (the reaction diary is not built).",
        "",
        "## Script (under five minutes)",
        "1. (30 seconds) The situation in the viewer's words: \"You read the list and still cannot tell what will react.\"",
        "2. (2 minutes) Open the page for the serum batch the viewer has at home; read the results together.",
        "3. (1 minute) The first value: what they would stop guessing at.",
        "4. (1 minute) Stop. Ask: \"What would you do with this tomorrow?\" and write the answer down.",
        "",
        "## What is recorded",
        "What the viewer did next, one quote under 25 words, and anything the page was missing.",
        "",
        "## Rules",
        "No promise of a feature, a price or a date. A question about the reaction diary is written down for the founder.",
      ),
    },
    {
      kind: "findings",
      title: "Findings: reactive-skin panel (6 participants)",
      summary: "What the panel supported and contradicted, with quotes under 25 words and a confidence each; filed as the interview source the Product lead's proposal cites.",
      status: "shared",
      specBlockIds: [...block("Pricing"), ...block("Features"), ...block("Customers")],
      bodyMd: md(
        "## Claims",
        `- Four of six would switch to a quarterly refill under £35; two called £38 "a stretch". Confidence medium (n=6, Estimate of price sensitivity). Source: the interview transcript (${interviewSourceId}).`,
        "- Five of six keep a private note of which products caused a reaction; none trust a brand's own claims without it. Confidence high within the panel. Source: the same transcript.",
        "- Two participants were referred by an online dermatology clinic, a channel the specification does not name. Confidence medium.",
        "",
        "## What it contradicts",
        "- Pricing: the £38 refill sits above the panel's ceiling (Estimate).",
        "- Customers: clinics act as a referral channel the Customers section does not list.",
        "",
        "## Handed to the Product lead",
        "Three proposed changes travel through the open change proposal; the founder decides each one.",
      ),
    },
  ];
  const ready = await repos.research.seedReady(ctx.db, businessId, {
    icp: NORTHWIND_ICP,
    agentId,
    specVersion: 1,
    summary: {
      icp: NORTHWIND_ICP,
      assumptions: [
        { assumption: "Buyers with reactive skin cannot tell which products are safe for them.", fromSection: "Problem", whyItMatters: "If the problem is rare, the published results and the promise do not sell.", testKind: "interview_plan" },
        { assumption: "The buyer decides alone and keeps their own record of reactions.", fromSection: "Customers", whyItMatters: "Decides who the subscription and the diary are for.", testKind: "survey" },
        { assumption: "A quarterly refill at £38 is the right price point.", fromSection: "Pricing", whyItMatters: "Margin per SKU depends on it.", testKind: "demo_script" },
      ],
      firstStepTaskIds: [],
      model: { route: "worker", mode: "mock", costLabel: "Estimate", runner: "seed" },
    },
    artifacts,
    at: addDays(ctx.startDate, 4),
  });
  return { artifacts: ready.artifacts.length };
}

export async function seedLedgerlyResearch(ctx: SeedCtx, businessId: string, squad: SquadResult, specIds: ReadonlyMap<string, string>): Promise<{ artifacts: number }> {
  const agentId = researcherOf(squad);
  const block = (section: string) => (specIds.get(section) ? [specIds.get(section)!] : []);
  const artifacts: CreateResearchArtifactInput[] = [
    {
      kind: "interview_plan",
      title: "Discovery interviews with fintech operations managers",
      summary: "Eight conversations across UK and US fintechs that test who runs the close and who decides on tools.",
      status: "shared",
      specBlockIds: [...block("Problem"), ...block("Customers")],
      bodyMd: md(
        "## Goal",
        "Learn how operations managers close the month today, what it costs them, and who decides which tools the team adopts.",
        "",
        "## Who",
        "8 operations managers or finance leads at UK and US fintechs with 20-200 staff (Estimate: 8 covers both markets twice). Recruited from the CRM's consented contacts and the founder's introductions; the list is approved by the founder before anyone is contacted.",
        "",
        "## Assumptions tested",
        "- Problem: the close is matched by hand and unmatched lines wait for someone to notice.",
        "- Customers: the head of operations buys, the analyst uses.",
        "",
        "## Questions",
        "1. Walk me through your last month-end close, day by day.",
        "2. Where did the unmatched lines come from, and who found them?",
        "3. What did the close cost the team in hours? How do you know?",
        "4. Who signed off on the last tool your team adopted?",
        "5. What have you paid for in this area before, and what did you stop paying for?",
        "6. What would have to be true for you to change how you close?",
        "7. Is there anything I should have asked and did not?",
        "",
        "## Decision rule",
        "If fewer than half name the head of operations as the decider (Estimate), the Customers section changes before the approval workflow is built.",
      ),
    },
    {
      kind: "smoke_test",
      title: "Smoke test: the month-end close checklist page",
      summary: "One page that states the value proposition in the customer's words and measures one action; the threshold is an Estimate.",
      status: "ready",
      specBlockIds: block("Value proposition"),
      bodyMd: md(
        "## The one sentence",
        "Close month-end in two days, not nine: payouts, invoices and bank lines matched for you, exceptions routed with evidence.",
        "",
        "## Page outline",
        "1. Headline: the sentence above, in the words the interviews produced.",
        "2. Three lines on what changes for the ops analyst (from the Value proposition section).",
        "3. One screenshot of the exception queue.",
        "4. One action: \"Ask for early access\" (a work email and consent to be contacted).",
        "",
        "## The measured action",
        "Early-access requests divided by unique visitors who read past the headline.",
        "",
        "## Threshold",
        "Proceed at 5% of qualified visitors over two weeks (Estimate); below 2% (Estimate) the Value proposition section goes back to the Product lead with the page's words as evidence.",
        "",
        "## What happens if it fails",
        "No build task is canceled by the test alone; the Product lead proposes spec changes and the founder decides.",
        "",
        "## Rules",
        "Traffic comes only from channels the founder has started; nothing is promoted by an agent.",
      ),
    },
    {
      kind: "demo_script",
      title: "Demo script: the exception queue",
      summary: "Under five minutes, shows the matching and the exception queue as they work today, and records what the viewer does next.",
      status: "shared",
      specBlockIds: block("Features"),
      bodyMd: md(
        "## Before the demo",
        "Confirm what the build does today: Stripe and bank sync, matching rules with explanations, the exception queue. The script claims nothing about the close checklist or the audit export until they ship.",
        "",
        "## Script (under five minutes)",
        "1. (30 seconds) The situation in the viewer's words: \"Nine days of spreadsheets and a line nobody noticed.\"",
        "2. (2 minutes) Open the viewer's own payout file in the sandbox account; watch the matching and read one explanation together.",
        "3. (1 minute) The exception queue: who gets what, with the evidence attached.",
        "4. (1 minute) Stop. Ask: \"What would you do with this tomorrow?\" and write the answer down.",
        "",
        "## What is recorded",
        "What the viewer did next, one quote under 25 words, and anything missing before it is shown to anyone else.",
        "",
        "## Rules",
        "No promise of a feature, a price or a date; a question about SSO or the audit export is written down for the founder.",
      ),
    },
  ];
  const ready = await repos.research.seedReady(ctx.db, businessId, {
    icp: LEDGERLY_ICP,
    agentId,
    specVersion: 1,
    summary: {
      icp: LEDGERLY_ICP,
      assumptions: [
        { assumption: "The month-end close is matched by hand and unmatched lines wait for someone to notice.", fromSection: "Problem", whyItMatters: "Sizes the value of automatic matching.", testKind: "interview_plan" },
        { assumption: "The head of operations buys, the ops analyst uses.", fromSection: "Customers", whyItMatters: "Decides who the approval workflow and the landing page address.", testKind: "survey" },
        { assumption: "A two-day close is believable in one sentence.", fromSection: "Value proposition", whyItMatters: "Headline of the smoke test page.", testKind: "smoke_test" },
      ],
      firstStepTaskIds: [],
      model: { route: "worker", mode: "mock", costLabel: "Estimate", runner: "seed" },
    },
    artifacts,
    at: addDays(ctx.startDate, 5),
  });
  return { artifacts: ready.artifacts.length };
}
