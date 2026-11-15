/**
 * A person's public profile (docs/THESIS_REVIEW.md package 2.3): `/u/<handle>`, open to anyone signed out
 * (lib/auth/redirects.ts `PUBLIC_PREFIXES`), from 390 px (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`),
 * and indexable while it is public (the root layout says noindex for everything else; not found stays noindex). The
 * content is what the person published, read through the API's public view; an unknown handle and a profile that is
 * not public are the same not-found. No contact button yet (connecting is a later package).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { PersonPage } from "@foundmill/dugout";
import { personDescription, personTitle } from "@foundmill/shared/person-profile";
import { publicPerson } from "@/lib/public-person.server";

// Read on every request: a profile taken down is gone at once, and changes show as soon as they are saved.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const person = await publicPerson(handle);
  if (!person) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = personTitle(person.displayName, person.headline);
  const description = personDescription(person.displayName, person.about, person.headline, APP_NAME);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: person.url },
    openGraph: { title, description, url: person.url, siteName: APP_NAME, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function PublicPersonRoute({ params }: Props) {
  const { handle } = await params;
  const person = await publicPerson(handle);
  if (!person) notFound();
  return (
    <PersonPage
      name={person.displayName}
      headline={person.headline}
      about={person.about}
      strengths={person.strengths}
      wantsToLearn={person.wantsToLearn}
      lookingFor={person.lookingFor}
      place={person.place}
      projects={person.projects.map((p) => ({ slug: p.slug, name: p.name, pitch: p.pitch, href: p.path }))}
    />
  );
}
