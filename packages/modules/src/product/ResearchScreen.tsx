"use client";
/**
 * Product › Research (BUILD §11.5, §11.1): what the Research agent and the Source Watcher learned — competitor cards,
 * research notes with entity links, the topics that keep coming up, and how well each spec section is backed by
 * sources. Every market figure is the agent's estimate and says so.
 */
import { useMemo } from "react";
import { BookOpenText, ExternalLink, FileText, Swords } from "lucide-react";
import { BarChart, Chip, EntityText, Icon, Panel, ProvenanceChip, formatDate, formatRelative } from "@foundmill/dugout";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { Screen, blockTitle, findBlock } from "./shared";
import { RESEARCH_NOTE_KINDS, SOURCE_KIND_META, coverageBySection, hostOf, linkedBlocks, relevance, topicCounts, topics } from "./sources/kinds";
import type { SourceRow, SourcesListResponse, SpecBlockRow, SpecGetResponse } from "./types";

function CompetitorCard({ source, onOpen }: { source: SourceRow; onOpen: () => void }) {
  const r = relevance(source);
  const strengths = Array.isArray(r.strengths) ? r.strengths : [];
  const weaknesses = Array.isArray(r.weaknesses) ? r.weaknesses : [];
  const citations = Array.isArray(r.citations) ? r.citations : [];
  return (
    <article aria-label={source.title} className="flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-3" data-competitor={source.id}>
      <header className="flex items-start gap-2">
        <Icon icon={Swords} size="default" className="mt-0.5 text-status-bad" />
        <div className="min-w-0 flex-1">
          <h3 className="t-display-sm truncate text-primary">{source.title || hostOf(source.uri) || "Competitor"}</h3>
          {source.uri ? (
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 font-mono text-mono text-link hover:underline focus-visible:outline-2 focus-visible:outline-link">
              {hostOf(source.uri) ?? source.uri}
              <ExternalLink size={12} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>
      {r.summary ? <EntityText as="p" className="text-body text-primary">{String(r.summary)}</EntityText> : null}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {r.pricing ? (
          <>
            <dt className="t-label">Pricing</dt>
            <dd className="text-body text-primary tabular-nums">{String(r.pricing)}</dd>
          </>
        ) : null}
        {r.marketSizeEstimate ? (
          <>
            <dt className="t-label flex items-center gap-1">
              Market size <ProvenanceChip kind="estimate" />
            </dt>
            <dd className="text-body text-primary tabular-nums">{String(r.marketSizeEstimate)}</dd>
          </>
        ) : null}
      </dl>
      {strengths.length || weaknesses.length ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="t-label mb-1 text-status-good">Strengths</p>
            <ul className="flex flex-col gap-0.5 text-small text-primary">
              {strengths.map((s, i) => (
                <li key={i}>· {String(s)}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="t-label mb-1 text-status-warn">Weaknesses</p>
            <ul className="flex flex-col gap-0.5 text-small text-primary">
              {weaknesses.map((s, i) => (
                <li key={i}>· {String(s)}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center gap-2 text-small text-secondary tabular-nums">
        {source.fetchedAt ? <span>Checked {formatRelative(source.fetchedAt)}</span> : <span>Not fetched yet</span>}
        {citations.length ? <span>· {citations.length} citation{citations.length === 1 ? "" : "s"}</span> : null}
      </footer>
    </article>
  );
}

function NoteRow({ source, blocks, onOpenBlock, onOpen }: { source: SourceRow; blocks: readonly SpecBlockRow[]; onOpenBlock: (id: string) => void; onOpen: () => void }) {
  const m = SOURCE_KIND_META[source.kind] ?? SOURCE_KIND_META.doc;
  const r = relevance(source);
  const linked = linkedBlocks(source).map((l) => ({ ...l, block: findBlock(blocks, l.blockId) })).filter((l) => l.block);
  return (
    <li className="flex flex-col gap-1 px-panel-pad py-2" data-note={source.id}>
      <div className="flex items-center gap-2">
        <Chip tone={m.tone} icon={m.icon}>
          {m.word}
        </Chip>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-body-strong text-primary hover:underline focus-visible:outline-2 focus-visible:outline-link">
          {source.title || source.uri || "Untitled"}
        </button>
        <span className="text-small text-secondary tabular-nums">{formatDate(source.createdAt, "d MMM")}</span>
      </div>
      {r.summary ? <EntityText as="p" className="text-body text-primary">{String(r.summary)}</EntityText> : <p className="text-small text-secondary">Not summarised yet.</p>}
      {linked.length || topics(source).length ? (
        <div className="flex flex-wrap items-center gap-1">
          {linked.slice(0, 3).map((l) => (
            <Chip key={l.blockId} tone="neutral" icon={FileText} onClick={() => onOpenBlock(l.blockId)} title={`Relevance ${Math.round(l.score * 100)}%`}>
              {blockTitle(l.block!)}
            </Chip>
          ))}
          {topics(source).map((t) => (
            <Chip key={t} tone="info">
              {t}
            </Chip>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function ResearchScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const list = useWidgetQuery<SourcesListResponse>("product.sources.list", { limit: 200 });
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const departments = useDepartments();
  useBusinessEvents(() => list.refetch(), ["source.added", "spec.proposal_created"]);

  const sources = useMemo(() => list.data?.items ?? [], [list.data]);
  const blocks = useMemo(() => spec.data?.blocks ?? [], [spec.data]);
  const competitors = sources.filter((s) => s.kind === "competitor");
  const notes = sources.filter((s) => RESEARCH_NOTE_KINDS.includes(s.kind)).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const coverage = useMemo(() => coverageBySection(sources, blocks), [sources, blocks]);
  const topicList = useMemo(() => topicCounts(sources), [sources]);
  const href = (tab: string, query?: string) => `${moduleHref(businessId, departments.data, "product", tab) ?? routes.department(businessId, "product", tab)}${query ?? ""}`;
  const openBlock = (blockId: string) => navigate(href("specification", `?block=${blockId}`));
  const open = (s: SourceRow) => {
    if (s.uri && typeof window !== "undefined") window.open(s.uri, "_blank", "noopener,noreferrer");
    else navigate(href("sources", `?source=${s.id}`));
  };
  const err = list.error ? list.error.message : undefined;

  return (
    <Screen name="product/research">
      <Panel
        title="Competitors"
        span={8}
        loading={list.isLoading}
        error={err}
        onRetry={list.refetch}
        empty={list.data && competitors.length === 0 ? { icon: Swords, title: "No competitor cards yet", children: "The Research agent grounds the spec with competitor pages and pricing; add a competitor link on the Sources tab to start one." , action: { label: "Open sources", onClick: () => navigate(href("sources")) } } : undefined}
        footer={<span className="tabular-nums">{competitors.length} competitors · pricing and market figures are the agent's estimates, not measurements</span>}
      >
        <div className="grid grid-cols-2 gap-3">
          {competitors.map((s) => (
            <CompetitorCard key={s.id} source={s} onOpen={() => open(s)} />
          ))}
        </div>
      </Panel>

      <Panel
        title="Spec coverage"
        span={4}
        loading={list.isLoading || spec.isLoading}
        error={err ?? (spec.error ? spec.error.message : undefined)}
        onRetry={list.refetch}
        empty={list.data && spec.data && coverage.length === 0 ? { icon: FileText, children: "Coverage appears once the spec has sections and sources are linked to them." } : undefined}
        footer={<span>Sources linked to at least one block in each section. Sections at zero are the ones to interview for next.</span>}
      >
        <BarChart label="Sources per spec section" horizontal height={Math.max(120, 24 * coverage.length + 32)} data={coverage.map((c) => ({ label: c.section, value: c.count }))} showValues format={(v) => String(Math.round(v))} />
      </Panel>

      <Panel
        title="Research notes"
        span={8}
        loading={list.isLoading}
        error={err}
        onRetry={list.refetch}
        empty={list.data && notes.length === 0 ? { icon: BookOpenText, title: "No research notes yet", children: "Interviews, feedback, documents and issues the team has read appear here with a summary and the spec blocks they touch." } : undefined}
        footer={<span className="tabular-nums">{notes.length} notes · names link to the CRM</span>}
        flush
      >
        <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Research notes">
          {notes.map((s) => (
            <NoteRow key={s.id} source={s} blocks={blocks} onOpenBlock={openBlock} onOpen={() => open(s)} />
          ))}
        </ul>
      </Panel>

      <Panel title="Topics" span={4} loading={list.isLoading} error={err} onRetry={list.refetch} empty={list.data && topicList.length === 0 ? { icon: BookOpenText, children: "Topics are tagged by the Source Watcher as it reads; they show what customers keep raising." } : undefined}>
        <ul className="flex flex-wrap gap-1" aria-label="Topics">
          {topicList.map((t) => (
            <li key={t.topic}>
              <Chip tone="info">
                {t.topic} <span className="ml-1 text-secondary tabular-nums">{t.count}</span>
              </Chip>
            </li>
          ))}
        </ul>
      </Panel>
    </Screen>
  );
}
