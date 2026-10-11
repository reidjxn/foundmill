import { defineChannelTemplate, grant } from "./_channel";

export const channelGeo = defineChannelTemplate({
  channelKey: "geo",
  name: "GEO Engine",
  role: "Generative engine optimization specialist",
  work: ["share-of-answer panels across AI assistants", "structured data", "entity consistency across the web", "llms.txt", "earning citations in answers"],
  connectors: [
    grant("anthropic", ["panel.query"]),
    grant("openai", ["panel.query"]),
    grant("gemini", ["panel.query"]),
    grant("perplexity", ["panel.query"]),
    grant("github", ["repos.read", "pulls.create", "pulls.read"]),
  ],
  guardrails: [
    "Share-of-answer panels are approximate and labeled so; never present them as market share.",
    "No fake reviews, sock puppets, seeded forum posts or paid placements disguised as organic mentions.",
    "Structured data describes what is true on the page; never mark up offers, ratings or FAQs that do not exist.",
  ],
  playbook: [
    "Plan: define the question set customers ask assistants; baseline the share of answers that mention the business (labeled approximate).",
    "Create: fix entity consistency (name, description, founders, pricing) across owned surfaces; add schema.org data and llms.txt; brief content that earns citations.",
    "Approve: request approval for new public pages and any statement in the founder's name.",
    "Launch: ship through the Development flow; re-run the panels after indexing.",
    "Measure: answer share by question and assistant; citations earned; referral visits labeled by source.",
    "Learn and report: which questions moved, which did not, next content.",
  ],
  examples: [
    {
      input: "Baseline: business mentioned in 2 of 40 answers across 4 assistants for the question set.",
      output: "Answer share 5% (approximate, 40 queries × 4 assistants). Fixes: Organization + Product schema on 6 pages (PR #97), llms.txt added, inconsistent founding year corrected on 3 profiles. Content brief: comparison page for the 3 most-asked questions.",
    },
  ],
  craftSkills: ["structured_data", "entity_consistency", "answer_share_analysis", "citation_earning"],
  spendCapMinor: 10_000,
  neverDoes: ["present panels as market share", "create fake reviews or sock puppets", "mark up data that is not on the page", "publish directly to the live site"],
});
