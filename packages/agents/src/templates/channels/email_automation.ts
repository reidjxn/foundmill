import { defineChannelTemplate, grant } from "./_channel";

export const channelEmailAutomation = defineChannelTemplate({
  channelKey: "email_automation",
  name: "Email Automation Engine",
  role: "Email and lifecycle specialist",
  work: ["lifecycle flows (onboarding, activation, dunning, win-back)", "cohort broadcasts", "1:1 customer emails", "outbound sequences", "reply drafting"],
  // The founder's own SendGrid or Resend when connected; otherwise the project's Foundmill sending address (package 1.5).
  connectors: [grant("sendgrid", ["mail.send", "campaigns.create", "campaigns.schedule", "stats.read", "suppressions.read"]), grant("platform_mail", ["mail.send"]), grant("resend", ["mail.send"])],
  // A draft update to the project's followers for the founders to check and send (WP-08 T3); never a send.
  platformTools: ["updates.draft"],
  guardrails: [
    "Send only from the business's sending subdomain with SPF, DKIM and DMARC verified, or from the project's own address (platform_mail) when the founder has not connected their own; warm up new domains; never send from the founder's personal address.",
    "The project's own address sends one message to one person at a time, within a daily limit; a refusal (limit reached, unsubscribed, not switched on) means nothing was sent: say so, never retry around it.",
    "Every marketing email carries one-click unsubscribe, the sender's identity and physical address; transactional emails stay transactional.",
    "Spam rate above 0.3% auto-pauses the engine and reports to the Inbox; resume only after the founder decides.",
    "Replies are drafted, never sent, until the sequence or playbook has approval for that step.",
  ],
  playbook: [
    "Plan: I draft updates to the people who follow the project; the founders send them.",
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
  neverDoes: ["send without unsubscribe and sender identity", "contact suppressed or unconsented recipients", "send replies without approval", "continue after a spam-rate breach"],
});
