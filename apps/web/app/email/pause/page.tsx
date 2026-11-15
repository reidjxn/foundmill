import type { Metadata } from "next";
import { EmailPause } from "@/components/email/EmailPause";

export const metadata: Metadata = { title: "Pause emails", robots: { index: false, follow: false } };

/** "Pause every email" from a founder email's footer (retention plan, 2026-11-11); public: the signed token is the credential. */
export default async function EmailPausePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = (await searchParams).t;
  return <EmailPause token={typeof t === "string" ? t : null} />;
}
