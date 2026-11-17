"use client";
/**
 * "Shape my idea" at the end of the page (DIRECTION §4 "8. Start"): one idea box per page (one bot check), so this
 * scrolls back to the hero's box and puts the cursor in its field. Instant under reduced motion.
 */
import { Fan } from "lucide-react";
import { Icon, prefersReducedMotion } from "@foundmill/dugout";
import { IDEA_BUTTON } from "./flags";
import { IDEA_BOX_WORDS } from "./idea-box/IdeaBox";

export function StartButton() {
  return (
    <button
      type="button"
      className={IDEA_BUTTON === "filled" ? "idea-gen-filled" : "idea-gen min-h-tap px-4"}
      onClick={() => {
        document.getElementById("hero")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        document.querySelector<HTMLTextAreaElement>('[data-testid="idea-input"]')?.focus({ preventScroll: true });
      }}
      data-testid="start-shape"
    >
      <Icon icon={Fan} size={18} />
      {IDEA_BOX_WORDS.generate}
    </button>
  );
}
