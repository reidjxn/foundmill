/**
 * Product › Vision (BUILD §6.3, §11.5): the narrative sections of the spec read as one page, the pinned
 * (human-edited) blocks, the spec at a glance and what the squad is building now.
 */
import { useMemo } from "react";
import { BookOpen, Lock, Map as MapIcon } from "lucide-react";
import { Chip, Markdown, Panel, StatusPill, formatDate, formatNumber, formatRelative } from "@foundmill/dugout";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { pmToText, pmWordCount } from "./prosemirror";
import { computeRoadmapStatus, taskSummary } from "./roadmap-status";
import { AuthorRef, Fact, PinnedChip, Screen, blockTitle, groupBySection } from "./shared";
import type { RoadmapResponse, SpecGetResponse } from "./types";

/** Sections that read as the vision narrative, in order; the rest live on the Specification tab. */
export const NARRATIVE_SECTIONS = ["vision", "problem", "customers", "value proposition"] as const;

export function VisionScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const roadmap = useWidgetQuery<RoadmapResponse>("product.roadmap.list", {});
  const departments = useDepartments();
  useBusinessEvents(() => spec.refetch(), ["spec.version_published", "spec.proposal_created"]);

  const groups = useMemo(() => groupBySection(spec.data?.blocks ?? []), [spec.data]);
  const narrative = groups.filter((g) => (NARRATIVE_SECTIONS as readonly string[]).includes(g.section.toLowerCase()));
  const pinned = (spec.data?.blocks ?? []).filter((b) => b.pinned);
  const agentAuthored = (spec.data?.blocks ?? []).filter((b) => b.authoredByKind === "agent").length;
  const words = (spec.data?.blocks ?? []).reduce((n, b) => n + pmWordCount(b.content), 0);
  const now = (roadmap.data?.items ?? []).filter((i) => i.horizon === "now").slice().sort((a, b) => a.position - b.position);

  const href = (tab: string, query?: string) => `${moduleHref(businessId, departments.data, "product", tab) ?? routes.department(businessId, "product", tab)}${query ?? ""}`;
  const openBlock = (blockId: string) => navigate(href("specification", `?block=${blockId}`));

  return (
    <Screen name="product/vision">
      <Panel
        title="Vision"
        span={8}
        loading={spec.isLoading}
        error={spec.error ? spec.error.message : undefined}
        onRetry={spec.refetch}
        empty={spec.data && narrative.length === 0 ? { icon: BookOpen, title: "No narrative yet", children: "The Problem, Customers and Value proposition sections appear here once the spec outline is seeded or written on the Specification tab." } : undefined}
        footer={
          spec.data ? (
            <span className="tabular-nums">
              {spec.data.latestVersion ? `Version ${spec.data.latestVersion.version} · published ${formatDate(spec.data.latestVersion.publishedAt)}` : "No published version yet"} · {formatNumber(spec.data.blocks.length, { maxDigits: 0 })} blocks · {pinned.length} pinned
            </span>
          ) : undefined
        }
      >
        <article className="flex max-w-reading flex-col gap-5" data-vision-narrative>
          {narrative.map((g) => (
            <section key={g.section} aria-labelledby={`vision-${g.section}`}>
              <h3 id={`vision-${g.section}`} className="t-label mb-2">
                {g.section}
              </h3>
              <div className="flex flex-col gap-3">
                {g.blocks.map((b) => (
                  <div key={b.id} className="group relative" data-block={b.id}>
                    <Markdown variant="reading">{pmToText(b.content)}</Markdown>
                    <div className="mt-1 flex items-center gap-2 text-small text-secondary">
                      <AuthorRef kind={b.authoredByKind} id={b.authoredBy} />
                      {b.pinned ? <PinnedChip /> : null}
                      <button type="button" className="text-link opacity-0 transition-opacity duration-micro hover:underline focus-visible:opacity-100 group-hover:opacity-100" onClick={() => openBlock(b.id)}>
                        Edit in Specification
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </article>
      </Panel>

      <Panel
        title="Pinned blocks"
        span={4}
        loading={spec.isLoading}
        error={spec.error ? spec.error.message : undefined}
        onRetry={spec.refetch}
        empty={spec.data && pinned.length === 0 ? { icon: Lock, children: "Pinned blocks appear when a team member edits a block. Agents never change them without an accepted proposal." } : undefined}
        flush
      >
        <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Pinned blocks">
          {pinned.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => openBlock(b.id)} className="flex w-full flex-col gap-0.5 px-panel-pad py-2 text-left outline-none hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-link">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-body-strong text-primary">{blockTitle(b)}</span>
                  <Chip tone="neutral">{b.section}</Chip>
                </span>
                <span className="flex items-center gap-2 text-small text-secondary tabular-nums">
                  <AuthorRef kind={b.authoredByKind} id={b.authoredBy} />
                  <span>· v{b.version}</span>
                  {b.updatedAt ? <span>· {formatRelative(b.updatedAt)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Spec at a glance" span={4} loading={spec.isLoading} error={spec.error ? spec.error.message : undefined} onRetry={spec.refetch}>
        <div className="grid grid-cols-3 gap-3">
          <Fact label="Sections" numeric>
            {groups.length}
          </Fact>
          <Fact label="Blocks" numeric>
            {spec.data?.blocks.length ?? 0}
          </Fact>
          <Fact label="Pinned" numeric>
            {pinned.length}
          </Fact>
          <Fact label="Agent-written" numeric>
            {agentAuthored}
          </Fact>
          <Fact label="Words" numeric>
            {formatNumber(words, { maxDigits: 0 })}
          </Fact>
          <Fact label="Versions" numeric>
            {spec.data?.versionCount ?? 0}
          </Fact>
        </div>
        {groups.length ? (
          <nav aria-label="Spec outline" className="mt-3 flex flex-wrap gap-1">
            {groups.map((g) => (
              <Chip key={g.section} tone="neutral" onClick={() => openBlock(g.blocks[0]!.id)}>
                {g.section} <span className="ml-1 text-secondary tabular-nums">{g.blocks.length}</span>
              </Chip>
            ))}
          </nav>
        ) : null}
      </Panel>

      <Panel
        title="Now on the roadmap"
        span={8}
        loading={roadmap.isLoading}
        error={roadmap.error ? roadmap.error.message : undefined}
        onRetry={roadmap.refetch}
        empty={roadmap.data && now.length === 0 ? { icon: MapIcon, children: "Nothing is in Now. Move items there on the Roadmap tab and the squad picks them up next cycle.", action: { label: "Open roadmap", onClick: () => navigate(href("roadmap")) } } : undefined}
        flush
      >
        <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Roadmap items in Now">
          {now.map((item) => {
            const st = computeRoadmapStatus(item);
            const ts = taskSummary(item);
            return (
              <li key={item.id} className="flex items-center gap-3 px-panel-pad py-1.5">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-body-strong text-primary hover:underline focus-visible:outline-2 focus-visible:outline-link" onClick={() => navigate(href("roadmap", `?item=${item.id}`))}>
                  {item.title}
                </button>
                <span className="text-small text-secondary tabular-nums">{ts.total ? `${ts.done}/${ts.total} tasks` : "No tasks"}</span>
                <span className="text-small text-secondary tabular-nums">{item.targetEnd ? `by ${formatDate(item.targetEnd, "d MMM")}` : ""}</span>
                <StatusPill tone={st.tone} icon={st.icon}>
                  {st.word}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      </Panel>
    </Screen>
  );
}
