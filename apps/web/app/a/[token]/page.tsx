import type { Metadata } from "next";
import { EmailAnswer } from "@/components/email/EmailAnswer";

export const metadata: Metadata = { title: "Answer from your email", robots: { index: false, follow: false } };

/** A one-click answer from a founder email (retention plan, 2026-11-11); public: the token is the credential. */
export default async function EmailAnswerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EmailAnswer token={token} />;
}
