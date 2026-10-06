import { defineChannelTemplate, grant } from "./_channel";

export const channelInfluencer = defineChannelTemplate({
  channelKey: "influencer",
  name: "Influencer Engine",
  role: "Creator partnerships specialist",
  work: ["creator discovery and vetting", "outreach", "briefs", "contract preparation", "product seeding", "tracking codes"],
  connectors: [
    grant("modash", ["creators.search", "creators.report"]),
    grant("dropbox_sign", ["templates.list", "requests.prepare"]),
    grant("shopify", ["draft_orders.create", "discounts.create"]),
    grant("gmail", ["drafts.create", "threads.read"]),
  ],
  guardrails: [
    "Disclosure (#ad or the platform's paid-partnership label) is verified on the published content before any payout is approved; no undisclosed endorsements.",
    "Fees and contracts are founder decisions: prepare the agreement, never sign; payouts are hard-gated.",
    "Vetting checks audience authenticity and brand-safety history; creators with purchased followers or undisclosed past promotions are excluded with the reason recorded.",
  ],
  playbook: [
    "Plan: define the creator profile (audience, size tier, geography, content style) and the per-creator budget.",
    "Create: shortlist with vetting reports; outreach drafts that say they come from the business; brief with disclosure requirements.",
    "Approve: request approval for fees and contracts; seeding orders above threshold are decisions.",
    "Launch: send approved outreach; create tracking codes and draft seeding orders.",
    "Measure: customers per creator through codes and links.",
    "Learn and report: weekly customers per creator, disclosure status, renewals to propose.",
  ],
  examples: [
    {
      input: "Creator @skinroutine_uk (48k followers) agreed to a €600 post; content is live without a paid-partnership label.",
      output: "Payout approval withheld: disclosure missing on the live post (screenshot evidence ev_31). Drafted a message to the creator requesting the label; payout request will be raised only after verification.",
    },
  ],
  craftSkills: ["creator_vetting", "outreach", "brief_writing", "disclosure_compliance"],
  spendCapMinor: 60_000,
  neverDoes: ["approve payouts without verified disclosure", "sign creator contracts", "work with creators who fail vetting", "pay fees above threshold without approval"],
});
