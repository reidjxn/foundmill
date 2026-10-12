/**
 * The business layout (docs/ARCHITECTURE.md §14): loads the founder profile (AC-11.1.1 gate), the business and its
 * departments on the server, then renders the Dugout AppShell through <BusinessShell> (client) with everything
 * the surfaces below need: WidgetDataProvider, keyboard map, universal search, Continue state, stream.
 *
 * The profile, the business and the departments are asked in parallel; then the shell's first-screen queries (inbox,
 * finance, cycle) start and reach the browser with the page (lib/shell-data.server.ts). `generateMetadata` shares this
 * request's `business.get` (lib/trpc-server.ts `serverBusiness`).
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerDateFormat } from "@/lib/date-format.server";
import { Prefetched } from "@/lib/hydrate.server";
import { startBusinessShell } from "@/lib/shell-data.server";
import { serverApi, serverBusiness } from "@/lib/trpc-server";
import { errorMessage, trpcErrorCode } from "@/lib/trpc";
import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { BusinessShell } from "@/components/shell/BusinessShell";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { bid } = await params;
  if (!UUID_RE.test(bid)) return {};
  try {
    const data = await serverBusiness(bid);
    if (!data) return {};
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

  // One round of requests: the profile gate, the business and its departments (the shell's first-screen queries follow
  // once these are in, see lib/shell-data.server.ts).
  const shell = startBusinessShell(server, bid);
  // The person's date format (the cookie, else the API), so the shell renders in it on the first byte.
  const dateFormat = getServerDateFormat();
  dateFormat.catch(() => undefined);
  let profile;
  try {
    profile = await api.founder.profile.get.query();
  } catch (err) {
    return <ApiErrorPage error={err} email={server.auth.email} />;
  }
  // AC-11.1.1: no /b/* before the founder profile exists.
  if (!profile.complete) redirect("/onboarding");

  try {
    const [[business, departments], date] = await Promise.all([shell.data, dateFormat]);
    return (
      <Prefetched queryClient={shell.prefetch()}>
        <DateFormatHost initial={date.prefs} owner={date.owner}>
          <BusinessShell businessId={bid} initialBusiness={business} initialDepartments={departments} viewer={{ email: profile.email ?? server.auth.email, userId: server.auth.userId }}>
            {children}
          </BusinessShell>
        </DateFormatHost>
      </Prefetched>
    );
  } catch (err) {
    const code = trpcErrorCode(err);
    if (code === "NOT_FOUND" || code === "FORBIDDEN") notFound();
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
}
