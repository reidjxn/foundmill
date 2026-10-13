"use client";
/**
 * Settings › Integrations (BUILD §11.15, §13): the connector catalogue with connect / disconnect / health, scopes
 * and status pills, plus the dev-only Simulate panel (BUILD §13.3). The panel calls `dev.simulate` on apps/api
 * (owner/admin only), which mints the service token and proxies to apps/ingest over the private network
 * (docs/SECURITY_REVIEW.md SEC-2); the browser never talks to ingest. The procedure exists in development and
 * staging only.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink, FlaskConical, FolderGit2, Plug, RefreshCw, Unplug } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, IconButton, SimpleSelect, StatusPill, cn, useDateFormat, type StatusTone, type DateFormatPrefs } from "@foundmill/dugout";
import type { IntegrationStatus } from "@foundmill/shared";
import { simulatePanelAvailable } from "@/lib/env";
import { formatDateTime, plainWords, plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

export const STATUS_TONE: Record<IntegrationStatus, { tone: StatusTone; word: string }> = {
  connected: { tone: "good", word: "Connected" },
  degraded: { tone: "warn", word: "Degraded" },
  expired: { tone: "bad", word: "Expired" },
  disconnected: { tone: "neutral", word: "Not connected" },
  mock: { tone: "info", word: "Test data" },
};

/** How a connector signs in, in words (never the stored kind). */
export const AUTH_WORD: Record<string, string> = {
  oauth: "Sign in with the vendor",
  api_key: "API key",
  app: "Install the app",
  none: "No sign-in needed",
};

/** The six panel actions BUILD §13.3 names; the ingest catalogue may add more. */
export const SIMULATIONS: { name: string; label: string; description: string }[] = [
  { name: "signup.created", label: "Signup", description: "A new signup from the mock Stripe customer" },
  { name: "payment.received", label: "Payment", description: "A paid invoice: records a conversion, a journey and a Customer Update" },
  { name: "lead.replied", label: "Lead reply", description: "An inbound reply through the mock SendGrid parse" },
  { name: "bank.balance_updated", label: "Bank sync", description: "A mock open-banking balance update" },
  { name: "channel.threshold_breached", label: "CPA spike", description: "A channel's cost per customer jumps past its threshold" },
  { name: "credential.expiring", label: "Credential expiry", description: "A connector credential about to expire" },
];

/** What `dev.simulate` answers: ingest's status and body, shown verbatim (ingest labels it "Simulated"). */
export interface SimulateResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** The `dev.simulate` input for one panel click (the API mints the token; the browser sends no credential of its own). */
export function simulateInput(businessId: string, eventName: string, connector: string): { businessId: string; eventName: string; connector?: string } {
  return { businessId, eventName, ...(connector ? { connector } : {}) };
}

/** The result pane text: `name → status` then the body (JSON pretty-printed, text verbatim). */
export function formatSimulateResult(name: string, result: SimulateResult): string {
  return `${name} → ${result.status}\n${typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)}`;
}

/** The toast line for a refusal: the status and ingest's message. */
export function simulateRefusalMessage(result: SimulateResult): string {
  return `${result.status}: ${typeof result.body === "string" ? result.body : JSON.stringify(result.body)}`;
}

/** The connectors' mode: "Live", "Mock mode", or "Mock mode · GitHub live" when named connectors run live anyway. */
export function modeLabel(mode: string, rows: readonly { displayName: string; live?: boolean }[]): string {
  if (mode !== "mock") return "Live";
  const live = rows.filter((r) => r.live).map((r) => r.displayName);
  return live.length ? `Test mode · ${live.join(", ")} live` : "Test mode";
}

/** The line under a connector: its account, what agents can do with it, when it was last checked (in the person's `prefs`). */
export function connectorDetail(c: { tools: readonly unknown[] }, integ: { accountLabel?: string | null; scopes: readonly string[]; lastHealthAt?: string | Date | null } | null, prefs?: DateFormatPrefs | null): string {
  const parts: string[] = [];
  if (integ?.accountLabel) parts.push(integ.accountLabel);
  parts.push(`${plural(c.tools.length, "agent action")}`);
  if (integ?.scopes.length) parts.push(plural(integ.scopes.length, "permission"));
  if (integ?.lastHealthAt) parts.push(`checked ${formatDateTime(integ.lastHealthAt, prefs)}`);
  return parts.join(" · ");
}

/** Days before a consent lapses that the connector offers to renew it (the Cash tab warns from the same day). */
export const CONSENT_RENEW_DAYS = 7;

/** When the vendor consent behind a connection lapses (open banking: Tink, Plaid), from what the connector reported at connect. */
export function consentExpiry(integ: { settings?: unknown } | null): Date | null {
  const raw = (integ?.settings as { expiresAt?: unknown } | undefined)?.expiresAt;
  if (typeof raw !== "string" && !(raw instanceof Date)) return null;
  const at = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Whether a connection needs the founder's consent again: it expired or degraded, or its consent lapses within
 * `CONSENT_RENEW_DAYS`. Renewing connects again in place (`integrations.connect` upserts and keeps the settings), so
 * the stored credentials are never revoked first.
 */
export function needsRenewal(integ: { status: string; settings?: unknown } | null, now: Date = new Date()): boolean {
  if (!integ || integ.status === "disconnected") return false;
  if (integ.status === "expired" || integ.status === "degraded") return true;
  const expiry = consentExpiry(integ);
  return expiry !== null && expiry.getTime() - now.getTime() <= CONSENT_RENEW_DAYS * 86_400_000;
}

/** Leaves for a vendor's consent page in this tab (a seam for tests). */
export const navigation = { assign: (url: string) => window.location.assign(url) };
const navigateTo = (url: string) => navigation.assign(url);

export function IntegrationsTab() {
  const datePrefs = useDateFormat();
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const list = useQuery(trpc.integrations.list.queryOptions({ businessId }));
  const connect = useMutation(
    trpc.integrations.connect.mutationOptions({
      onSuccess: (r) => {
        void invalidate(["integrations"]);
        if (r.consentUrl) {
          // The vendor's page opens in this tab: a new tab opened after the request returns is a pop-up browsers block
          // (Safari always). The vendor sends the founder back here to finish (GitHub: /integrations/github/callback).
          t.info("Your consent is needed", "Opening the vendor's page; the connection completes when you accept and come back here.");
          navigateTo(r.consentUrl);
        } else t.saved("Connected", r.record.accountLabel ?? undefined);
      },
      onError: (e) => t.failed(e, "Could not connect"),
    }),
  );
  const disconnect = useMutation(trpc.integrations.disconnect.mutationOptions({ onSuccess: () => (void invalidate(["integrations"]), t.saved("Disconnected", "Credentials revoked.")), onError: (e) => t.failed(e) }));
  const health = useMutation(
    trpc.integrations.health.mutationOptions({
      onSuccess: (r) => (void invalidate(["integrations"]), r.health.ok ? t.saved("Healthy", r.health.message ?? undefined) : t.failed(new Error(r.health.message ?? "health check failed"), "Unhealthy")),
      onError: (e) => t.failed(e, "Health check failed"),
    }),
  );

  // Back from installing the GitHub App (app/integrations/github/callback): the founder confirms the installation here.
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // A deep link from another screen (Finance › Cash "Renew consent" → ?connector=tink) brings that connector's row into view.
  const focusKey = search?.get("connector") ?? null;
  useEffect(() => {
    if (!focusKey || !list.data) return;
    document.querySelector(`[data-connector="${CSS.escape(focusKey)}"]`)?.scrollIntoView?.({ block: "center" });
  }, [focusKey, list.data]);
  const pendingInstallation = /^\d{1,20}$/.test(search?.get("github_installation") ?? "") ? search!.get("github_installation")! : null;
  const installCode = search?.get("github_code") ?? null;
  const installState = search?.get("github_state") ?? null;
  // The code works once: whatever happens, the address loses it.
  const confirmInstallation = () =>
    pendingInstallation &&
    installCode &&
    installState &&
    connect.mutate({ businessId, connectorKey: "github", input: { installationId: Number(pendingInstallation), code: installCode, state: installState } }, { onSettled: () => router.replace(pathname ?? `/b/${businessId}/settings/integrations`) });

  if (list.error) return <ErrorPanel title="Integrations" message={errorMessage(list.error)} onRetry={() => void list.refetch()} />;
  const rows = list.data?.catalogue ?? [];

  return (
    <AdminOnly>
      {pendingInstallation ? (
        <SettingsSection title="Finish connecting GitHub">
          <div className="flex items-center gap-3" data-testid="github-installation">
            {installCode && installState ? (
              <>
                <Hint>
                  GitHub installation {pendingInstallation} is ready. Connect it to this business so agents can push their code to their own branches. GitHub confirms you can manage it first. Then choose the repository on Development › Code.
                </Hint>
                <Button variant="primary" icon={FolderGit2} loading={connect.isPending} onClick={confirmInstallation}>
                  Connect installation
                </Button>
              </>
            ) : (
              <Hint>GitHub did not confirm who installed installation {pendingInstallation}, so it cannot be connected from this link. Use Connect on GitHub below to install it again.</Hint>
            )}
          </div>
        </SettingsSection>
      ) : null}
      <SettingsSection wide title="Connectors" meta={list.data ? plural(rows.filter((r) => r.integration && r.integration.status !== "disconnected").length, "connected", "connected") : undefined} actions={list.data ? <Chip tone={list.data.mode === "mock" ? "info" : "good"}>{modeLabel(list.data.mode, rows)}</Chip> : undefined} loading={list.isLoading}>
        <Hint>Consents and API keys are yours to grant: a connector that needs one opens the vendor's page and waits for you. Secrets are stored encrypted and never shown again.</Hint>
        <ul className="flex flex-col" data-testid="connector-list">
          {rows.map((c) => {
            const integ = c.integration;
            const status = STATUS_TONE[(integ?.status ?? "disconnected") as IntegrationStatus] ?? STATUS_TONE.disconnected;
            const connected = integ !== null && integ.status !== "disconnected";
            const renew = connected && needsRenewal(integ);
            const expiry = consentExpiry(integ);
            const renewWord = c.auth.kind === "oauth" ? "Renew consent" : "Reconnect";
            return (
              <li key={c.key} className={cn("flex min-h-row-comfortable items-start gap-3 border-b border-line-faint py-2.5 last:border-b-0", focusKey === c.key && "rounded-panel bg-panel-alt outline outline-2 -outline-offset-2 outline-link")} data-connector={c.key} aria-current={focusKey === c.key ? "true" : undefined}>
                <span className="flex w-40 shrink-0 flex-col">
                  <span className="text-body-strong text-primary">{c.displayName}</span>
                  <span className="text-small text-tertiary">{AUTH_WORD[c.auth.kind] ?? plainWords(c.auth.kind)}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusPill tone={status.tone}>{status.word}</StatusPill>
                    {list.data?.mode === "mock" && c.live ? <Chip tone="good">Live</Chip> : null}
                  </span>
                  <span className="break-words text-small text-secondary" title={integ?.scopes.length ? `Permissions: ${integ.scopes.join(", ")}` : undefined}>
                    {connectorDetail(c, integ, datePrefs)}
                  </span>
                  {connected && expiry ? <span className={cn("text-small", renew ? "text-status-warn" : "text-tertiary")}>Consent until {formatDateTime(expiry, datePrefs)}</span> : null}
                  {integ?.lastError ? <span className="break-words text-small text-status-bad">{integ.lastError}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1 pt-0.5">
                  {connected ? (
                    <>
                      {renew ? (
                        <Button size="sm" icon={c.auth.kind === "oauth" ? ExternalLink : RefreshCw} loading={connect.isPending && connect.variables?.connectorKey === c.key} onClick={() => connect.mutate({ businessId, connectorKey: c.key, input: {} })}>
                          {renewWord}
                        </Button>
                      ) : null}
                      <IconButton label={`Check ${c.displayName} health`} icon={Activity} size="sm" disabled={health.isPending} onClick={() => integ && health.mutate({ businessId, integrationId: integ.id })} />
                      <IconButton label={`Disconnect ${c.displayName}`} icon={Unplug} size="sm" disabled={disconnect.isPending} onClick={() => integ && disconnect.mutate({ businessId, integrationId: integ.id })} />
                    </>
                  ) : (
                    <Button size="sm" icon={c.auth.kind === "oauth" ? ExternalLink : Plug} loading={connect.isPending && connect.variables?.connectorKey === c.key} onClick={() => connect.mutate({ businessId, connectorKey: c.key, input: {} })}>
                      Connect
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </SettingsSection>
      {simulatePanelAvailable() ? <SimulatePanel businessId={businessId} connectors={rows.filter((c) => c.simulations.length > 0).map((c) => ({ key: c.key, label: c.displayName, simulations: c.simulations }))} /> : null}
    </AdminOnly>
  );
}

export function SimulatePanel({ businessId, connectors }: { businessId: string; connectors: { key: string; label: string; simulations: readonly string[] }[] }) {
  const trpc = useTRPC();
  const t = useSettingsToast();
  const invalidate = useInvalidateRouters();
  const [connector, setConnector] = useState<string>("");
  const [last, setLast] = useState<{ name: string; result: SimulateResult } | null>(null);
  const fire = useMutation(
    trpc.dev.simulate.mutationOptions({
      onSuccess: (result, vars) => {
        setLast({ name: vars.eventName, result });
        if (result.ok) {
          t.saved("Simulated", `${vars.eventName} went through the webhook path.`);
          void invalidate(["inbox", "journey", "finance", "integrations", "distribution"]);
        } else t.failed(new Error(simulateRefusalMessage(result)), "Simulation refused");
      },
      onError: (e) => t.failed(e, "Simulation failed"),
    }),
  );
  return (
    <SettingsSection title="Simulate" actions={<Chip tone="warn" icon={FlaskConical}>Development only</Chip>} data-testid="simulate-panel">
      <Hint>Fires a mock platform event through the API and apps/ingest exactly as a vendor webhook would: it is labeled “Simulated”, costs nothing and never leaves this environment. Owners and admins only.</Hint>
      <div className="flex items-center gap-3">
        <span className="t-label">Connector</span>
        <SimpleSelect aria-label="Connector" controlSize="sm" value={connector} onValueChange={setConnector} placeholder="Default per event" options={[{ value: "", label: "Default per event" }, ...connectors.map((c) => ({ value: c.key, label: c.label }))]} className="w-56" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SIMULATIONS.map((s) => (
          <Button key={s.name} size="sm" variant="default" loading={fire.isPending && fire.variables?.eventName === s.name} onClick={() => fire.mutate(simulateInput(businessId, s.name, connector))} title={s.description} data-simulate={s.name}>
            {s.label}
          </Button>
        ))}
      </div>
      {last ? (
        <pre className="max-h-48 overflow-auto rounded-panel bg-ink p-2 font-mono text-mono text-secondary" data-testid="simulate-result">
          {formatSimulateResult(last.name, last.result)}
        </pre>
      ) : null}
    </SettingsSection>
  );
}
