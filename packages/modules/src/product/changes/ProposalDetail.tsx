"use client";
/**
 * One change proposal (BUILD §11.5): rationale with entity links, evidence (sources), impact (dates, tasks, cost —
 * estimates), then one three-way DiffView per hunk. A hunk is accepted, rejected or saved as edited through
 * `product.proposals.decideHunk`; the whole proposal through `acceptAll` / `reject`. Pinned blocks are flagged: only an
 * accepted hunk may change them (AC-11.5.3). When every hunk is decided the API settles the proposal, publishes the
 * next immutable version and writes the changelog, which the result panel shows.
 */
import { useMemo, useState } from "react";
import { Check, CheckCheck, ExternalLink, FileText, GitCommitVertical, Map as MapIcon, Save, X } from "lucide-react";
import { Button, Chip, DiffView, EntityLink, Icon, KeyValueList, Markdown, Panel, ProvenanceChip, StatusPill, cn, formatDate, formatDateTime, useEntityLinkContext, type HunkDecisionState, type HunkDecisions } from "@foundmill/dugout";
import { textToPm } from "../prosemirror";
import { InlineError, PinnedChip, blockTitle, findBlock, useAction } from "../shared";
import type { ProposalHunkRow, ProposalWithHunks, RoadmapRow, SourceRow, SpecBlockRow, SpecVersionRow } from "../types";
import { DECISION_PILL, PROPOSAL_STATUS_PILL, SEVERITY_CHIP, decisionProgress, hunkSides, impactLines, isSettled } from "./hunks";

export interface ProposalDetailProps {
  proposal: ProposalWithHunks;
  blocks: readonly SpecBlockRow[];
  roadmapItems: readonly RoadmapRow[];
  sources: readonly SourceRow[];
  /** Latest published version, to show the result of a settled proposal. */
  latestVersion: SpecVersionRow | null | undefined;
  currency: string;
  onChanged: () => void;
  onOpenBlock: (blockId: string) => void;
  onOpenRoadmapItem: (itemId: string) => void;
  onOpenSource: (source: SourceRow) => void;
}

function Proposer({ id }: { id: string | null }) {
  const ctx = useEntityLinkContext();
  if (!id) return <span className="text-small text-secondary">System</span>;
  return <EntityLink entity={{ id, kind: "agent", name: ctx.resolve?.(id)?.name ?? "Agent" }} />;
}

function HunkCard({ hunk, index, blocks, roadmapItems, settled, onChanged, onOpenBlock, onOpenRoadmapItem }: { hunk: ProposalHunkRow; index: number; blocks: readonly SpecBlockRow[]; roadmapItems: readonly RoadmapRow[]; settled: boolean; onChanged: () => void; onOpenBlock: (id: string) => void; onOpenRoadmapItem: (id: string) => void }) {
  const action = useAction();
  const [staged, setStaged] = useState<HunkDecisions>({});
  const [merged, setMerged] = useState<string | null>(null);
  const block = findBlock(blocks, hunk.specBlockId);
  const item = hunk.roadmapItemId ? roadmapItems.find((r) => r.id === hunk.roadmapItemId) : undefined;
  const sides = useMemo(() => hunkSides(hunk), [hunk]);
  const pill = DECISION_PILL[hunk.decision];
  const locked = settled || hunk.decision !== "pending";
  const stagedCount = Object.values(staged).filter((s) => s && s.decision !== "pending").length;

  const decide = (decision: "accepted" | "rejected" | "edited", edited?: Record<string, unknown>) =>
    action.run("product.proposals.decideHunk", { hunkId: hunk.id, decision, ...(edited ? { edited } : {}) }, { key: decision, then: onChanged });
  const onDecision = (lineHunkId: string, state: HunkDecisionState, mergedText: string) => {
    setStaged((s) => ({ ...s, [lineHunkId]: state }));
    setMerged(mergedText);
  };
  const title = block ? `${block.section} · ${blockTitle(block)}` : item ? `Roadmap · ${item.title}` : hunk.specBlockId ? "Spec block" : "Roadmap item";

  return (
    <section aria-label={`Hunk ${index + 1}: ${title}`} data-hunk={hunk.id} className="flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-2">
      <header className="flex flex-wrap items-center gap-2">
        <span className="t-label tabular-nums">Hunk {index + 1}</span>
        <button type="button" className="inline-flex min-w-0 items-center gap-1 truncate text-body-strong text-link hover:underline focus-visible:outline-2 focus-visible:outline-link" onClick={() => (block ? onOpenBlock(block.id) : item ? onOpenRoadmapItem(item.id) : undefined)}>
          <Icon icon={block || !item ? FileText : MapIcon} size="inline" />
          {title}
        </button>
        {block?.pinned ? <PinnedChip /> : null}
        <span className="flex-1" />
        <StatusPill tone={pill.tone} icon={pill.icon}>
          {pill.word}
        </StatusPill>
      </header>
      {block?.pinned && hunk.decision === "pending" ? <p className="text-small text-secondary">This block is pinned (human-edited). Nothing changes unless you accept or edit this hunk.</p> : null}
      <DiffView
        title={null}
        original={sides.original}
        proposed={sides.proposed}
        base={sides.base}
        labels={{ original: "Current", proposed: "Proposed", base: "When proposed" }}
        defaultMode={sides.base !== undefined ? "side-by-side" : "inline"}
        readOnly={locked}
        decisions={locked ? undefined : staged}
        onDecision={locked ? undefined : onDecision}
        maxHeight={360}
      />
      {!locked ? (
        <footer className="flex flex-wrap items-center gap-2">
          <span className="text-small text-secondary">{stagedCount ? `${stagedCount} change${stagedCount === 1 ? "" : "s"} staged in the diff` : "Decide the whole hunk, or accept and reject lines in the diff and save the result as an edit."}</span>
          <span className="flex-1" />
          <InlineError error={action.error} />
          <Button size="sm" variant="ghost" icon={X} onClick={() => void decide("rejected")} loading={action.pending === "rejected"}>
            Reject hunk
          </Button>
          <Button size="sm" variant="default" icon={Save} disabled={merged === null || stagedCount === 0} onClick={() => merged !== null && void decide("edited", textToPm(merged))} loading={action.pending === "edited"}>
            Save as edited
          </Button>
          <Button size="sm" variant="primary" icon={Check} onClick={() => void decide("accepted")} loading={action.pending === "accepted"}>
            Accept hunk
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

export function ProposalDetail({ proposal, blocks, roadmapItems, sources, latestVersion, currency, onChanged, onOpenBlock, onOpenRoadmapItem, onOpenSource }: ProposalDetailProps) {
  const action = useAction();
  const settled = isSettled(proposal);
  const progress = decisionProgress(proposal.hunks);
  const status = PROPOSAL_STATUS_PILL[proposal.status];
  const severity = SEVERITY_CHIP[proposal.severity];
  const impact = impactLines(proposal.impact, currency);
  const evidence = proposal.evidence.map((id) => sources.find((s) => s.id === id) ?? { id, kind: "doc" as const, uri: null, title: `Source ${id.slice(0, 8)}`, contentRef: null, relevance: {}, fetchedAt: null, createdAt: proposal.createdAt });
  const hunks = proposal.hunks.slice().sort((a, b) => a.position - b.position);
  const resolvedAt = proposal.resolvedAt ? new Date(proposal.resolvedAt) : null;
  const resultVersion = latestVersion && resolvedAt && new Date(latestVersion.publishedAt).getTime() >= resolvedAt.getTime() - 60_000 ? latestVersion : null;

  return (
    <div className="flex flex-col gap-3" data-proposal={proposal.id}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="t-display-sm min-w-0 flex-1 text-primary">{proposal.title || "Untitled proposal"}</h2>
          <Chip tone={severity.tone} icon={severity.icon}>
            {severity.word}
          </Chip>
          <StatusPill tone={status.tone} icon={status.icon}>
            {status.word}
          </StatusPill>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-small text-secondary tabular-nums">
          <span>Proposed by</span>
          <Proposer id={proposal.proposedByAgentId} />
          <span>· {formatDateTime(proposal.createdAt)}</span>
          {resolvedAt ? <span>· resolved {formatDateTime(resolvedAt)}</span> : null}
          <span className="flex-1" />
          <span>
            {progress.decided}/{progress.total} hunks decided
          </span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <section aria-label="Rationale" className="col-span-2">
          <h3 className="t-label mb-1">Rationale</h3>
          <Markdown variant="body">{proposal.rationaleMd || "_No rationale given._"}</Markdown>
        </section>
        <section aria-label="Evidence">
          <h3 className="t-label mb-1">Evidence · {evidence.length}</h3>
          {evidence.length === 0 ? <p className="text-small text-secondary">No sources attached.</p> : null}
          <ul className="flex flex-col gap-1">
            {evidence.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenSource(s)} className="inline-flex max-w-full items-center gap-1 text-left text-body text-link hover:underline focus-visible:outline-2 focus-visible:outline-link">
                  <Icon icon={s.uri ? ExternalLink : FileText} size="inline" />
                  <span className="truncate">{s.title || s.uri || s.id}</span>
                  <Chip tone="neutral">{s.kind}</Chip>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Impact">
          <h3 className="t-label mb-1 flex items-center gap-1">
            Impact <ProvenanceChip kind="estimate" />
          </h3>
          {impact.length === 0 && !proposal.impact?.summary ? <p className="text-small text-secondary">No impact estimate.</p> : null}
          {proposal.impact?.summary ? <p className="mb-1 text-body text-primary">{String(proposal.impact.summary)}</p> : null}
          {impact.length ? <KeyValueList dense items={impact.map((l) => ({ label: l.label, value: l.value, numeric: l.label === "Cost" }))} /> : null}
        </section>
      </div>

      {!settled ? (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border border-subtle bg-panel-alt p-2">
          <span className="text-body text-primary">
            {progress.pending} of {progress.total} hunks still pending. Deciding the last one publishes a new spec version with a changelog.
          </span>
          <span className="flex-1" />
          <InlineError error={action.error} />
          <Button size="sm" variant="ghost" icon={X} onClick={() => void action.run("product.proposals.reject", { proposalId: proposal.id }, { key: "reject", then: onChanged })} loading={action.pending === "reject"}>
            Reject proposal
          </Button>
          <Button size="sm" variant="primary" icon={CheckCheck} onClick={() => void action.run("product.proposals.acceptAll", { proposalId: proposal.id }, { key: "acceptAll", then: onChanged })} loading={action.pending === "acceptAll"}>
            Accept all
          </Button>
        </div>
      ) : (
        <Panel title="Result" className={cn(proposal.status === "rejected" && "opacity-90")}>
          <div className="flex flex-col gap-1 text-body text-primary">
            <p>
              {proposal.status === "rejected" ? "Rejected: no block changed." : `${progress.accepted} accepted · ${progress.edited} edited · ${progress.rejected} rejected.`}
            </p>
            {resultVersion ? (
              <p className="flex flex-wrap items-center gap-1">
                <Icon icon={GitCommitVertical} size="inline" className="text-secondary" />
                <span className="text-body-strong tabular-nums">Version {resultVersion.version}</span> published {formatDate(resultVersion.publishedAt)}
                {resultVersion.changelogMd ? <span className="text-secondary">· {resultVersion.changelogMd}</span> : null}
              </p>
            ) : proposal.status !== "rejected" ? (
              <p className="text-small text-secondary">The new version appears in the Specification history once published.</p>
            ) : null}
          </div>
        </Panel>
      )}

      <div className="flex flex-col gap-2" aria-label="Hunks">
        {hunks.map((h, i) => (
          <HunkCard key={h.id} hunk={h} index={i} blocks={blocks} roadmapItems={roadmapItems} settled={settled} onChanged={onChanged} onOpenBlock={onOpenBlock} onOpenRoadmapItem={onOpenRoadmapItem} />
        ))}
      </div>
    </div>
  );
}
