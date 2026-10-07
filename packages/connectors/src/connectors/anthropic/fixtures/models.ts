import { MODELS } from "@foundmill/models/routing";

export interface FixtureModel {
  id: string;
  display_name: string;
  created_at: string;
}

/** Deterministic model list: every routed model plus two older ids a real account also sees. */
export const ANTHROPIC_MODEL_FIXTURES: FixtureModel[] = [
  { id: MODELS.opus, display_name: "Claude Opus 5.5", created_at: "2026-07-14T00:00:00Z" },
  { id: MODELS.sonnet, display_name: "Claude Sonnet 5.5", created_at: "2026-07-14T00:00:00Z" },
  { id: MODELS.haiku, display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z" },
  { id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5", created_at: "2025-09-29T00:00:00Z" },
  { id: "claude-opus-4-1-20250805", display_name: "Claude Opus 4.1", created_at: "2025-08-05T00:00:00Z" },
];
