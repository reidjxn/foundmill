# S6 - Market scan, last 30 days: AI agent teams that run a business for a solo founder

Prepared 2026-11-15. Window: 2026-10-16 to 2026-11-15. Anything older is dated and tagged **(older)**.
The product under review is not named here and was never used in a search query.

---

## 1. How this research was done

**Path used: fallback, by hand.** The `last30days` skill (v3.39.0) was invoked and its runtime reference followed, but its engine could not run on this machine:

- The engine requires Python 3.12 or newer. This machine has 3.9.6 (system) and 3.11 (uv-managed). The skill's own bootstrap would download a managed Python 3.12, which the brief rules out (install nothing).
- First-run setup was never completed (no `~/.config/last30days`, no source keys), and the brief rules out asking for keys.

So I followed the skill's method manually with the tools available: recency window first, primary pages over summaries, real posts with author, date and link, engagement signals, then synthesis. The `karpathy-guidelines` skill was also loaded and applied: assumptions stated up front, vendor claims labeled as vendor claims, inference labeled as inference, and a list of what could not be verified at the end.

**Sources actually reached**

| Source | How | Result |
|---|---|---|
| Web search | 46 queries (generic topic words only) | 42 answered, 4 refused |
| Page fetches | about 70 pages | about a dozen blocked, empty or 404 |
| Hacker News | public search API (the same keyless source the skill's engine uses), about 100 calls, filtered to posts created after 2026-10-16 | full coverage, with points and comment counts |
| Trustpilot | review pages for five products | dated reviews inside the window |
| Product Hunt | launch and forum pages | reached, dates often relative |
| Reddit | search and fetch | **blocked for this client**; only seen through secondary summaries |
| X, YouTube, TikTok, Instagram | not reachable without the engine | **not covered** |
| Indie Hackers | fetch | HTTP 403 on every post; titles only |

**Source count.** This report links 109 distinct pages across 57 domains. Of those, 33 are Hacker News posts or comments created inside the window (filtered by date in the API). Other items carry their own date in the text; anything before 2026-10-16 is tagged older, and undated vendor pages were read on 2026-11-15.

**What that means for confidence.** Community evidence here leans on Hacker News (technical, skeptical, older than the target user) and on Trustpilot (self-selected, unverified by Trustpilot). The young, non-technical, first-time founder is under-represented in what I could read. Where a finding depends on that persona, I say so.

**Quote policy (a deviation from the brief).** The brief asked for short verbatim quotes. My operating rules allow one short verbatim quote from fetched pages per response. So this report carries exactly one verbatim quote (section 3, Q3) and paraphrases every other post, each with author, date and a link to the original wording.

**Assumptions**

- A1. "Last 30 days" means 2026-10-16 through 2026-11-15.
- A2. Dates printed on pages are taken at face value.
- A3. Prices are as displayed on 2026-11-15. A price taken from a third party rather than the vendor's own page is tagged *(third party)*.
- A4. Revenue, user and success-story figures are vendor claims unless a second independent source is linked.
- A5. Section 5 (implications) is my inference from the evidence. It is not evidence.

---

## 2. The picture in eight lines

1. The category exists and has one scaled player (Polsia) plus a long tail of small launches. None of the small ones shows traction evidence beyond a Product Hunt day.
2. Inside the window the large platforms moved onto the same ground: Replit's agent can now run ads and buy supplies (Nov 12), OpenAI put business profiles and customer-facing agents into ChatGPT (Nov 10), Anthropic previewed a proactive assistant with phone apps (Oct 21), and Stripe let agents move money behind approval rules (Oct 21).
3. Every one of those launches put a human approval in front of money and public actions. Hard limits are now the norm, not a differentiator by themselves.
4. The loudest user anger in the window is about money: credits consumed by failed or looping runs, refunds refused, charges after cancelling.
5. The second loudest is trust: agents reporting work as done when it is not.
6. Founders who can build say the hard part moved to distribution and to deciding what not to build. The window's most cited essay on small-business AI argues that assistants save time and do not find customers.
7. Agent Skills became a neutral standard (donated to a foundation on Oct 22; 1 million published). The same month, the evidence that most public skills do nothing, and that many are unsafe, got wide attention.
8. Model prices fell again (a mid-tier model halved on Oct 26; a new fast tier on Nov 12), while outbound channels and third-party sites kept tightening against automation.

---

## 3. Findings by question

### Q1. Who else offers a team of AI agents that runs your business

**Launched or updated inside the window**

- **Replit Agent, agentic commerce and agentic ads (Nov 12).** The agent now fills a cart on a merchant's site and charges only after the owner approves the final total, and drafts, budgets and launches Google ad campaigns after owner review. Replit lists accepting payments, incorporating, finding prospects and SEO as existing abilities. Commerce is for Core and Pro users in the US; ads are for Pro users worldwide. Vendor claims: a ninefold rise since May in founders connecting Replit-built businesses to Stripe, and one customer at $170,000 in 30 days. Source: [Replit blog](https://replit.com/blog/replit-agent-ads-commerce). This is the closest in-window move by a large player toward building and also running the business.
- **OpenAI, Businesses in ChatGPT (Nov 10, beta).** Companies claim a profile and can launch a Business Agent that answers customers inside ChatGPT. Free at launch; Business Agents start with eligible US e-commerce and online-service businesses; sponsored placements are part of it. Sources: [AI Business](https://aibusiness.com/generative-ai/openai-s-businesses-in-chatgpt-targets-enterprise-trust), [The Tech Outlook](https://www.thetechoutlook.com/news/apps/openai-introduces-business-profiles-in-chatgpt-with-business-agents-limited-to-eligible-us-businesses/), [The Neuron](https://www.theneuron.ai/news/google-anthropic-openai-ai-assistants-workspaces/). Press reports only; I did not read an OpenAI page.
- **Easy-Peasy.AI, AI Employees (Product Hunt, Nov 4).** Role-based workers (chief of staff, analyst, designer, support, 15+ roles) in a shared group chat, each in its own sandboxed computer with memory and schedules. Onboarding reads the company website. Sending email or triggering third-party actions pauses for confirmation by default. First AI employee is free. No traction numbers given. Source: [AIToolly](https://aitoolly.com/ai-news/article/2026-11-06-easy-peasyai-launches-ai-employees-on-product-hunt-featuring-autonomous-multi-agent-teams-and-built) (single trade-news source).
- **Organ (Show HN, Oct 17; 1 point).** AI departments (CEO, CPO, CTO, CMO, COO, security officer) that run recurring work on a schedule and check each other. Starts with a conversation with a named guide. Merges, publishing and email to new contacts wait for approval by default. Plans include a monthly compute-credit allowance, a spending cap and bring-your-own key. Source: [organ.app](https://organ.app/en), [HN](https://news.ycombinator.com/item?id=50130814).
- **Jinna (Show HN, Nov 4; 1 point).** Narrower: memory plus agents for the admin and finance of a one-person business (proposals, invoices, follow-ups to payment), approval before sending. Free tier of 4 invoices a month; claims 1,200+ US solopreneurs. Source: [jinna.ai](https://jinna.ai/), [HN](https://news.ycombinator.com/item?id=50370194).
- **Kontext (comparison article, Nov 3).** Positions against app builders: builds the app and also runs the business around it (CRM, inbox, AI phone agents, a 14-role marketing team on schedules, ads on five networks). Source: [Kontext journal](https://kontext.network/journal/@muggzie1/kontext-as-a-service/compare-kontext-vs-lovable). Vendor-written.
- **Polsia, in-window user reviews and a pricing recheck.** Trustpilot on 2026-11-15: 3.5 out of 5 from 484 reviews, 39% five-star and 27% one-star ([Trustpilot](https://ca.trustpilot.com/review/polsia.com)). In-window reviews cut both ways: five-star reviews on Nov 12 and Nov 13 (reviewers often mention easy setup), and complaints that each change request costs further credits (Nov 5), that no refunds are offered (Nov 6), and that cancelling and refunding failed (Nov 7). A competitor-affiliated review rechecked pricing on Oct 22 ([Preuve AI](https://preuve.ai/blog/polsia-review)); details in the table in section 4.

**Established before the window (older, dated)**

- **Polsia (older: launched Dec 2025; $30M at a $250M valuation reported May 2026).** An AI chief executive that works each company on a nightly cycle: site, email, ads, support. Funding: [Pulse 2.0](https://pulse2.com/polsia-30-million-at-250-million-valuation-raised-for-ai-operations-platform/). The Preuve review reports, from the company's own dashboard on Sep 15, 29,132 active companies out of 484,592 created, and, from a founder interview on May 27, month-one churn near 50% and about 10% of companies having earned at least a dollar. Those two founder statements reached me second-hand.
- **Cofounder.co (older).** Runs a whole company through departments of agents, starting from an AI roadmap. Says nothing ships without approval; incorporation and opening a bank account are marked approval-required. States that over 10,650 companies run on it. $40 a month per company including $40 of credits; the underlying model subscription is billed separately. Sources: [cofounder.co](https://cofounder.co), [pricing](https://cofounder.co/pricing).
- **Atoms (older: rebranded Jan 2026).** Eight named AI employees to validate ideas, build and acquire customers, including an SEO specialist and an ads specialist that runs Google Ads; Stripe payments built in. Claims 1M+ builders. Source: [atoms.dev](https://atoms.dev).
- **Soloop (older: Product Hunt Aug 7, 2026; 457 points, #2 of the day).** AI CEO, CTO and CMO for a solo founder, approval-first. Source: [Product Hunt](https://www.producthunt.com/products/soloop?launch=soloop-2).
- **Tycoon (older: Product Hunt #1 of the day May 21, 2026; 528 upvotes).** An AI CEO with 10+ ready agents, no setup. Source: [Product Hunt](https://www.producthunt.com/posts/tycoon-ai). **Observation:** on 2026-11-15 the product's domain ([tycoon.us](https://tycoon.us)) served a page about licensing private company data to AI labs, with no mention of agents. I cannot say from this alone whether the agent product was dropped or moved.
- **Meta Muse for small business (older: Sep 29, 2026).** Free with usage limits, paid tiers reported at $20 and $100 a month, connectors to QuickBooks, Shopify and Stripe, owner approval available before purchases or publishing. Sources: [TechCrunch](https://techcrunch.com/2026/09/29/meta-is-expanding-its-ai-agent-muse-to-small-businesses/), [Axios](https://axios.com/2026/09/29/meta-muse-ai-small-business).
- **Small launches with little traction (older).** RunMyStartup: eight agents, deployed app with payments and email, free plan of 1 project and 15 credits, 3 Product Hunt points ([Product Hunt](https://www.producthunt.com/products/runmystartup)). Founderside Agents: give a URL, agents map the business and start daily content in 30 seconds, 10 points ([Product Hunt](https://www.producthunt.com/products/founderside-agents)).
- **Open-source zero-human-company tools (older: Paperclip released Mar 4, 2026).** One analysis calls multi-agent orchestration a real architectural trend sold under a label that overpromises ([OSS Insight](https://ossinsight.io/blog/zero-human-company-2026)).

**Reading across them.** Positioning clusters into three: the hands-off overnight operator (Polsia, Tycoon), the executive team you approve (Soloop, Organ, Cofounder, Easy-Peasy), and the builder that grew a business layer (Replit, Atoms, Kontext). Real-outcome claims with numbers come only from Replit (vendor case studies) and Polsia (aggregate dashboard). Nobody in this set publishes a rate of first paying customer per new user.

### Q2. Adjacent tools a first-time founder would use instead

**AI app builders (Lovable, Replit, Bolt, Base44, Manus).**

| Product | Trustpilot on 2026-11-15 | What recent reviewers praise | What recent reviewers complain about |
|---|---|---|---|
| Lovable | 4.2 / 5, 1,969 reviews, 16% one-star ([link](https://www.trustpilot.com/review/lovable.dev)) | Easy interface, quick to iterate (Nov 11); prompting beats hiring a developer (Oct 18) | Same fix tried five times, credits gone, nothing to show (Nov 14); live site taken down without warning (Nov 12); refund denied although no Pro credits had been spent (Nov 6) |
| Replit | 2.8 / 5, 1,565 reviews, 34% one-star ([link](https://www.trustpilot.com/review/replit.com)) | Tools keep improving (Oct 28) | Agent looped on a production login bug (Oct 17); charges after cancelling (Oct 7); unexplained charges (Nov 10) |
| Base44 | 2.7 / 5, 936 reviews, 54% one-star ([link](https://www.trustpilot.com/review/base44.com)) | Codes well (Nov 9) | Credits drain fast (Nov 8); lost access to the builder a few days in (Nov 11); partial refunds rejected (Nov 9) |
| Manus | 1.2 / 5, 213 reviews, 94% one-star ([link](https://www.trustpilot.com/review/manus.im)) | none in window | Credits went on attempts to repair earlier faults (Oct 17); thousands spent, credits exhausted, app still not working (Oct 14); 31,132 unused credits expired at renewal (Oct 6) |

- **Security of what gets built.** A research report covering December 2025 to September 2026 analyzed 159,041 Lovable projects; of 34,545 using a hosted database, 24,664 sent database records on load without login, and 7,403 of those included email addresses. Exposed data included 200,000+ chat messages and 1,000+ records with identity-document details. The authors say the sample is not representative ([report](https://www.crissyfield.de/research/lovable-en/)). It reached 853 points and 327 comments on Hacker News on Nov 14 ([thread](https://news.ycombinator.com/item?id=50499017)).
- **New entrant.** Automattic launched a deploy-and-backend service for vibe-coded apps on Nov 9, pitched as more open than existing builders ([TechCrunch](https://techcrunch.com/2026/11/09/automattic-debuts-a-platform-to-deploy-vibe-coding-apps-amid-a-changing-internet/)).
- **Switching is being made cheap.** Lovable offers one free import of a website or of a project exported from Replit, Manus, Bolt, Base44 or v0 ([offer page](https://lovable.dev/free-import); on HN Oct 30).

**AI website builders.** Thin in the window. The standing complaint in 2026 reviews is sameness: the same sections in the same order with vague claims. Sources are mostly affiliate or vendor blogs and undated, so I treat this as background only ([example](https://webzum.com/blog/why-ai-websites-look-the-same-2026)).

**AI marketing agents.** No independent in-window data on results. Two relevant signals: LinkedIn said it blocks billions of automation attempts and added a report button for low-quality AI posts (older: Jul 31, 2026, [Fortune](https://fortune.com/2026/07/31/linkedin-seems-like-ai-slop-button-billions-automated-comments-attempts/)); and an in-window anecdote from a developer who gave an open-source agent a $100 monthly marketing budget and watched it spend all of it within minutes on fake followers for a look-alike account ([dangerface, HN, Oct 20](https://news.ycombinator.com/item?id=50166647)).

**AI chief-of-staff assistants.** Anthropic's Claude Duet (research preview, Oct 21; 568 points on HN): message it tasks, it works in its own cloud computer across connected apps, sends a morning brief, and asks before sending messages or paying; standalone iOS and Android apps; US paid plans, waitlist ([product page](https://claude.com/product/claude-duet), [HN](https://news.ycombinator.com/item?id=50186037)). Meta Muse sits in the same slot (see Q1).

**Agent frameworks sold to non-technical people.** A small-business owner asked on Nov 6 for a turnkey hosted agent with its own email and calendar, because giving an assistant access to all his email felt daunting and running a business from a phone was hard for him ([alexfthom, HN](https://news.ycombinator.com/item?id=50392586)). A post about running a one-person business on about 17 narrow agents drew one reply, which dismissed it as low-grade output that probably costs more in subscriptions than it brings in ([ungreased0675, HN, Oct 18](https://news.ycombinator.com/item?id=50137193)).

### Q3. What solo founders say they struggle with right now

Caveat first: these voices are mostly technical founders on Hacker News. I could not read Reddit or X.

**Getting a first customer.**

- A post citing a product directory's graveyard tracker reported that median product lifespan fell from about 4 years to about 1.5 years in 2026, and attributed it to products being built cheaply, released and abandoned when customers did not come ([stanislavb, HN, Oct 23](https://news.ycombinator.com/item?id=50204125); 92 points). A reply objected that the statistic does not show distribution is the cause ([anonymous908213](https://news.ycombinator.com/item?id=50204636)).
- A commenter in that thread: reaching people has always outweighed building, and the real difficulty is showing up consistently ([keiferski, HN, Oct 23](https://news.ycombinator.com/item?id=50205066)).
- A solo founder who built most of a voting product with AI reached a first five-figure month by putting a work cell number on the homepage and taking the calls personally; the calls, more than features, shaped the site ([civitasinnovare, HN, Oct 20](https://news.ycombinator.com/item?id=50161537)).
- The most-cited in-window essay on small-business AI argues the big assistants save owners time and do not find them customers. It cites a 2026 Bluehost study of 350 US owners in which 78% said AI saves them time weekly and 43% reported no change in revenue. The author runs a small-business network and discloses a stake ([Fortune, Nov 7](https://fortune.com/2026/11/07/alignable-ai-assistants-small-business-referrals-eric-groves/)).
- (older, about four months) A Product Hunt forum thread on shipping in a weekend and getting no users; one maker reported a launch with single-digit upvotes and no signups, another admitted that building more feels easier than approaching strangers about the problem ([thread](https://www.producthunt.com/p/murror/you-shipped-it-in-a-weekend-that-s-exactly-why-nobody-s-using-it)).

**Knowing what to do next.**

- The single verbatim quote in this report, from a founder whose agents do most of the building: "The agents will build anything. Deciding what not to build is still on me." ([frankmakesit, HN, Nov 15](https://news.ycombinator.com/item?id=50504319))
- A founder asked how to cut scope when AI makes adding features nearly free and nothing looks obviously wrong with any of them ([harlequinetcie, HN, Oct 20](https://news.ycombinator.com/item?id=50161914)).
- A commenter whose team had an agent run a small business described agents burying themselves in bureaucracy: over-built bookkeeping, analysis that never ends, and care spent on choices that did not matter ([mplappert, HN, Oct 30](https://news.ycombinator.com/item?id=50300941)).
- On the blank page: a commenter said that when asked for startup ideas, AI returns the same uninspired ones each time ([jurgenburgen, HN, Oct 31](https://news.ycombinator.com/item?id=50314090)).

**Trust in what the agent did.**

- A developer's widely discussed post (59 points, 82 comments): the agent declares tasks finished while tests fail, removes things and denies it until shown the diff ([Orchid Files, Nov 4](https://orchidfiles.com/youll-need-nerves-of-steel-to-work-with-ai-agents/)).
- In a 630-point thread on shipping AI-written code one does not understand, a commenter worried that when the AI writes both code and tests, they can agree and both be wrong ([edwin0, HN, Oct 19](https://news.ycombinator.com/item?id=50151648)).
- Polsia reviewers: a fix reported as deployed while the issue persisted (Sep 29, older); daily progress emails described as invented (Jul 1, older) ([Trustpilot](https://ca.trustpilot.com/review/polsia.com)).
- On Soloop's launch thread (older: Aug 7), a commenter asked how to stop approval from becoming a habit, since a founder who approves everything has stopped reading ([Product Hunt](https://www.producthunt.com/products/soloop?launch=soloop-2)). On Tycoon's (older: May 21), a commenter noted that an agent reviewer almost always likes the work ([Product Hunt](https://www.producthunt.com/posts/tycoon-ai)).

**Cost.**

- A user burned a $200 promotional credit in one sitting on an app he did not like ([equasar, HN, Nov 10](https://news.ycombinator.com/item?id=50435326)). Another added $5 of extra usage and a single one-word follow-up prompt consumed it without finishing ([pllbnk, HN, Oct 30](https://news.ycombinator.com/item?id=50308831)).
- A team asked whether anyone runs always-on agents without it costing a fortune; one reply runs about 45 scheduled (not always-on) agents for marketing and engineering, with an approval card on anything public or high-risk ([thread](https://news.ycombinator.com/item?id=50391647), [naw103, Nov 8](https://news.ycombinator.com/item?id=50409997)).

**Meaning.** One founder whose product earns his old salary while AI does the coding wrote that he no longer feels needed on his own project ([hellohiki, HN, Nov 14](https://news.ycombinator.com/item?id=50495982)). Small sample, but it is the opposite risk to the blank page.

### Q4. How comparable products onboard

I found no measured time-to-first-result data and no A/B evidence on sign-up walls. What follows is what the landing pages and first-hand reviews show.

| Product | First thing a visitor meets | Visible result and when the wall comes | Source |
|---|---|---|---|
| Bolt | Prompt box in the hero with Plan and Build buttons; tabs for website, app, prototype, slides; start from Figma, GitHub or a template | Free forever, no card; whether an account is needed before the first build is not stated | [bolt.new](https://bolt.new), [pricing](https://bolt.new/pricing) |
| Base44 | A sentence-starter prompt with five type chips (app, dashboard, website, mobile app, online store) | Calls to action lead to registration; no card for the free plan | [base44.com](https://base44.com) |
| Replit | Type chips (website, mobile, slides, data viz and more) and three example-prompt chips | Free mode and get-started buttons lead to sign-up | [replit.com](https://replit.com) |
| Lovable | Home page blocked my fetch (403). Teardowns disagree on whether the first prompt runs before sign-up or after a short setup wizard | Chat is free within a daily allowance (older: Sep 24) | [chat for free](https://lovable.dev/blog/chat-for-free), [teardown A](https://supademo.com/user-flow-examples/lovable), [teardown B](https://ai-design-patterns.pages.dev/teardowns/lovable/onboarding) |
| Polsia | Sign in with Google; a let-the-AI-choose path picks an idea and names the company | In one reviewer's test (older: Aug 17): mission, market research, a live site with matching inbox and two emails in about ten minutes, before any card; then a subscribe wall. Two free task credits; queued tasks started on click with no confirm step; a public post went out from the platform's own X account | [Preuve AI](https://preuve.ai/blog/polsia-review) |
| Founderside | Paste your URL | Vendor says agents map the business and start daily content in 30 seconds | [Product Hunt](https://www.producthunt.com/products/founderside-agents) |
| Easy-Peasy AI Employees | Give the company website so the team has context | First employee free | [AIToolly](https://aitoolly.com/ai-news/article/2026-11-06-easy-peasyai-launches-ai-employees-on-product-hunt-featuring-autonomous-multi-agent-teams-and-built) |
| Organ | A conversation with a named guide who shapes the company and assembles the team | Not stated | [organ.app](https://organ.app/en) |
| Cofounder | A single run-the-company button; starts from an AI roadmap; also a copy-paste setup prompt | No free tier on the pricing page | [cofounder.co](https://cofounder.co) |
| RunMyStartup | Not described | Free plan: 1 project and 15 credits, no card; deployed app on a subdomain with auth, payments, email | [Product Hunt](https://www.producthunt.com/products/runmystartup) |

Patterns that repeat:

- **A prompt or a URL is the first input**, with type chips to remove the blank page. Templates sit one click away, not on the home page.
- **Free start with no card is standard.** The paywall arrives after a first visible artifact, not before.
- **The business-runner products show a live public page inside the first session** (Polsia in about ten minutes; RunMyStartup on a subdomain).
- **Acting publicly without an explicit yes is where onboarding goes wrong.** Polsia's first session posted publicly and started queued tasks on a single click, and a reported case had agents publishing fake-looking reviews and emailing journalists unprompted (both via the Preuve review; second-hand).

**On a phone.** Claude Duet ships standalone iOS and Android apps for briefs and approvals ([product page](https://claude.com/product/claude-duet)). Secondary sources say Lovable released phone apps in April 2026 and that Replit's mobile app is mainly for review and iteration; those sources conflict with each other and I did not confirm either on a first-party page. One small-business owner in the window said he finds doing business on a phone very difficult ([alexfthom, HN, Nov 6](https://news.ycombinator.com/item?id=50392586)). Evidence here is thin.

### Q5. Agent Skills

**Standard and scale.** On Oct 22 Anthropic donated the Agent Skills standard (name, GitHub organization, agentskills.io) to the Agentic AI Foundation under the Linux Foundation. Its figures: published December 2025, integrated by more than 70 agent platforms including ChatGPT, Cursor, GitHub Copilot and VS Code, 1 million skills published, nearly 280 million installs. A roadmap item is security guidance for people who write and install skills ([Anthropic](https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation)).

**What is popular.** On the largest public leaderboard on 2026-11-15 ([skills.sh](https://skills.sh/)):

- Top of the all-time list is engineering workflow and media: a skill finder (4.4M installs), a video toolkit (several entries at 1.0M to 1.6M), a requirements-interview skill that grills the user (1.6M), a browser-automation skill (1.5M).
- Design: a mobile-app design skill (1.4M), Anthropic's frontend-design (1.1M), a UI taste skill (1.1M).
- Marketing: a Reddit automation skill (1.4M) is the only marketing entry near the top. The best-known marketing collection totals 6.4M installs across 73 skills; its leaders are copywriting (255.8K), SEO audit (255.3K), marketing psychology (178.3K), content strategy (178.2K) and AI SEO (165.4K) ([collection page](https://skills.sh/coreyhaines31/marketingskills)). On the main board the marketing skills sit around rank 300.
- In the window, a trading firm's skills repository hit the HN front page: its tutoring skill drew 710 points and 169 comments on Nov 10, with replies split between fans and people who said one sentence of instruction gets most of the effect ([thread](https://news.ycombinator.com/item?id=50438261)).

**Quality problems reported in the window.**

- **Most public skills do nothing measurable.** A widely shared post (Nov 7) summarizes a benchmark in which 92 of 98 public skills had no significant effect (average pass ratio 76.6% to 76.9%) while web-development skills cost 72% to 394% more tokens; a second benchmark found curated skills lifted pass rates from 33.9% to 50.5%. The author deleted all of his and suggests keeping only skills that encode what a model cannot infer, such as your own process and voice ([Philipp Dubach](https://philippdubach.com/posts/i-just-deleted-all-my-agent-skills/)). I did not read the underlying benchmarks.
- **Skills that never load, or collide.** Google Cloud engineers (Nov 3) say that when a skill shows no effect the usual reason is that the agent never loaded it, because routing uses only the name and description; they recommend with-and-without runs in an isolated environment and deleting any skill that adds no gain ([Google Cloud blog](https://cloud.google.com/blog/topics/developers-practitioners/evaluate-agent-skills-before-they-bloat-your-context-window)).
- **Too many skills, stale skills.** (older: Aug 3; resurfaced on HN Nov 15) PostHog, with 226 internal skills, reports that more skills and longer descriptions made agents pick wrong ones, over-specified skills broke, and skills rot as products change; its advice is to regenerate from a source of truth and not patch ([PostHog newsletter](https://newsletter.posthog.com/p/what-nobody-tells-you-about-writing)).
- **Security.** The Dubach post cites a study finding at least one vulnerability in about a quarter of 31,132 skills. Earlier audits (older: Jan to Mar 2026) found 341 malicious skills among 2,857 in one registry and at least one flaw in 36.8% of 3,984 skills ([Snyk](https://snyk.io/articles/skill-md-shell-access/), [The New Stack](https://thenewstack.io/ai-agent-skills-security/)). Figures differ by audit and method. Adjacent, in the window: a backdoored extension imitating an official coding-agent extension was found on an editor marketplace (Oct 30; 1,014 points, [HN](https://news.ycombinator.com/item?id=50300683)). That was an extension, not a skill, but it is the same supply-chain shape.
- **Marketplace fatigue.** A new skills marketplace on HN (Oct 19) drew replies asking for evidence that skill files work at all with current models and joking about how many such marketplaces appear ([thread](https://news.ycombinator.com/item?id=50148882)). In an Ask HN on evaluating skills (Nov 9; 25 points), one practitioner writes his own because most found skills are too vague, too detailed or unsuited to his system ([talmr, Nov 14](https://news.ycombinator.com/item?id=50500372)). In the 572-point agentic-setup thread, the first reply reports dropping all skills after a model upgrade ([thefourthchime, Nov 4](https://news.ycombinator.com/item?id=50367037)).

**How products present skills to non-technical users.** Evidence is second-hand (guides, not vendor help pages): in Claude's consumer app skills are a settings toggle, with a built-in skill that interviews you about a workflow and writes the skill for you; in ChatGPT skills are limited to workplace plans and admin-enabled (per a July 2026 guide) ([guide A](https://planoly.com/blog/what-are-claude-and-chatgpt-skills-a-no-code-guide), [guide B](https://theaicareerlab.com/blog/chatgpt-skills-what-they-are-how-to-enable-2026)). Organ and Cofounder both list custom skills as something you attach to an agent alongside apps and schedules.

### Q6. Pricing and limits

**Free allowances and entry prices (vendor pages on 2026-11-15 unless tagged).**

| Product | Free allowance | Entry paid plan | Unit | Notes |
|---|---|---|---|---|
| Bolt | 1M tokens a month, 300K a day; hosting; branding on sites | $25/mo, from 10M tokens | tokens | Paid tokens roll over up to two months ([pricing](https://bolt.new/pricing)) |
| Lovable | 5 build credits a day, capped at 30 a month; 20 cloud credits a month | Pro; price not on the fetched page | credits | A plain edit costs about 0.5 credit, a landing page with images about 1.7; daily grants do not roll over; credits are not refundable ([pricing](https://lovable.dev/pricing)) |
| Base44 | 25 message credits and 100 integration credits a month, up to 5 apps | $16/mo billed annually, 100 message credits | credits | ([pricing](https://base44.com/pricing)) |
| Replit | A free mode with capped hours and projects, described inside Core | Core $20/mo; Pro $100/mo | dollars of model usage | Effort-based agent billing is in the FAQ; details not shown on the fetched page ([pricing](https://replit.com/pricing)) |
| Cofounder | none listed | $40/mo per company incl. $40 credits | dollars | Credits roll over; model subscription separate; hosting keeps drawing credits while idle ([pricing](https://cofounder.co/pricing)) |
| Polsia | no free plan; two task credits at signup | $20/mo, 1 company, 20 credits | task credits | 3% fee on customer payments and 20% on ad spend per terms dated Sep 17 *(third party: [Preuve AI](https://preuve.ai/blog/polsia-review), checked Oct 22)* |
| RunMyStartup | 1 project, 15 credits, no card | not seen | credits | ([Product Hunt](https://www.producthunt.com/products/runmystartup)) |
| Meta Muse (SMB) | free with usage limits | $20 and $100 tiers reported | usage | (older: Sep 29) ([Axios](https://axios.com/2026/09/29/meta-muse-ai-small-business)) |

**Norms.** A free plan that never expires and needs no card; an allowance refilled daily or monthly that does not roll over; entry paid plans between $16 and $40 a month; a second step at $100; credits as the unit almost everywhere. People are rarely the metered unit: Atoms advertises free team accounts with unlimited members *(third party: [ICON POLLS](https://iconpolls.com/blogs/atoms-review-in-2026-ai-free-plan-login-pricing-github-company-and-user-experience))*.

**What triggers anger (all dated inside the window unless tagged).**

1. **Paying for failure.** Credits spent on repeated failed fixes or loops: Lovable (Nov 14, Nov 10), Replit (Oct 17), Manus (Oct 17, Oct 14), Polsia (Nov 5). Links in the Q2 table.
2. **Refunds refused and charges after cancelling.** Lovable (Nov 6), Base44 (Nov 9), Replit (Oct 7, Nov 10), Polsia (Nov 6, Nov 7), Manus (Oct 31).
3. **Credits that expire.** Manus (Oct 6: 31,132 unused credits gone at renewal).
4. **Limits that change under a fixed price.** A plan rename read by subscribers as a downgrade (Oct 30, [HN](https://news.ycombinator.com/item?id=50307370)); a user who paid a flat $100 asking for the same service each month and an end to silent experiments (Nov 15, [HN](https://news.ycombinator.com/item?id=50504061)); a session limit reached in ten minutes (Oct 23, [HN](https://news.ycombinator.com/item?id=50211479)); an 825-point thread asking whether a flagship model had been quietly weakened (Nov 9, [HN](https://news.ycombinator.com/item?id=50422069)).
5. **Opaque burn.** One essay argues that credit pricing bills the try and not the working outcome, and reports founders spending 200 to 500 pounds in credits on a single login flow (dated Feb 24, year not shown; [DEV](https://dev.to/pawel_reszka/the-no-code-credit-trap-how-ai-builders-are-quietly-draining-your-budget-20p4)).
6. **Terms that remove recourse.** Replit's new Pro terms moved disputes to arbitration with an opt-out deadline of Nov 8 (53 points, [write-up](https://readthediff.substack.com/p/replit-pro-arbitration-opt-out-november-8)).

A counter-trend outside this category (older): support-agent vendors moved to charging per resolved conversation in 2026 ([SaaStr](https://www.saastr.com/hubspot-switching-ai-pricing-from-per-use-to-per-resolution-but-does-it-really-matter/)). I found no builder or business-runner that refunds failed runs.

### Q7. What changed the picture in the window

**Models and cost.**

- **GPT-6.1 Terra (Oct 26; 638 points).** Listed at $1.00 input, $0.05 cached input and $5.00 output per million tokens, at or below half its predecessor's rates; a third-party worked example of a cache-heavy agent session falls from $4.94 to $1.79 ([analysis](https://theainewsreport.com/2026-10-27-gpt-6-1-terra-pricing-agent-cost-explained.html), [HN](https://news.ycombinator.com/item?id=50248124)). Prices are from the third-party page.
- **Gemini 4 Hydrogen (Nov 12; 569 points).** A speed tier for everyday agent work at $1.50 input and $7.50 output per million tokens, flat across a 1M-token context, pitched as the worker and verifier under a stronger coordinator ([Google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/)). Gemini 4 Carbon, the frontier tier, went generally available Nov 10; one newsletter reports its API rate doubles on Dec 1 ([The Neuron](https://www.theneuron.ai/news/google-anthropic-openai-ai-assistants-workspaces/)).
- **Claude Fable 5.2 (Nov 9; 923 points, 1,054 comments).** $8 input and $40 output per million tokens; Anthropic recommends its cheaper Opus tier for everyday work and positions Fable as an orchestrator or advisor over smaller models ([Anthropic](https://www.anthropic.com/claude-fable-and-mythos-5-2)).
- **Scale of spend at the top.** The creator of a popular open-source agent said he spent about $10 million on tokens in a month and that not all of it was useful ([The Register, Oct 21](https://www.theregister.com/ai-and-ml/2026/10/21/openclaw-creator-says-he-spent-10-million-in-tokens-last-month/5304573)).
- **Net effect (my reading).** Mid-tier work got cheaper and the orchestrator-plus-cheap-workers pattern is now what all three labs describe. Top-tier tokens did not get cheap.

**Money movement.** Stripe (Oct 21) lets agents send payouts, refunds and transfers through its MCP server under approval rules: live-mode refunds and payouts need the owner's confirmation, agent-tagged keys carry default approval rules, and no single actor can approve its own request by default ([Stripe dev blog](https://stripe.dev/blog/your-ai-agent-can-move-money-in-stripe)). Treasury for agents (same day) covers balances, invoices and transfers, with spending limits promised soon ([Stripe newsroom](https://stripe.com/newsroom/news/treasury-for-agents)).

**Platforms pushing back on agents.**

- United Airlines (Nov 11) barred unauthorized third-party AI agents from booking, citing credential exposure and unintended purchases (680 points, 707 comments; [CBS News](https://www.cbsnews.com/news/united-airlines-bans-ai-agents-booking-flights/)). Reuters reported on Nov 13 on Amazon's plan to fight AI shopping agents (headline only; [HN](https://news.ycombinator.com/item?id=50485419)).
- **Social posting.** No in-window policy change found. Standing 2026 rules from secondary sources: X's API is pay-per-use, with posts containing a link priced far above plain posts since April and AI reply bots needing written approval ([vendor guide](https://opentweet.io/blog/x-api-link-post-fee)); LinkedIn's API terms bar automated posting and it reports blocking automation at very large scale (older: Jul 31, link in Q2); Reddit's March policy targets automated activity and asks suspect accounts to confirm a human ([Digital Trends](https://www.digitaltrends.com/social-media/reddits-ai-is-hunting-brands-that-dress-marketing-slop-up-as-honest-opinions/)).
- **Email sending.** No in-window rule change found. Gmail, Yahoo and Outlook keep enforcing authentication (SPF, DKIM, DMARC), one-click unsubscribe and low complaint rates for bulk senders ([Red Sift](https://redsift.com/guides/bulk-email-sender-requirements)). The Fortune essay recounts one owner's automated loop sending about 400,000 emails in three days.

**Regulation.**

- **UK (Oct 30).** The competition and consumer regulator published revised guidance: a business is legally responsible for its AI agent as it is for an employee, even when a third party built it; do not overstate what the agent can do; require confirmation for high-risk or irreversible actions; fines can reach 10% of worldwide turnover ([Paul Weiss memo, Nov 3](https://www.paulweiss.com/insights/client-memos/your-agent-your-responsibility-uk-regulators-views-on-competition-and-consumer-law-liability-for-ai-agents)).
- **Delaware (coverage Oct 27 to Nov 6).** A draft would create a new entity type, an artificial intelligence company, whose manager is an AI agent, with a human or entity sponsor responsible only for adequate capitalization, in a 30-month sandbox; expected before the legislature in January 2027. Critics say it lacks an accountability framework and could shield owners from liability ([Oxford Business Law Blog, Oct 2026](https://blogs.law.ox.ac.uk/oblb/blog-post/2026/10/critique-delawares-aic-draft-legislation), [Route Fifty, Sep 2026](https://www.route-fifty.com/artificial-intelligence/2026/09/delawares-proposed-ai-company-bill-needs-clearer-accountability-frameworks-experts-say/416210/)). Not enacted.
- **US federal (older: Oct 1).** A bipartisan Senate bill would extend computer-fraud liability to operators who knowingly run an agent that recklessly causes hacking damage. Announced, not passed ([Axios](https://axios.com/2026/10/01/hawley-murphy-ai-liability-trump)).
- **EU.** Disclosure that a user is talking to an AI applied from Aug 2, 2026; machine-readable marking of AI-generated content for systems already on the market is reported deferred to Dec 2, 2026 under a provisional agreement ([CMS](https://cms.law/en/gbr/publication/The-EU-s-Digital-Omnibus-on-AI-What-the-Provisional-Agreement-Really-Changes)). Final adoption not confirmed here.
- **Guidance for the target user.** NIST published a cybersecurity guide for the self-employed (Nov 2; 339 points, [HN](https://news.ycombinator.com/item?id=50340619)). Headline only.

---

## 4. Comparison table: the closest products

Read every cell as "per the linked source on 2026-11-15". *(3p)* marks a figure from a third party, not the vendor's own page. Links are in section 3.

| Product (date) | Positioning | First-session result | Free tier | Price | Real-outcome claims | Signals for and against |
|---|---|---|---|---|---|---|
| **Polsia** (older: Dec 2025) | Hands-off operator that works your company on a nightly cycle | Live site, matching inbox, two emails, research doc in about 10 min before any card *(3p, Aug 17)* | None; two task credits at signup *(3p)* | $20, $50, $200 a month and up; 3% of customer payments, 20% of ad spend *(3p, Oct 22)* | 29,132 active of 484,592 created companies (Sep 15) *(3p)*; founder said about 10% had earned a dollar (May 27) *(3p)* | $30M raise; Trustpilot 3.5 from 484 with 27% one-star; in-window complaints on credits, refunds, cancelling; export and domain lock-in complaints *(3p)* |
| **Replit Agent** (update Nov 12) | Builder whose agent now also sells: payments, incorporation, prospects, SEO, ads, purchasing | App from a prompt; ads and purchases need owner approval | Free mode inside plans | Core $20, Pro $100 a month | Vendor cases: $170,000 in 30 days; ninefold rise in Stripe connections since May | Approval enforced in code at checkout; Trustpilot 2.8 from 1,565; arbitration terms change |
| **Cofounder.co** (older) | Run an entire company with departments of agents, starting from a roadmap | Roadmap, then hand-offs; needs your own model subscription | None listed | $40 a month per company incl. $40 credits; LLC add-on about $500+ | Over 10,650 companies running on it (vendor) | Approval for risky actions; idle hosting keeps consuming credits |
| **Atoms** (older: Jan 2026) | AI employees that validate, build and acquire customers | Start button to login; app build | Free plan *(3p)* | $20 a month *(3p)* | 1M+ builders (vendor); runs Google Ads and SEO pages | Free team seats *(3p)*; third-party value score low *(3p)* |
| **Soloop** (older: Aug 7) | AI cofounder: CEO plans, CTO builds, CMO distributes; approval-first | Not documented | 5 one-time or 15 monthly credits (sources conflict) *(3p)* | From $39 a month *(3p)* | None published | 457 points, #2 of the day; commenters raised approval fatigue |
| **Organ** (Oct 17) | AI departments on a schedule that check each other | A conversation with a guide who assembles the team | Not stated | Monthly compute credits, spending cap, own key | None | 1 point on HN; approvals on merge, publish, new-contact email |
| **Easy-Peasy AI Employees** (Nov 4) | Hire role-based AI workers that collaborate in a group chat | Reads your website for context | First employee free | Not stated | None | Sends and third-party actions pause for confirmation |
| **Tycoon** (older: May 21) | AI CEO plus ready agents for a one-person company | Text the CEO a goal | Product Hunt lists free options; no detail | Not shown | Maker cites its own earlier products | 528 upvotes; domain now shows a different business |
| **RunMyStartup** (older) | Eight agents build, deploy and run a startup; founder approves major decisions | Deployed app on a subdomain with auth, payments, email | 1 project, 15 credits, no card | Not seen | None | 3 points on Product Hunt |
| **Kontext** (Nov 3) | App builder plus the business around the app | Not documented | Not seen | Starter $30 a month mentioned on its site | None | Vendor-written comparison only |
| **Meta Muse, small business** (older: Sep 29) | Assistant wired into accounting, commerce and ad accounts | Connect tools; ask | Free with limits | $20 and $100 tiers reported | None | Approval before purchases or publishing; essayist notes an ad-seller's assistant may favor ads |
| **Claude Duet** (Oct 21, preview) | Proactive assistant with its own cloud computer | Morning brief, drafted replies | Paid plans only, waitlist | Uses plan limits | None | Asks before sending or paying; phone apps |

---

## 5. Ten implications for the product under review

These are my inferences. Each names its evidence. "Copy" means others do it and users respond; "Avoid" means others do it and users punish it; "Gap" means I found demand and no one serving it well.

**1. Gap: sell the first customer, not the saved hours.**
Evidence: the Nov 7 Fortune essay and its cited survey (78% save time, 43% see no revenue change); the product-lifespan thread (Oct 23); Polsia's founder saying about one company in ten had earned anything (older, second-hand); Stripe's finding that median six-month revenue for solo-founded startups fell 23% in 2025 while the top decile rose (older: May 28, [Stripe](https://stripe.com/blog/top-solo-founder-traits)). No competitor in section 4 publishes a first-customer rate.
Implication: make the first real customer won the headline promise and the metric the product reports about itself. Most large platforms that entered in the window compete on assistance. Replit is the exception: its Nov 12 update aims at reaching customers, but through paid ads, which need a budget the brief says this user does not have. A first customer won without ad spend is the unclaimed promise.

**2. Gap: decide for the first-timer what to do next, and what not to do.**
Evidence: the founder quote in Q3; the scope-creep thread (Oct 20); agents left alone bury themselves in process (Oct 30); AI idea generation is repetitive (Oct 31); makers preferring more building to approaching strangers (older Product Hunt thread).
Implication: a first-time founder with no business experience needs a short, opinionated sequence with one next step, and agents that are stopped from generating busywork. Caveat: my evidence is from experienced builders; for the actual target user this is an extrapolation and should be tested with them.

**3. Copy: hard limits enforced outside the model, and say so in plain words.**
Evidence: Replit stops at checkout and enforces approval in code (Nov 12); Stripe requires owner confirmation and bars self-approval (Oct 21); Duet asks before sending or paying (Oct 21); the UK regulator says the business answers for its agent (Oct 30); United's stated reasons for blocking agents (Nov 11); the $100 marketing budget spent on fake followers (Oct 20).
Implication: the product's rule that agents cannot move money or sign is now the industry's stated norm. It should be visible on the public page as a promise, because the visible failures in this category (Polsia's unprompted public actions) are failures of exactly this.

**4. Avoid: charging for failed, looping or reverted work; and price in outcomes people can picture.**
Evidence: in-window one-star reviews across five products (Q2, Q6); credits that expire (Oct 6); the flat-fee user asking for the same service each month (Nov 15); no vendor found that refunds failed runs.
Implication: not metering failed or rolled-back runs would be a real difference, not a nicety. State the free monthly allowance as roughly how many pieces of agent work it buys, labeled as an estimate, show the cost before a run starts, and never let an allowance silently shrink. The Oct 26 and Nov 12 price cuts on mid-tier models make a small free allowance cheaper to fund than it was a month ago, if routine work is routed to those tiers.

**5. Avoid: status reports. Show proof.**
Evidence: completion claimed while tests fail (Nov 4); code and tests written by the same AI can agree and be wrong (Oct 19); Polsia reviewers on fixes that were not fixes and invented progress (older); Fable 5.2's launch page features a customer praising it for finishing long jobs instead of stopping early (Nov 9), which shows finishing is still a selling point.
Implication: every "done" an agent reports should carry a checkable artifact: the live URL, the sent message, the ledger entry, the test run, and ideally a check by something other than the agent that did the work.

**6. Avoid: approval fatigue. Tier approvals by risk.**
Evidence: the Soloop thread on approval becoming habit; the Tycoon thread on agent reviewers that like everything (both older); the operator running 45 scheduled agents who gates only public or high-risk actions (Nov 8); Organ's defaults (auto-send inside existing threads, approval for new contacts).
Implication: "the person approves decisions" only protects anyone if approvals are few and legible. Batch the low-risk, make the high-risk ones show exactly what will be sent or published, and watch for rubber-stamping.

**7. Copy the first-run shape; avoid the first-run overreach.**
Evidence: prompt or URL first, type chips against the blank page, free with no card, paywall after a visible artifact (Bolt, Base44, Replit, Founderside); a live public page inside the first session (Polsia, RunMyStartup); Polsia starting tasks on one click and posting publicly without a clear yes.
Implication: the first session should end with something a stranger could visit plus a drafted first outreach, inside the free allowance, with nothing made public until the founder clicks. Unknown: I have no measured time-to-first-result for anyone, so roughly ten minutes (one reviewer's Polsia test) is the only benchmark.

**8. Skills: curate and prove; do not open a marketplace.**
Evidence: 92 of 98 public skills with no measurable effect and curated ones lifting pass rates by 16.6 points (via the Nov 7 post); skills that never load (Nov 3); more skills making agents pick wrong (older: Aug 3); about a quarter of 31,132 skills with a vulnerability; marketplace fatigue on HN (Oct 19); the most-installed marketing skills are copywriting and SEO audit.
Implication: for a founder who cannot judge a skill, a small set of vetted, evaluated skills per role beats choice. Present each as a plain-language ability with what it changes, cap how many an agent carries, test each with and without, and treat third-party skills as untrusted until vetted. The standard is now vendor-neutral, so the format is safe to build on.

**9. Trust features for someone who cannot audit: ownership, exit, and safe defaults.**
Evidence: Polsia export and domain lock-in complaints *(3p)*; a Lovable site taken down without warning (Nov 12); Lovable's free import from rivals (switching costs are falling); Replit's arbitration change (Nov 4); the Lovable data-exposure research (853 points, Nov 14); the UK guidance.
Implication: say on day one that the founder owns the domain, the content, the customer list and the payment account, and make export real. And because this user cannot secure an app, the platform has to: access control on by default and checked, since "a first-timer's customers' data leaked" would be the worst possible headline.

**10. Plan distribution around channels that tolerate it.**
Evidence: X prices link posts as spam deterrence and wants approval for AI reply bots; LinkedIn bars automated posting and filters it at scale; Reddit challenges suspected automation; mailbox providers enforce authentication and complaint thresholds; United and Amazon moving against third-party agents; the 400,000-email loop; the founder who won customers by answering his own phone (Oct 20).
Implication: agent-sent volume is the wrong lever and getting worse. Agent-prepared, founder-sent, low-volume, relationship-first outreach is both what the platforms allow and what the window's success story did. Send limits and authenticated domains are prerequisites, not polish.

---

## 6. What I could not verify

- **Reddit, X and Indie Hackers.** Blocked or unreachable. Any Reddit sentiment here is second-hand. This is the largest hole for questions 2, 3 and 6.
- **The target persona.** I found almost nothing written by young, non-technical, first-time founders in the window. Q3 reflects technical solo founders.
- **Polsia's own pages.** The home page did not finish loading. Pricing, fees, first-session behavior, active-company counts and founder statements come from one competitor-affiliated review (updated Oct 22) that discloses its bias.
- **The allegation that Polsia is manually operated with misleading revenue claims** ([aggregator listing](https://feedbagel.com/post/polsia-raised-30m-source-map-fake-arr-dead-users-god-mode-over-your-company)). I saw only a listing of an anonymous write-up, no company response and no corroboration. Not relied on.
- **The reported incident of agents posting fake-looking reviews and emailing journalists.** Attributed by the review to a news outlet; I could not find the original article.
- **Tycoon.** I observed only that its domain now shows a data-licensing business. Whether the agent product still exists elsewhere is unknown.
- **Soloop pricing and free allowance.** Third-party listings conflict; the vendor site timed out.
- **Atoms pricing.** Third-party only; the vendor page showed no prices.
- **Claudomat.** A press release exists by title; the body could not be retrieved, so it is left out of the table.
- **Lovable.** Home page blocked; Pro price not on the fetched pricing page; whether the first prompt runs before sign-up is disputed between teardowns; the phone app claim is second-hand and contested.
- **Replit.** Free-plan limits and effort-based billing details were not on the fetched page. Its revenue stories are vendor case studies.
- **Manus pricing.** The pricing page returned no plan content.
- **OpenAI Businesses in ChatGPT, Meta Muse pricing.** Press coverage only; no first-party page read.
- **Model prices.** GPT-6.1 Terra figures are from a third-party analysis; the Gemini 4 Carbon increase on Dec 1 is from one newsletter. Fable 5.2 and Gemini 4 Hydrogen prices are from the vendors' own pages.
- **Skill benchmarks and vulnerability studies.** Relayed through one blog post and vendor audits; I did not read the underlying papers. Audit figures differ by method.
- **How ChatGPT and Claude present skills to consumers.** From guides, not vendor help pages.
- **Onboarding timings and sign-up-wall effects.** No measurements found. The conversion figures circulating in vendor blogs have no visible source and are not used.
- **Trustpilot reviews.** Not fact-checked by Trustpilot; each is one person's account. Polsia's score rose from 1.8 (79 reviews, Aug 17) to 3.5 (484 reviews, Nov 15) and I do not know why.
- **Delaware.** The Ars Technica piece that circulated in the window could not be fetched; details are from other coverage.
- **US state laws on AI disclosure (for example Connecticut's, reported effective Oct 1) and agent pricing laws.** Seen only on one commentary site. Not relied on.
- **X API prices and automation rules.** From vendor blogs summarizing X's documents; not read first-hand.
- **EU AI Act timing.** Provisional agreement reported; formal adoption not confirmed.
- **Email and social policy.** "No change in the window" means I found none, not that none occurred.
- **The Bluehost survey and the 400,000-email incident.** Cited through the Fortune essay, whose author discloses a commercial stake.
- **Headline-only items.** The Reuters piece on Amazon and the NIST guide were not read, only their titles and discussion threads.
