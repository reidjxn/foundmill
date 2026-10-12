"use client";
/**
 * Settings › Keys (BUILD §10.2): paste an Anthropic key → validate (minimal API call, nothing stored) → store
 * (encrypted with the business data key; never shown again, never logged). Rotate and revoke; spend-limit advice.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type { IntegrationStatus } from "@foundmill/shared";
import { KeyRound, RefreshCw, ShieldOff } from "lucide-react";
import { useState } from "react";
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, KeyValueList, StatusPill, useDateFormat } from "@foundmill/dugout";
import { formatDateTime, plainWords } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { STATUS_TONE } from "./IntegrationsTab";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

export const SPEND_LIMIT_ADVICE = "Also set a monthly spend limit in your Anthropic Console: the key is yours, and the limit there is the ceiling no agent can exceed.";

export function KeysTab() {
  const datePrefs = useDateFormat();
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const status = useQuery(trpc.keys.status.queryOptions({ businessId }));
  const [apiKey, setApiKey] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const validate = useMutation(trpc.keys.validate.mutationOptions({ onError: (e) => t.failed(e, "Validation failed") }));
  // A key stored after a revoke (or used-up credits) resumes the team by itself; the result says how many came back.
  const resumedNote = (r: { resumed: { agents: number } | null }) => (r.resumed ? ` ${r.resumed.agents} agent${r.resumed.agents === 1 ? "" : "s"} resumed.` : "");
  const set = useMutation(trpc.keys.setAnthropic.mutationOptions({ onSuccess: (r) => (void invalidate(["keys", "integrations", "business", "team"]), setApiKey(""), validate.reset(), t.saved("Key stored", `Encrypted with the business data key.${resumedNote(r)}`)), onError: (e) => t.failed(e, "Key not stored") }));
  const rotate = useMutation(trpc.keys.rotate.mutationOptions({ onSuccess: (r) => (void invalidate(["keys", "integrations", "business", "team"]), setApiKey(""), validate.reset(), t.saved("Key rotated", `Agents use the new key from their next call.${resumedNote(r)}`)), onError: (e) => t.failed(e, "Key not rotated") }));
  const revoke = useMutation(trpc.keys.revoke.mutationOptions({ onSuccess: (r) => (void invalidate(["keys", "integrations", "business", "team", "inbox"]), setConfirmRevoke(false), t.saved("Key revoked", `${r.pausedAgents} agents paused; a note explains it in the Inbox.`)), onError: (e) => t.failed(e, "Key not revoked") }));

  if (status.error) return <ErrorPanel title="Keys" message={errorMessage(status.error)} onRetry={() => void status.refetch()} />;
  const configured = status.data?.configured ?? false;
  const latest = status.data?.credentials[0];
  const validation = validate.data;
  const canStore = apiKey.trim().length > 0 && validation?.valid === true;

  return (
    <AdminOnly>
      <SettingsSection title="Anthropic key" loading={status.isLoading}>
        <div className="flex items-center gap-3">
          <StatusPill tone={configured ? "good" : "neutral"} icon={KeyRound}>
            {configured ? "Key on file" : "No key"}
          </StatusPill>
          {status.data?.integration ? <Chip tone={status.data.integration.status === "mock" ? "info" : "neutral"}>{STATUS_TONE[status.data.integration.status as IntegrationStatus]?.word ?? plainWords(status.data.integration.status)}</Chip> : null}
        </div>
        {configured && latest ? (
          <KeyValueList
            items={[
              { label: "Stored", value: formatDateTime(latest.createdAt, datePrefs) },
              { label: "Expires", value: latest.expiresAt ? formatDateTime(latest.expiresAt, datePrefs) : "No expiry" },
              { label: "Credentials", value: String(status.data?.credentials.length ?? 0), numeric: true },
            ]}
          />
        ) : null}
        <Field htmlFor="anthropic-key" label={configured ? "New key (rotate)" : "API key"} hint="Validated with one minimal call, then encrypted. It is never shown again, never logged, never sent to a sandbox.">
          <Input
            id="anthropic-key"
            mono
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              validate.reset();
            }}
          />
        </Field>
        {validation ? (
          <div className="flex flex-col gap-2" data-testid="key-validation">
            <StatusPill tone={validation.valid ? "good" : "bad"}>{validation.valid ? "Key accepted" : (validation.reason ?? "Rejected")}</StatusPill>
            {validation.valid ? (
              <ul className="flex flex-wrap gap-1">
                {validation.routedModels.map((m) => (
                  <Chip key={m.key} tone={m.available ? "good" : "warn"}>
                    {plainWords(m.key)} · {m.available ? "available" : "not available"}
                  </Chip>
                ))}
              </ul>
            ) : null}
            <Hint>
              Checked {formatDateTime(validation.checkedAt, datePrefs)}{validation.mode === "mock" ? " in test mode" : ""}.
            </Hint>
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-t border-subtle pt-3">
          <Button variant="default" disabled={apiKey.trim().length === 0} loading={validate.isPending} onClick={() => validate.mutate({ businessId, apiKey: apiKey.trim() })}>
            Validate
          </Button>
          {configured ? (
            <Button variant="primary" icon={RefreshCw} disabled={!canStore} loading={rotate.isPending} onClick={() => rotate.mutate({ businessId, apiKey: apiKey.trim() })}>
              Rotate key
            </Button>
          ) : (
            <Button variant="primary" icon={KeyRound} disabled={!canStore} loading={set.isPending} onClick={() => set.mutate({ businessId, apiKey: apiKey.trim() })}>
              Store key
            </Button>
          )}
        </div>
        <Hint>{status.data?.advice ?? SPEND_LIMIT_ADVICE}</Hint>
      </SettingsSection>
      {configured ? (
        <SettingsSection title="Revoke">
          <p className="text-body text-secondary">Revoking archives the credential, disconnects the integration, stops every agent and posts a note in the Inbox. Storing a new key resumes them by itself; on a plan with credits, an owner or admin can also press Resume agents in the top bar.</p>
          <div>
            <Button variant="danger" icon={ShieldOff} onClick={() => setConfirmRevoke(true)}>
              Revoke key
            </Button>
          </div>
          <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Revoke the Anthropic key?</DialogTitle>
                <DialogDescription>Every agent stops until a new key is stored, which resumes them. The Inbox gets a note explaining why.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>
                  Cancel
                </Button>
                <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate({ businessId })}>
                  Revoke
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SettingsSection>
      ) : null}
    </AdminOnly>
  );
}
