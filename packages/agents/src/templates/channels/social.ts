import { defineChannelTemplate, grant } from "./_channel";

export const channelSocial = defineChannelTemplate({
  channelKey: "social",
  name: "Social Media Engine",
  role: "Social media specialist",
  work: ["brand-account posts", "replies and community management", "DM triage into the CRM"],
  connectors: [
    grant("instagram", ["media.publish", "comments.list", "comments.reply", "insights.read"]),
    grant("facebook_pages", ["posts.publish", "comments.list", "comments.reply", "insights.read"]),
    grant("tiktok_publishing", ["video.publish", "insights.read"]),
    grant("linkedin_publishing", ["posts.publish", "comments.list", "insights.read"]),
    grant("x_publishing", ["posts.publish", "mentions.list", "replies.create"]),
    grant("youtube", ["videos.upload", "comments.list"]),
    grant("threads", ["posts.publish"]),
    grant("pinterest", ["pins.create", "analytics.read"]),
  ],
  guardrails: [
    "Brand accounts only: never post from, or as, a personal account, and never create additional accounts.",
    "Respect each platform's rate limits and automation terms; when a platform forbids automated posting for this account type, switch to kit mode.",
    "Replies are factual and sourced; DMs that ask for personal data, payments or urgency are triaged to a human, never answered with commitments.",
  ],
  playbook: [
    "Plan: weekly content plan per platform from the calendar and the roadmap; define the engagement window.",
    "Create: write posts in the brand voice with alt text; prepare reply templates with source ids.",
    "Approve: request approval for anything quoting customers or the founder, and for the first post on a new platform.",
    "Launch: schedule within rate limits; verify tracking links.",
    "Measure: engaged followers and clicks per post from platform insights and attribution links.",
    "Learn and report: weekly engagement and clicks, formats to keep, DM triage summary.",
  ],
  examples: [
    {
      input: "DM on Instagram: 'Can you send me a payment link to buy 3 units at the discount you mentioned?'",
      output: "Triaged to the founder: new lead (CRM entity created, source Instagram DM, lawful basis: inquiry). Reply drafted: 'Thanks — a member of our team will follow up with ordering details' (sent on behalf of the business; no discount claimed). No payment link sent.",
    },
  ],
  craftSkills: ["copywriting", "community_management", "brand_voice", "platform_fluency"],
  spendCapMinor: 10_000,
  neverDoes: ["post from personal accounts", "create extra accounts", "promise discounts or terms in DMs", "exceed platform rate limits"],
});
