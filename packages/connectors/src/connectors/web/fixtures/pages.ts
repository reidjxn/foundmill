/**
 * Deterministic pages for the mock web reader (INTEGRATIONS_MODE=mock). Known demo links return the fixture below;
 * any other link gets a page built from the words in its path, so a source added on staging always reads as
 * something about what its link names. Two hosts stand for the failures the Source Watcher must handle:
 * `blocked.example` (robots.txt refuses) and `down.example` (the site does not answer).
 */
export interface MockPage {
  title: string;
  description: string;
  paragraphs: string[];
}

export const MOCK_ROBOTS_BLOCKED_HOST = "blocked.example";
export const MOCK_DOWN_HOST = "down.example";

export const MOCK_PAGES: Record<string, MockPage> = {
  "https://example.com/competitor-pricing": {
    title: "Pricing: Invoicely for small finance teams",
    description: "Simple plans for teams that close the month together.",
    paragraphs: [
      "Starter is $29 per month for one entity and up to 200 bank transactions.",
      "Growth is $79 per month with multi-entity reconciliation, approval workflows and a Xero sync.",
      "Annual billing saves two months on every plan. Every plan includes email approvals for CFOs.",
      "Customers say the bank feed matching saves them two days at month end.",
    ],
  },
  "https://competitor.example/pricing": {
    title: "Pricing that grows with you",
    description: "Monthly and annual plans, cancel anytime.",
    paragraphs: ["The Basic plan costs $19 per month; the Team plan costs $49 per seat per month.", "Annual plans include two free months and priority support.", "A free trial lasts 14 days with no card required."],
  },
};

const TOPIC_PARAGRAPHS: Record<string, string[]> = {
  pricing: ["Plans start at $25 per month and rise to $90 per month for teams; annual billing saves two months.", "The pricing page compares three tiers by seats, entities and support response times."],
  refill: ["Refills ship every quarter at $32 with free shipping over $40; customers can pause or skip a refill.", "A bundle of two routines costs $58 per quarter."],
  feature: ["The release adds approval workflows, a reaction diary and an export of the audit trail.", "Customers asked for pause and skip on subscriptions and for clearer batch results."],
  review: ["Reviewers praise the fast onboarding and the bank feed matching but call support slow on weekends.", "Three reviewers mention the missing export to CSV."],
  privacy: ["The policy explains which processors receive customer data and how long invoices are kept.", "Customers can request deletion of their data at any time."],
  integration: ["Integrations include Xero, QuickBooks, Stripe and Shopify, with a webhook for new invoices.", "A public API lists invoices, customers and payments."],
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** The mock page for a link: a fixture, or a page about the words in its path. */
export function mockPageFor(url: URL): MockPage {
  const known = MOCK_PAGES[`${url.origin}${url.pathname}`.replace(/\/$/, "")];
  if (known) return known;
  const words = decodeURIComponent(url.pathname)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  const topics = Object.keys(TOPIC_PARAGRAPHS).filter((t) => words.some((w) => w.startsWith(t) || t.startsWith(w)));
  const subject = words.length ? titleCase(words.join(" ")) : url.hostname;
  const paragraphs = topics.flatMap((t) => TOPIC_PARAGRAPHS[t]!);
  return {
    title: `${subject} | ${url.hostname}`,
    description: `A page about ${subject.toLowerCase()} on ${url.hostname}.`,
    paragraphs: paragraphs.length ? paragraphs : [`This page on ${url.hostname} describes ${subject.toLowerCase()}.`, "It lists what the company offers, who it is for and how to get in touch."],
  };
}
