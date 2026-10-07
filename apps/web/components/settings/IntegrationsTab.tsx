"use client";
/**
 * Settings › Integrations (BUILD §11.15, §13): the connector catalogue with connect / disconnect / health, scopes
 * and status pills, plus the dev-only Simulate panel (BUILD §13.3) that posts to apps/ingest
 * `POST /simulate/:eventName` (NEXT_PUBLIC_INGEST_URL; the route only exists in development and staging).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink, FlaskConical, Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { Button, Chip, IconButton, SimpleSelect, StatusPill, type StatusTone } from "@foundmill/dugout";
import type { IntegrationStatus } from "@foundmill/shared";
import { publicEnv, simulatePanelAvailable } from "@/lib/env";
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

export interface SimulateResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** POST the simulation; the response is shown verbatim (the ingest service labels it "Simulated"). */
export async function postSimulation(ingestUrl: string, eventName: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<SimulateResult> {
  const res = await fetchImpl(`${ingestUrl}/simulate/${encodeURIComponent(eventName)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { ok: res.ok, status: res.status, body: parsed };
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

  if (list.error) return <ErrorPanel title="Integrations" message={errorMessage(list.error)} onRetry={() => void list.refetch()} />;
  const rows = list.data?.catalogue ?? [];

  return (
    <AdminOnly>
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

function SimulatePanel({ businessId, connectors }: { businessId: string; connectors: { key: string; label: string; simulations: readonly string[] }[] }) {
  const t = useSettingsToast();
  const invalidate = useInvalidateRouters();
  const [connector, setConnector] = useState<string>("");
  const [last, setLast] = useState<{ name: string; result: SimulateResult } | null>(null);
  const fire = useMutation({
    mutationFn: async (name: string) => postSimulation(publicEnv().ingestUrl, name, { businessId, ...(connector ? { connector } : {}) }),
    onSuccess: (result, name) => {
      setLast({ name, result });
      if (result.ok) {
        t.saved("Simulated", `${name} went through the webhook path.`);
        void invalidate(["inbox", "journey", "finance", "integrations", "distribution"]);
      } else t.failed(new Error(`${result.status}: ${typeof result.body === "string" ? result.body : JSON.stringify(result.body)}`), "Simulation refused");
    },
    onError: (e) => t.failed(e, "Ingest unreachable"),
  });
  return (
    <SettingsSection title="Simulate" actions={<Chip tone="warn" icon={FlaskConical}>Development only</Chip>} data-testid="simulate-panel">
      <Hint>Fires a mock platform event through apps/ingest exactly as a vendor webhook would: it is labelled “Simulated”, costs nothing and never leaves this environment.</Hint>
      <div className="flex items-center gap-3">
        <span className="t-label">Connector</span>
        <SimpleSelect aria-label="Connector" controlSize="sm" value={connector} onValueChange={setConnector} placeholder="Default per event" options={[{ value: "", label: "Default per event" }, ...connectors.map((c) => ({ value: c.key, label: c.label }))]} className="w-56" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SIMULATIONS.map((s) => (
          <Button key={s.name} size="sm" variant="default" loading={fire.isPending && fire.variables === s.name} onClick={() => fire.mutate(s.name)} title={s.description} data-simulate={s.name}>
            {s.label}
          </Button>
        ))}
      </div>
      {last ? (
        <pre className="max-h-48 overflow-auto rounded-panel bg-ink p-2 font-mono text-mono text-secondary" data-testid="simulate-result">
          {`${last.name} → ${last.result.status}\n${typeof last.result.body === "string" ? last.result.body : JSON.stringify(last.result.body, null, 2)}`}
        </pre>
      ) : null}
    </SettingsSection>
  );
}
