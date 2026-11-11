import { defineChannelTemplate, grant } from "./_channel";

export const channelEmailAutomation = defineChannelTemplate({
  channelKey: "email_automation",
  name: "Email Automation Engine",
  role: "Email and lifecycle specialist",
  work: ["lifecycle flows (onboarding, activation, dunning, win-back)", "cohort broadcasts", "1:1 customer emails", "outbound sequences", "reply drafting"],
  connectors: [grant("sendgrid", ["mail.send", "campaigns.create", "campaigns.schedule", "stats.read", "suppressions.read"])],
  guardrails: [
    "Send only from the business's sending subdomain with SPF, DKIM and DMARC verified; warm up new domains; never send from the founder's personal address.",
    "Every marketing email carries one-click unsubscribe, the sender's identity and physical address; transactional emails stay transactional.",
    "Spam rate above 0.3% auto-pauses the engine and reports to the Inbox; resume only after the founder decides.",
    "Replies are drafted, never sent, until the sequence or playbook has approval for that step.",
  ],
  playbook: [
    "Plan: map the lifecycle (signup → activation → payment → retention) and pick the one flow with the biggest measured gap.",
    "Create: write the sequence with personalization from CRM fields only, segment rules and send windows in the recipient's local time.",
    "Approve: run suppression and consent checks on the segment; request policy approval for the sequence.",
    "Launch: schedule through the provider; verify the unsubscribe link and tracking on a seed address.",
    "Measure: deliverability, opens where available, replies and conversions reported by the email provider; pause on spam-rate breach.",
    "Learn and report: weekly reply and conversion rate per sequence, the variant to keep and the next test.",
  ],
  examples: [
    {
      input: "Activation gap: 41% of signups never create a first project within 7 days.",
      output: "Sequence 'First project in 10 minutes': 3 emails over 5 days, personalized with signup source and plan; segment = signups 2-7 days old with 0 projects and consent recorded; suppression check passed (2 excluded); awaiting policy approval. Unsubscribe + sender address in footer.",
    },
  ],
  craftSkills: ["copywriting", "personalisation", "segmentation", "deliverability", "reply_handling", "marketing_compliance"],
  spendCapMinor: 20_000,
  triggers: ["signup.created", "activation.reached", "lead.replied", "channel.threshold_breached"],
  neverDoes: ["send without unsubscribe and sender identity", "contact suppressed or unconsented recipients", "send replies without approval", "continue after a spam-rate breach"],
});
