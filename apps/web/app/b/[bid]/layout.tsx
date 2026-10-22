/**
 * The business layout (docs/ARCHITECTURE.md §14): loads the founder profile (AC-11.1.1 gate), the business and its
 * departments on the server, then renders the Dugout AppShell through <BusinessShell> (client) with everything
 * the surfaces below need: WidgetDataProvider, keyboard map, universal search, Continue state, stream.
 *
 * The profile, the business, the departments and the guidance preferences are asked in parallel; then the shell's
 * first-screen queries (inbox, finance, cycle) start and reach the browser with the page (lib/shell-data.server.ts),
 * together with the profile the gate already read. The guidance preferences go to GuidanceHost as `initial`, below
 * `<Prefetched>`, so the first render holds the account's answer (lib/guidance.server.ts). app/b/loading.tsx shows the app frame while this waits, so the document head and the scripts
 * reach the browser first.
 *
 * Browser titles ("Inbox · Northwind · Foundmill") are rendered by <BusinessTitle> from what the shell already holds,
 * not by Next metadata: a `generateMetadata` here would ask the API for the business again on every navigation and
 * hover prefetch, since metadata is resolved again for each one while this layout is not.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { staleBusinessPath } from "@/lib/auth/last-business";
import { getLastBusinessId } from "@/lib/auth/server";
import { getServerDateFormat } from "@/lib/date-format.server";
import { getServerGuidance } from "@/lib/guidance.server";
import { Prefetched } from "@/lib/hydrate.server";
import { startBusinessShell } from "@/lib/shell-data.server";
import { serverApi } from "@/lib/trpc-server";
import { handOverProfile } from "@/lib/profile-handover";
import { errorMessage, trpcErrorCode } from "@/lib/trpc";
import { AgentPersonaHost } from "@/components/providers/AgentPersonaHost";
import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { GuidanceHost } from "@/components/providers/GuidanceHost";
import { BusinessShell } from "@/components/shell/BusinessShell";
import { BusinessTitle } from "@/components/shell/BusinessTitle";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const dynamic = "force-dynamic";

/** No Next `<title>` under /b/[bid] (not even the product name from the root layout): <BusinessTitle> renders the only one. */
export const metadata: Metadata = { title: null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string }>;

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
  // The guided layer's preferences (never rejects: a failed read is handed over as null and read in the browser).
  const guidance = getServerGuidance();
  let profile;
  try {
    profile = await api.founder.profile.get.query();
  } catch (err) {
    return <ApiErrorPage error={err} email={server.auth.email} />;
  }
  // AC-11.1.1: no /b/* before the founder profile exists.
  if (!profile.complete) redirect("/onboarding");

  let loaded;
  try {
    loaded = await Promise.all([shell.data, dateFormat, guidance]);
  } catch (err) {
    const code = trpcErrorCode(err);
    if (code === "NOT_FOUND" || code === "FORBIDDEN") {
      // `/` sent the founder here from the last-business cookie, and that business is gone: forget it and pick again
      // (proxy.ts) instead of stopping on "No business at this address". Only for the cookie's business, so it cannot loop.
      if ((await getLastBusinessId()) === bid) redirect(staleBusinessPath(bid));
      notFound();
    }
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
  const [[business, departments], date, guided] = loaded;
  return (
    // The profile the gate just read goes along, so the shell's business menu, the Inbox and the reading pane do not ask again.
    <Prefetched queryClient={handOverProfile(shell.prefetch(), profile)}>
      <GuidanceHost initial={guided.prefs} signedIn textSizeOwner={date.owner}>
        <DateFormatHost initial={date.prefs} owner={date.owner}>
          <AgentPersonaHost businessId={bid}>
            <BusinessShell businessId={bid} initialBusiness={business} initialDepartments={departments} viewer={{ email: profile.email ?? server.auth.email, userId: server.auth.userId, name: profile.profile?.displayName ?? null }}>
              <BusinessTitle />
              {children}
            </BusinessShell>
          </AgentPersonaHost>
        </DateFormatHost>
      </GuidanceHost>
    </Prefetched>
  );
}
