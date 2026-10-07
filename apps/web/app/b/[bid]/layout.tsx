/**
 * The business layout (docs/ARCHITECTURE.md §14): loads the founder profile (AC-11.1.1 gate), the business and its
 * departments on the server, then renders the Dugout AppShell through <BusinessShell> (client) with everything
 * the surfaces below need: WidgetDataProvider, keyboard map, universal search, Continue state, stream.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { serverApi } from "@/lib/trpc-server";
import { errorMessage, trpcErrorCode } from "@/lib/trpc";
import { BusinessShell } from "@/components/shell/BusinessShell";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { bid } = await params;
  const server = await serverApi();
  if (!server || !UUID_RE.test(bid)) return {};
  try {
    const data = await server.api.business.get.query({ businessId: bid });
    return { title: { default: data.business.name, template: `%s · ${data.business.name}` } };
  } catch {
    return {};
  }
}

export default async function BusinessLayout({ params, children }: { params: Params; children: ReactNode }) {
  const { bid } = await params;
  if (!UUID_RE.test(bid)) notFound();
  const server = await serverApi();
  if (!server) redirect(`/login?next=${encodeURIComponent(`/b/${bid}/home`)}`);
  const { api } = server;

  let profile;
  try {
    profile = await api.founder.profile.get.query();
  } catch (err) {
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
  // AC-11.1.1: no /b/* before the founder profile exists.
  if (!profile.complete) redirect("/onboarding");

  try {
    const [business, departments] = await Promise.all([api.business.get.query({ businessId: bid }), api.department.list.query({ businessId: bid, includeHidden: true })]);
    return (
      <BusinessShell businessId={bid} initialBusiness={business} initialDepartments={departments} viewer={{ email: profile.email ?? server.auth.email, userId: server.auth.userId }}>
        {children}
      </BusinessShell>
    );
  } catch (err) {
    const code = trpcErrorCode(err);
    if (code === "NOT_FOUND" || code === "FORBIDDEN") notFound();
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
}
