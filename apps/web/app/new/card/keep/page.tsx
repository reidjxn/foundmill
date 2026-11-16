/**
 * /new/card/keep — the card waiting from the landing page's idea box (docs/IDEA_BOX.md): where /start sends a person
 * right after sign-in, from 390 px. They see the card and the words it was drafted from, and keep it with one press
 * (`keepCard`), or say it is not theirs (`notMine`). Nothing reaches a deck unseen (security review 2026-11-13).
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDEA_CLAIM_PARAM, IDEA_COOKIE } from "@foundmill/shared";
import { CardKeepView } from "@/components/new/card/CardKeepView";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { KEEP_THEN_PARAM, KEEP_THEN_STUDIO } from "@/lib/auth/constants";
import { serverApi } from "@/lib/trpc-server";
import { keepCard, notMine } from "./actions";

export const metadata: Metadata = { title: "Keep your card" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function KeepCardPage({ searchParams }: Props) {
  const params = await searchParams;
  const claimParam = params[IDEA_CLAIM_PARAM];
  const claim = typeof claimParam === "string" ? claimParam : null;
  const studio = params[KEEP_THEN_PARAM] === KEEP_THEN_STUDIO;
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") {
    const start = new URLSearchParams();
    if (claim) start.set(IDEA_CLAIM_PARAM, claim);
    if (studio) start.set(KEEP_THEN_PARAM, KEEP_THEN_STUDIO);
    redirect(`/login?next=${encodeURIComponent(start.size ? `/start?${start.toString()}` : "/start")}`);
  }
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const server = await serverApi();
  if (!server) redirect("/login?next=%2Fstart");
  const preview = await server.api.ideaBox.preview.query({ token: (await cookies()).get(IDEA_COOKIE)?.value ?? null, claim }).catch(() => null);
  if (!preview) redirect("/start");
  return <CardKeepView preview={preview} claim={preview.source === "link" ? claim : null} viewer={{ email: result.viewer.email }} keepAction={keepCard.bind(null, studio)} notMineAction={notMine} />;
}
