/**
 * The LIVE pages (BUILD §6.2, §11.14): /network, /communities[/id], /leaderboards[/boardId]. They are about the founder,
 * not about one business, so they live outside /b/[bid]; the app shell still needs a business (brand colours, departments,
 * Continue, search), so this layout picks the current one: the business the founder last opened (the cookie the business
 * layout sets), else their newest. A founder without a business is sent to /new. Signed-out visitors never get here:
 * proxy.ts sends them to /login (these paths are not public).
 *
 * The business the cookie names is loaded while the profile loads (lib/shell-data.server.ts) and used only if the
 * profile confirms it is one of the founder's; otherwise the picked business is loaded after. The app frame shows
 * meanwhile (a Suspense boundary around all of it), so the document head and the scripts reach the browser first.
 */
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";
import { getServerDateFormat } from "@/lib/date-format.server";
import { getServerGuidance } from "@/lib/guidance.server";
import { Prefetched } from "@/lib/hydrate.server";
import { startBusinessShell } from "@/lib/shell-data.server";
import { errorMessage } from "@/lib/trpc";
import { handOverProfile } from "@/lib/profile-handover";
import { serverApi } from "@/lib/trpc-server";
import { LiveViewerProvider } from "@/components/live/viewer";
import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { GuidanceHost } from "@/components/providers/GuidanceHost";
import { BusinessShell } from "@/components/shell/BusinessShell";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { ShellSkeleton } from "@/components/shell/ShellSkeleton";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const dynamic = "force-dynamic";

export default function LiveLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <LiveShell>{children}</LiveShell>
    </Suspense>
  );
}

async function LiveShell({ children }: { children: ReactNode }) {
  const server = await serverApi();
  if (!server) redirect("/login");
  const { api } = server;

  const lastBusinessId = await getLastBusinessId();
  const likely = lastBusinessId ? startBusinessShell(server, lastBusinessId) : null;
  const dateFormat = getServerDateFormat();
  dateFormat.catch(() => undefined);
  // The guided layer's preferences, handed to GuidanceHost as `initial` (never rejects; lib/guidance.server.ts).
  const guidance = getServerGuidance();

  let profile;
  try {
    profile = await api.founder.profile.get.query();
  } catch (err) {
    return <ApiErrorPage error={err} email={server.auth.email} />;
  }
  // AC-11.1.1: no app screen before the founder profile exists.
  const founder = profile.profile;
  if (!founder) redirect("/onboarding");

  const current = pickCurrentBusiness(lastBusinessId, profile.businesses);
  if (!current) redirect("/new");
  const shell = likely && likely.businessId === current.id ? likely : startBusinessShell(server, current.id);

  try {
    const [[business, departments], date, guided] = await Promise.all([shell.data, dateFormat, guidance]);
    return (
      <Prefetched queryClient={handOverProfile(shell.prefetch(), profile)}>
        <GuidanceHost initial={guided.prefs} signedIn textSizeOwner={date.owner}>
          <DateFormatHost initial={date.prefs} owner={date.owner}>
            <BusinessShell businessId={current.id} initialBusiness={business} initialDepartments={departments} viewer={{ email: profile.email ?? server.auth.email, userId: server.auth.userId, name: profile.profile?.displayName ?? null }}>
              <LiveViewerProvider value={{ userId: founder.userId, displayName: founder.displayName }}>{children}</LiveViewerProvider>
            </BusinessShell>
          </DateFormatHost>
        </GuidanceHost>
      </Prefetched>
    );
  } catch (err) {
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
}
