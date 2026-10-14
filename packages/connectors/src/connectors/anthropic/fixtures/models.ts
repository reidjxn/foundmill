import { LISTED_UNROUTED_MODELS, MODELS } from "@foundmill/models/routing";

export interface FixtureModel {
  id: string;
  display_name: string;
  created_at: string;
}

/** Deterministic model list: every routed model plus the older ids a real account also sees (both from routing.ts). */
export const ANTHROPIC_MODEL_FIXTURES: FixtureModel[] = [
  { id: MODELS.opus, display_name: "Claude Opus 5.5", created_at: "2026-07-14T00:00:00Z" },
  { id: MODELS.sonnet, display_name: "Claude Sonnet 5.5", created_at: "2026-07-14T00:00:00Z" },
  { id: MODELS.haiku, display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z" },
  ...LISTED_UNROUTED_MODELS.map((m) => ({ id: m.id, display_name: m.displayName, created_at: m.createdAt })),
];
