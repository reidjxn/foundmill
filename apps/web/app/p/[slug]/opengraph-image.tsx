/**
 * The share image of a project's public page (1200 × 630): the project's name and pitch on its own brand colors, the
 * "Built on" mark small in a corner for a project on the free plan (none on a paid plan). Colors come from the business (its brand) and the design system's computed ink
 * (`kitOnPrimary`, `kitRamp`), never a literal here. A page that is not public has no image.
 */
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { ON_KIT_DARK, isHexColour, kitOnPrimary, kitRamp } from "@foundmill/dugout";
import { PAGE_STAGE_LABELS, builtOnWords, clipText } from "@foundmill/shared/project-page";
import { publicProjectPage } from "@/lib/public-page.server";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `A project's page on ${APP_NAME}`;
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await publicProjectPage(slug);
  if (!page) notFound();
  const primary = isHexColour(page.brandPrimary) ? page.brandPrimary : ON_KIT_DARK;
  const ramp = kitRamp(primary);
  const ink = kitOnPrimary(ramp.deep);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: `linear-gradient(135deg, ${ramp.deep} 0%, ${ON_KIT_DARK} 100%)`, color: ink }}>
        <div style={{ display: "flex", height: 8, width: 160, background: primary, borderRadius: 4 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600, opacity: 0.85 }}>{clipText(page.name, 60)}</div>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{clipText(page.pitch, 110)}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ fontSize: 28, opacity: 0.75 }}>{PAGE_STAGE_LABELS[page.stage]}</span>
          {page.mark ? <span style={{ fontSize: 20, opacity: 0.6 }}>{builtOnWords(APP_NAME).mark}</span> : null}
        </div>
      </div>
    ),
    size,
  );
}
