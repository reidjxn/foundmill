"use client";
/** Profile visibility (BUILD §11.14): who may see the founder's name. Saves on change; the choice is read back from the API. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { Panel, RadioGroup, RadioOption, useToast } from "@foundmill/dugout";
import { VISIBILITY, type Visibility } from "@foundmill/shared/constants";
import { VISIBILITY_OPTIONS, visibilityLabel } from "@/lib/live";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

function isVisibility(v: string): v is Visibility {
  return (VISIBILITY as readonly string[]).includes(v);
}

export function VisibilityPanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery(trpc.live.profile.visibility.get.queryOptions(undefined, { staleTime: 30_000 }));
  const set = useMutation(
    trpc.live.profile.visibility.set.mutationOptions({
      onSuccess: (_row, vars) => {
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.profile") as unknown[] });
        toast({ title: `Profile visibility: ${visibilityLabel(vars.visibility)}`, tone: "good" });
      },
      onError: (err) => toast({ title: "Visibility not changed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const value = set.isPending ? set.variables?.visibility : q.data?.visibility;

  return (
    <Panel
      title="Profile visibility"
      loading={q.isLoading}
      error={q.error ? errorMessage(q.error) : undefined}
      onRetry={() => void q.refetch()}
      footer="Your business is listed on the network only while it is LIVE."
      data-testid="visibility-panel"
    >
      <p className="mb-2 flex items-center gap-1.5 text-small text-secondary">
        <Eye aria-hidden className="size-icon-inline" />
        Who can see your name
      </p>
      <RadioGroup value={value} onValueChange={(v) => isVisibility(v) && set.mutate({ visibility: v })} aria-label="Profile visibility" disabled={set.isPending} className="flex flex-col gap-2">
        {VISIBILITY_OPTIONS.map((o) => (
          <RadioOption key={o.value} id={`visibility-${o.value}`} value={o.value} label={o.label} description={o.description} />
        ))}
      </RadioGroup>
    </Panel>
  );
}
