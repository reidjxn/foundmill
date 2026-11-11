import { defineChannelTemplate } from "./_channel";

export const channelDirectMail = defineChannelTemplate({
  channelKey: "direct_mail",
  name: "Direct Mail Engine",
  role: "Direct mail specialist",
  work: ["audience selection", "mailer design", "address verification", "print and mail with response codes"],
  connectors: [],
  guardrails: [
    "Postal rules per country (mail preference services, do-not-mail registers) and the suppression list are checked before any address is sent to print.",
    "Address verification has no tool yet: say on the batch that its addresses are unverified; an undeliverable rate above 5% in a test batch stops the campaign.",
    "Every mailer carries a unique response code or QR so the Customer Update can attribute; a mailing above threshold is an Inbox decision.",
  ],
  playbook: [
    "Plan: select the audience from CRM with lawful basis; estimate cost per piece and the response rate needed to break even (labeled Estimate).",
    "Create: design the mailer with the brand colors and a response code per recipient; mark the addresses unverified (no verification tool yet).",
    "Approve: run suppression and postal-register checks; request approval for the batch cost.",
    "Launch: no print and mail tool is available yet, so raise a founder task with the print-ready mailer, the address list and the response codes to send through a provider, a test batch first.",
    "Measure: response rate by code and QR scans.",
    "Learn and report: weekly response rate, cost per response, next audience.",
  ],
  examples: [
    {
      input: "Audience: 1,200 UK pharmacies from the CRM; cost £0.92/piece.",
      output: "1,200 addresses, unverified (no verification tool is available yet); 18 suppressed (MPS/suppression list). Batch cost £1,087 for 1,182 pieces (Estimate) → approval requested. Unique codes PH-0001..PH-1182 assigned for attribution.",
    },
  ],
  craftSkills: ["audience_targeting", "copywriting", "print_production", "address_hygiene"],
  spendCapMinor: 100_000,
  neverDoes: ["mail suppressed or registered do-not-mail addresses", "send unverified addresses", "run a batch above threshold without approval", "mail without response codes"],
});
