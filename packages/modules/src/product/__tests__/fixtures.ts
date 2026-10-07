/** Deterministic fixtures for the product screens (Ledgerly, BUILD §17.2 flavour). */
import type { PmDoc, ProposalRow, ProposalWithHunks, RoadmapResponse, SourceRow, SpecBlockRow, SpecGetResponse, SpecVersionRow } from "../types";

export const BID = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number, block = "a") => `${block}${block}${block}${block}${block}${block}${block}${block}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const AGENT = { atlas: uuid(1, "e"), nova: uuid(2, "e") };
export const USER = { reid: uuid(1, "c") };
export const BLOCK = { problem: uuid(1, "b"), customers: uuid(2, "b"), pricing: uuid(3, "b"), features: uuid(4, "b"), metrics: uuid(5, "b") };
export const ITEM = { billing: uuid(1, "d"), sso: uuid(2, "d"), reports: uuid(3, "d"), mobile: uuid(4, "d") };
export const SOURCE = { interview: uuid(1, "f"), competitor: uuid(2, "f"), issue: uuid(3, "f"), legal: uuid(4, "f") };
export const PROPOSAL = { annual: uuid(1, "9"), sso: uuid(2, "9") };
export const HUNK = { pricing1: uuid(1, "8"), pricing2: uuid(2, "8"), features: uuid(3, "8"), roadmap: uuid(4, "8") };

export const doc = (...paragraphs: string[]): PmDoc => ({
  type: "doc",
  content: paragraphs.map((p) => (p.startsWith("# ") ? { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: p.slice(2) }] } : { type: "paragraph", content: [{ type: "text", text: p }] })),
});

export const blocks: SpecBlockRow[] = [
  { id: BLOCK.problem, section: "Problem", position: 0, content: doc("# Invoices go unpaid", "Freelancers chase late invoices by hand and lose a week a quarter to it."), sources: [SOURCE.interview], authoredByKind: "agent", authoredBy: AGENT.atlas, pinned: false, version: 3, updatedAt: "2026-10-01T09:00:00Z" },
  { id: BLOCK.customers, section: "Customers", position: 0, content: doc("# Solo consultants in the EU", "Design and engineering freelancers billing 3 to 12 clients a month."), sources: [], authoredByKind: "user", authoredBy: USER.reid, pinned: true, version: 5, updatedAt: "2026-10-03T12:00:00Z" },
  { id: BLOCK.features, section: "Features", position: 0, content: doc("# Automatic reminders", "Reminder sequences per client with tone presets.", "- Acceptance: a reminder is sent 3 days after due date"), sources: [SOURCE.issue], authoredByKind: "agent", authoredBy: AGENT.nova, pinned: false, version: 2 },
  { id: BLOCK.pricing, section: "Pricing", position: 0, content: doc("# Pricing", "Monthly plan at 12 EUR per seat."), sources: [], authoredByKind: "user", authoredBy: USER.reid, pinned: true, version: 4 },
  { id: BLOCK.metrics, section: "Metrics", position: 0, content: doc("# North star", "Invoices paid within 30 days."), sources: [], authoredByKind: "system", authoredBy: null, pinned: false, version: 1 },
];

export const versions: SpecVersionRow[] = [
  { id: uuid(3, "7"), version: 3, snapshot: { blocks }, changelogMd: "Accepted annual plan proposal (2 of 3 hunks).", publishedBy: USER.reid, publishedAt: "2026-10-04T10:00:00Z" },
  { id: uuid(2, "7"), version: 2, snapshot: { blocks: blocks.map((b) => (b.id === BLOCK.pricing ? { ...b, content: doc("# Pricing", "Monthly plan at 10 EUR per seat.") } : b)) }, changelogMd: "Pricing raised after interviews.", publishedBy: USER.reid, publishedAt: "2026-09-20T10:00:00Z" },
  { id: uuid(1, "7"), version: 1, snapshot: { blocks: blocks.slice(0, 3) }, changelogMd: "First outline from the archetype.", publishedBy: null, publishedAt: "2026-09-01T10:00:00Z" },
];

export const specGet: SpecGetResponse = { blocks, latestVersion: versions[0] ?? null, versionCount: versions.length };
export const specEmpty: SpecGetResponse = { blocks: [], latestVersion: null, versionCount: 0 };

export const roadmap: RoadmapResponse = {
  items: [
    { id: ITEM.billing, title: "Usage-based billing", horizon: "now", targetStart: "2026-09-28", targetEnd: "2026-10-20", confidence: 4, status: "planned", position: 0, specBlockIds: [BLOCK.pricing], ownerRef: { kind: "agent", id: AGENT.atlas }, tasks: [{ id: uuid(1, "1"), title: "Metering table", status: "done", progress: 1 }, { id: uuid(2, "1"), title: "Stripe usage records", status: "running", progress: 0.4 }] },
    { id: ITEM.sso, title: "SSO for teams", horizon: "next", targetStart: "2026-11-01", targetEnd: "2026-11-30", confidence: 3, status: "planned", position: 0, specBlockIds: [BLOCK.features], tasks: [] },
    { id: ITEM.reports, title: "Quarterly reports", horizon: "later", targetStart: null, targetEnd: null, confidence: 2, status: "planned", position: 0, specBlockIds: [], tasks: [] },
    { id: ITEM.mobile, title: "Mobile reminders", horizon: "now", targetStart: "2026-09-01", targetEnd: "2026-09-25", confidence: 5, status: "done", position: 1, specBlockIds: [BLOCK.features], tasks: [{ id: uuid(3, "1"), title: "Push service", status: "done", progress: 1 }] },
  ],
  dependencies: [{ fromItem: ITEM.sso, toItem: ITEM.billing }],
};
export const roadmapEmpty: RoadmapResponse = { items: [], dependencies: [] };

export const proposals: ProposalRow[] = [
  { id: PROPOSAL.annual, title: "Offer an annual plan", status: "open", rationaleMd: "Three of five interviewees asked for annual billing. See [[ent:" + AGENT.atlas + "|Atlas]]'s notes.", evidence: [SOURCE.interview, SOURCE.competitor], impact: { dates: { shiftDays: 4 }, tasks: 2, costMinor: 120000, currency: "EUR", summary: "Pricing page and billing tasks move by four days." }, severity: "normal", proposedByAgentId: AGENT.atlas, inboxItemId: null, resolvedAt: null, createdAt: "2026-10-05T08:00:00Z" },
  { id: PROPOSAL.sso, title: "Drop SSO from Next", status: "rejected", rationaleMd: "No customer asked for it.", evidence: [], impact: {}, severity: "low", proposedByAgentId: AGENT.nova, inboxItemId: null, resolvedAt: "2026-10-02T08:00:00Z", createdAt: "2026-10-01T08:00:00Z" },
];

export const proposalAnnual: ProposalWithHunks = {
  ...proposals[0]!,
  hunks: [
    { id: HUNK.pricing1, proposalId: PROPOSAL.annual, specBlockId: BLOCK.pricing, roadmapItemId: null, base: doc("# Pricing", "Monthly plan at 10 EUR per seat."), ours: doc("# Pricing", "Monthly plan at 12 EUR per seat."), theirs: doc("# Pricing", "Monthly plan at 12 EUR per seat.", "Annual plan at 120 EUR per seat (two months free)."), decision: "pending", position: 0 },
    { id: HUNK.features, proposalId: PROPOSAL.annual, specBlockId: BLOCK.features, roadmapItemId: null, base: null, ours: doc("# Automatic reminders", "Reminder sequences per client with tone presets."), theirs: doc("# Automatic reminders", "Reminder sequences per client with tone presets.", "Annual customers get a yearly statement."), decision: "pending", position: 1 },
    { id: HUNK.roadmap, proposalId: PROPOSAL.annual, specBlockId: null, roadmapItemId: ITEM.billing, base: null, ours: doc("Usage-based billing"), theirs: doc("Usage-based and annual billing"), decision: "accepted", position: 2 },
  ],
};

export const sources: SourceRow[] = [
  { id: SOURCE.interview, kind: "transcript", uri: "https://notes.example.com/interview-7", title: "Customer interview 7 (Mira, consultant)", contentRef: null, relevance: { summary: "Wants annual billing; reminders too aggressive.", blocks: [{ blockId: BLOCK.pricing, score: 0.82 }], topics: ["pricing", "reminders"] }, fetchedAt: "2026-10-04T10:00:00Z", createdAt: "2026-10-04T10:00:00Z" },
  { id: SOURCE.competitor, kind: "competitor", uri: "https://invoicely.example.com/pricing", title: "Invoicely", contentRef: null, relevance: { summary: "Incumbent for freelancers; annual plan is 20 percent off.", pricing: "From 9 EUR per month, annual 86 EUR", strengths: ["Brand", "Integrations"], weaknesses: ["No reminder tone control"], marketSizeEstimate: "1.2M EU freelancers" }, fetchedAt: "2026-10-03T10:00:00Z", createdAt: "2026-10-03T10:00:00Z" },
  { id: SOURCE.issue, kind: "issue", uri: "https://github.com/ledgerly/app/issues/42", title: "Reminder sent twice on bank holiday", contentRef: null, relevance: { blocks: [{ blockId: BLOCK.features, score: 0.61 }] }, fetchedAt: null, createdAt: "2026-10-02T10:00:00Z" },
  { id: SOURCE.legal, kind: "legal", uri: null, title: "EU e-invoicing directive note", contentRef: "s3://docs/einvoicing.pdf", relevance: { summary: "Mandatory structured e-invoices for B2B from 2028." }, fetchedAt: "2026-09-30T10:00:00Z", createdAt: "2026-09-30T10:00:00Z" },
];

export const dataResponses = {
  "product.spec.get": specGet,
  "product.spec.versions": versions,
  "product.spec.compare": (input: Record<string, unknown> | undefined) => ({ from: versions.find((v) => v.version === input?.from) ?? versions[2], to: versions.find((v) => v.version === input?.to) ?? versions[0] }),
  "product.roadmap.list": roadmap,
  "product.proposals.list": { items: proposals, nextCursor: null },
  "product.proposals.get": (input: Record<string, unknown> | undefined) => (input?.proposalId === PROPOSAL.annual ? proposalAnnual : { ...proposals[1]!, hunks: [] }),
  "product.sources.list": { items: sources, nextCursor: null },
};

export const emptyResponses = {
  "product.spec.get": specEmpty,
  "product.spec.versions": [],
  "product.spec.compare": new Error("no versions"),
  "product.roadmap.list": roadmapEmpty,
  "product.proposals.list": { items: [], nextCursor: null },
  "product.proposals.get": new Error("not found"),
  "product.sources.list": { items: [], nextCursor: null },
};
