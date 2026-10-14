import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProfileScreen } from "@/components/live/ProfileScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /profiles/[kind]/[id] — a public founder or business profile (BUILD §6.2, §11.14). `kind` is founder or business. */
export default async function ProfilePage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if ((kind !== "founder" && kind !== "business") || !UUID_RE.test(id)) notFound();
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <ProfileScreen kind={kind} id={id} />
    </Suspense>
  );
}
