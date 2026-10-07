/** Blueprints for channel-engine craft skills (BUILD §11.7 table). */
import { bp, type BlueprintSet, CHECK, TOOLS } from "./_types";

export const CHANNEL_BLUEPRINTS: BlueprintSet = {
  icp_definition: [
    bp(
      "Define the ICP for {business}",
      "Write the ideal customer profile for {business} ({product}, {price}, {market}): firmographics or demographics, roles, trigger signals that can be sourced from mock data tools, exclusions, and the lawful basis per country for outreach.",
      [
        "Profile is specific and sourceable (fields a data tool can filter on).",
        "Trigger signals are observable, not wishes.",
        "Exclusions and lawful basis per country stated; EU/UK consumers excluded from cold email.",
      ],
    ),
    bp(
      "Narrow a vague ICP at {business}",
      "{founder} says {business}'s ICP is 'anyone who needs {product}'. Using {metric} and the fixture of the 20 best current {customer}, derive a narrow ICP and explain which current customers it would have excluded and why that is fine.",
      [
        "Derives patterns from the fixture (size, role, trigger).",
        "Explains trade-off of narrowing honestly.",
        "Produces a filterable profile.",
      ],
      { fixtures: { customers: "fixtures/crm/best_customers_{business}.json" } },
    ),
    bp(
      "Two ICPs or one for {business}",
      "{business} sells to two apparently different groups. Decide whether to run one ICP or two for sourcing, give the criteria you used (sourcing cost, message fit, conversion data), and the test to settle it in 4 weeks.",
      [
        "Decision is reasoned with explicit criteria.",
        "Proposes a measurable test.",
        "Keeps compliance constraints per segment.",
      ],
    ),
  ],
  lead_sourcing: [
    bp(
      "Source a batch for {business}",
      "Using the mock Apollo/PDL/Hunter tools, source 50 contacts matching {business}'s ICP (fixture). Enrich, verify emails, record lawful basis and source on each, and report counts: found, enriched, verified, excluded (and why).",
      [
        "Counts reconcile; exclusions explained (suppression, unverifiable, wrong country basis).",
        "Each contact has source and lawful basis.",
        "No EU/UK consumer contacts for cold email.",
      ],
      { mockTools: ["apollo.mock.people.search", "people_data_labs.mock.enrich", "hunter.mock.verify", "platform.suppression.check", "platform.crm.entities.create"], fixtures: { icp: "fixtures/channels/icp_{business}.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Enrichment rules at {business}",
      "A sourced contact for {business} already exists in the CRM with a founder-entered title. The enrichment tool returns a different title and a phone number. Say what you write, what you leave, and how you record provenance.",
      [
        "Fills empty fields only; does not overwrite founder data.",
        "Records provenance per field.",
        "Flags the conflict for review if material.",
      ],
      { mockTools: TOOLS.crm },
    ),
    bp(
      "Bounce spike at {business}",
      "Verification for {business}'s latest segment shows 4.2% predicted bounce. State the rule you apply, what you pause, how you fix the segment, and what you report.",
      [
        "Applies the bounce threshold and pauses the segment.",
        "Proposes a fix (re-verify, drop catch-alls).",
        "Report is factual with counts.",
      ],
    ),
  ],
  lead_scoring: [
    bp(
      "Score leads for {business}",
      "Score the fixture leads (30) for {business} 1-20 with reasons: ICP fit, trigger signals, engagement, data quality. Show the weights, the top 10, and what you would exclude.",
      [
        "Weights explicit; scores consistent with them.",
        "Reasons specific per lead.",
        "Excludes poor data or suppressed records.",
      ],
      { fixtures: { leads: "fixtures/channels/leads_{business}.json" } },
    ),
    bp(
      "Calibrate scores to outcomes at {business}",
      "Fixture: 120 leads with scores and outcomes (replied, converted). Evaluate {business}'s scoring: does a higher score predict conversion? Propose weight changes with evidence.",
      [
        "Evaluates predictive power with simple numbers (conversion by score band).",
        "Proposes evidence-based weight changes.",
        "Avoids overfitting to small counts.",
      ],
      { fixtures: { outcomes: "fixtures/channels/lead_outcomes.json" } },
    ),
    bp(
      "Explain a score to the founder at {business}",
      "{founder} asks why {entity} scored 9 at {business}. Give the breakdown by factor with the data points used and what would raise it.",
      [
        "Breakdown ties to the scoring weights.",
        "Data points cited.",
        "Clear path to a higher score.",
      ],
    ),
  ],
  marketing_compliance: [
    bp(
      "Pre-send check for {business}",
      "Before {business} sends a marketing sequence to the fixture list (mixed countries, some consumers, some suppressed), produce the pre-send report: lawful basis per recipient group, who is excluded and why, required footer elements, send-window rules.",
      [
        "Correctly excludes suppressed and EU/UK consumers without consent.",
        "Lists unsubscribe, sender identity and address requirements.",
        "States lawful basis per group.",
      ],
      { fixtures: { list: "fixtures/channels/send_list_mixed.json" }, mockTools: TOOLS.email, checks: [CHECK.policy()] },
    ),
    bp(
      "SMS consent at {business}",
      "{business} wants to text US {customer} appointment reminders and promotions. Explain the consent requirements for each message type, what you need recorded, and what you refuse to send.",
      [
        "Distinguishes transactional from promotional; prior express consent for automated promotional SMS.",
        "Specifies consent records.",
        "Refuses sends without consent.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Unsubscribe handling at {business}",
      "A {customer} replied 'stop emailing me' to a {business} sequence but also has an active account with transactional emails. Say what you suppress, what continues, and how fast.",
      [
        "Suppresses marketing immediately; transactional continues.",
        "Updates the suppression list and records the request.",
        "Timing meets one-click/prompt processing expectations.",
      ],
      { mockTools: TOOLS.email, checks: [CHECK.policy()] },
    ),
  ],
  copywriting: [
    bp(
      "Lifecycle email for {business}",
      "Write the first activation email for {business} to a {customer} who signed up 2 days ago and has not used {product}. Subject, 90-140 words, one call to action, claims only from the brief (fixture), footer elements listed.",
      [
        "Leads with the reader's problem; one clear call to action.",
        "No claims beyond the brief; no invented social proof.",
        "Length and footer requirements met.",
      ],
      { fixtures: { brief: "fixtures/brief/{business}.md" }, checks: [CHECK.words(80, 180), CHECK.none("guarantee", "100%", "best in class")] },
    ),
    bp(
      "Landing page hero for {business}",
      "Write the hero for {business}'s landing page for {customer} in {market}: headline (≤ 10 words), subhead (≤ 25 words), CTA label, and the proof line using only {metric}. Then list three claims you deliberately avoided.",
      [
        "Headline is specific to the customer and outcome.",
        "Proof uses only the given metric.",
        "Avoided claims listed and sensible.",
      ],
    ),
    bp(
      "Rewrite hype into fact at {business}",
      "Rewrite this draft for {business} without hype or invented urgency: 'Revolutionary {product} loved by thousands — only 5 spots left this week!' Keep it persuasive and truthful with the available facts ({metric}).",
      [
        "Removes invented urgency and unverifiable claims.",
        "Stays persuasive using real facts.",
        "Short and specific.",
      ],
      { checks: [CHECK.none("only 5 spots", "revolutionary", "thousands")] },
    ),
  ],
  personalisation: [
    bp(
      "Personalise from CRM fields at {business}",
      "Personalise {business}'s outreach for 5 fixture contacts using only CRM fields (role, company, trigger signal, last interaction). Show each merge field used and what you do when a field is empty.",
      [
        "Uses only real fields; no invented details.",
        "Empty-field fallback is graceful and truthful.",
        "Personalisation is relevant, not decorative.",
      ],
      { fixtures: { contacts: "fixtures/crm/contacts_{business}.json" } },
    ),
    bp(
      "Segment-level vs individual at {business}",
      "Decide for {business}'s 1,200-recipient broadcast which elements are personalised individually and which per segment; justify by data availability and risk of errors.",
      [
        "Sensible split with reasons.",
        "Error-risk considered (wrong names).",
        "Keeps compliance footers constant.",
      ],
    ),
    bp(
      "Avoid creepy personalisation at {business}",
      "A proposal for {business} would mention a {customer}'s recent website visits and company funding in the first email. Decide what is appropriate, what is not, and why, under {regulator}.",
      [
        "Rejects behavioural details the recipient would not expect; allows public professional context.",
        "References the regulation's transparency expectations.",
        "Proposes an appropriate version.",
      ],
    ),
  ],
  segmentation: [
    bp(
      "Define segments for {business}",
      "Define the lifecycle segments for {business}'s email engine (signup→activation→payment→retention→win-back) with entry/exit rules on real events, consent requirement per segment, and the one message per segment.",
      [
        "Rules are event-based and mutually exclusive where needed.",
        "Consent requirement stated per segment.",
        "Messages match segment goals.",
      ],
    ),
    bp(
      "Segment size sanity at {business}",
      "Fixture: {business}'s segments by size and conversion. One segment has 9 people and a 44% rate; another 3,000 and 1%. Recommend where effort goes and how you avoid over-reading the small segment.",
      [
        "Handles small-sample noise correctly.",
        "Effort allocation reasoned.",
        "Proposes a test.",
      ],
      { fixtures: { segments: "fixtures/channels/segments_{business}.json" } },
    ),
    bp(
      "Exclusion segments at {business}",
      "List the exclusion segments {business} must apply to every marketing send and the data source for each (suppressed, unsubscribed, bounced, no consent, open complaints, employees).",
      [
        "All standard exclusions listed with sources.",
        "Order of application clear.",
        "Nothing marketing-related to excluded groups.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  deliverability: [
    bp(
      "Set up sending for {business}",
      "Plan {business}'s sending setup: subdomain, SPF/DKIM/DMARC, warm-up schedule for 4 weeks, list hygiene, spam-rate monitoring with the 0.3% auto-pause, and what you report weekly.",
      [
        "Authentication and subdomain correct; warm-up schedule realistic.",
        "Auto-pause rule implemented at 0.3%.",
        "Weekly metrics defined.",
      ],
    ),
    bp(
      "Spam-rate breach at {business}",
      "{business}'s spam rate hit 0.41% yesterday. State what happens automatically, what you investigate (fixture stats), and the Inbox warning with options to resume.",
      [
        "Engine pauses automatically; founder decides resume.",
        "Investigation uses the fixture stats (segment, content, list source).",
        "Warning with options and record ids.",
      ],
      { fixtures: { stats: "fixtures/channels/sendgrid_stats.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Diagnose low inbox placement at {business}",
      "Open rates for {business} dropped 30% with no content change. Using fixture stats, diagnose likely causes (authentication, list source, volume jump, complaints) and the fix order.",
      [
        "Diagnosis matches the fixture evidence.",
        "Fix order is sensible.",
        "Avoids tricks (misleading subject lines).",
      ],
      { fixtures: { stats: "fixtures/channels/sendgrid_stats.json" } },
    ),
  ],
  reply_handling: [
    bp(
      "Classify and draft replies for {business}",
      "For the fixture inbound replies (8) to {business}'s sequence, classify each (positive, objection, not now, unsubscribe, out of office, other) and draft the reply where appropriate, noting which require approval before sending and which must never get a reply.",
      [
        "Classifications are correct; unsubscribes are suppressed, not replied to with marketing.",
        "Drafts are factual and say they are on behalf of the business.",
        "Approval needs identified correctly.",
      ],
      { fixtures: { replies: "fixtures/channels/replies_{business}.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Handle a pricing objection at {business}",
      "A {customer} replies to {business}: 'Too expensive compared to {competitor}.' Draft the reply using only facts from the brief and the public comparison fixture; no invented discounts or urgency; propose the next step.",
      [
        "Uses sourced facts; no invented discounts or competitor claims.",
        "Proposes a concrete next step.",
        "Flags any discount as a founder decision.",
      ],
      { fixtures: { comparison: "fixtures/research/comparison_{competitor}.json" }, checks: [CHECK.cites()] },
    ),
    bp(
      "Reply that needs a human at {business}",
      "A reply to {business} asks for a signed data-processing agreement and a call with the founder this week. Say what you draft, what you do not commit to, and how you route it.",
      [
        "Does not commit to signing; routes DPA to legal and the founder.",
        "Draft acknowledges and proposes scheduling via approved tool.",
        "Records the interaction.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  keyword_research: [
    bp(
      "Cluster keywords for {business}",
      "From the fixture keyword export for {business} ({keyword} and related), cluster by intent (informational, commercial, transactional), estimate volume and difficulty (label Estimate), and pick 3 clusters with signup intent to brief first.",
      [
        "Clusters are coherent by intent.",
        "Volumes and difficulty labelled Estimate with source.",
        "Picks clusters with signup intent and achievable difficulty.",
      ],
      { fixtures: { keywords: "fixtures/seo/keywords_{business}.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Avoid vanity keywords at {business}",
      "{founder} wants {business} to rank for a broad head term with huge volume. Explain with numbers why a long-tail cluster around {keyword} is a better first target and what the head term would cost.",
      [
        "Numbers support the argument (difficulty, intent, conversion).",
        "Respectful of the founder's goal with a path to it later.",
        "Estimates labelled.",
      ],
    ),
    bp(
      "Localise keywords for {business}",
      "{business} targets {market}. Using the fixture, identify language and locale variants of {keyword}, which search engines matter, and how you avoid machine-translated junk pages.",
      [
        "Identifies real locale variants and engines.",
        "Rejects doorway/translated junk explicitly.",
        "Proposes a localisation approach.",
      ],
      { fixtures: { keywords: "fixtures/seo/keywords_{business}.json" } },
    ),
  ],
  technical_seo: [
    bp(
      "Audit and fix for {business}",
      "Run the fixture audit for {business}'s site: list issues (canonicals, redirects, LCP, structured data errors, broken links) by impact, then open the PRs for the two highest-impact fixes with the before/after measurement.",
      [
        "Issues ranked by impact with evidence.",
        "Two PRs with correct, minimal fixes and measurements.",
        "No changes outside the merge flow.",
      ],
      { fixtures: { audit: "fixtures/seo/audit_{business}.json", repo: "fixtures/repos/marketing-site" }, mockTools: TOOLS.sandbox },
    ),
    bp(
      "Indexing problem at {business}",
      "Search Console (fixture) shows 60% of {business}'s product pages 'Discovered – currently not indexed'. Diagnose causes and the fix order.",
      [
        "Realistic causes (thin content, crawl budget, internal links, duplicates).",
        "Fix order reasoned.",
        "Measurement plan.",
      ],
      { fixtures: { gsc: "fixtures/seo/gsc_{business}.json" } },
    ),
    bp(
      "Programmatic pages done right at {business}",
      "{business} wants 400 programmatic pages for '{keyword} in [city]'. Set the rules that keep them out of doorway-page territory: unique data per page, thresholds for publishing, noindex rules, internal links.",
      [
        "Rules ensure distinct, useful content per page.",
        "Publishing thresholds and noindex rules defined.",
        "Explicitly avoids doorway pages.",
      ],
    ),
  ],
  content_briefs: [
    bp(
      "Brief an article for {business}",
      "Write the content brief for {business} on '{keyword}': target query and intent, audience ({customer}), outline with H2s, must-answer questions, internal links, schema, sources to cite, word count, and what not to claim.",
      [
        "Brief is executable by a writer without further questions.",
        "Includes sources and the no-claim list.",
        "Internal links and schema specified.",
      ],
    ),
    bp(
      "Brief vs competitor content at {business}",
      "The top results for {keyword} (fixture SERP) are long guides. Write {business}'s brief that is genuinely better for {customer} rather than longer, and explain the angle.",
      [
        "Angle is specific and customer-driven.",
        "Does not simply inflate word count.",
        "Uses the SERP fixture evidence.",
      ],
      { fixtures: { serp: "fixtures/seo/serp_{keyword}.json" } },
    ),
    bp(
      "Brief for a gated asset at {business}",
      "Brief a gated guide for {business} that captures leads: value promise, outline, form fields allowed by lawful basis, follow-up sequence hook, and tracking.",
      [
        "Form fields limited by lawful basis.",
        "Follow-up hook and tracking defined.",
        "Value promise is truthful.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  internal_linking: [
    bp(
      "Plan internal links for {business}",
      "Using the fixture site map for {business}, plan internal links from the top 10 traffic pages to the 3 conversion pages: anchor text, placement, and which existing links to remove.",
      [
        "Links are relevant with descriptive anchors.",
        "Removals justified.",
        "No manipulative patterns.",
      ],
      { fixtures: { sitemap: "fixtures/seo/sitemap_{business}.json" } },
    ),
    bp(
      "Fix orphan pages at {business}",
      "The fixture crawl shows 22 orphan pages on {business}'s site. Decide for each group: link, merge, redirect or remove, with reasons.",
      [
        "Decisions are reasoned per group.",
        "Redirect/merge where content overlaps.",
        "Keeps useful pages reachable.",
      ],
      { fixtures: { crawl: "fixtures/seo/crawl_{business}.json" } },
    ),
    bp(
      "Hub and spoke for {business}",
      "Design a hub page for {business} around {keyword} with spokes from the fixture articles: structure, link pattern, and how you measure the effect.",
      [
        "Structure is coherent and useful.",
        "Link pattern bidirectional where sensible.",
        "Measurement defined.",
      ],
      { fixtures: { articles: "fixtures/seo/articles_{business}.json" } },
    ),
  ],
  structured_data: [
    bp(
      "Add schema for {business}",
      "Add schema.org markup for {business}'s organisation and product pages ({product}, {price}): types, required properties, what you must not mark up (reviews that do not exist), and the validation step.",
      [
        "Correct types and properties for what exists on the page.",
        "Explicitly excludes non-existent reviews or offers.",
        "Validation step included.",
      ],
      { checks: [CHECK.none("aggregateRating")] },
    ),
    bp(
      "Fix invalid markup at {business}",
      "The fixture validator report for {business} shows errors (missing price currency, invalid date, rating without reviews). Fix each and explain.",
      [
        "All errors fixed correctly.",
        "Rating removed if no reviews exist.",
        "Explanations accurate.",
      ],
      { fixtures: { report: "fixtures/geo/validator_report.json" } },
    ),
    bp(
      "FAQ markup honestly at {business}",
      "{business} wants FAQ markup on every page for rich results. Say when FAQ markup is appropriate, what the page must contain, and how you avoid markup that does not match visible content.",
      [
        "Appropriateness criteria clear.",
        "Visible-content rule enforced.",
        "Avoids spammy use.",
      ],
    ),
  ],
  entity_consistency: [
    bp(
      "Audit entity facts for {business}",
      "Compare {business}'s facts across the fixture surfaces (site, LinkedIn, Crunchbase, directories): name, description, founding year, founders, pricing, address. List inconsistencies and the canonical value with source.",
      [
        "Finds the planted inconsistencies.",
        "Canonical values justified by source.",
        "Fix list per surface.",
      ],
      { fixtures: { surfaces: "fixtures/geo/surfaces_{business}.json" } },
    ),
    bp(
      "Describe {business} once",
      "Write the canonical 40-word description of {business} for all surfaces and an llms.txt outline; explain what facts must appear identically everywhere.",
      [
        "Description accurate and reusable.",
        "llms.txt outline sensible.",
        "Identical-fact list correct.",
      ],
      { checks: [CHECK.words(30, 120)] },
    ),
    bp(
      "Handle a stale third-party listing at {business}",
      "A directory lists {business} with an old price and address. Say how you get it corrected within terms, what you cannot do (fake reviews, scraping), and how you track it.",
      [
        "Uses legitimate correction routes.",
        "Rejects prohibited tactics explicitly.",
        "Tracking defined.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  answer_share_analysis: [
    bp(
      "Baseline answer share for {business}",
      "Using the mock assistant panel tools, run the 20-question set for {business} across 4 assistants, compute the share of answers mentioning the business and {competitor}, label it approximate, and report by question.",
      [
        "Share computed correctly and labelled approximate.",
        "Reported per question and assistant.",
        "Competitor comparison included.",
      ],
      { mockTools: ["anthropic.mock.panel", "openai.mock.panel", "gemini.mock.panel", "perplexity.mock.panel"], checks: [CHECK.all("approximate")] },
    ),
    bp(
      "Interpret a share move at {business}",
      "Answer share for {business} moved from 5% to 12% after two content pieces. Say what you can and cannot conclude, and how you would strengthen the inference.",
      [
        "Acknowledges noise and confounders.",
        "Proposes a stronger design (holdout questions, repeated runs).",
        "No market-share language.",
      ],
      { checks: [CHECK.none("market share")] },
    ),
    bp(
      "Question set design for {business}",
      "Design the 20-question set for {business}'s answer-share panels: the questions {customer} actually ask, variants, and the ones you exclude as too branded.",
      [
        "Questions are realistic customer questions.",
        "Variants cover phrasing.",
        "Branded questions excluded with reason.",
      ],
    ),
  ],
  citation_earning: [
    bp(
      "Earn citations for {business}",
      "Propose three content pieces for {business} that assistants and journalists would cite: original data from {business}'s own metrics ({metric}), a definitive explainer on {keyword}, a comparison. For each: why it is citable, what data it needs, and what you must not do.",
      [
        "Pieces are genuinely citable with original value.",
        "Data needs are real and available.",
        "Excludes fake reviews, seeded posts.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Decline a shortcut at {business}",
      "A vendor offers {business} 'guaranteed mentions in AI answers via forum seeding'. Evaluate and respond.",
      [
        "Rejects sock-puppet seeding with the rule cited.",
        "Explains the risk.",
        "Offers the legitimate alternative.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Measure citations for {business}",
      "Define how {business} measures earned citations: sources (assistant answers, backlinks, mentions), frequency, labels (approximate), and the report format.",
      [
        "Sources and frequency defined.",
        "Labels present.",
        "Report format concise.",
      ],
    ),
  ],
  editorial_planning: [
    bp(
      "Quarterly calendar for {business}",
      "Build a 12-week content calendar for {business} with a budget for one article and one short video per week: topics from the fixture keyword clusters and customer questions, format, owner, dependencies (approvals for founder byline), and distribution.",
      [
        "Calendar fits the budget and alternates formats.",
        "Topics tied to clusters/questions.",
        "Approval dependencies marked.",
      ],
      { fixtures: { keywords: "fixtures/seo/keywords_{business}.json" } },
    ),
    bp(
      "Respond to a roadmap change at {business}",
      "The Product lead at {business} moved a feature launch two weeks earlier. Re-plan the calendar: what moves, what you cut, and how you keep weekly cadence.",
      [
        "Adjustments are specific and keep cadence.",
        "Cuts are justified.",
        "Launch content aligned with the new date.",
      ],
    ),
    bp(
      "Repurpose plan at {business}",
      "The best-performing guide at {business} got 3x the leads of others. Plan five repurposed assets from it with format, effort and expected use.",
      [
        "Repurposing is realistic and varied.",
        "Effort estimates labelled.",
        "Expected use is specific.",
      ],
      { checks: [CHECK.all("Estimate")] },
    ),
  ],
  brand_voice: [
    bp(
      "Voice guide for {business}",
      "Write the voice guide for {business} ({customer}, {market}) from the brief fixture: 5 principles with do/don't examples, glossary terms to use, words to avoid, and how AI involvement is disclosed.",
      [
        "Principles are specific with paired examples.",
        "Glossary and avoid-list present.",
        "Disclosure rule included.",
      ],
      { fixtures: { brief: "fixtures/brief/{business}.md" } },
    ),
    bp(
      "Fix off-brand copy at {business}",
      "Rewrite the fixture social post for {business} that is off-voice (slang, hype, wrong glossary) into the brand voice; list each change.",
      [
        "Rewrite matches the guide.",
        "Changes listed and justified.",
        "No invented claims.",
      ],
      { fixtures: { post: "fixtures/content/off_brand_post.md" } },
    ),
    bp(
      "Voice across formats at {business}",
      "Show how {business}'s voice adapts to an email, a LinkedIn post and a podcast intro without losing identity. One example each, under 60 words.",
      [
        "Examples share identity while fitting the format.",
        "Each under 60 words.",
        "Glossary used.",
      ],
    ),
  ],
  asset_production: [
    bp(
      "Produce a newsletter issue for {business}",
      "Produce {business}'s newsletter issue from the fixture notes: subject, 350-500 words, sections, one sourced number ({metric}), CTA, footer elements, and the production checklist (links tested, alt text, unsubscribe).",
      [
        "Meets structure and length; number sourced.",
        "Checklist complete.",
        "No invented facts.",
      ],
      { fixtures: { notes: "fixtures/content/newsletter_notes_{business}.md" }, checks: [CHECK.words(300, 600)] },
    ),
    bp(
      "Script and produce a short video at {business}",
      "Write a 45-second script for {business} on {product}, specify the synthetic voice and licence record, the on-screen labelling for AI-generated media where required in {market}, and the approval step.",
      [
        "Script is tight and factual.",
        "Voice licence and labelling addressed.",
        "Approval step present.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Gated asset production at {business}",
      "Produce the outline and production plan for a 12-page guide for {business}: sections, sources, design handoff, form fields (lawful basis), file hosting and tracking.",
      [
        "Outline is substantive with sources.",
        "Form fields limited by lawful basis.",
        "Tracking defined.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  community_management: [
    bp(
      "Reply to comments for {business}",
      "Reply to the fixture comments (10) on {business}'s posts: factual answers with sources, polite handling of criticism, what you escalate (refund request, legal threat, personal data), and what you never promise.",
      [
        "Replies are factual and polite; criticism handled without defensiveness.",
        "Escalations correct.",
        "No commitments or discounts promised.",
      ],
      { fixtures: { comments: "fixtures/social/comments_{business}.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "DM triage at {business}",
      "Triage the fixture DMs (8) to {business}: leads to CRM with lawful basis, support to the right route, spam ignored, anything asking for payment links or personal data to a human.",
      [
        "Routing correct per DM.",
        "CRM entries carry source and lawful basis.",
        "Payment/data requests go to a human.",
      ],
      { fixtures: { dms: "fixtures/social/dms_{business}.json" }, mockTools: TOOLS.crm, checks: [CHECK.policy()] },
    ),
    bp(
      "Handle a public complaint at {business}",
      "A {customer} publicly complains that {product} arrived damaged. Draft the public reply and the private follow-up, state what you can offer without approval, and what you record.",
      [
        "Public reply is brief, empathetic, moves to private.",
        "No refund promised without approval.",
        "Interaction recorded.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  platform_fluency: [
    bp(
      "Adapt one message to four platforms for {business}",
      "Adapt {business}'s announcement to LinkedIn, Instagram, X and TikTok: format, length limits, hashtags/alt text, posting windows for {market}, and platform rules you must follow (brand accounts only, rate limits).",
      [
        "Each version respects the platform's format and limits.",
        "Posting windows sensible for the market.",
        "Platform rules stated.",
      ],
    ),
    bp(
      "Automation terms check at {business}",
      "For each platform {business} uses, state whether automated posting is allowed for the account type (fixture terms summary), and switch to offline tracking where it is not.",
      [
        "Decisions follow the fixture terms.",
        "Offline tracking applied correctly.",
        "No evasion suggested.",
      ],
      { fixtures: { terms: "fixtures/social/platform_terms.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Read platform insights for {business}",
      "Using the fixture insights, say which formats and times performed for {business}, what is noise, and the two changes for next week.",
      [
        "Reads the data correctly and avoids over-reading small numbers.",
        "Changes are specific.",
        "Attribution to clicks noted.",
      ],
      { fixtures: { insights: "fixtures/social/insights_{business}.json" } },
    ),
  ],
  audience_targeting: [
    bp(
      "Build audiences for {business}",
      "Define three paid audiences for {business} ({customer}, {market}): targeting parameters per platform, exclusions (existing customers, suppressed), size estimates (Estimate), and a check that no special-category targeting is used.",
      [
        "Parameters realistic per platform; exclusions applied.",
        "No special categories.",
        "Sizes labelled Estimate.",
      ],
      { checks: [CHECK.all("Estimate"), CHECK.policy()] },
    ),
    bp(
      "Refuse a risky audience at {business}",
      "{founder} suggests targeting by health condition for {business}'s {product}. Explain why not under ad policy and {regulator}, and propose a compliant alternative.",
      [
        "Rejects special-category targeting with the rule.",
        "Alternative is compliant and effective.",
        "Respectful tone.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Direct-mail audience at {business}",
      "Select a direct-mail audience of 1,000 from {business}'s CRM fixture: lawful basis, suppression and do-not-mail checks, address verification, and the response code scheme.",
      [
        "Checks applied in order with counts.",
        "Lawful basis stated.",
        "Response codes unique.",
      ],
      { fixtures: { crm: "fixtures/crm/contacts_{business}.json" }, checks: [CHECK.policy()] },
    ),
  ],
  creative_testing: [
    bp(
      "Variant set for {business}",
      "Create 4 ad variants for {business} ({product}, {customer}): hook, body, CTA, with every claim traced to a source id; define the winner rule (metric, minimum conversions, duration).",
      [
        "Variants differ meaningfully; claims sourced.",
        "Winner rule is numeric and sound.",
        "No invented social proof.",
      ],
      { checks: [CHECK.cites()] },
    ),
    bp(
      "Read a creative test at {business}",
      "Fixture results: 4 variants, 2 weeks. Decide winners/losers, what to scale, what to retire, and what the small sample does not tell you.",
      [
        "Decisions follow the data with sample caveats.",
        "Scaling plan concrete.",
        "Honest about uncertainty.",
      ],
      { fixtures: { results: "fixtures/ads/creative_results.json" } },
    ),
    bp(
      "Policy pre-check creatives at {business}",
      "Pre-check the fixture creatives for {business} against ad policy: prohibited claims, before/after imagery, special categories, missing disclosures. List failures and fixes.",
      [
        "Finds the planted violations.",
        "Fixes compliant.",
        "No false positives.",
      ],
      { fixtures: { creatives: "fixtures/ads/creatives_{business}.json" }, checks: [CHECK.policy()] },
    ),
  ],
  bid_pacing: [
    bp(
      "Pace a month for {business}",
      "{business} has {currency} 1,500 for paid ads this month across 3 campaigns. Set daily and lifetime caps, pacing rules, the CPA kill-switch (cap and 48-hour rule), and the weekly reallocation rule.",
      [
        "Caps sum within budget; pacing rules concrete.",
        "Kill-switch defined correctly.",
        "Reallocation rule based on CPA.",
      ],
    ),
    bp(
      "Overspend risk at {business}",
      "A campaign for {business} spent 60% of its lifetime budget in 3 days with CPA at cap. Decide and act: pause, reduce, or continue; justify with numbers; write the report.",
      [
        "Decision is proportionate and numeric.",
        "Action within authority; report factual.",
        "Stays within caps.",
      ],
      { mockTools: TOOLS.ads },
    ),
    bp(
      "Shift budget to a winner at {business}",
      "Fixture: campaign A CPA {currency} 98 (14 conversions), B {currency} 212 (3 conversions, 52 hours over cap). Apply the rules, move budget, and state what you do not conclude from 3 conversions.",
      [
        "Pauses B per the 48-hour rule; shifts budget to A.",
        "Avoids over-reading B's small sample.",
        "Report with ids.",
      ],
      { fixtures: { results: "fixtures/ads/campaign_results.json" }, mockTools: TOOLS.ads, checks: [CHECK.policy()] },
    ),
  ],
  conversion_tracking: [
    bp(
      "Set up server-side conversions for {business}",
      "Design conversion tracking for {business}: events (signup, activation, payment), server-side API per platform, deduplication with client events, consent handling under {regulator}, and the end-to-end verification test.",
      [
        "Events and server-side flow correct; dedup handled.",
        "Consent respected.",
        "Verification test specified.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Missing conversions at {business}",
      "The platform shows 40% fewer conversions than {business}'s database for last week. Diagnose using the fixture (consent rates, dedup keys, timing) and propose fixes.",
      [
        "Diagnosis uses the fixture evidence.",
        "Fixes are concrete.",
        "Does not inflate counts to match.",
      ],
      { fixtures: { tracking: "fixtures/ads/tracking_gap.json" } },
    ),
    bp(
      "Offline attribution codes for {business}",
      "{business} runs a print ad and a direct-mail batch. Design the codes and vanity URLs so the Customer Update attributes touches correctly; describe the redemption flow and the report.",
      [
        "Codes unique per campaign/recipient as appropriate.",
        "Redemption flow ties to journeys.",
        "Report defined.",
      ],
    ),
  ],
  ad_policy_compliance: [
    bp(
      "Pre-check a campaign for {business}",
      "Pre-check {business}'s fixture campaign (audiences, creatives, landing page) against platform ad policy: special categories, prohibited claims, landing page requirements, disclosures. Return pass/fail per item with fixes.",
      [
        "Finds planted issues; passes compliant items.",
        "Fixes specific.",
        "No special-category targeting slips through.",
      ],
      { fixtures: { campaign: "fixtures/ads/campaign_{business}.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Regulated category at {business}",
      "{business}'s {product} is in a category with extra ad rules in {market} (fixture summary). Explain the constraints and how the campaign complies, or why it cannot run.",
      [
        "Constraints correctly applied from the fixture.",
        "Compliance plan or honest 'cannot run'.",
        "No workaround that evades rules.",
      ],
      { fixtures: { rules: "fixtures/ads/category_rules_{market}.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Disapproved ad at {business}",
      "A {business} ad was disapproved for 'misleading claims'. Identify the claim from the fixture, fix it with a sourced version, and explain the appeal/resubmit path.",
      [
        "Identifies the claim correctly.",
        "Fix is sourced and compliant.",
        "Path described without evasion.",
      ],
      { fixtures: { ad: "fixtures/ads/disapproved_ad.json" }, checks: [CHECK.cites()] },
    ),
  ],
  creator_vetting: [
    bp(
      "Vet a shortlist for {business}",
      "Vet 6 fixture creators for {business} ({customer}): audience authenticity signals, engagement quality, brand-safety history, past undisclosed promotions, audience geography vs {market}. Rank and exclude with reasons.",
      [
        "Excludes creators with authenticity or disclosure problems with evidence.",
        "Ranking considers fit and geography.",
        "Reasons recorded per creator.",
      ],
      { fixtures: { creators: "fixtures/influencer/creators_{business}.json" } },
    ),
    bp(
      "Spot purchased followers at {business}",
      "A creator proposed to {business} has 120k followers and 0.3% engagement with comment patterns in the fixture. Assess and decide.",
      [
        "Identifies the red flags correctly.",
        "Decision justified.",
        "Suggests how to verify further.",
      ],
      { fixtures: { creator: "fixtures/influencer/creator_suspicious.json" } },
    ),
    bp(
      "Brand-safety policy for {business}",
      "Write {business}'s creator brand-safety checklist: content categories excluded, disclosure history check, conflicts with {competitor}, and what triggers a re-vet.",
      [
        "Checklist is concrete and relevant.",
        "Re-vet triggers defined.",
        "Disclosure history included.",
      ],
    ),
  ],
  outreach: [
    bp(
      "Write outreach for {business}",
      "Write the first outreach to a vetted creator for {business}: who we are (on behalf of the business), why them (specific fixture facts), the offer structure (no fee committed), disclosure requirement, next step. Under 150 words.",
      [
        "Discloses the business; specific to the creator.",
        "No fee committed; disclosure requirement stated.",
        "Under 150 words.",
      ],
      { fixtures: { creator: "fixtures/influencer/creator_a.json" }, checks: [CHECK.words(60, 170), CHECK.policy()] },
    ),
    bp(
      "Follow-up cadence at {business}",
      "Define {business}'s outreach follow-up cadence to creators and journalists: number, spacing, when to stop, and how consent and suppression apply to professional contacts.",
      [
        "Cadence is respectful and bounded.",
        "Stop rules clear.",
        "Compliance applied.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Decline tactics at {business}",
      "A playbook suggests {business} pretend to be a fan when first DMing creators. Explain why not and write the honest version.",
      [
        "Rejects impersonation with the rule.",
        "Honest version is effective.",
        "Discloses the business.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  brief_writing: [
    bp(
      "Creator brief for {business}",
      "Write the creator brief for {business}'s {product}: goals, key messages (sourced), do/don't list, mandatory disclosure wording for {market}, deliverables, timeline, approval step, code/link for attribution.",
      [
        "Messages sourced; disclosure wording mandatory.",
        "Deliverables and timeline specific.",
        "Attribution included.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Production brief for {business}",
      "Brief a 60-second product video for {business}: objective, audience, script outline, shots, claims allowed, labelling for synthetic media, deliverable specs per platform.",
      [
        "Complete and executable.",
        "Claims limited to sourced facts.",
        "Labelling addressed.",
      ],
    ),
    bp(
      "Fix a vague brief at {business}",
      "Rewrite the fixture brief for {business} that says 'make something fun about our product' into a complete brief.",
      [
        "Adds objective, audience, messages, constraints, deliverables.",
        "Keeps the creative freedom appropriate.",
        "Disclosure present.",
      ],
      { fixtures: { brief: "fixtures/influencer/vague_brief.md" } },
    ),
  ],
  disclosure_compliance: [
    bp(
      "Verify disclosure before payout at {business}",
      "Three creator posts for {business} are live (fixture screenshots/metadata). Verify disclosure per {market} rules, decide which payouts can be requested, and write the message for the non-compliant one.",
      [
        "Correctly identifies missing or hidden disclosure.",
        "Withholds payout request where non-compliant.",
        "Message is clear and specific.",
      ],
      { fixtures: { posts: "fixtures/influencer/live_posts.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Disclosure rules by market at {business}",
      "Summarise disclosure requirements for creator content in {market} (fixture guidance): wording, placement, platform labels, and what counts as hidden.",
      [
        "Accurate to the fixture guidance.",
        "Placement and visibility rules clear.",
        "Platform label usage included.",
      ],
      { fixtures: { guidance: "fixtures/influencer/disclosure_{market}.json" } },
    ),
    bp(
      "Affiliate disclosure at {business}",
      "An affiliate for {business} publishes reviews without disclosing commissions. Decide the action: notify, pause, terminate; and the policy clause.",
      [
        "Proportionate action with the clause.",
        "Pause until fixed.",
        "Records the decision.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  programme_design: [
    bp(
      "Design the affiliate programme for {business}",
      "Design {business}'s affiliate programme from the margin model fixture: commission type and rate, caps per partner and month, cookie window, exclusions (coupon leaks, self-referrals), payout schedule (founder-approved), terms outline.",
      [
        "Commission fits the margin; caps defined.",
        "Exclusions and payout approval present.",
        "Terms outline complete.",
      ],
      { fixtures: { margins: "fixtures/finance/{business}_unit_costs.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Tiering for {business}",
      "Propose partner tiers for {business} based on fixture performance: thresholds, benefits, and how you avoid incentivising fraud.",
      [
        "Tiers are data-based.",
        "Benefits sensible.",
        "Anti-fraud considered.",
      ],
      { fixtures: { partners: "fixtures/affiliate/partners_{business}.json" } },
    ),
    bp(
      "Programme vs referral at {business}",
      "Should {business} run an affiliate programme or a customer referral programme first? Decide with the evidence given ({metric}, {price}) and outline the chosen one.",
      [
        "Decision reasoned on economics.",
        "Outline concrete.",
        "Risks noted.",
      ],
    ),
  ],
  partner_recruitment: [
    bp(
      "Recruit partners for {business}",
      "From the fixture candidate list, pick 10 partners for {business} whose audience matches {customer}; give the reason, the invite draft (on behalf of the business), and what you record in the CRM.",
      [
        "Selections justified by audience fit.",
        "Invite discloses the business; no exaggerated earnings.",
        "CRM records defined.",
      ],
      { fixtures: { candidates: "fixtures/affiliate/candidates_{business}.json" }, mockTools: TOOLS.crm, checks: [CHECK.policy()] },
    ),
    bp(
      "Earnings claims at {business}",
      "A draft recruitment page for {business} says 'earn thousands monthly'. Rewrite the earnings statement truthfully from fixture payout data and explain the rule.",
      [
        "Uses real payout data with ranges and labels.",
        "Explains honesty rule.",
        "Keeps appeal.",
      ],
      { fixtures: { payouts: "fixtures/affiliate/payouts_{business}.json" } },
    ),
    bp(
      "Partner fit screening at {business}",
      "Write {business}'s partner acceptance criteria: audience, content quality, disclosure, no coupon sites unless approved, geography.",
      [
        "Criteria are clear and enforceable.",
        "Coupon-site rule present.",
        "Disclosure requirement included.",
      ],
    ),
  ],
  fraud_detection: [
    bp(
      "Review a week of commissions for {business}",
      "Review the fixture commissions (60) for {business}: flag self-referrals, coupon leaks, refunded orders, click-stuffing, abnormal conversion rates. Give holds with evidence and the clean list for the payout batch (founder approval).",
      [
        "Finds the planted fraud patterns with evidence.",
        "Clean list correct.",
        "Payout batch is a founder approval.",
      ],
      { fixtures: { commissions: "fixtures/affiliate/commissions_week.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Explain a hold at {business}",
      "A partner disputes {business}'s hold on 29 commissions. Write the explanation with evidence, what would release them, and the tone to keep the relationship.",
      [
        "Evidence-based and specific.",
        "Release conditions clear.",
        "Tone professional.",
      ],
    ),
    bp(
      "Fraud rules for {business}",
      "Define {business}'s automated fraud rules: thresholds, evidence required, hold duration, and who releases.",
      [
        "Rules are concrete and proportionate.",
        "Evidence and release path defined.",
        "Founder releases money-related holds.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  commission_modelling: [
    bp(
      "Model payouts for {business}",
      "Model next month's affiliate payouts for {business} from fixture revenue, refund rate and commission rates; show refund-adjusted payouts per partner, caps applied, and the margin impact (Estimate).",
      [
        "Refund adjustment and caps applied correctly.",
        "Margin impact computed and labelled.",
        "Per-partner table.",
      ],
      { fixtures: { revenue: "fixtures/affiliate/revenue_{business}.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Rate sensitivity at {business}",
      "Show how changing {business}'s commission from 15% to 20% affects payouts and margin at current volumes and at 2x; recommend.",
      [
        "Arithmetic correct at both volumes.",
        "Recommendation reasoned against margin.",
        "Labels estimates.",
      ],
      { checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Reconcile a payout batch for {business}",
      "Reconcile the fixture payout batch against paid, non-refunded transactions for {business}; list mismatches and the corrected batch for founder approval.",
      [
        "Mismatches found with ids.",
        "Corrected batch accurate.",
        "No payout initiated by the agent.",
      ],
      { fixtures: { batch: "fixtures/affiliate/payout_batch.json" }, checks: [CHECK.policy()] },
    ),
  ],
  print_production: [
    bp(
      "Print-ready files for {business}",
      "Prepare the print spec for {business}'s mailer/ad: dimensions, bleed, safe area, colour mode, resolution, fonts outlined, code placement, file naming; check the fixture artwork and list fixes.",
      [
        "Spec correct for the format.",
        "Fixture issues found (RGB, missing bleed, low-res).",
        "Code placement visible.",
      ],
      { fixtures: { artwork: "fixtures/print/artwork_check.json" } },
    ),
    bp(
      "Supplier spec compliance at {business}",
      "{supplier}'s print spec (fixture) differs from {business}'s standard template. Adapt the file and list every change.",
      [
        "Changes match the supplier spec.",
        "List complete.",
        "Brand kit preserved.",
      ],
      { fixtures: { spec: "fixtures/print/supplier_spec.json" } },
    ),
    bp(
      "Proof approval flow for {business}",
      "Define the proof approval flow for {business}'s packaging print: who checks what (label checklist, colour, dieline), the founder's approval, and what you never approve on their behalf.",
      [
        "Checks assigned correctly.",
        "Founder approval defined.",
        "Agent does not approve print runs.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  address_hygiene: [
    bp(
      "Clean a mailing list for {business}",
      "Clean the fixture list (1,200) for {business}: verify addresses with the mock tool, remove undeliverables, apply suppression and do-not-mail registers for {market}, dedupe households, and report counts.",
      [
        "Counts reconcile at each step.",
        "Suppression and registers applied.",
        "Dedup logic sensible.",
      ],
      { fixtures: { list: "fixtures/mail/list_{business}.json" }, mockTools: ["lob.mock.addresses.verify", "platform.suppression.check"], checks: [CHECK.policy()] },
    ),
    bp(
      "Undeliverable spike at {business}",
      "A test batch for {business} returned 7% undeliverable. Apply the rule, diagnose from the fixture (source, formatting), and fix.",
      [
        "Stops the campaign per rule.",
        "Diagnosis matches fixture.",
        "Fix concrete.",
      ],
      { fixtures: { batch: "fixtures/mail/test_batch.json" } },
    ),
    bp(
      "International formats at {business}",
      "{business} mails to {market}. Explain address format differences, verification sources, and how you handle records missing postcode or region.",
      [
        "Formats correct for the market.",
        "Verification sources named.",
        "Missing-data handling defined.",
      ],
    ),
  ],
  media_research: [
    bp(
      "Shortlist media for {business}",
      "Shortlist 5 titles/stations/sites for {business} ({customer}, {market}) from the fixture media packs: audience fit, reach, rate card with source and date, format options, lead times.",
      [
        "Fit reasoned; figures sourced and dated.",
        "Formats and lead times listed.",
        "No unsourced circulation.",
      ],
      { fixtures: { packs: "fixtures/media/packs_{market}.json" }, checks: [CHECK.cites()] },
    ),
    bp(
      "Compare cost per reach at {business}",
      "Compare the fixture options for {business} on cost per thousand matched audience; show the math and label estimates.",
      [
        "Math correct and transparent.",
        "Matched audience used, not raw reach.",
        "Labelled Estimate.",
      ],
      { fixtures: { packs: "fixtures/media/packs_{market}.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Verify a media claim at {business}",
      "{publication} claims a readership that seems high for {business}'s {market}. Say how you verify (audits, ABC-type bodies, comparables) and how you report unverifiable figures.",
      [
        "Verification sources appropriate.",
        "Unverifiable figures labelled.",
        "No fabrication.",
      ],
    ),
  ],
  negotiation: [
    bp(
      "Negotiate within limits for {business}",
      "You negotiate a quote for {business} with {supplier}: list {currency} 0.52/unit, target {currency} 0.42, walk-away {currency} 0.48, max concession 5% from target. Write your opening message, the response to a counter at {currency} 0.49, and when you stop. Everything recorded; final terms are the founder's decision.",
      [
        "Stays inside target/walk-away; stops correctly at the walk-away.",
        "Messages disclose the business and are professional.",
        "Final acceptance is a founder decision; transcript recorded.",
      ],
      { mockTools: TOOLS.crm, checks: [CHECK.policy()] },
    ),
    bp(
      "Negotiate a sponsorship for {business}",
      "{business} wants the {currency} 2,500 sponsorship tier at a conference; budget authority {currency} 2,000; ask for a talk slot. Write the negotiation plan and messages; contract and deposit remain founder actions.",
      [
        "Creative trade-offs (slot, lead list) instead of only price.",
        "Stays within authority; contract/deposit to founder.",
        "Records the exchange.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Negotiation ethics at {business}",
      "A tactic suggests telling {supplier} that {business} has a competing quote 20% lower when it does not. Decide and explain; propose an honest lever.",
      [
        "Rejects the invented competing offer with the rule.",
        "Honest lever is effective.",
        "Tone professional.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  kit_preparation: [
    bp(
      "Booking kit for {business}",
      "Prepare the founder kit for a print booking with {publication} for {business}: IO draft (unsigned), artwork to spec, deadlines, contact, negotiated terms, tracking code, and the founder task text. Nothing is booked.",
      [
        "Kit is complete and the IO is unsigned.",
        "Founder task is clear.",
        "No booking API or signature by the agent.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Kit for a blocked automation at {business}",
      "A platform forbids automated posting for {business}'s account type. Prepare the kit: posts, schedule, alt text, instructions, and how results are captured afterwards.",
      [
        "Kit complete and schedule realistic.",
        "Capture of results defined.",
        "No evasion.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Incorporation kit for {business}",
      "{business} incorporates in a jurisdiction without a supervised route. Prepare the kit outline: documents, forms, fees (sourced), steps the founder performs, and what the agent never does.",
      [
        "Outline complete with sourced fees.",
        "Founder steps clear.",
        "Agent boundaries stated.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  scriptwriting: [
    bp(
      "Write a 30-second spot for {business}",
      "Write a 30-second audio script for {business} ({product}, {customer}): hook, problem, product, proof ({metric} with source), CTA with the vanity URL; word count for 30 s; no invented claims.",
      [
        "Structure complete and timed (≈75 words).",
        "Proof sourced; no invented claims.",
        "CTA with vanity URL.",
      ],
      { checks: [CHECK.words(55, 95), CHECK.cites()] },
    ),
    bp(
      "Two versions for {business}",
      "Write 15-second and 30-second versions of the same message for {business}; keep the CTA identical and explain what you cut.",
      [
        "Versions consistent; cuts explained.",
        "Timing appropriate.",
        "CTA identical.",
      ],
    ),
    bp(
      "Compliance in scripts at {business}",
      "Review the fixture script for {business}: find claims without sources, implied urgency, and missing disclosure; fix.",
      [
        "Finds all issues.",
        "Fixes are compliant.",
        "Script still works.",
      ],
      { fixtures: { script: "fixtures/broadcast/script_review.md" } },
    ),
  ],
  lift_measurement: [
    bp(
      "Design a lift test for {business}",
      "Design the geo-lift test for {business}'s campaign in {market}: test and holdout regions, duration, metric (vanity URL visits, signups), minimum detectable effect, and how you label the result Estimate.",
      [
        "Design is sound (matched regions, duration).",
        "Metric and MDE defined.",
        "Labelled Estimate.",
      ],
      { checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Read a lift result at {business}",
      "Fixture: test region +18% signups, holdout +9%, over 3 weeks. Report the lift, uncertainty and what you would conclude for budget.",
      [
        "Correct lift arithmetic.",
        "Uncertainty stated honestly.",
        "Budget conclusion proportionate.",
      ],
      { fixtures: { lift: "fixtures/broadcast/lift_result.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Attribution for offline at {business}",
      "Explain how {business} attributes an outdoor campaign: QR scans, short URLs, geo-lift, and what you cannot attribute; how the Customer Update records these touches.",
      [
        "Methods correct and combined sensibly.",
        "Unattributable portion acknowledged.",
        "Journey touch recording described.",
      ],
    ),
  ],
  creative_sizing: [
    bp(
      "Size creative for formats at {business}",
      "Adapt {business}'s key visual to the fixture formats (DOOH 1080×1920, 48-sheet, LinkedIn 1200×627, Instagram 1080×1350): safe areas, text size minimums at viewing distance, QR size and placement.",
      [
        "Dimensions and safe areas correct.",
        "Text sizes appropriate to viewing distance.",
        "QR usable.",
      ],
      { fixtures: { formats: "fixtures/outdoor/formats.json" } },
    ),
    bp(
      "Fix an unreadable design at {business}",
      "The fixture DOOH creative for {business} has 9 lines of small text. Fix it for a 3-second view: hierarchy, one message, CTA.",
      [
        "Reduces to one message with hierarchy.",
        "Readable at distance.",
        "CTA clear.",
      ],
      { fixtures: { creative: "fixtures/outdoor/creative_dense.json" } },
    ),
    bp(
      "Spec a static site creative for {business}",
      "Produce the spec for a static billboard for {business}: dimensions from the fixture site, materials, production lead time, proof process, and how the QR/short URL is tested before print.",
      [
        "Spec complete.",
        "Testing step present.",
        "Lead time realistic.",
      ],
      { fixtures: { site: "fixtures/outdoor/site_spec.json" } },
    ),
  ],
  media_relations: [
    bp(
      "Build a media list for {business}",
      "Build a 12-journalist media list for {business} from the fixture directory: beat match to {product}/{market}, recent relevant articles, contact route, lawful basis recorded. Exclude mismatches with reasons.",
      [
        "Beat match evidenced by recent articles.",
        "Lawful basis recorded.",
        "Exclusions reasoned.",
      ],
      { fixtures: { directory: "fixtures/pr/journalists_{market}.json" }, mockTools: TOOLS.crm, checks: [CHECK.policy()] },
    ),
    bp(
      "Relationship over time at {business}",
      "Plan how {business} builds relationships with 5 key journalists over 6 months without spamming: cadence, value offered (data, sources), what you never do.",
      [
        "Cadence respectful; value real.",
        "Prohibited tactics named.",
        "Tracking in CRM.",
      ],
    ),
    bp(
      "Respond to a source request for {business}",
      "A fixture source request asks for an expert on {keyword}. Draft {business}'s response: relevance, the founder's credentials (from the profile fixture), availability, and what you need approved.",
      [
        "Relevant and specific; credentials from the fixture only.",
        "Approval for quotes in the founder's name.",
        "Concise.",
      ],
      { fixtures: { request: "fixtures/pr/source_request.json", profile: "fixtures/founder/profile_{founder}.json" }, checks: [CHECK.policy()] },
    ),
  ],
  press_release_writing: [
    bp(
      "Milestone release for {business}",
      "Write the press release for {business}'s milestone (fixture ms_100): headline, dateline, lead with facts, body with sourced numbers, founder quote marked for approval, boilerplate, contact. 300-450 words.",
      [
        "Facts sourced; quote marked for approval.",
        "Structure complete.",
        "No hype; within length.",
      ],
      { fixtures: { milestone: "fixtures/pr/milestone_ms_100.json" }, checks: [CHECK.words(280, 480), CHECK.cites()] },
    ),
    bp(
      "Newsworthiness check at {business}",
      "{founder} wants a release about a minor UI update for {business}. Assess newsworthiness honestly, propose the alternative (blog, customer email), or the angle that would make it news.",
      [
        "Honest assessment.",
        "Alternative or angle constructive.",
        "No fabricated significance.",
      ],
    ),
    bp(
      "Fix a release draft at {business}",
      "Edit the fixture release for {business}: remove unverifiable claims, fix the invented customer quote, add sources, keep the news.",
      [
        "All problems found and fixed.",
        "Sources added.",
        "News preserved.",
      ],
      { fixtures: { draft: "fixtures/pr/release_draft.md" }, checks: [CHECK.cites()] },
    ),
  ],
  pitch_writing: [
    bp(
      "Individual pitch for {business}",
      "Write a pitch to a fixture journalist at {publication} for {business}: why this story fits their recent coverage (cite the article), the news hook, what you can offer (data, founder interview), disclosure of the business. Under 150 words.",
      [
        "Specific to the journalist's coverage with a citation.",
        "Hook clear; offer concrete.",
        "Discloses the business; under 150 words.",
      ],
      { fixtures: { journalist: "fixtures/pr/journalist_a.json" }, checks: [CHECK.words(60, 170), CHECK.cites()] },
    ),
    bp(
      "Follow-up pitch at {business}",
      "The journalist did not reply to {business}'s pitch after 7 days. Write the one follow-up and the rule for stopping.",
      [
        "Follow-up adds value, not pressure.",
        "Stop rule stated.",
        "Under 80 words with no new claims.",
      ],
    ),
    bp(
      "Pitch with data for {business}",
      "Turn {business}'s {metric} and the fixture dataset into a data-led pitch: the finding, the method (one line), why it matters to readers, and limits.",
      [
        "Finding supported by the dataset.",
        "Method and limits stated.",
        "Readers' angle clear.",
      ],
      { fixtures: { dataset: "fixtures/pr/dataset_{business}.json" } },
    ),
  ],
  media_monitoring: [
    bp(
      "Weekly coverage report for {business}",
      "From the fixture mentions, write {business}'s weekly PR report: coverage pieces with links, sentiment, referral visits from attribution, review ratings changes, and the two actions.",
      [
        "Coverage and visits tied to records.",
        "Sentiment reasonable.",
        "Actions specific.",
      ],
      { fixtures: { mentions: "fixtures/pr/mentions_{business}.json" }, checks: [CHECK.cites()] },
    ),
    bp(
      "Negative review handling at {business}",
      "A 1-star review (fixture) accuses {business} of a billing error. Draft the public reply (factual, no incentives), the internal check, and the escalation.",
      [
        "Reply factual and calm; no incentive offered.",
        "Internal check defined.",
        "Escalation appropriate.",
      ],
      { fixtures: { review: "fixtures/pr/review_negative.json" }, checks: [CHECK.policy()] },
    ),
    bp(
      "Spot a misattributed mention at {business}",
      "Monitoring flagged 40 mentions of '{business}' but many refer to an unrelated entity. Design the filter and report the corrected count.",
      [
        "Filter is sensible (context terms, domains).",
        "Corrected count justified.",
        "False positives explained.",
      ],
    ),
  ],
  event_sourcing: [
    bp(
      "Find events for {business}",
      "From the fixture events directory, shortlist 5 events in {market} where {customer} attend for {business}: audience evidence, cost (sourced), format options, dates, and the pipeline needed to break even (Estimate).",
      [
        "Audience evidence and costs sourced.",
        "Break-even arithmetic shown and labelled.",
        "Dates feasible.",
      ],
      { fixtures: { events: "fixtures/events/directory_{market}.json" }, checks: [CHECK.all("Estimate"), CHECK.cites()] },
    ),
    bp(
      "Host or sponsor at {business}",
      "Decide whether {business} should sponsor a conference or host a 30-person dinner for {customer} this quarter; compare cost, control, lead quality; recommend.",
      [
        "Comparison numeric and fair.",
        "Recommendation reasoned.",
        "Contracts/deposits flagged as founder actions.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Event ROI review at {business}",
      "Fixture: {business} attended 3 events; pipeline and cost per event. Rank them, say which to repeat, and what the data does not show.",
      [
        "Ranking by pipeline per cost.",
        "Repeat decisions reasoned.",
        "Limits acknowledged.",
      ],
      { fixtures: { results: "fixtures/events/results_{business}.json" } },
    ),
  ],
  lead_capture: [
    bp(
      "Design lead capture for {business}",
      "Design {business}'s event lead capture: fields, consent checkbox wording for {market}, lawful basis, source tagging, sync to CRM, and what you do with business cards.",
      [
        "Fields minimal; consent wording appropriate.",
        "Lawful basis and source recorded.",
        "Business-card handling compliant.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Process captured leads at {business}",
      "Process the fixture of 60 captured leads for {business}: dedupe against CRM, record consent, route to the email engine's approved sequence or exclude, and report counts.",
      [
        "Dedup and consent handled correctly.",
        "Routing respects consent.",
        "Counts reconcile.",
      ],
      { fixtures: { leads: "fixtures/events/captured_leads.json" }, mockTools: TOOLS.crm, checks: [CHECK.policy()] },
    ),
    bp(
      "Capture without a form at {business}",
      "At a dinner {business} hosts, there is no form. Propose how to capture leads compliantly (QR, follow-up consent) and what you must not do.",
      [
        "Compliant capture method.",
        "Prohibited actions named.",
        "Follow-up consent step.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  follow_up: [
    bp(
      "Post-event follow-up for {business}",
      "Write {business}'s post-event follow-up plan: timing, message per attendee type (met, booth visitor, no-show), approved sequence usage, and what needs founder approval.",
      [
        "Timing and messages appropriate per type.",
        "Uses approved sequences; approvals identified.",
        "Compliant.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Follow-up that converts at {business}",
      "Draft the follow-up email to a {customer} met at an event who asked about {price}. Use only facts; propose a call via the scheduling tool; no discounts without approval.",
      [
        "Factual, specific to the conversation.",
        "Scheduling via approved tool.",
        "No unapproved discounts.",
      ],
      { checks: [CHECK.policy()] },
    ),
    bp(
      "Stop rule at {business}",
      "Define when {business} stops following up with an event lead and what happens to the record (retention rule).",
      [
        "Stop rule bounded.",
        "Retention rule applied (24 months default).",
        "Suppression on request.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
};
