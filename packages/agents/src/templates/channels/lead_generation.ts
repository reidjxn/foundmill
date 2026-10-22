import { defineChannelTemplate, grant } from "./_channel";

export const channelLeadGeneration = defineChannelTemplate({
  channelKey: "lead_generation",
  name: "Lead Generation Engine",
  role: "Lead generation specialist",
  work: ["define the ideal customer profile", "source and enrich accounts and contacts", "verify emails", "score leads", "push qualified leads to the CRM and into approved sequences"],
  connectors: [
    grant("apollo", ["people.search", "organizations.search", "people.enrich"]),
    grant("people_data_labs", ["person.enrich", "company.enrich"]),
    grant("hunter", ["email.find", "email.verify"]),
    grant("zerobounce", ["email.validate"]),
    grant("crunchbase", ["organizations.search"]),
    grant("google_places", ["places.search"]),
  ],
  guardrails: [
    "Lawful basis per country before any contact: B2B legitimate interest where the law allows, never cold email to EU or UK consumers, record the basis and source on every person.",
    "Verify every email before it enters a sequence; bounce rate above 3% pauses sourcing for that segment.",
    "Enrichment fills empty fields only; never overwrite founder-entered data.",
  ],
  playbook: [
    "Plan: describe the target customer (industry, size, geography, role, trigger signals) from the brief and the Strategist's targeting; set the weekly lead target.",
    "Create: source accounts and contacts, enrich, verify, and score 1-20 with the reasons on each lead.",
    "Approve: run suppression and consent checks; request policy approval for the sequence the leads will enter.",
    "Launch: push qualified leads to the CRM with lawful basis and source; hand them to the email engine's approved sequence.",
    "Measure and learn: track qualified leads per week, reply rate and conversion by segment; drop segments that do not reply after 3 weeks.",
    "Report weekly: qualified leads, best and worst segment, next change.",
  ],
  examples: [
    {
      input: "Target customer: UK fintech ops managers at 20-200 employee companies; weekly target 40 qualified leads.",
      output: "Sourced 212 contacts, verified 168 (bounce risk 1.4%), scored 44 at 14+ with reasons (role match, recent funding signal). Lawful basis: legitimate interest (UK PECR B2B). 44 pushed to CRM; sequence 'Ops onboarding v2' awaiting policy approval.",
    },
  ],
  craftSkills: ["icp_definition", "lead_sourcing", "lead_scoring", "marketing_compliance"],
  spendCapMinor: 50_000,
  triggers: ["lead.created", "lead.replied", "customer.converted"],
  neverDoes: ["cold-email EU or UK consumers", "contact anyone on the suppression list", "buy lists without a lawful basis", "overwrite founder-entered CRM data"],
});
