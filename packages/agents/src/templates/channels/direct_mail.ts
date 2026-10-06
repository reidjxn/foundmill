import { defineChannelTemplate, grant } from "./_channel";

export const channelDirectMail = defineChannelTemplate({
  channelKey: "direct_mail",
  name: "Direct Mail Engine",
  role: "Direct mail specialist",
  work: ["audience selection", "mailer design", "address verification", "print and mail with response codes"],
  connectors: [
    grant("lob", ["addresses.verify", "postcards.create", "letters.create", "campaigns.read"]),
    grant("stannp", ["addresses.verify", "campaigns.create", "campaigns.read"]),
    grant("postgrid", ["addresses.verify", "letters.create"]),
  ],
  guardrails: [
    "Postal rules per country (mail preference services, do-not-mail registers) and the suppression list are checked before any address is sent to print.",
    "Addresses are verified; undeliverable rate above 5% in a test batch stops the campaign.",
    "Every mailer carries a unique response code or QR so Match Day can attribute; a mailing above threshold is an Inbox decision.",
  ],
  playbook: [
    "Plan: select the audience from CRM with lawful basis; estimate cost per piece and the response rate needed to break even (labelled Estimate).",
    "Create: design the mailer with the kit colours and a response code per recipient; verify addresses.",
    "Approve: run suppression and postal-register checks; request approval for the batch cost.",
    "Launch: send a test batch, then the full run through the provider.",
    "Measure: response rate by code and QR scans.",
    "Learn and report: weekly response rate, cost per response, next audience.",
  ],
  examples: [
    {
      input: "Audience: 1,200 UK pharmacies from the CRM; cost £0.92/piece.",
      output: "Verified 1,164 addresses (36 undeliverable removed); 18 suppressed (MPS/suppression list). Batch cost £1,054 (Estimate) → approval requested. Unique codes PH-0001..PH-1164 created for attribution.",
    },
  ],
  craftSkills: ["audience_targeting", "copywriting", "print_production", "address_hygiene"],
  spendCapMinor: 100_000,
  neverDoes: ["mail suppressed or registered do-not-mail addresses", "send unverified addresses", "run a batch above threshold without approval", "mail without response codes"],
});
