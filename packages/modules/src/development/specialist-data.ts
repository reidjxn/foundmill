/**
 * Specialist tile data (BUILD §11.6: RFQ funnel, quote table, sample tracker, shipments) derived from a specialist
 * session's stream. There is no `dev.specialists.*` procedure in BUILD §8.3, so the structured facts travel as
 * `note` events whose text is `specialist:<json>` (one object per note, see `SpecialistNote`); tool calls to
 * supplier/RFQ tools feed the funnel when no structured notes have arrived yet. Pure.
 */
import type { AgentTileSession, RfqStage, SampleItem, Shipment, SpecialistData, SupplierQuote } from "@foundmill/dugout";

export const SPECIALIST_NOTE_PREFIX = "specialist:";

/** One structured note. Each note replaces the matching record by id (quotes/samples/shipments) or a funnel stage. */
export type SpecialistNote =
  | { type: "rfq"; stages: RfqStage[] }
  | { type: "rfq_stage"; stage: RfqStage }
  | { type: "quote"; quote: SupplierQuote }
  | { type: "sample"; sample: SampleItem }
  | { type: "shipment"; shipment: Shipment };

export const EMPTY_SPECIALIST_DATA: SpecialistData = { rfq: [], quotes: [], samples: [], shipments: [] };

/** Default funnel stages when only tool calls are known (identified → contacted → replied → quoted → shortlisted). */
export const DEFAULT_RFQ_STAGES: readonly { id: string; label: string; tools: RegExp }[] = [
  { id: "identified", label: "Identified", tools: /supplier|search|discover|identif/i },
  { id: "contacted", label: "RFQ sent", tools: /rfq|outreach|send_email|mail/i },
  { id: "replied", label: "Replied", tools: /repl(y|ied)|inbound|read_message/i },
  { id: "quoted", label: "Quoted", tools: /quote|extract_price|quarantin/i },
  { id: "shortlisted", label: "Shortlisted", tools: /shortlist|score|rank/i },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Parse a `specialist:<json>` note; null when the note is not one or the JSON is malformed. */
export function parseSpecialistNote(text: string): SpecialistNote | null {
  if (!text.startsWith(SPECIALIST_NOTE_PREFIX)) return null;
  try {
    const v = JSON.parse(text.slice(SPECIALIST_NOTE_PREFIX.length)) as unknown;
    if (!isRecord(v) || typeof v.type !== "string") return null;
    switch (v.type) {
      case "rfq":
        return Array.isArray(v.stages) ? { type: "rfq", stages: v.stages.filter(isRfqStage) } : null;
      case "rfq_stage":
        return isRfqStage(v.stage) ? { type: "rfq_stage", stage: v.stage } : null;
      case "quote":
        return isRecord(v.quote) && typeof v.quote.id === "string" && typeof v.quote.supplier === "string" ? { type: "quote", quote: v.quote as unknown as SupplierQuote } : null;
      case "sample":
        return isRecord(v.sample) && typeof v.sample.id === "string" && typeof v.sample.supplier === "string" ? { type: "sample", sample: v.sample as unknown as SampleItem } : null;
      case "shipment":
        return isRecord(v.shipment) && typeof v.shipment.id === "string" && typeof v.shipment.ref === "string" ? { type: "shipment", shipment: v.shipment as unknown as Shipment } : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function isRfqStage(v: unknown): v is RfqStage {
  return isRecord(v) && typeof v.id === "string" && typeof v.label === "string" && typeof v.count === "number";
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  return i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
}

/** Fold a session's notes (and, failing those, its tool calls) into tile data. */
export function specialistDataFromSession(session: Pick<AgentTileSession, "notes" | "toolCalls">): SpecialistData {
  let data: SpecialistData = { rfq: [], quotes: [], samples: [], shipments: [] };
  let structuredFunnel = false;
  for (const note of session.notes) {
    const parsed = parseSpecialistNote(note.text);
    if (!parsed) continue;
    switch (parsed.type) {
      case "rfq":
        data = { ...data, rfq: parsed.stages };
        structuredFunnel = true;
        break;
      case "rfq_stage":
        data = { ...data, rfq: upsert(data.rfq, parsed.stage) };
        structuredFunnel = true;
        break;
      case "quote":
        data = { ...data, quotes: upsert(data.quotes, parsed.quote) };
        break;
      case "sample":
        data = { ...data, samples: upsert(data.samples, parsed.sample) };
        break;
      case "shipment":
        data = { ...data, shipments: upsert(data.shipments, parsed.shipment) };
        break;
    }
  }
  if (!structuredFunnel && session.toolCalls.length) {
    const counts = DEFAULT_RFQ_STAGES.map((stage) => ({ id: stage.id, label: stage.label, count: session.toolCalls.filter((c) => c.status === "succeeded" && stage.tools.test(c.tool)).length }));
    if (counts.some((c) => c.count > 0)) data = { ...data, rfq: counts };
  }
  return data;
}

/** Does the session hold anything the specialist views can show? */
export function hasSpecialistData(data: SpecialistData): boolean {
  return data.rfq.length > 0 || data.quotes.length > 0 || data.samples.length > 0 || data.shipments.length > 0;
}
