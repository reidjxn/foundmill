/**
 * Mock classifier (generic label picker) and categoriser (bank transactions → standard chart of accounts, BUILD §11.8
 * "Haiku categorises bank transactions ... founder recategorisations become rules").
 */
import { type AccountCategory, type CategoriserOutput, type ClassifierOutput } from "../schemas";
import { type MockContext, isRecord, keywords } from "./inputs";

interface LabelIn {
  label: string;
  description: string;
}

export function generateClassifier(ctx: MockContext): ClassifierOutput {
  const labels = readLabels(ctx);
  const text = ctx.getString("text", "content", "input", "message", "query") ?? ctx.lastUser.replace(/```[\s\S]*?```/g, " ");
  const lower = text.toLowerCase();
  const tokens = new Set(keywords(text, 300));
  if (labels.length === 0) return { label: "other", confidence: 0.34, reasons: ["No labels were supplied; defaulted to 'other'."] };

  const scored = labels.map((l) => {
    const phrase = l.label.toLowerCase().replace(/_/g, " ");
    const kws = Array.from(new Set([...keywords(`${l.label.replace(/_/g, " ")} ${l.description}`, 20), ...phrase.split(/\s+/).filter((w) => w.length >= 3)]));
    const hits = kws.filter((k) => tokens.has(k) || lower.includes(k));
    const verbatim = phrase.length >= 3 && lower.includes(phrase) ? 1 : 0;
    const score = (kws.length === 0 ? 0 : hits.length / kws.length) + verbatim;
    return { l, score, hits };
  });
  scored.sort((a, b) => b.score - a.score || a.l.label.localeCompare(b.l.label));
  const best = scored[0] as (typeof scored)[number];
  const total = scored.reduce((acc, s) => acc + s.score, 0);
  const confidence = best.score === 0 ? 0.34 : Math.max(0.34, Math.min(0.98, Math.round((best.score / Math.max(total, best.score)) * 100) / 100));
  const reasons = best.hits.length > 0 ? [`Matched ${best.hits.slice(0, 4).join(", ")} for "${best.l.label}".`] : [`No label keywords found; picked "${best.l.label}" as the closest default.`];
  if (scored.length > 1 && (scored[1] as (typeof scored)[number]).score > 0) reasons.push(`Runner-up: "${(scored[1] as (typeof scored)[number]).l.label}".`);
  return { label: best.l.label, confidence, reasons };
}

function readLabels(ctx: MockContext): LabelIn[] {
  const raw = ctx.getArray<unknown>("labels", "classes", "categories", "options");
  const out: LabelIn[] = [];
  for (const l of raw) {
    if (typeof l === "string" && l.trim()) out.push({ label: l.trim(), description: "" });
    else if (isRecord(l)) {
      const label = typeof l.label === "string" ? l.label : typeof l.key === "string" ? l.key : typeof l.name === "string" ? l.name : undefined;
      if (label) out.push({ label, description: typeof l.description === "string" ? l.description : "" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Categoriser
// ---------------------------------------------------------------------------------------------------------------------

interface TxIn {
  id: string;
  description: string;
  amountMinor: number | undefined;
  inflow: boolean | undefined;
}

const RULES: Array<{ name: string; re: RegExp; category: AccountCategory; confidence: number; inflowOnly?: boolean; outflowOnly?: boolean }> = [
  { name: "refund", re: /\brefund|chargeback|reversal\b/i, category: "refunds", confidence: 0.92 },
  { name: "payout-revenue", re: /\b(?:stripe|shopify|paypal|adyen|mollie|klarna|gumroad|lemon ?squeezy|paddle)\b.*\b(?:payout|transfer|settlement)\b|\bpayout\b|\binvoice (?:paid|payment)\b|\bcustomer payment\b|\bsubscription (?:payment|revenue)\b/i, category: "revenue", confidence: 0.9, inflowOnly: true },
  { name: "ads", re: /\b(?:google ads|adwords|meta ?ads?|facebook ads?|facebk|linkedin ads?|tiktok ads?|microsoft ads|bing ads|reddit ads?|x ads|twitter ads|lob|stannp|postgrid|mailchimp|hubspot marketing|semrush|ahrefs)\b/i, category: "marketing_and_advertising", confidence: 0.92 },
  { name: "software", re: /\b(?:aws|amazon web services|google cloud|gcp|vercel|railway|supabase|github|gitlab|notion|slack|figma|linear|jira|atlassian|zoom|openai|anthropic|cloudflare|digitalocean|heroku|netlify|twilio|sendgrid|postmark|1password|zapier|airtable|microsoft 365|google workspace|apple\.com\/bill|adobe|datadog|sentry|temporal)\b/i, category: "software_and_hosting", confidence: 0.9 },
  { name: "payroll", re: /\b(?:payroll|gusto|deel|remote\.com|rippling|salary|salaries|wages|contractor|upwork|fiverr|toptal|freelancer)\b/i, category: "salaries_and_contractors", confidence: 0.9 },
  { name: "professional", re: /\b(?:lawyer|solicitor|attorney|legal|law firm|accountant|accounting|bookkeep|audit|consult(?:ant|ing)|notary|registered agent|stripe atlas|companies house|clerky|carta)\b/i, category: "professional_services", confidence: 0.85 },
  { name: "rent", re: /\b(?:rent|wework|regus|office lease|coworking|lease payment|utilities|electricity|internet bill)\b/i, category: "rent_and_facilities", confidence: 0.88 },
  { name: "travel", re: /\b(?:uber|lyft|bolt|taxi|airline|ryanair|lufthansa|sas|ba\.com|british airways|hotel|airbnb|booking\.com|train|sj\b|trainline|restaurant|cafe|coffee|lunch|dinner|per diem|eurostar)\b/i, category: "travel_and_meals", confidence: 0.85 },
  { name: "equipment", re: /\b(?:apple store|dell|lenovo|laptop|macbook|monitor|keyboard|hardware|elgiganten|mediamarkt|currys|best buy|ikea)\b/i, category: "equipment", confidence: 0.82 },
  { name: "insurance", re: /\binsurance|assurance|hiscox|allianz|axa|trygg|if skadef\b/i, category: "insurance", confidence: 0.9 },
  { name: "shipping", re: /\b(?:dhl|ups|fedex|postnord|royal mail|usps|shipbob|shipmonk|3pl|fulfil(?:l)?ment|freight|customs duty|shipping label)\b/i, category: "shipping_and_fulfilment", confidence: 0.88 },
  { name: "cogs", re: /\b(?:supplier|raw materials?|packaging|manufactur|wholesale|ingredients?|inventory purchase|purchase order|po-\d+)\b/i, category: "cost_of_goods_sold", confidence: 0.8, outflowOnly: true },
  { name: "taxes", re: /\b(?:hmrc|irs|skatteverket|finanzamt|vat|tax|moms|corporation tax|payroll tax|bolagsverket|companies house fee)\b/i, category: "taxes_and_government", confidence: 0.85 },
  { name: "bank-fees", re: /\b(?:bank fee|monthly fee|card fee|fx fee|interest|overdraft|wire fee|service charge|stripe fee|processing fee)\b/i, category: "bank_fees_and_interest", confidence: 0.88 },
  { name: "financing", re: /\b(?:safe|convertible note|investment received|seed round|loan (?:received|disbursement)|grant received|angel|vc|venture)\b/i, category: "financing", confidence: 0.75, inflowOnly: true },
  { name: "transfer", re: /\b(?:transfer to savings|internal transfer|own account|to savings|from savings|between accounts|sweep)\b/i, category: "transfers", confidence: 0.85 },
  { name: "generic-revenue", re: /\b(?:invoice|inv-\d+|payment received|sales|order #?\d+)\b/i, category: "revenue", confidence: 0.7, inflowOnly: true },
];

export function generateCategoriser(ctx: MockContext): CategoriserOutput {
  const txs = readTransactions(ctx);
  return {
    transactions: txs.map((t) => {
      const text = t.description;
      for (const r of RULES) {
        if (r.inflowOnly && t.inflow === false) continue;
        if (r.outflowOnly && t.inflow === true) continue;
        if (r.re.test(text)) return { id: t.id, category: r.category, confidence: r.confidence, rule: r.name };
      }
      if (t.inflow === true) return { id: t.id, category: "revenue" as const, confidence: 0.45, rule: "inflow-default" };
      return { id: t.id, category: "uncategorised" as const, confidence: 0.3, rule: "no-match" };
    }),
  };
}

function readTransactions(ctx: MockContext): TxIn[] {
  const raw = ctx.getArray<unknown>("transactions", "bank_transactions", "items", "rows");
  const out: TxIn[] = [];
  raw.forEach((t, i) => {
    if (!isRecord(t)) return;
    const description = [t.description, t.memo, t.counterparty, t.merchant, t.name, t.reference].filter((v): v is string => typeof v === "string").join(" ");
    const amountMinor = typeof t.amount_minor === "number" ? t.amount_minor : typeof t.amountMinor === "number" ? t.amountMinor : typeof t.amount === "number" ? Math.round(t.amount * 100) : undefined;
    const dir = typeof t.direction === "string" ? t.direction : typeof t.type === "string" ? t.type : undefined;
    const inflow = dir ? /^(?:in|inflow|credit|deposit|incoming)$/i.test(dir) : amountMinor !== undefined ? amountMinor > 0 : undefined;
    out.push({ id: typeof t.id === "string" ? t.id : typeof t.transaction_id === "string" ? t.transaction_id : `tx-${i + 1}`, description, amountMinor, inflow });
  });
  return out;
}
