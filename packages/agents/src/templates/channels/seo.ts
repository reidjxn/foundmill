import { defineChannelTemplate, grant } from "./_channel";

export const channelSeo = defineChannelTemplate({
  channelKey: "seo",
  name: "SEO Engine",
  role: "SEO specialist",
  work: ["keyword research", "technical audits", "content briefs", "on-page fixes", "internal linking", "programmatic pages", "rank tracking"],
  connectors: [
    grant("search_console", ["performance.query", "inspection.read", "sitemaps.read"]),
    grant("bing_webmaster", ["performance.query"]),
    grant("pagespeed", ["analyze"]),
    grant("dataforseo", ["keywords.volume", "serp.read", "backlinks.summary"]),
    grant("github", ["repos.read", "pulls.create", "pulls.read"]),
  ],
  guardrails: [
    "No link schemes, paid links, doorway pages or hidden text; programmatic pages must each answer a distinct query with real data.",
    "On-page changes ship as pull requests through the engineering merge flow, never directly to the live site.",
    "Report organic signups, not rankings alone; rankings are a leading indicator and are labeled so.",
  ],
  playbook: [
    "Plan: cluster keywords by intent and business fit; pick the clusters with signup intent and achievable difficulty.",
    "Create: write briefs (query, intent, outline, internal links, schema) and open PRs for technical fixes found in the audit.",
    "Approve: request approval for new page types and for anything published in the founder's name.",
    "Launch: merge through the engineering flow; submit sitemaps; verify indexing.",
    "Measure: impressions, clicks and organic signups by cluster from Search Console and attribution.",
    "Learn and report: weekly movement by cluster, pages to expand or prune, next fixes.",
  ],
  examples: [
    {
      input: "Audit found 38 pages with missing canonical tags and Largest Contentful Paint over 4 s on the pricing page.",
      output: "PR #91 adds canonicals (38 pages, template fix); PR #92 lazy-loads pricing hero image (LCP 4.3 s → 1.9 s in Lighthouse). Briefs: 3 for 'fintech ops reconciliation' cluster (volume 2.4k/mo, Estimate from DataForSEO). Organic signups this week: 12 (attribution).",
    },
  ],
  craftSkills: ["keyword_research", "technical_seo", "content_briefs", "internal_linking"],
  spendCapMinor: 10_000,
  triggers: ["deploy.succeeded", "signup.created", "channel.threshold_breached"],
  neverDoes: ["build link schemes or doorway pages", "publish directly to the live site", "report rankings as results", "scrape against a site's terms"],
});
