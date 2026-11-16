/**
 * The share image of `/` (1200 × 630; components/landing/seo.tsx `HOME_SHARE_IMAGE`): the wordmark, the page's own
 * headline and its first assurance ("Your first card is free and needs no sign-up."), so a link to Foundmill in a group chat says what the page says. Colors are the
 * design system's computed inks (`ON_KIT_DARK`, `ON_KIT_LIGHT`), never a literal here. It lives under /examples/ (a
 * public prefix the landing session owns) because a root `opengraph-image` would replace the default share image of
 * every page that has none of its own. Static, regenerated with the page.
 */
import { ImageResponse } from "next/og";
import { ON_KIT_DARK, ON_KIT_LIGHT } from "@foundmill/dugout";
import { wordmarkSvg } from "@foundmill/dugout/brand";
import { LANDING_WORDS } from "@/components/landing/words";

export const dynamic = "force-static";
export const revalidate = 3600;

const size = { width: 1200, height: 630 };

export function GET() {
  const wordmark = `data:image/svg+xml;base64,${Buffer.from(wordmarkSvg({ fill: ON_KIT_LIGHT })).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: ON_KIT_DARK, color: ON_KIT_LIGHT }}>
        <img src={wordmark} width={330} height={30} alt="" />
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1, maxWidth: 980 }}>{LANDING_WORDS.hero.title}</div>
        <div style={{ display: "flex", fontSize: 32, opacity: 0.78 }}>{LANDING_WORDS.start.text}</div>
      </div>
    ),
    size,
  );
}
