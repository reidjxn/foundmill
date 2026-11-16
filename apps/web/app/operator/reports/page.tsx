/**
 * /operator/reports — the platform's review queue for reports of people, profiles and messages (docs/NETWORK.md F21).
 * Desktop only. The queue is read on the server first: anyone outside `OPERATOR_USER_IDS` gets the plain not-found page,
 * the same as an address that does not exist, and never the queue's screen.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportsQueue } from "@/components/operator/ReportsQueue";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { trpcErrorCode } from "@/lib/trpc";
import { serverApi } from "@/lib/trpc-server";

// No title of its own: the tab says nothing about a queue until the server has let the operator in.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OperatorReportsPage() {
  const server = await serverApi();
  if (!server) redirect("/login?next=%2Foperator%2Freports");
  try {
    await server.api.operator.reports.list.query({ limit: 1 });
  } catch (err) {
    if (trpcErrorCode(err) === "NOT_FOUND") notFound();
    return <ApiErrorPage error={err} email={server.auth.email} />;
  }
  return <ReportsQueue viewer={{ email: server.auth.email }} />;
}
