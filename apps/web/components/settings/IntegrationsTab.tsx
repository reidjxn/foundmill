"use client";
/**
 * Settings › Integrations (BUILD §11.15, §13): the connector catalogue with connect / disconnect / health, scopes
 * and status pills, plus the dev-only Simulate panel (BUILD §13.3). The panel calls `dev.simulate` on apps/api
 * (owner/admin only), which mints the service token and proxies to apps/ingest over the private network
 * (docs/SECURITY_REVIEW.md SEC-2); the browser never talks to ingest. The procedure exists in development and
 * staging only.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink, FlaskConical, FolderGit2, Plug, Unplug } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Chip, IconButton, SimpleSelect, StatusPill, type StatusTone } from "@foundmill/dugout";
import type { IntegrationStatus } from "@foundmill/shared";
import { simulatePanelAvailable } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
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
  mock: { tone: "info", word: "Mock" },
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

export function IntegrationsTab() {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const list = useQuery(trpc.integrations.list.queryOptions({ businessId }));
  const connect = useMutation(
    trpc.integrations.connect.mutationOptions({
      onSuccess: (r) => {
        void invalidate(["integrations"]);
        if (r.consentUrl) t.info("Your consent is needed", "The vendor's consent page opened in a new tab; the connection completes when you accept.");
        else t.saved("Connected", r.record.accountLabel ?? undefined);
        if (r.consentUrl) window.open(r.consentUrl, "_blank", "noopener");
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
      <SettingsSection title="Connectors" actions={list.data ? <Chip tone={list.data.mode === "mock" ? "info" : "good"}>{list.data.mode === "mock" ? "Mock mode" : "Live"}</Chip> : undefined} loading={list.isLoading}>
        <Hint>OAuth consents and API keys are yours to grant: a connector that needs one opens the vendor's page and waits for you. Secrets are encrypted at rest and never shown again.</Hint>
        <ul className="flex flex-col divide-y divide-subtle" data-testid="connector-list">
          {rows.map((c) => {
            const integ = c.integration;
            const status = STATUS_TONE[(integ?.status ?? "disconnected") as IntegrationStatus] ?? STATUS_TONE.disconnected;
            const connected = integ !== null && integ.status !== "disconnected";
            return (
              <li key={c.key} className="flex min-h-row-comfortable items-center gap-3 py-1" data-connector={c.key}>
                <span className="w-40 shrink-0">
                  <span className="block text-body font-medium">{c.displayName}</span>
                  <span className="block text-small text-secondary">
                    {c.auth.kind} · phase {c.phase}
                  </span>
                </span>
                <StatusPill tone={status.tone}>{status.word}</StatusPill>
                {list.data?.mode === "mock" && c.live ? <Chip tone="good">Live</Chip> : null}
                <span className="flex-1 truncate text-small text-secondary">
                  {integ?.accountLabel ? `${integ.accountLabel} · ` : ""}
                  {c.tools.length} tools{integ?.scopes.length ? ` · ${integ.scopes.join(", ")}` : ""}
                  {integ?.lastHealthAt ? ` · checked ${formatDateTime(integ.lastHealthAt)}` : ""}
                  {integ?.lastError ? ` · ${integ.lastError}` : ""}
                </span>
                {connected ? (
                  <>
                    <IconButton label={`Check ${c.displayName} health`} icon={Activity} size="sm" disabled={health.isPending} onClick={() => integ && health.mutate({ businessId, integrationId: integ.id })} />
                    <IconButton label={`Disconnect ${c.displayName}`} icon={Unplug} size="sm" disabled={disconnect.isPending} onClick={() => integ && disconnect.mutate({ businessId, integrationId: integ.id })} />
                  </>
                ) : (
                  <Button size="sm" icon={c.auth.kind === "oauth" ? ExternalLink : Plug} loading={connect.isPending && connect.variables?.connectorKey === c.key} onClick={() => connect.mutate({ businessId, connectorKey: c.key, input: {} })}>
                    Connect
                  </Button>
                )}
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
      <Hint>Fires a mock platform event through the API and apps/ingest exactly as a vendor webhook would: it is labelled “Simulated”, costs nothing and never leaves this environment. Owners and admins only.</Hint>
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
