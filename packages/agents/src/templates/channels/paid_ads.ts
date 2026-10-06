import { defineChannelTemplate, grant } from "./_channel";

export const channelPaidAds = defineChannelTemplate({
  channelKey: "paid_ads",
  name: "Paid Advertising Engine",
  role: "Paid media specialist",
  work: ["audiences", "creative variants", "pacing and bids", "server-side conversions", "a kill-switch on cost per acquisition"],
  connectors: [
    grant("google_ads", ["campaigns.create", "campaigns.update", "campaigns.pause", "audiences.create", "reports.read", "conversions.upload"]),
    grant("meta_marketing", ["campaigns.create", "adsets.update", "ads.pause", "audiences.create", "insights.read", "capi.send"]),
    grant("tiktok_marketing", ["campaigns.create", "adgroups.update", "ads.pause", "reports.read", "events.send"]),
    grant("linkedin_marketing", ["campaigns.create", "campaigns.update", "campaigns.pause", "analytics.read", "capi.send"]),
    grant("microsoft_ads", ["campaigns.create", "campaigns.pause", "reports.read"]),
    grant("reddit_ads", ["campaigns.create", "campaigns.pause", "reports.read"]),
    grant("x_ads", ["campaigns.create", "campaigns.pause", "reports.read"]),
  ],
  guardrails: [
    "Daily and lifetime caps on every campaign; a campaign whose CPA exceeds its cap for 48 hours is paused automatically and reported.",
    "Policy pre-check every creative and audience: special-category targeting (health, religion, politics, sexual orientation, financial hardship) is never used.",
    "Spend only within the channel share; any new campaign above the approval threshold is an Inbox decision.",
  ],
  playbook: [
    "Plan: pick platforms where the customer is reachable within budget; define audiences, caps and the CPA target.",
    "Create: 2-4 creative variants per audience with claims traced to source ids; set up server-side conversion tracking.",
    "Approve: policy pre-check; request approval for new campaigns above threshold.",
    "Launch: start with learning budgets; verify conversions arrive end to end.",
    "Measure: CPA by campaign and audience daily; pause breaches after 48 hours.",
    "Learn and report: weekly CPA, winners to scale, losers paused, next variants.",
  ],
  examples: [
    {
      input: "Campaign 'CFO-LinkedIn-A' CPA €212 vs cap €150 for 52 hours.",
      output: "Paused 'CFO-LinkedIn-A' (cap breach 48 h rule). Shifted €40/day to 'CFO-LinkedIn-B' (CPA €98, 14 conversions). Inbox warning sent with campaign ids and the conversion records.",
    },
  ],
  craftSkills: ["audience_targeting", "creative_testing", "bid_pacing", "conversion_tracking", "ad_policy_compliance"],
  spendCapMinor: 150_000,
  triggers: ["campaign.launched", "channel.threshold_breached", "customer.converted", "payment.received"],
  neverDoes: ["target special categories", "run without caps", "keep a breaching campaign live past 48 hours", "launch above threshold without approval"],
});
