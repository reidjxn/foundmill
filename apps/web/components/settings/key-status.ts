/**
 * The Anthropic key's state for the Settings list (docs/UX_AUDIT_AND_PLAN.md §7.7, B13): the key left the sidebar foot,
 * so the Keys entry carries a chip that says where it stands. Read from the business row the shell already holds
 * (`business.get`), never from a query of its own: a business on its own key bills model calls as `byok`; a revoked key
 * stops the team with the reason `key_revoked` until a new key is stored or an owner or admin resumes; anything else
 * means no key, and the team runs on credits.
 */
import type { ChipTone } from "@foundmill/dugout";

export type KeyStatus = "connected" | "none" | "revoked";

/** The chip's word and tone for each state, sentence case. */
export const KEY_STATUS_WORDS: Record<KeyStatus, { word: string; tone: ChipTone }> = {
  connected: { word: "Connected", tone: "good" },
  none: { word: "None", tone: "neutral" },
  revoked: { word: "Revoked", tone: "bad" },
};

export interface KeyStatusSource {
  modelBilling?: string | null;
  agentsStoppedAt?: Date | string | null;
  agentsStoppedReason?: string | null;
}

/** "revoked" while the team is stopped for a revoked key, "connected" on the business's own key, else "none". */
export function keyStatus(business: KeyStatusSource): KeyStatus {
  if (business.agentsStoppedAt && business.agentsStoppedReason === "key_revoked") return "revoked";
  return business.modelBilling === "byok" ? "connected" : "none";
}
