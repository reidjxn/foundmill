/** Shared fixtures for mock tests: a Northwind Skincare-flavoured manifest and prompt builders. */
import type { ChatMessage } from "../types";

export const AGENT_PRIYA = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
export const AGENT_TOMAS = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
export const ORG_ALDER = "7f3c6a2e-1b4d-4c8e-9f0a-2b3c4d5e6f70";
export const PERSON_MARA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const ORG_NORTHWIND = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
export const EVENT_1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const EVENT_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

export const MANIFEST = [
  { id: ORG_ALDER, kind: "organisation", name: "Alder & Finch", aliases: ["Alder and Finch", "A&F"] },
  { id: AGENT_PRIYA, kind: "agent", name: "Priya Natarajan", aliases: [], role: "Distribution strategist", department_id: "dept-dist", channel: "paid_ads" },
  { id: AGENT_TOMAS, kind: "agent", name: "Tomas Berg", aliases: [], role: "Backend engineer", department_id: "dept-eng" },
  { id: PERSON_MARA, kind: "person", name: "Mara Lindqvist", aliases: ["Mara"] },
  { id: ORG_NORTHWIND, kind: "organisation", name: "Northwind Skincare", aliases: ["Northwind"] },
];

export const AGENTS = [
  { id: AGENT_PRIYA, name: "Priya Natarajan", role: "Distribution strategist", department_id: "dept-dist", channel: "paid_ads", status: "healthy" },
  { id: AGENT_TOMAS, name: "Tomas Berg", role: "Backend engineer", department_id: "dept-eng", status: "healthy" },
];

/** A prompt whose user message carries the structured inputs as a fenced JSON block (the convention mocks read). */
export function promptWith(input: Record<string, unknown>, prose = "Inputs follow."): ChatMessage[] {
  return [{ role: "user", content: `${prose}\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`` }];
}

export const COMPOSER_INPUT = {
  business: { name: "Northwind Skincare", brief: "Clean skincare for sensitive skin, sold direct and through retail partners." },
  from_agent: { id: AGENT_PRIYA, name: "Priya Natarajan", role: "Distribution strategist" },
  source_events: [
    { id: EVENT_1, type: "payment.received", payload: { customer_id: ORG_ALDER, amount_minor: 48900, currency: "EUR", channel_key: "email_automation" } },
  ],
  metrics: [
    { metric: "mrr", value: 12450, source: "stripe.mrr" },
    { metric: "runway_months", value: 14, source: "finance.runway" },
    { metric: "customers_week", value: 7, source: "journeys.weekly" },
  ],
  named_queries: [
    { id: "q_mrr_12w", title: "Monthly recurring revenue, last twelve weeks", kind: "chart" },
    { id: "q_customer_card", title: "Customer card", kind: "entity_card" },
  ],
  manifest: MANIFEST,
  glossary: { customer: "client" },
};
