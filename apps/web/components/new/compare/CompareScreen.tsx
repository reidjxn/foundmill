"use client";
/**
 * /new/compare?ids=a,b[,c,d] — ConceptCompare (attribute bars side by side + radar in department colours) and the
 * "Agent verdict" from idea.compare (BUILD §11.1, AC-11.1.4 for 2, 3 and 4 cards). The comparison is recorded as an
 * idea_comparison; from here the founder commits the leader, merges the set or goes back to the studio.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Columns3, GitMerge, Trophy } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { Button, Chip, ConceptCompare, EmptyState, Markdown, Panel, Skeleton, SkeletonRows, StatusPill, cn, useToast } from "@foundmill/dugout";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { StudioFrame } from "../StudioFrame";
import { COMPARE_MIN, commitHref, parseCompareIds, toConcept, type IdeaLike } from "../ideate/concepts";

export interface CompareScreenProps {
  viewer: { email: string | null };
}

export function CompareScreen({ viewer }: CompareScreenProps) {
  const params = useSearchParams();
  const ids = useMemo(() => parseCompareIds(params.get("ids")), [params]);
  const key = ids.join(",");
  return <CompareBody key={key} ids={ids} viewer={viewer} />;
}

function CompareBody({ ids, viewer }: { ids: string[]; viewer: { email: string | null } }) {
  const trpc = useTRPC();
  const router = useRouter();
  const { toast } = useToast();
  const compare = useMutation(trpc.idea.compare.mutationOptions());
  const merge = useMutation(
    trpc.idea.merge.mutationOptions({
      onSuccess: (merged) => {
        toast({ title: "Merged", description: `${merged.title} is ready to commit.`, tone: "good" });
        router.push(commitHref(merged.id));
      },
      onError: (err) => toast({ title: "Not merged", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const started = useRef(false);
  useEffect(() => {
    if (ids.length >= COMPARE_MIN && !started.current) {
      started.current = true;
      compare.mutate({ ideaIds: ids });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per ids key (the parent remounts on change)
  }, []);

  const data = compare.data;
  const rankOf = useMemo(() => new Map((data?.verdict.ranking ?? []).map((r) => [r.idea_id, r])), [data]);
  const concepts = useMemo(() => (data?.ideas ?? []).map((idea: IdeaLike) => toConcept(idea, { verdict: rankOf.get(idea.id)?.reason })), [data, rankOf]);
  const leader = useMemo(() => {
    const ranked = [...(data?.verdict.ranking ?? [])].sort((a, b) => a.rank - b.rank)[0];
    return ranked ? (data?.ideas ?? []).find((i: IdeaLike) => i.id === ranked.idea_id) ?? null : null;
  }, [data]);

  const back = (
    <LinkButton variant="ghost" icon={ArrowLeft} href="/new/ideate">
      Back to the studio
    </LinkButton>
  );

  if (ids.length < COMPARE_MIN) {
    return (
      <StudioFrame step="compare" title="Compare concepts" lede="Side-by-side attributes, a radar and the agent verdict." viewer={viewer} actions={back}>
        <EmptyState icon={Columns3} title="Pick two to four cards first" action={{ label: "Open the studio", onClick: () => router.push("/new/ideate") }}>
          Tick the compare box on each card in the Ideation Studio, then press Compare.
        </EmptyState>
      </StudioFrame>
    );
  }

  return (
    <StudioFrame
      step="compare"
      title={`Compare ${ids.length} concepts`}
      lede="Attribute by attribute, with the Research agent's verdict. The leader per attribute is highlighted."
      viewer={viewer}
      actions={
        <>
          {back}
          <Button variant="default" icon={GitMerge} loading={merge.isPending} disabled={!data} onClick={() => merge.mutate({ ideaIds: ids })} data-testid="merge-compared">
            Merge these
          </Button>
          {leader ? (
            <LinkButton variant="primary" iconRight={ArrowRight} href={commitHref(leader.id)} data-testid="commit-leader">
              Commit {leader.title}
            </LinkButton>
          ) : null}
        </>
      }
    >
      {compare.isPending || (!data && !compare.error) ? (
        <div className="flex flex-col gap-gutter" aria-busy="true" aria-label="Comparing" data-testid="compare-loading">
          <Panel title={<Skeleton className="h-3 w-24" />}>
            <SkeletonRows rows={10} cols={ids.length + 1} />
          </Panel>
          <div className="grid grid-cols-12 gap-gutter">
            <Panel title={<Skeleton className="h-3 w-20" />} loading className="col-span-4" />
            <Panel title={<Skeleton className="h-3 w-20" />} loading className="col-span-8" />
          </div>
        </div>
      ) : compare.error ? (
        <Panel title="Comparison" error={errorMessage(compare.error)} onRetry={() => compare.mutate({ ideaIds: ids })} />
      ) : (
        <div className="flex flex-col gap-gutter" data-testid="compare-result" data-count={concepts.length}>
          <ConceptCompare concepts={concepts} />
          <div className="grid grid-cols-12 gap-gutter">
            <Panel title="Agent verdict in full" className="col-span-8" footer={<span>Written by the Research agent from the cards' evidence and saved with your comparisons</span>}>
              <Markdown variant="reading">{data?.verdict.verdict_md ?? ""}</Markdown>
            </Panel>
            <Panel title="Ranking" meta={`${concepts.length} concepts`} className="col-span-4" data-testid="ranking">
              <ol className="flex flex-col divide-y divide-line-faint">
                {[...(data?.verdict.ranking ?? [])]
                  .sort((a, b) => a.rank - b.rank)
                  .map((r) => {
                    const idea = (data?.ideas ?? []).find((i: IdeaLike) => i.id === r.idea_id);
                    const first = r.rank === 1;
                    return (
                      <li key={r.idea_id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0" data-rank={r.rank}>
                        <span className={cn("inline-flex size-control-xs shrink-0 items-center justify-center rounded-pill font-mono text-mono tabular-nums ring-1", first ? "bg-gold/12 text-gold ring-gold/40" : "text-secondary ring-line-strong")} aria-label={`Rank ${r.rank}`}>
                          {first ? <Trophy size={12} aria-hidden /> : r.rank}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words text-body-strong">{idea?.title ?? "Concept"}</span>
                            {first ? <Chip tone="gold">Recommended</Chip> : null}
                          </div>
                          <p className="text-small text-secondary">{r.reason}</p>
                          {idea ? (
                            <LinkButton size="sm" variant="ghost" iconRight={ArrowRight} className="mt-1 -ml-1.5" href={commitHref(idea.id)}>
                              Commit
                            </LinkButton>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
              </ol>
              <div className="mt-3">
                <StatusPill tone="info">Verdict, not a decision</StatusPill>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </StudioFrame>
  );
}
