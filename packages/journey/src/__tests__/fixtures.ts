/**
 * Hand-built fixtures for the journey tests. Ids are deterministic GUIDs (not v4) so that fixtures read well; the
 * schemas accept any 8-4-4-4-12 hex id (docs/DECISIONS.md "ids validated as GUIDs").
 */
import type { ChannelKey } from "@founder-manager/shared";
import type { JourneyAgentInput } from "../builder";
import { emptyTouchSource } from "../synthetic";
import type { Conversion, Touch, TouchKind, TouchSource } from "../types";

export const BUSINESS_ID = "b0000000-0000-0000-0000-000000000001";
export const ENTITY_ID = "e0000000-0000-0000-0000-000000000001";
export const VISITOR_ID = "a0000000-0000-0000-0000-000000000001";
export const OTHER_ENTITY_ID = "e0000000-0000-0000-0000-000000000002";

/** A readable deterministic GUID: non-hex prefix characters are hex-encoded (t → 74, x → 78) so the id stays valid. */
export const fid = (prefix: string, n: number): string => {
  const hex = [...prefix.toLowerCase()].map((ch) => (/[0-9a-f]/.test(ch) ? ch : ch.charCodeAt(0).toString(16))).join("");
  return `${hex.padEnd(8, "0").slice(0, 8)}-0000-0000-0000-${String(n).padStart(12, "0")}`;
};

export const AGENTS: JourneyAgentInput[] = [
  { agentId: fid("a9", 1), name: "Paid", role: "Paid media lead", departmentId: fid("d", 1), channelKeys: ["paid_ads"] },
  { agentId: fid("a9", 2), name: "Lifecycle", role: "Lifecycle email", departmentId: fid("d", 1), channelKeys: ["email_automation"] },
  { agentId: fid("a9", 3), name: "Search", role: "SEO and content", departmentId: fid("d", 1), channelKeys: ["seo", "content"] },
  { agentId: fid("a9", 4), name: "Outbound", role: "Outbound", departmentId: fid("d", 2), channelKeys: ["lead_generation"] },
];

export interface TouchSpec {
  /** Hours before the conversion. */
  hoursBefore: number;
  channelKey?: ChannelKey | null;
  kind?: TouchKind;
  identified?: boolean;
  firstParty?: boolean;
  source?: Partial<TouchSource>;
  campaignId?: string | null;
}

export const CONVERTED_AT = "2025-06-12T09:30:00.000Z";

export function makeConversion(over: Partial<Conversion> = {}): Conversion {
  return {
    id: fid("c", 1), entityId: ENTITY_ID, kind: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: CONVERTED_AT, sourceEventId: null, firstPayment: true, ...over,
  };
}

/** Touches for one journey, numbered in time order, ending before `convertedAt`. */
export function makeTouches(specs: readonly TouchSpec[], convertedAt: string = CONVERTED_AT): Touch[] {
  const end = Date.parse(convertedAt);
  return specs.map((s, i) => ({
    id: fid("t", i + 1),
    visitorId: VISITOR_ID,
    entityId: s.identified ? ENTITY_ID : null,
    occurredAt: new Date(end - s.hoursBefore * 3_600_000).toISOString(),
    channelKey: s.channelKey === undefined ? "seo" : s.channelKey,
    campaignId: s.campaignId ?? null,
    kind: s.kind ?? "visit",
    source: { ...emptyTouchSource(), ...(s.source ?? {}) },
    firstParty: s.firstParty ?? true,
  }));
}

/** The canonical five-touch journey used across the builder tests: paid → seo → email → direct → outbound. */
export const FIVE_TOUCH: TouchSpec[] = [
  { hoursBefore: 240, channelKey: "paid_ads", kind: "ad_click", firstParty: false, source: { clickIds: { ...emptyTouchSource().clickIds, gclid: "abc123" } } },
  { hoursBefore: 180, channelKey: "seo" },
  { hoursBefore: 96, channelKey: "email_automation", kind: "email_click", identified: true, source: { agentId: fid("a9", 2) } },
  { hoursBefore: 48, channelKey: null },
  { hoursBefore: 6, channelKey: "lead_generation", kind: "meeting", identified: true },
];

export const sum = (xs: Iterable<number>): number => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

/** Journey weights are rounded to 9 decimals, so a sum of n weights can be off by n × 5e-10. */
export const closeTo = (a: number, b: number, eps = 1e-8): boolean => Math.abs(a - b) <= eps;
