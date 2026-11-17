/**
 * The share images of a shared Customer Update (WP-14 T9; DESIGN §9f), one design at the two sizes a milestone's card
 * uses (lib/milestone-card-image.tsx): wide for link previews (app/m/update/[id]/opengraph-image.tsx) and tall for
 * story posts (app/m/update/[id]/story-image). Both carry the project's name, the day, what happened, the lead channel
 * and the standout agent, "Verified by Foundmill", and "Built on Foundmill" small in a corner by the project's plan.
 *
 * Never the customer, the amount or a count, and not the founders' own line: an image travels without its page, so it
 * carries only what the platform recorded.
 */
import { ImageResponse } from "next/og";
import { APP_NAME } from "@foundmill/config";
import { ON_KIT_DARK, isHexColour, kitOnPrimary, kitRamp, updateCardChannelLabel, updateCardDay } from "@foundmill/dugout";
import { builtOnWords, clipText } from "@foundmill/shared/project-page";
import { storyWords } from "@foundmill/shared/project-story";
import { UPDATE_CARD_HEADLINE_WORDS, updateCardWords } from "@foundmill/shared/update-cards";
import { formatDate } from "./format";
import type { PublicUpdateCard } from "./public-page.server";

type ImageCard = Pick<PublicUpdateCard, "name" | "mark" | "brandPrimary"> & { card: Pick<PublicUpdateCard["card"], "headline" | "occurredOn" | "leadChannelKey" | "standoutAgent"> };

/** What both images print, in one place so the two sizes can never say different things. */
export function updateCardImageWords(c: ImageCard) {
  const words = updateCardWords(APP_NAME);
  const day = updateCardDay(c.card.occurredOn);
  const channel = updateCardChannelLabel(c.card.leadChannelKey);
  const agent = c.card.standoutAgent?.trim() || null;
  return {
    headline: UPDATE_CARD_HEADLINE_WORDS[c.card.headline],
    name: clipText(c.name, 60),
    date: day ? formatDate(day) : "",
    channel: channel ? `${words.leadChannel}: ${channel}` : null,
    agent: agent ? `${words.standoutAgent}: ${clipText(agent, 40)} (${words.aiAgent})` : null,
    verified: storyWords(APP_NAME).verified,
    builtOn: c.mark ? builtOnWords(APP_NAME).mark : null,
  };
}

/** One design at two sizes: `tall` scales the type up and stacks the foot. */
export function updateCardImage(c: ImageCard, size: { width: number; height: number }): ImageResponse {
  const tall = size.height > size.width;
  const words = updateCardImageWords(c);
  const primary = isHexColour(c.brandPrimary) ? c.brandPrimary : ON_KIT_DARK;
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
        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 36 : 18 }}>
          <div style={{ display: "flex", fontSize: tall ? 44 : 30, opacity: 0.75 }}>{words.date}</div>
          <div style={{ display: "flex", fontSize: tall ? 124 : 84, fontWeight: 700, lineHeight: 1.05 }}>{words.headline}</div>
          {words.channel ? <div style={{ display: "flex", fontSize: tall ? 42 : 28, opacity: 0.85 }}>{words.channel}</div> : null}
          {words.agent ? <div style={{ display: "flex", fontSize: tall ? 42 : 28, opacity: 0.85 }}>{words.agent}</div> : null}
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
