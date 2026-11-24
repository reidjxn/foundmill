"use client";
/**
 * Settings › Integrations › "Add a website the team can work in" (founder, Nov 22, 2026): the sites on the site list, each
 * connected by the founder's own sign-in in a live view (BrowserSiteConnectDialog). The `browser_*` connectors are listed
 * here only, never in the general connector list. The live view's address is held in this component's state for the one
 * sign-in and dropped when the dialog closes; the api never stores it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { BrowserAddSite, BrowserSiteConnectDialog, BrowserSitesList, type BrowserConnectStage, type BrowserSiteAnswer, type BrowserSiteRow } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { errorMessage } from "@/lib/trpc";
import { useInvalidateRouters } from "./SettingsScreen";
import { SettingsSection, useSettingsToast } from "./shared";

/** The part of a catalogue entry this section reads. */
export interface BrowserCatalogueEntry {
  key: string;
  browser: { siteKey: string; name: string; state: "open" | "ask_first" | "no_longer_allowed" } | null;
  available?: boolean;
  integration: { id: string; status: string; settings?: unknown } | null;
}

/** The sites to list: the ones that can be connected here, and any already connected (so it can be disconnected). */
export function browserSiteRows(catalogue: readonly BrowserCatalogueEntry[]): BrowserSiteRow[] {
  return catalogue
    .filter((c) => c.browser !== null && (c.available !== false || (c.integration !== null && c.integration.status !== "disconnected")))
    .map((c) => {
      const status = c.integration?.status;
      // A website the founder typed keeps its address in its integration's config: signing in again sends it back.
      const address = (c.integration?.settings as { config?: { address?: unknown } } | null | undefined)?.config?.address;
      return { connectorKey: c.key, siteKey: c.browser!.siteKey, name: c.browser!.name, askFirst: c.browser!.state === "ask_first", ...(typeof address === "string" ? { address } : {}), status: !status || status === "disconnected" ? ("not_connected" as const) : c.browser!.state === "no_longer_allowed" ? ("blocked" as const) : status === "expired" ? ("expired" as const) : ("connected" as const) };
    });
}

interface Open {
  site: BrowserSiteRow;
  stage: BrowserConnectStage;
  /** The page itself, for this sign-in only. */
  liveViewUrl: string | null;
  error: string | null;
}

/** What the connect calls send for a website the founder typed; nothing for one on the list. */
const siteInput = (site: BrowserSiteRow): Record<string, unknown> => (site.address ? { address: site.address, acceptUnconfirmed: true } : {});

export function BrowserSitesSection({ businessId, catalogue, canEdit, loading }: { businessId: string; catalogue: readonly BrowserCatalogueEntry[]; canEdit: boolean; loading?: boolean }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [open, setOpen] = useState<Open | null>(null);
  const sites = browserSiteRows(catalogue);
  const noneConnected = sites.every((s) => s.status === "not_connected");
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [answer, setAnswer] = useState<BrowserSiteAnswer | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const starters = useQuery({ ...trpc.browser.starters.queryOptions({ businessId }), enabled: canEdit });
  const check = useMutation(trpc.browser.checkSite.mutationOptions());
  const refresh = useMutation(trpc.browser.refreshStarters.mutationOptions());
  // Starter sites with no fresh check are checked once, quietly, when an administrator opens Settings; they appear when they pass.
  const asked = useRef(false);
  useEffect(() => {
    if (!canEdit || asked.current || !starters.data || starters.data.pending.length === 0) return;
    asked.current = true;
    refresh.mutate({ businessId }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.browser.starters.queryKey({ businessId }) }) });
  }, [canEdit, starters.data, businessId, refresh, queryClient, trpc]);
  const connect = useMutation(trpc.integrations.connect.mutationOptions());
  const disconnect = useMutation(trpc.integrations.disconnect.mutationOptions({ onSuccess: () => (void invalidate(["integrations"]), t.saved("Disconnected", "The saved sign-in is deleted.")), onError: (e) => t.failed(e) }));

  const start = (site: BrowserSiteRow) => {
    setOpen({ site, stage: "starting", liveViewUrl: null, error: null });
    connect.mutate(
      { businessId, connectorKey: site.connectorKey, input: siteInput(site) },
      {
        onSuccess: (r) => setOpen((o) => (o && o.site.connectorKey === site.connectorKey ? { ...o, stage: "sign_in", liveViewUrl: r.signIn?.liveViewUrl ?? null } : o)),
        onError: (e) => setOpen((o) => (o ? { ...o, stage: "intro", error: errorMessage(e) } : o)),
      },
    );
  };
  // Connect: the plain words first for the first site and for a site not yet confirmed; otherwise straight to the sign-in.
  const begin = (site: BrowserSiteRow) => (noneConnected || site.askFirst ? setOpen({ site, stage: "intro", liveViewUrl: null, error: null }) : start(site));
  const done = () => {
    if (!open) return;
    const { site } = open;
    connect.mutate(
      { businessId, connectorKey: site.connectorKey, input: { ...siteInput(site), done: true } },
      {
        onSuccess: () => {
          void invalidate(["integrations"]);
          setOpen(null);
          t.saved(`Signed in to ${site.name}`, `The team can work in ${site.name} now. You can watch and stop it from Working now.`);
        },
        // "Not signed in yet" and the like: the message says what is missing and the dialog stays open.
        onError: (e) => setOpen((o) => (o ? { ...o, error: errorMessage(e) } : o)),
      },
    );
  };
  // Cancel, Esc and the close button all throw an unsaved sign-in away.
  const cancel = () => {
    if (open && open.stage !== "intro") connect.mutate({ businessId, connectorKey: open.site.connectorKey, input: { ...siteInput(open.site), cancel: true } });
    setOpen(null);
  };

  const checkAddress = (a: string) => {
    setAnswer(null);
    setCheckError(null);
    check.mutate({ businessId, url: a }, { onSuccess: setAnswer, onError: (e) => setCheckError(errorMessage(e)) });
  };
  // The founder's yes (if the terms do not say) was given in the panel, so the dialog goes straight on to the sign-in.
  const connectTyped = (a: Extract<BrowserSiteAnswer, { status: "ask_first" | "open" }>) => begin({ connectorKey: a.slotKey, siteKey: a.slotKey.replace(/^browser_/, ""), name: a.name, askFirst: false, address: a.address, status: "not_connected" });

  return (
    <SettingsSection wide title="Add a website the team can work in" loading={loading} data-testid="browser-sites-section">
      <BrowserSitesList
        sites={sites}
        canEdit={canEdit}
        pendingKey={disconnect.isPending ? (catalogue.find((c) => c.integration?.id === disconnect.variables?.integrationId)?.key ?? null) : null}
        onConnect={begin}
        onDisconnect={(site) => {
          const integration = catalogue.find((c) => c.key === site.connectorKey)?.integration;
          if (integration) disconnect.mutate({ businessId, integrationId: integration.id });
        }}
      />
      {canEdit ? (
        <BrowserAddSite
          starters={starters.data?.sites ?? []}
          address={address}
          onAddressChange={(a) => (setAddress(a), setAnswer(null))}
          onCheck={checkAddress}
          checking={check.isPending}
          answer={answer}
          error={checkError}
          onConnect={connectTyped}
          connecting={connect.isPending}
        />
      ) : null}
      <BrowserSiteConnectDialog
        open={open !== null}
        onOpenChange={(o) => !o && cancel()}
        siteName={open?.site.name ?? ""}
        askFirst={open?.site.askFirst ?? false}
        showIntro={noneConnected}
        appName={APP_NAME}
        stage={open?.stage ?? "intro"}
        liveViewUrl={open?.liveViewUrl ?? null}
        error={open?.error ?? null}
        busy={connect.isPending}
        onStart={() => open && start(open.site)}
        onDone={done}
        onCancel={cancel}
      />
    </SettingsSection>
  );
}
