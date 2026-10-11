"use client";
/**
 * Tools and permissions (BUILD §11.10 "Tools (add/remove; retested)", §9.5 policy hints): the connector catalogue
 * from `integrations.list` with each tool's policy hints (spends money, contacts a third party, irreversible), the
 * grants of the live version, and an editor that saves a draft version (`agent.training.saveDraft` with `tools`) so
 * the change is retested before it goes live. The business mode and hard gates are shown so "permissions" is honest:
 * a grant lets the agent call a tool; Cedar still decides allow / ask / deny per call.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleDollarSign, Plug, Send, ShieldAlert, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Chip, Icon, Panel, StatusPill, Tooltip, useToast } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import type { TabProps } from "./AgentProfileScreen";
import { currentVersion, grantedTools, grantsEqual, humaniseKey, latestDraft, parseInstructions, parseToolGrants, toggleToolGrant, toolDisplay, type ToolGrant } from "./logic";

type IntegrationsList = NonNullable<ReturnType<typeof useIntegrations>["data"]>;
type CatalogueEntry = IntegrationsList["catalogue"][number];

function useIntegrations(businessId: string) {
  const trpc = useTRPC();
  return useQuery(trpc.integrations.list.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
}

const HINT_LABEL: Record<string, { label: string; icon: typeof Ban; tone: "warn" | "bad" | "info" }> = {
  spendsMoney: { label: "Spends money", icon: CircleDollarSign, tone: "warn" },
  contactsThirdParty: { label: "Contacts a third party", icon: Send, tone: "info" },
  irreversible: { label: "Irreversible", icon: ShieldAlert, tone: "bad" },
  requiresKitMode: { label: "Offline tracking only", icon: Ban, tone: "info" },
};

function hintChips(hints: Record<string, boolean | undefined> | undefined) {
  if (!hints) return null;
  const on = Object.entries(hints).filter(([, v]) => v);
  if (!on.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {on.map(([k]) => {
        const meta = HINT_LABEL[k];
        return meta ? (
          <Chip key={k} tone={meta.tone} icon={meta.icon}>
            {meta.label}
          </Chip>
        ) : null;
      })}
    </span>
  );
}

export interface ToolGrantsEditorProps {
  businessId: string;
  value: readonly ToolGrant[];
  onChange: (grants: ToolGrant[]) => void;
  readOnly?: boolean;
}

/** Connector × tool checkboxes over the integrations catalogue; connection status next to each connector. */
export function ToolGrantsEditor({ businessId, value, onChange, readOnly }: ToolGrantsEditorProps) {
  const integrationsQ = useIntegrations(businessId);
  const catalogue: CatalogueEntry[] = useMemo(() => {
    const entries = integrationsQ.data?.catalogue ?? [];
    const known = new Set(entries.map((c) => c.key));
    // Grants on connectors the catalogue does not list (phase-later connectors) still show, read-only.
    const extra: CatalogueEntry[] = value.filter((g) => !known.has(g.connectorKey)).map((g) => ({ key: g.connectorKey, displayName: humaniseKey(g.connectorKey), phase: 0, auth: { kind: "none" }, mode: "mock", tools: g.tools.map((t) => ({ name: t, description: "", inputSchema: { type: "object" } })), policyHints: {}, webhookPaths: [], rateLimits: undefined, simulations: [], integration: null }) as unknown as CatalogueEntry);
    return [...entries, ...extra].sort((a, b) => Number(!!b.integration) - Number(!!a.integration) || a.displayName.localeCompare(b.displayName));
  }, [integrationsQ.data, value]);

  if (integrationsQ.error) return <p className="text-small text-status-bad">{errorMessage(integrationsQ.error)}</p>;
  if (!integrationsQ.data) return <p className="text-small text-secondary">Loading the connector catalog…</p>;

  return (
    <ul className="flex flex-col divide-y divide-subtle" data-testid="tool-grants">
      {catalogue.map((c) => {
        const grant = value.find((g) => g.connectorKey === c.key);
        const status = c.integration?.status ?? "disconnected";
        const tone = status === "connected" || status === "mock" ? "good" : status === "degraded" || status === "expired" ? "warn" : "neutral";
        return (
          <li key={c.key} className="py-2" data-connector={c.key} data-granted={grant ? grant.tools.length : 0}>
            <div className="flex flex-wrap items-center gap-2">
              <Icon icon={Plug} size="inline" className="text-secondary" />
              <span className="text-body-strong text-primary">{c.displayName}</span>
              <StatusPill tone={tone}>{status === "mock" ? "Mock" : status.charAt(0).toUpperCase() + status.slice(1)}</StatusPill>
              <span className="text-small text-secondary">
                {grant?.tools.length ?? 0} of {c.tools.length} tools granted
              </span>
              {!c.integration && status === "disconnected" ? (
                <a href={routes.settings(businessId, "integrations")} className="ml-auto text-small text-link hover:underline">
                  Connect in Settings
                </a>
              ) : null}
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 pl-6">
              {c.tools.map((t) => {
                const id = `${c.key}-${t.name}`;
                const checked = grant?.tools.includes(t.name) ?? false;
                const hints = (c.policyHints as Record<string, Record<string, boolean | undefined>> | undefined)?.[t.name];
                const shown = toolDisplay({ name: t.name, title: t.title, description: t.description });
                return (
                  <li key={t.name} className="flex items-start gap-2">
                    <Checkbox id={id} checked={checked} disabled={readOnly} onCheckedChange={() => onChange(toggleToolGrant(value, c.key, t.name))} className="mt-0.5" aria-label={`${c.displayName}: ${shown.label}`} />
                    <label htmlFor={id} className="flex min-w-0 flex-col text-body text-primary" data-tool={t.name}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {/* The tool's name in words; the id stays in the data attribute for support, not on screen. */}
                        <span className="text-body-strong">{shown.label}</span>
                        {shown.hardGate ? (
                          <Chip tone="bad" icon={ShieldAlert}>
                            Only you can do this
                          </Chip>
                        ) : null}
                        {hintChips(hints)}
                      </span>
                      {shown.description ? (
                        <Tooltip content={shown.description}>
                          <span className="line-clamp-2 text-small text-secondary" tabIndex={0}>
                            {shown.description}
                          </span>
                        </Tooltip>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function ToolsTab({ businessId, profile, refetch }: TabProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useBusiness();
  const current = currentVersion(profile);
  const draft = latestDraft(profile.versions);
  const liveToolsKey = JSON.stringify(current?.tools ?? []);
  const liveGrants = useMemo(() => parseToolGrants(JSON.parse(liveToolsKey)), [liveToolsKey]);
  const [grants, setGrants] = useState<ToolGrant[]>(liveGrants);
  useEffect(() => setGrants(liveGrants), [liveGrants]);
  const dirty = !grantsEqual(grants, liveGrants);

  const saveDraft = useMutation(
    trpc.agent.training.saveDraft.mutationOptions({
      onSuccess: (r) => {
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("agent") as unknown[] });
        toast({ title: `Draft v${r.version.version} saved`, description: "Train it from the Training tab so the new tools are retested before they go live.", tone: "good" });
        refetch();
      },
      onError: (err) => toast({ title: "Could not save the draft", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const businessMode = data.business.businessMode;
  const modeCopy: Record<string, string> = {
    augmented: "Augmented: every external action and spend asks you first.",
    assisted: "Assisted: routine external work within caps runs; above caps, new counterparties and contracts ask.",
    automated: "Automated: everything within caps runs; only hard gates ask.",
  };

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-tools">
      <Panel
        title="Tools granted"
        span={8}
        flush
        actions={
          <span className="inline-flex items-center gap-2">
            <Chip tone="neutral">{grantedTools(grants)} tools</Chip>
            {dirty ? <Chip tone="info">Unsaved changes</Chip> : null}
          </span>
        }
        footer={
          <span className="flex w-full items-center gap-2">
            <span>Changes save as a draft version and are retested before promotion; the live version keeps its tools until then.</span>
            <span className="ml-auto inline-flex items-center gap-2">
              <Button size="sm" variant="ghost" icon={Undo2} disabled={!dirty || saveDraft.isPending} onClick={() => setGrants(liveGrants)}>
                Reset
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty} loading={saveDraft.isPending} onClick={() => saveDraft.mutate({ businessId, agentId: profile.agent.id, instructions: parseInstructions(draft?.instructions ?? current?.instructions ?? {}), tools: grants.filter((g) => g.tools.length > 0), comment: "Tools changed from the profile" })} data-testid="save-tools-draft">
                Save as draft
              </Button>
            </span>
          </span>
        }
      >
        <div className="p-panel-pad">
          <ToolGrantsEditor businessId={businessId} value={grants} onChange={setGrants} />
        </div>
      </Panel>
      <Panel title="Permissions" span={4} data-testid="permissions-panel">
        <div className="flex flex-col gap-3 text-body text-primary">
          <p>
            <span className="t-label block">Business mode</span>
            {modeCopy[businessMode] ?? businessMode}
          </p>
          <p>
            <span className="t-label block">Per call</span>
            A grant lets this agent use the tool. Every use is still checked: it runs, asks you first, or is refused, depending on the business mode, this agent's autonomy and what the tool can do.
          </p>
          <div>
            <span className="t-label block">Hard gates (never lifted)</span>
            <ul className="mt-1 flex flex-col gap-0.5 text-small text-secondary">
              <li>Moving money, signing, accepting terms</li>
              <li>Filing with the founder's identity</li>
              <li>Permanent deletion, security settings</li>
              <li>Acting on instructions found in untrusted content</li>
            </ul>
          </div>
          {draft ? <p className="text-small text-secondary">Draft v{draft.version} exists; its tools replace the live grants once it is promoted.</p> : null}
        </div>
      </Panel>
    </div>
  );
}
