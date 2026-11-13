/**
 * What the /terms and /privacy routes share: each document's metadata (indexable, unlike the rest of the app; the root
 * layout says noindex) and the links between the two documents.
 */
import type { Metadata } from "next";
import type { LegalDocument, LegalPageLink } from "@foundmill/dugout";
import { LEGAL_ROUTES } from "./facts";

export type LegalKey = keyof typeof LEGAL_ROUTES;

export const LEGAL_LABELS: Record<LegalKey, string> = { terms: "Terms", privacy: "Privacy" };

export function legalLinks(current: LegalKey): LegalPageLink[] {
  return (Object.keys(LEGAL_ROUTES) as LegalKey[]).map((key) => ({ href: LEGAL_ROUTES[key], label: LEGAL_LABELS[key], current: key === current }));
}

export function legalMetadata(key: LegalKey, doc: LegalDocument, description: string): Metadata {
  return {
    title: doc.title,
    description,
    alternates: { canonical: LEGAL_ROUTES[key] },
    openGraph: { title: doc.title, description, url: LEGAL_ROUTES[key], type: "article" },
    robots: { index: true, follow: true },
  };
}
