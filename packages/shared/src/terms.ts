/**
 * The definitions source (docs/UX_AUDIT_AND_PLAN.md §6.1, §5 principle 3): one static map, keyed by a stable id and
 * never by the display word, so the UI (`Term`, `InfoTip`, `PlainFigure`), the Inbox Composer and the plain-language
 * linter define "runway" identically, and the business glossary (the rename map, ./glossary.ts) can still swap the
 * display word. `termsWithGlossary` is what the app hands `GuidanceProvider`; a business that says "clients" reads
 * "Cost to win a client" everywhere.
 *
 * Writing rules (the tests hold them): `word` in sentence case; `short` one sentence a student understands, under 140
 * characters, with units on every number and "Estimate" on every number that is worked out rather than measured;
 * `long` two or three sentences for the hover card; `learn` a route slug the app resolves with `learnPath`:
 * "<department>/<tab>" in the display vocabulary (so "team/agents", not the URL's old tab slug), "settings/<tab>", or a
 * top-level page ("inbox", "journey", "milestones"). US English, no exclamation marks, no sport words, none of the
 * replace-tier jargon of `PLAIN_LANGUAGE_TIERS`.
 */
import { MODULE_TABS, type ModuleKey } from "./constants";
import { applyGlossary, type Glossary } from "./glossary";

/** Mirrors `TermDefinition` in packages/dugout/src/components/guidance/GuidanceProvider.tsx; keep the two identical. */
export interface TermDefinition {
  id: string;
  /** The display word, sentence case ("Runway"). */
  word: string;
  /** One sentence a student understands ("How many months your cash lasts at today's spending."). */
  short: string;
  /** An optional longer explanation for the hover card. */
  long?: string;
  /** An optional "Learn more" target: a route slug the app resolves, or an absolute URL. */
  learn?: string;
}

export const TERMS = {
  // ---- Finance -------------------------------------------------------------------------------------------------
  runway: {
    id: "runway",
    word: "Runway",
    short: "How many months your cash lasts at today's spending.",
    long: "Cash in the bank divided by what you spend more than you earn each month. It is an Estimate until a bank is connected; under 9 months it turns amber, under 6 red.",
    learn: "finance/runway",
  },
  revenue: {
    id: "revenue",
    word: "Revenue",
    short: "Money customers paid you, counted on the day it arrives.",
    long: "Everything customers paid this month, on a cash basis: a sale counts when the money lands, not when it is invoiced. Money raised or moved between accounts is left out.",
    learn: "finance/overview",
  },
  burn: {
    id: "burn",
    word: "Burn",
    short: "How much cash the business uses up each month.",
    long: "Gross burn is everything you spend in a month; net burn is what you spend minus what you earn. Net burn is the figure runway is worked out from.",
    learn: "finance/overview",
  },
  gross_burn: {
    id: "gross_burn",
    word: "Gross burn",
    short: "Everything the business spends in a month, before counting any money that comes in.",
    long: "Payroll, tools, advertising and every other cost added up for the month. It stays the same whether or not customers paid you that month.",
    learn: "finance/overview",
  },
  net_burn: {
    id: "net_burn",
    word: "Net burn",
    short: "What the business spends in a month minus what it earns; the cash that actually leaves.",
    long: "Gross burn minus revenue. When net burn is zero or less the business pays for itself, and runway no longer counts down.",
    learn: "finance/overview",
  },
  cash_basis: {
    id: "cash_basis",
    word: "Cash basis",
    short: "Money is counted when it moves, not when it is promised or invoiced.",
    long: "A sale counts the day the payment arrives and a cost counts the day it is paid. It is simpler than accrual accounting, and it is how every Finance figure here is kept.",
    learn: "finance/cash",
  },
  pnl: {
    id: "pnl",
    word: "P&L",
    short: "Profit and loss: what the business earned minus what it spent over a period.",
    long: "Revenue at the top, costs underneath, profit or loss at the bottom. Finance › Profit and loss shows it by month on a cash basis.",
    learn: "finance/pnl",
  },
  ledger: {
    id: "ledger",
    word: "Ledger",
    short: "The list of every payment in and out, the books the Finance figures are added up from.",
    long: "Each line is one transaction with a date, an amount and a category. Connect a bank or Stripe and the lines arrive on their own; until then they are entered by hand or estimated.",
    learn: "finance/cash",
  },
  mrr: {
    id: "mrr",
    word: "MRR",
    short: "Monthly recurring revenue: the subscription money that comes in every month.",
    long: "Add up what every active subscriber pays per month. It only applies to businesses that charge a subscription; one-off sales are not recurring.",
    learn: "finance/overview",
  },
  arr: {
    id: "arr",
    word: "ARR",
    short: "Annual recurring revenue: MRR times 12, the yearly run rate of your subscriptions.",
    long: "A way of saying monthly subscription revenue as a yearly figure. It is a run rate, not money already in the bank.",
    learn: "finance/overview",
  },
  churn: {
    id: "churn",
    word: "Churn",
    short: "Customers who leave, as a share of the customers you had at the start of the month.",
    long: "Five customers leaving out of a hundred is 5% monthly churn. Lower is better; it is the leak that growth has to outrun.",
    learn: "finance/overview",
  },
  gross_margin: {
    id: "gross_margin",
    word: "Gross margin",
    short: "The share of each sale left after the direct cost of delivering it.",
    long: "Sell something for $100 that costs $30 to make and deliver, and the gross margin is 70%. Payroll, rent and advertising are not in it; those come out of what is left.",
    learn: "finance/pnl",
  },
  payback: {
    id: "payback",
    word: "Payback",
    short: "How many months a new customer takes to earn back what it cost to win them.",
    long: "Cost to win a customer divided by what that customer brings in each month. Under 12 months is usually comfortable; it is an Estimate until real spend and revenue are connected.",
    learn: "finance/overview",
  },
  acquisition_cost: {
    id: "acquisition_cost",
    word: "Cost to win a customer",
    short: "What you spend on marketing and sales, divided by the customers it brought in.",
    long: "Spend $1,000 on advertising and win 10 customers, and each cost $100. Finance and the Channels tab show it per channel; it is an Estimate until spend and customers are both tracked.",
    learn: "distribution/channels",
  },
  cap_table: {
    id: "cap_table",
    word: "Cap table",
    short: "Who owns what share of the business: founders, investors and anyone with options.",
    long: "Every holder, how many shares they have and the percentage that works out to. It changes when money is raised, options are granted or someone's shares vest.",
    learn: "finance/cap-table",
  },
  safe: {
    id: "safe",
    word: "SAFE",
    short: "A simple agreement for future equity: an investor pays now for shares priced in a later round.",
    long: "No shares change hands on the day. When the business raises a priced round, the SAFE turns into shares, usually at a discount or under a valuation cap.",
    learn: "finance/cap-table",
  },
  vesting: {
    id: "vesting",
    word: "Vesting",
    short: "Earning your shares over time, usually 4 years with nothing until a 1-year cliff.",
    long: "Shares are promised up front but become yours in steps as you stay. Leave before the cliff and you keep none; leave after it and you keep what has vested so far.",
    learn: "finance/cap-table",
  },
  wage: {
    id: "wage",
    word: "Wage",
    short: "What an agent costs per month in AI usage, in US dollars, labeled Estimate until the month is over.",
    long: "Worked out from the model it runs on and the tokens it used. Payroll adds every agent's wage up; an agent that reaches its wage cap pauses until the next period.",
    learn: "finance/payroll",
  },
  wage_cap: {
    id: "wage_cap",
    word: "Wage cap",
    short: "The most an agent may cost per month; when it is reached the agent pauses until next month.",
    long: "Set when hiring and changed on the agent's profile. It protects your credits: a runaway agent stops spending at the cap instead of draining the balance.",
    learn: "finance/payroll",
  },

  // ---- Distribution --------------------------------------------------------------------------------------------
  funnel: {
    id: "funnel",
    word: "Funnel",
    short: "The steps from first hearing about you to paying, and how many people make it through each.",
    long: "Visitors at the top, sign-ups in the middle, paying customers at the bottom. The drop between steps shows where people give up and where the team should work.",
    learn: "distribution/channels",
  },
  attribution: {
    id: "attribution",
    word: "Attribution",
    short: "Working out which channel brought in a customer when several touched them on the way.",
    long: "Someone sees an ad, reads a post and then signs up from a search; attribution decides how much credit each channel gets. Two methods are shown, and the figures are an Estimate.",
    learn: "distribution/attribution",
  },
  conversion: {
    id: "conversion",
    word: "Conversion",
    short: "A person taking the step you wanted: signing up, activating or paying.",
    long: "The conversion rate is how many out of a hundred take that step. Each kind of conversion is a win the Inbox can narrate.",
    learn: "distribution/attribution",
  },
  pipeline: {
    id: "pipeline",
    word: "Pipeline",
    short: "Deals in progress, from a first conversation to a signed customer.",
    long: "Each lead sits at a stage with a value and a next step. The Leads tab is the pipeline; in Development the same word means the build steps a change goes through.",
    learn: "distribution/leads",
  },
  fit: {
    id: "fit",
    word: "Fit",
    short: "How well a channel suits this business, from 1 to 20; 16 and above is Excellent.",
    long: "Worked out from the archetype, the customer and what the channel costs, then refined as results come in. Poor is 1 to 5, Average 6 to 10, Good 11 to 15, Excellent 16 to 20.",
    learn: "distribution/board",
  },
  channel_board: {
    id: "channel_board",
    word: "Channel Board",
    short: "The map of where this business finds customers: channels on the board are live, off the board are not.",
    long: "Channels sit in four lines: Acquisition, Engagement, Organic and Offline. Each shows its fit and its weekly form against the cost target; the Distribution strategist proposes which channels go on it and you confirm them.",
    learn: "distribution/board",
  },
  lead: {
    id: "lead",
    word: "Lead",
    short: "A person or company that might become a customer, with a stage and a next step.",
    long: "Leads come from forms, campaigns and imports and move through the pipeline. In the Team department the same word means an agent that runs a department.",
    learn: "distribution/leads",
  },
  campaign: {
    id: "campaign",
    word: "Campaign",
    short: "One planned push on one channel with a budget, a start, an end and a goal.",
    long: "An ad set, an email series or a launch post. Spend and conversions roll up to the channel so attribution can judge it.",
    learn: "distribution/campaigns",
  },
  creative: {
    id: "creative",
    word: "Creative",
    short: "The ads, emails, posts and images a campaign runs with.",
    long: "Agents draft creative, and in Augmented mode you approve it before it goes out. Each piece keeps its results so the best ones are reused.",
    learn: "distribution/creative",
  },
  distribution_strategist: {
    id: "distribution_strategist",
    word: "Distribution strategist",
    short: "The lead that decides where this business looks for customers and how much it spends there.",
    long: "It proposes the Channel Board, sets each channel's cost target and reviews the campaigns. It starts work only after you start distribution.",
    learn: "distribution/board",
  },
  cost_trend: {
    id: "cost_trend",
    word: "Cost trend",
    short: "The last five weeks against the channel's cost target: under, near or over it.",
    long: "Each cell is one week of cost per customer compared with the target the Distribution strategist set. A run of weeks over the target is the sign to pause the channel or change its creative.",
    learn: "distribution/channels",
  },

  // ---- Contacts (the CRM, founder decision 2026-10-20 item 1) ----------------------------------------------------
  contacts: {
    id: "contacts",
    word: "Contacts",
    short: "Everyone the business knows: customers, leads, partners and suppliers, with their notes and every touch on record.",
    long: "The same screen operators call the CRM, and the search still answers to that name. Agents link every person and company they mention, so a name in a note opens its record.",
    learn: "crm",
  },

  // ---- Product -------------------------------------------------------------------------------------------------
  specification: {
    id: "specification",
    word: "Specification",
    short: "The written description of what the product is and does, kept up to date by the Product lead.",
    long: "Sections for the problem, the customer, the features and what is out of scope. Agents build from it, so a change to the specification comes to you as a proposal to sign off.",
    learn: "product/specification",
  },
  roadmap: {
    id: "roadmap",
    word: "Roadmap",
    short: "The ordered list of what the team builds next, by milestone.",
    long: "Each item has a why, a rough size and a place in line. Development turns an item into a task graph when its turn comes.",
    learn: "product/roadmap",
  },
  proposal: {
    id: "proposal",
    word: "Proposal",
    short: "A change an agent suggests to the specification or the roadmap, with its reasoning and evidence.",
    long: "Nothing changes until you accept it. The Changes tab shows the old and new text side by side; accept, edit or decline each one.",
    learn: "product/changes",
  },
  sign_off: {
    id: "sign_off",
    word: "Sign-off",
    short: "Your yes on a document, which lets the team build from it.",
    long: "The specification and the roadmap need your sign-off before Development starts real work. Later edits ask for it again only when they change what gets built.",
    learn: "product/specification",
  },
  sku: {
    id: "sku",
    word: "SKU",
    short: "Stock keeping unit: one sellable version of a product, such as a size or color.",
    long: "A shirt in three sizes and two colors is six SKUs. Each one has its own stock count, cost and price.",
  },
  source_watcher: {
    id: "source_watcher",
    word: "Source watcher",
    short: "The agent that reads the sources you add and proposes changes to the specification when they matter.",
    long: "Paste a link or a note on the Sources tab. It scores each one for relevance and, for the ones that matter, drafts a proposal with its evidence for you to accept or decline.",
    learn: "product/sources",
  },
  product_lead: {
    id: "product_lead",
    word: "Product lead",
    short: "The lead that keeps the specification and the roadmap, and proposes changes to them.",
    long: "Every edit to the specification goes through it. It also speaks for the Source watcher when a source suggests a change.",
    learn: "product/specification",
  },

  // ---- Concept attributes (the Ideation Studio's ten scores, 1 to 20; UX plan §7.5 A6) ------------------------
  // The sentence is CONCEPT_ATTRIBUTE_HINTS (packages/dugout journey/types.ts) with its direction; the ids are
  // `attr_<key>` as the Studio's `attributeTermId` builds them.
  attr_market_pull: {
    id: "attr_market_pull",
    word: "Market pull",
    short: "How strongly people already want this; higher means more demand.",
    long: "One of the ten scores on a concept card, from 1 to 20, with the evidence behind it. Compare puts the same score side by side across concepts.",
  },
  attr_market_size: {
    id: "attr_market_size",
    word: "Market size",
    short: "How many people or businesses could pay for it; higher means a bigger market.",
    long: "One of the ten scores on a concept card, from 1 to 20, with the evidence behind it. A big market with no pull is a crowd that is not looking for you yet.",
  },
  attr_competition: {
    id: "attr_competition",
    word: "Competition",
    short: "How crowded the market is; higher means less crowded.",
    long: "One of the ten scores on a concept card, from 1 to 20. It reads the way the other scores do: a high score is good news, here an open field.",
  },
  attr_speed_to_first_customer: {
    id: "attr_speed_to_first_customer",
    word: "Speed to first customer",
    short: "How soon the first customer could pay; higher means sooner.",
    long: "One of the ten scores on a concept card, from 1 to 20. Weeks scores high, a year of building before anyone can pay scores low.",
  },
  attr_capital_intensity: {
    id: "attr_capital_intensity",
    word: "Capital intensity",
    short: "How much money it takes before the first sale; higher means less money needed.",
    long: "One of the ten scores on a concept card, from 1 to 20. It reads the way the other scores do: a high score is good news, here a business that starts cheap.",
  },
  attr_agent_executability: {
    id: "attr_agent_executability",
    word: "Agent-executability",
    short: "How much of the work your agent team can do on its own; higher means more of it.",
    long: "One of the ten scores on a concept card, from 1 to 20. Software, content and online sales score high; anything that needs hands, trucks or a license scores lower.",
  },
  attr_founder_fit: {
    id: "attr_founder_fit",
    word: "Founder fit",
    short: "How well your skills and constraints suit what this needs; higher means a closer fit.",
    long: "One of the ten scores on a concept card, from 1 to 20, worked out from your profile. Change the profile and the score changes with it.",
  },
  attr_defensibility: {
    id: "attr_defensibility",
    word: "Defensibility",
    short: "How hard it is for others to copy; higher means harder to copy.",
    long: "One of the ten scores on a concept card, from 1 to 20. Data, relationships, a brand or a license that others cannot get quickly all raise it.",
  },
  attr_regulatory_load: {
    id: "attr_regulatory_load",
    word: "Regulatory load",
    short: "How much regulation applies; higher means fewer rules to deal with.",
    long: "One of the ten scores on a concept card, from 1 to 20. It reads the way the other scores do: a high score is good news, here few permits, licenses or filings.",
  },
  attr_distribution_clarity: {
    id: "attr_distribution_clarity",
    word: "Distribution clarity",
    short: "How clear the path to the first customers is; higher means a clearer path.",
    long: "One of the ten scores on a concept card, from 1 to 20. A known channel with a known cost scores high; 'we will see' scores low.",
  },

  // ---- Development ---------------------------------------------------------------------------------------------
  pull_request: {
    id: "pull_request",
    word: "Pull request",
    short: "A finished piece of code an agent asks to add to the product, with its changes laid out for review.",
    long: "The agent works on a branch, then opens a pull request so a lead can review and merge it. Nothing reaches the product until it is merged.",
    learn: "development/pull-requests",
  },
  branch: {
    id: "branch",
    word: "Branch",
    short: "A separate copy of the code where an agent can work without touching what is live.",
    long: "Each task gets its own branch. When the work is reviewed and merged, the branch's changes join the main code and the branch is done.",
    learn: "development/code",
  },
  repository: {
    id: "repository",
    word: "Repository",
    short: "Where the product's code lives, with the history of every change.",
    long: "Usually a GitHub repository connected in Settings › Integrations. Agents read it in a sandbox and send their changes back as pull requests.",
    learn: "development/code",
  },
  sandbox: {
    id: "sandbox",
    word: "Sandbox",
    short: "A safe, throwaway computer where an agent runs code without touching anything real.",
    long: "Each live session gets its own. Whatever the agent breaks there stays there; only reviewed changes leave it.",
    learn: "development/environments",
  },
  session: {
    id: "session",
    word: "Session",
    short: "One run of one agent on one task, from start to finish, with everything it did recorded.",
    long: "Live sessions shows the ones running now and their transcript. A session ends when the task is done, the time limit is hit or you stop it.",
    learn: "development/live-sessions",
  },
  task_graph: {
    id: "task_graph",
    word: "Task graph",
    short: "The plan for a piece of work as tasks and the order they depend on.",
    long: "Each box is a task with a goal and what counts as done; each arrow says which task must finish first. Tasks that share files are never run at the same time.",
    learn: "development/plan",
  },
  acceptance: {
    id: "acceptance",
    word: "Acceptance",
    short: "What counts as done for a task, written so a test can check it.",
    long: "Each task lists its acceptance criteria before work starts. A pull request is not finished until every one of them passes.",
    learn: "development/plan",
  },
  planner: {
    id: "planner",
    word: "Planner",
    short: "The agent that turns a roadmap item into a task graph with goals and acceptance criteria.",
    long: "It plans tasks of under 4 hours each and marks the hard ones for the larger model. Anything the specification leaves open becomes a question for you, never an assumption.",
    learn: "development/plan",
  },

  // ---- Limits and modes ----------------------------------------------------------------------------------------
  hard_gate: {
    id: "hard_gate",
    word: "Hard gate",
    short: "An action no agent may ever take alone: moving money, signing, deleting for good, changing security settings.",
    long: "Hard gates stop at you in every business mode, on vacation included. They come to the Inbox as a note that needs your go-ahead.",
    learn: "settings/mode",
  },
  policy: {
    id: "policy",
    word: "Policy",
    short: "Your limits: what agents may do on their own, what asks first and what is never allowed.",
    long: "Set by the business mode and the spend cap, and tightened per agent in its Autonomy tab. Every action an agent takes is checked against it before it runs.",
    learn: "settings/mode",
  },
  autonomy: {
    id: "autonomy",
    word: "Autonomy",
    short: "How much one agent may do without asking you, within the business's limits.",
    long: "An agent inherits the business mode unless you give it its own setting. More autonomy means fewer notes in the Inbox; hard gates still stop at you.",
    learn: "settings/mode",
  },
  business_mode: {
    id: "business_mode",
    word: "Business mode",
    short: "How much the team may do on its own: Augmented asks first, Assisted acts within your limits, Automated runs the day.",
    long: "Augmented: agents prepare and you execute. Assisted: routine work runs within your limits, and new spend and contracts ask first. Automated: the Chief of Staff runs the day, you review outcomes, and hard gates still ask.",
    learn: "settings/mode",
  },
  autopilot: {
    id: "autopilot",
    word: "Autopilot",
    short: "The business starts its own cycles on a schedule instead of waiting for you to press Continue.",
    long: "Set in Settings › Mode with a cadence and a daily cap. It pauses itself when credits run out, when agents are stopped or after a few empty cycles, and it waits while a note holds Continue.",
    learn: "settings/mode",
  },
  vacation: {
    id: "vacation",
    word: "Vacation",
    short: "Your away mode: the team keeps working within limits you set, and only hard gates and emergencies reach you.",
    long: "Turn it on from the top bar with a return date and a budget ceiling. The Chief of Staff decides inside that authority and writes down why; everything else waits for you.",
  },
  api_key: {
    id: "api_key",
    word: "API key",
    short: "A password-like code that lets this product use an AI provider's models on your own account.",
    long: "Add one in Settings › Keys to pay the provider directly instead of using credits. It is stored encrypted and never shown again after you save it.",
    learn: "settings/keys",
  },
  integration: {
    id: "integration",
    word: "Integration",
    short: "A connection to an outside service such as GitHub, Stripe or a bank.",
    long: "Set up in Settings › Integrations. Each one has a practice version so the whole product can run without real accounts, and a real one that asks you to sign in.",
    learn: "settings/integrations",
  },
  archetype: {
    id: "archetype",
    word: "Archetype",
    short: "The kind of business this is, which sets the starting team, channels and example figures.",
    long: "B2B SaaS, consumer app, marketplace, physical product, hardware, services or content. It is chosen at commit and can be changed in Settings › Business.",
    learn: "settings/business",
  },

  // ---- AI usage ------------------------------------------------------------------------------------------------
  model: {
    id: "model",
    word: "Model",
    short: "The AI an agent runs on; a bigger model thinks better and costs more per task.",
    long: "Each agent is set to one of three sizes. The largest is best for planning and hard problems, the smallest for quick, repeated work; the choice changes the agent's wage.",
    learn: "team/agents",
  },
  tokens: {
    id: "tokens",
    word: "Tokens",
    short: "The units AI usage is metered in, roughly three quarters of a word each.",
    long: "Everything an agent reads and writes is counted in tokens, and the model charges per thousand. Credits and wages are worked out from them.",
    learn: "settings/billing",
  },
  credits: {
    id: "credits",
    word: "Credits",
    short: "Prepaid balance that pays for the team's AI usage, in US dollars.",
    long: "Every agent session draws down credits by the tokens it used. When they run out the team stops until you top up or add your own API key.",
    learn: "settings/billing",
  },

  // ---- Team and agents -----------------------------------------------------------------------------------------
  chief_of_staff: {
    id: "chief_of_staff",
    word: "Chief of Staff",
    short: "The agent that plans each cycle, hands work to the department leads and turns your replies into plans.",
    long: "It never spends, signs or acts on a hard gate; those come to you. On vacation it decides inside the authority you gave it and writes down why.",
    learn: "team/agents",
  },
  line_manager: {
    id: "line_manager",
    word: "Line manager",
    short: "The lead an agent reports to, who reviews its work and hands it tasks.",
    long: "Workers report to a department lead, leads report to the Chief of Staff, and the Chief of Staff reports to you. Team › Hierarchy shows the tree.",
    learn: "team/hierarchy",
  },
  hierarchy: {
    id: "hierarchy",
    word: "Hierarchy",
    short: "Who reports to whom: you, then the Chief of Staff, then the department leads, then their workers.",
    long: "Team › Hierarchy draws the tree. Moving an agent under a different lead changes who reviews its work and who hands it tasks.",
    learn: "team/hierarchy",
  },
  rating: {
    id: "rating",
    word: "Rating",
    short: "An agent's skill from 1 to 20, always shown with its band word: Poor, Average, Good or Excellent.",
    long: "Each skill has one, and the agent's overall rating is the average. Poor is 1 to 5, Average 6 to 10, Good 11 to 15, Excellent 16 to 20; training can move it.",
    learn: "team/agents",
  },
  tested: {
    id: "tested",
    word: "Tested",
    short: "The score on practice tests: what the agent does on held-back examples, 1 to 20.",
    long: "Half of the practice tests stay hidden so the score stays honest. A training run re-tests every skill and the Coach compares the results with the live version.",
    learn: "team/agents",
  },
  proven: {
    id: "proven",
    word: "Proven",
    short: "The score on real work: how the agent's finished tasks went, 1 to 20.",
    long: "More real work makes Proven count for more in the displayed score. A new skill shows its tested score alone until the agent has used it.",
    learn: "team/agents",
  },
  potential: {
    id: "potential",
    word: "Potential",
    short: "How good an agent could become with training, shown as outlined stars beside its filled stars.",
    long: "Filled stars are the rating now; outlined stars are the ceiling. An agent close to its ceiling is better replaced than trained.",
    learn: "team/agents",
  },
  form: {
    id: "form",
    word: "Form",
    short: "How an agent's last five tasks went, oldest on the left: went well, partly, or failed.",
    long: "A quick read of whether an agent is on a good run. Hover the cells for the count; a run of failures is usually a sign the task or the model is wrong for it.",
    learn: "team/agents",
  },
  position_map: {
    id: "position_map",
    word: "Other roles it could take",
    short: "How well an agent would do in each other role, as Excellent, Good, Average or Poor.",
    long: "Each role cell shows the fit from 1 to 20 with its band word. Use it before hiring: an existing agent with a Good fit may cover a role for free.",
    learn: "team/agents",
  },
  training: {
    id: "training",
    word: "Training",
    short: "Practice runs that change an agent's instructions and model, tested before anything goes live.",
    long: "Edit the playbook, run it against held-back tests and compare the scores. Nothing changes for real until you press Promote; the Coach reviews the change first.",
    learn: "team/agents",
  },
  coach: {
    id: "coach",
    word: "Coach",
    short: "The agent that reviews training changes and says what got better, what got worse and whether to promote.",
    long: "It compares the new version with the live one on the same tests. Its note is advice; promoting is your call.",
    learn: "team/agents",
  },
  playbook: {
    id: "playbook",
    word: "Playbook",
    short: "The steps an agent follows to do its job, written in plain words.",
    long: "Every agent has one in its instructions: what to load, what to check, what to hand over. Training changes the playbook; the Coach reviews what changed before it goes live.",
    learn: "team/agents",
  },
  health: {
    id: "health",
    word: "Health",
    short: "Whether each agent is working, idle, paused or down, and what it needs to get going again.",
    long: "Down means a credential lapsed, a rate limit was hit or errors repeated; the row says when it is expected back. Paused is a choice, yours or a wage cap, not a fault.",
    learn: "team/health",
  },
  team_health: {
    id: "team_health",
    word: "Team health",
    short: "The share of agents not failing, down or degraded; idle and paused agents count as fine.",
    long: "Shown on Home and in Team › Health. A team of idle agents is 100% healthy; nothing is wrong, they simply have no task.",
    learn: "team/health",
  },

  // ---- The loop, the journey and provenance --------------------------------------------------------------------
  cycle: {
    id: "cycle",
    word: "Cycle",
    short: "One round of work: the team works for a while, then reports back in the Inbox.",
    long: "Press Continue to run one. Each agent gets a task and a time limit; what they finished, what they need from you and what went wrong come back as notes.",
    learn: "home",
  },
  chapter: {
    id: "chapter",
    word: "Chapter",
    short: "A quarter of the business's life, the way the Journey groups what happened.",
    long: "Milestones and wins are filed by chapter. A new one starts every three months, with a short recap of the last.",
    learn: "journey",
  },
  milestone: {
    id: "milestone",
    word: "Milestone",
    short: "A first the business reached: first customer, first dollar, a signed-off specification.",
    long: "Milestones are filed by chapter on the Journey and in Milestones. The next ones are shown outlined so you can see what is coming.",
    learn: "milestones",
  },
  leaderboard: {
    id: "leaderboard",
    word: "Leaderboard",
    short: "Where this business ranks against others of its kind on a figure such as revenue or customers.",
    long: "Only for businesses in Live mode that chose to appear. Figures you mark private stay out of it.",
  },
  customer_update: {
    id: "customer_update",
    word: "Customer Update",
    short: "A note that narrates a win: a sign-up, a first use or a payment, at a brief, standard or featured level.",
    long: "Brief is one line for a sign-up; standard adds who was involved; featured, for a payment, tells the whole story with a standout agent. The level follows the kind of win.",
    learn: "inbox",
  },
  runway_horizon: {
    id: "runway_horizon",
    word: "Runway horizon",
    short: "The date your cash runs out at today's net burn, drawn on the Journey; amber under 9 months, red under 6.",
    long: "Today plus the runway in months. It is an Estimate until a bank is connected, and it moves every time spending or revenue changes.",
    learn: "journey",
  },
  estimate: {
    id: "estimate",
    word: "Estimate",
    short: "Worked out, not measured.",
    long: "The figure is calculated from what is known, such as archetype averages or a model's price list. It is replaced by a measured one as soon as a bank, Stripe or an ad account is connected.",
  },
  forecast: {
    id: "forecast",
    word: "Forecast",
    short: "A projection of what could happen, not a measurement.",
    long: "Built from today's figures and a set of assumptions you can change. The cone on the Journey widens the further out it looks because the uncertainty grows.",
    learn: "finance/runway",
  },

  // ---- Legal ---------------------------------------------------------------------------------------------------
  jurisdiction: {
    id: "jurisdiction",
    word: "Jurisdiction",
    short: "The country or state whose laws the business is set up under and must follow.",
    long: "Picked when the business is formed, such as Delaware or England and Wales. It decides the legal entity types, the taxes and the filing deadlines Legal tracks.",
    learn: "legal/entity",
  },
  lawful_basis: {
    id: "lawful_basis",
    word: "Lawful basis",
    short: "The legal reason you are allowed to hold and use someone's personal data.",
    long: "Consent, a contract with them or a legitimate interest are the common ones. Every place the product stores personal data names its basis in the privacy policy.",
    learn: "legal/policies",
  },
  filing: {
    id: "filing",
    word: "Filing",
    short: "A form or report the company must send to a registry or tax office by a set date.",
    long: "Annual accounts, a confirmation statement, a tax return. Legal › Compliance lists each one with its deadline and who files it; a compliance event is anything else the company must do by a date.",
    learn: "legal/compliance",
  },
} as const satisfies Record<string, TermDefinition>;

export type TermId = keyof typeof TERMS;

/** Every id, in the map's order. */
export const TERM_IDS = Object.keys(TERMS) as TermId[];

/**
 * The definitions with the business glossary applied to `word`, `short` and `long` (never to `id` or `learn`), so a
 * business that says "clients" reads it in every definition. An empty glossary gives back equal entries.
 */
export function termsWithGlossary(glossary: Glossary | null | undefined): Record<string, TermDefinition> {
  const out: Record<string, TermDefinition> = {};
  for (const [id, term] of Object.entries(TERMS) as [TermId, TermDefinition][]) {
    const entry: TermDefinition = { id: term.id, word: applyGlossary(term.word, glossary), short: applyGlossary(term.short, glossary) };
    if (term.long !== undefined) entry.long = applyGlossary(term.long, glossary);
    if (term.learn !== undefined) entry.learn = term.learn;
    out[id] = entry;
  }
  return out;
}

/**
 * The jargon tiers of docs/UX_AUDIT_AND_PLAN.md §8.2 and Appendix E, as plain words and phrases for the plain-language
 * linter (scripts/plain-language.mjs) and the Composer eval. "replace" fails on sight in anything a founder reads;
 * "define" is allowed where the screen or the note defines the word (a `Term`, an explainer, a hint). Matching is by
 * whole word, case-insensitive except for the all-caps acronyms.
 */
export const PLAIN_LANGUAGE_TIERS: { readonly replace: readonly string[]; readonly define: readonly string[] } = {
  replace: [
    "ICP",
    "CPA",
    "CAC",
    "COGS",
    "RLS",
    "Cedar",
    "named query",
    "exhibit",
    "request_human_action",
    "concurrency",
    "time box",
    "counterparty",
    "webhook",
    "OAuth",
    "BYOK",
    "unit economics",
    "hunk",
    "triage",
  ],
  define: Object.values(TERMS).map((t) => t.word),
};

/**
 * `learn` slugs use the display vocabulary (CLAUDE.md: new identifiers follow the table) while a few tabs keep their
 * old URL slug; this maps the one to the other.
 */
export const LEARN_SLUG_ALIASES: Readonly<Record<string, string>> = {
  "team/agents": "team/squad",
  "distribution/board": "distribution/formation",
  "development/live-sessions": "development/training-ground",
  "finance/payroll": "finance/wage-bill",
};

/** The path a term's `learn` opens inside a business: a department tab, a Settings tab, a top-level page, or an absolute URL as given. */
export function learnPath(learn: string, businessId: string): string {
  if (/^https?:\/\//.test(learn)) return learn;
  const slug = LEARN_SLUG_ALIASES[learn] ?? learn;
  const [first = "", second] = slug.split("/");
  if (!second) return `/b/${businessId}/${first}`;
  if (first === "settings") return `/b/${businessId}/settings/${second}`;
  return `/b/${businessId}/d/${first}/${second}`;
}

/** True when a department `learn` slug names a real tab (after aliases); other shapes are not checked here. */
export function isKnownDepartmentLearn(learn: string): boolean {
  const slug = LEARN_SLUG_ALIASES[learn] ?? learn;
  const [dept, tab] = slug.split("/");
  if (!dept || !tab) return false;
  const tabs = MODULE_TABS[dept as ModuleKey];
  return Boolean(tabs?.some((t) => t.slug === tab));
}
