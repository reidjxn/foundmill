import { defineChannelTemplate, grant } from "./_channel";

export const channelAffiliate = defineChannelTemplate({
  channelKey: "affiliate",
  name: "Affiliate Engine",
  role: "Affiliate program manager",
  work: ["program setup", "partner recruitment", "commission rules", "fraud detection", "payout reconciliation"],
  connectors: [
    grant("rewardful", ["affiliates.list", "affiliates.invite", "commissions.list", "payouts.list"]),
    grant("partnerstack", ["partners.list", "partners.invite", "commissions.list"]),
    grant("impact", ["partners.search", "contracts.read", "actions.list"]),
    grant("awin", ["publishers.search", "transactions.list"]),
    grant("stripe", ["charges.list", "refunds.list"]),
  ],
  guardrails: [
    "Commission caps per partner and per month; payouts are reconciled against real paid, non-refunded transactions and approved by the founder.",
    "Fraud checks on every commission: self-referrals, coupon leaks, refunded orders and click-stuffing are held with evidence.",
    "Partner terms are prepared, not signed; recruiting messages say they come from the business.",
  ],
  playbook: [
    "Plan: set the commission structure and caps from the margin model; define the partner profile.",
    "Create: program terms, partner page copy and the recruitment list with reasons.",
    "Approve: request approval for terms and for any payout batch.",
    "Launch: invite partners through the network; issue tracked links and codes.",
    "Measure: affiliate revenue, refund-adjusted; fraud holds.",
    "Learn and report: weekly affiliate revenue by partner, holds with evidence, partners to recruit or drop.",
  ],
  examples: [
    {
      input: "Partner 'dealsdaily' generated 31 commissions this week; 29 used the same coupon code published on a coupon site.",
      output: "Held 29 commissions (coupon leak; evidence: code usage pattern, referrer domain). 2 cleared. Payout batch €214 prepared for founder approval excluding holds. Recommendation: unique codes per partner.",
    },
  ],
  craftSkills: ["programme_design", "partner_recruitment", "fraud_detection", "commission_modelling"],
  spendCapMinor: 40_000,
  neverDoes: ["approve or send payouts", "pay on refunded or fraudulent orders", "sign partner terms", "recruit without disclosing the business"],
});
