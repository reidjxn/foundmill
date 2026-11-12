/**
 * The share image of a person's public profile (1200 × 630): the initials, the name and the headline, the product's
 * name small. A person has no brand colors, so it is drawn in the design system's own ink and ground (`ON_KIT_DARK`,
 * `ON_KIT_LIGHT`), never a literal here. A profile that is not public has no image.
 */
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { ON_KIT_DARK, ON_KIT_LIGHT } from "@foundmill/dugout";
import { clipText } from "@foundmill/shared/project-page";
import { personInitials } from "@foundmill/shared/person-profile";
import { publicPerson } from "@/lib/public-person.server";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `A person's profile on ${APP_NAME}`;
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const person = await publicPerson(handle);
  if (!person) notFound();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: ON_KIT_DARK, color: ON_KIT_LIGHT }}>
        <div style={{ display: "flex", width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", border: `3px solid ${ON_KIT_LIGHT}`, fontSize: 48, fontWeight: 600, opacity: 0.9 }}>{personInitials(person.displayName)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>{clipText(person.displayName, 50)}</div>
          {person.headline ? <div style={{ display: "flex", fontSize: 40, opacity: 0.8 }}>{clipText(person.headline, 90)}</div> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, opacity: 0.7 }}>
          <span>{person.place ? clipText(person.place, 40) : ""}</span>
          <span>{`Made with ${APP_NAME}`}</span>
        </div>
      </div>
    ),
    size,
  );
}
