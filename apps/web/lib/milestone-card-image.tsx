/**
 * The share images of a milestone's card (docs/NETWORK.md F3 "two sizes from one design"): wide for link previews
 * (1200 × 630, app/m/[id]/opengraph-image.tsx) and tall for story posts (1080 × 1920, app/m/[id]/story-image). Both
 * carry the same four things: the milestone's words, the project's name, the day it was reached and "Verified by
 * Foundmill"; and, for a project on the free plan only, "Built on Foundmill" small in a corner.
 *
 * Colors come from the business (its brand) and the design system's computed ink (`kitRamp`, `kitOnPrimary`), never a
 * literal here, as on the project page's own share image. Nothing is counted, and a milestone about a customer is its
 * words and date only.
 */
import { ImageResponse } from "next/og";
import { APP_NAME } from "@foundmill/config";
import { ON_KIT_DARK, isHexColour, kitOnPrimary, kitRamp } from "@foundmill/dugout";
import { builtOnWords, clipText } from "@foundmill/shared/project-page";
import { storyWords } from "@foundmill/shared/project-story";
import { formatDate } from "./format";
import type { PublicMilestoneCard } from "./public-page.server";

export const CARD_IMAGE_WIDE = { width: 1200, height: 630 } as const;
export const CARD_IMAGE_TALL = { width: 1080, height: 1920 } as const;
export const CARD_IMAGE_TYPE = "image/png";

/** What both images print, in one place so the two sizes can never say different things. */
export function cardImageWords(card: Pick<PublicMilestoneCard, "name" | "milestone" | "mark">) {
  return {
    label: clipText(card.milestone.label, 60),
    name: clipText(card.name, 60),
    date: formatDate(card.milestone.achievedAt),
    verified: storyWords(APP_NAME).verified,
    builtOn: card.mark ? builtOnWords(APP_NAME).mark : null,
  };
}

/** One design at two sizes: `tall` scales the type up and stacks the foot. */
export function milestoneCardImage(card: Pick<PublicMilestoneCard, "name" | "milestone" | "mark" | "brandPrimary">, size: { width: number; height: number }): ImageResponse {
  const tall = size.height > size.width;
  const words = cardImageWords(card);
  const primary = isHexColour(card.brandPrimary) ? card.brandPrimary : ON_KIT_DARK;
  const ramp = kitRamp(primary);
  const ink = kitOnPrimary(ramp.deep);
  const pad = tall ? 96 : 72;
  const check = tall ? 44 : 32;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: pad, background: `linear-gradient(${tall ? 160 : 135}deg, ${ramp.deep} 0%, ${ON_KIT_DARK} 100%)`, color: ink }}>
        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 40 : 24 }}>
          <div style={{ display: "flex", height: tall ? 12 : 8, width: tall ? 220 : 160, background: primary, borderRadius: 6 }} />
          <div style={{ display: "flex", fontSize: tall ? 56 : 40, fontWeight: 600, opacity: 0.85 }}>{words.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 40 : 24 }}>
          <div style={{ display: "flex", fontSize: tall ? 44 : 30, opacity: 0.75 }}>{words.date}</div>
          <div style={{ display: "flex", fontSize: tall ? 132 : 92, fontWeight: 700, lineHeight: 1.05 }}>{words.label}</div>
        </div>
        <div style={{ display: "flex", flexDirection: tall ? "column" : "row", justifyContent: "space-between", alignItems: tall ? "flex-start" : "flex-end", gap: tall ? 32 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: tall ? 20 : 14, fontSize: tall ? 44 : 30, fontWeight: 600 }}>
            <svg width={check} height={check} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="m8 12.5 2.75 2.75L16 9.5" />
            </svg>
            <span>{words.verified}</span>
          </div>
          {words.builtOn ? <span style={{ fontSize: tall ? 30 : 20, opacity: 0.6 }}>{words.builtOn}</span> : null}
        </div>
      </div>
    ),
    size,
  );
}
