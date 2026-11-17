"use client";
/**
 * Choosing the repository the team's code goes to, from Settings › Integrations, so a founder who already has one never
 * needs Builder view (WP-07 T11). Same procedures as Product › Code: `dev.code.repository` and `dev.code.setRepository`.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, Checkbox, Chip, Field, Input } from "@foundmill/dugout";
import { useBusiness } from "@/components/shell/business-context";
import { useTRPC } from "@/lib/trpc-react";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

export function GitHubRepositoryPanel() {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const t = useSettingsToast();
  const id = useId();
  const current = useQuery(trpc.dev.code.repository.queryOptions({ businessId }));
  const chosen = current.data?.repository ?? null;
  const [value, setValue] = useState("");
  const [push, setPush] = useState(false);
  useEffect(() => {
    setValue(chosen?.fullName ?? "");
    setPush(chosen?.writeEnabled ?? false);
  }, [chosen?.fullName, chosen?.writeEnabled]);
  const save = useMutation(
    trpc.dev.code.setRepository.mutationOptions({
      onSuccess: (r) => {
        void current.refetch();
        t.saved(r.repository ? "Repository chosen" : "Repository forgotten");
      },
      onError: (e) => t.failed(e, "Could not choose the repository"),
    }),
  );

  return (
    <SettingsSection title="Code repository" data-testid="github-repository" meta={chosen ? chosen.fullName : undefined}>
      <Hint>Choose the repository your team's code goes to. Each task gets its own branch there; nothing is written to the default branch, and merging stays a pull request.</Hint>
      {current.data?.simulated ? <Chip tone="info">Simulated GitHub: pushes are recorded here but do not reach github.com</Chip> : null}
      <Field htmlFor={`${id}-repo`} label="Repository" hint="owner/name, or the repository's github.com address">
        <Input id={`${id}-repo`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="acme/shop" mono />
      </Field>
      <label htmlFor={`${id}-push`} className="flex items-start gap-2 text-body">
        <Checkbox id={`${id}-push`} checked={push} onCheckedChange={(v) => setPush(v === true)} className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span>Let the team push its work to this repository</span>
          <span className="text-small text-secondary">A push can start this repository's CI and preview deploys on code an agent wrote, with their secrets. Files under .github are never pushed.</span>
        </span>
      </label>
      <Hint>This repository has no commits yet. Add a first commit with a README, then choose it again; the team cannot start an empty repository.</Hint>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon={FolderGit2} loading={save.isPending} disabled={!value.trim()} onClick={() => save.mutate({ businessId, repository: value.trim(), pushEnabled: push })}>
          Save repository
        </Button>
        {chosen ? (
          <Button variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ businessId, repository: null, pushEnabled: false })}>
            Forget repository
          </Button>
        ) : null}
      </div>
    </SettingsSection>
  );
}
