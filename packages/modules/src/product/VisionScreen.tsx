"use client";
/**
 * Product › Vision (BUILD §6.3, §11.5): the business's vision (drafted on the first open with the specification and
 * the roadmap: statement, who it is for, the problem, why now, principles, the north-star metric), the narrative
 * sections of the spec read as one page, the pinned (human-edited) blocks, the spec at a glance and what the team is
 * building now. While the foundations are drafting the tab shows the vision as soon as it is written, the narrative
 * sections as they land (marked Drafting) and fills in the rest when they are ready.
 */
import { useMemo } from "react";
import { BookOpen, Lock, Map as MapIcon } from "lucide-react";
import { Chip, Panel, StatusPill, formatNumber, formatRelative, useFormatters } from "@foundmill/dugout";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { FoundationsBanner, VisionPanels, useFoundations } from "./foundations";
import { PlainDoc } from "./PlainDoc";
import { pmExcerpt, pmWordCount } from "./prosemirror";
import { computeRoadmapStatus, taskSummary } from "./roadmap-status";
import { AuthorRef, Fact, PinnedChip, Screen, blockTitle, groupBySection } from "./shared";
import type { RoadmapResponse, SpecGetResponse } from "./types";

/** Sections that read as the vision narrative, in order; the rest live on the Specification tab. */
export const NARRATIVE_SECTIONS = ["vision", "problem", "customers", "value proposition"] as const;

export function VisionScreen({ businessId }: ModuleScreenProps) {
  const { formatDate, formatDateShort } = useFormatters();
  const { navigate } = useWidgetData();
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const roadmap = useWidgetQuery<RoadmapResponse>("product.roadmap.list", {});
  const departments = useDepartments();
  useBusinessEvents(() => spec.refetch(), ["spec.version_published", "spec.proposal_created"]);
  const foundations = useFoundations(() => {
    spec.refetch();
    roadmap.refetch();
  });
  // The vision shows as soon as the drafting has written it (within seconds of the first open), before the rest.
  const vision = foundations.data && foundations.data.status !== "none" ? foundations.data.vision : null;
  // While drafting, a narrative section's empty block reads what has been written for it so far.
  const drafted = useMemo(() => new Map((foundations.data?.progress?.sections ?? []).filter((s) => s.done && s.content).map((s) => [s.section.toLowerCase(), s.content!] as const)), [foundations.data?.progress]);

  const groups = useMemo(() => groupBySection(spec.data?.blocks ?? []), [spec.data]);
  const narrative = groups.filter((g) => (NARRATIVE_SECTIONS as readonly string[]).includes(g.section.toLowerCase()));
  const pinned = (spec.data?.blocks ?? []).filter((b) => b.pinned);
  const agentAuthored = (spec.data?.blocks ?? []).filter((b) => b.authoredByKind === "agent").length;
  const words = (spec.data?.blocks ?? []).reduce((n, b) => n + pmWordCount(b.content), 0);
  const now = (roadmap.data?.items ?? []).filter((i) => i.horizon === "now").slice().sort((a, b) => a.position - b.position);
  // What comes after Now, so the panel shows the road ahead rather than a mostly empty box.
  const next = (roadmap.data?.items ?? []).filter((i) => i.horizon === "next").slice().sort((a, b) => a.position - b.position).slice(0, 4);

  const href = (tab: string, query?: string) => `${moduleHref(businessId, departments.data, "product", tab) ?? routes.department(businessId, "product", tab)}${query ?? ""}`;
  const openBlock = (blockId: string) => navigate(href("specification", `?block=${blockId}`));

  return (
    <Screen name="product/vision">
      <FoundationsBanner foundations={foundations} />
      {vision ? <VisionPanels vision={vision} /> : null}
      <Panel
        title={vision ? "From the specification" : "Vision"}
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
                {g.blocks.map((b, i) => {
                  const draft = i === 0 && pmWordCount(b.content) === 0 ? drafted.get(g.section.toLowerCase()) : undefined;
                  return (
                    <div key={b.id} className="group relative" data-block={b.id} data-drafting={draft ? "true" : undefined}>
                      <PlainDoc doc={draft ?? b.content} />
                      <div className="mt-1 flex items-center gap-2 text-small text-secondary">
                        {draft ? <Chip tone="info">Drafting</Chip> : null}
                        <AuthorRef kind={b.authoredByKind} id={b.authoredBy} />
                        {b.pinned ? <PinnedChip /> : null}
                        <button type="button" className="text-link opacity-0 transition-opacity duration-micro hover:underline focus-visible:opacity-100 group-hover:opacity-100" onClick={() => openBlock(b.id)}>
                          Edit in Specification
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </article>
      </Panel>

      <Panel
        title="Pinned blocks"
        span={4}
        className="self-start"
        loading={spec.isLoading}
        error={spec.error ? spec.error.message : undefined}
        onRetry={spec.refetch}
        empty={spec.data && pinned.length === 0 ? { icon: Lock, children: "Pinned blocks appear when a team member edits a block. Agents never change them without an accepted proposal." } : undefined}
        footer={pinned.length ? <span>Agents change a pinned block only through a proposal you accept.</span> : undefined}
        flush
      >
        <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Pinned blocks">
          {pinned.map((b) => (
            // The block opens from its own button; the author's link sits beside it, never inside it (a link inside a
            // button is unreachable for assistive tech, and its click would open the block instead of the agent).
            <li key={b.id} className="flex flex-col gap-1 px-panel-pad py-2.5 hover:bg-white/4">
              <button type="button" onClick={() => openBlock(b.id)} className="flex w-full flex-col gap-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-link" data-pinned-block={b.id}>
                <span className="text-pretty break-words text-body-strong text-primary">{b.section}</span>
                {/* The block's own words, so the panel says what is pinned rather than a cut-off title. */}
                <span className="line-clamp-3 text-small text-secondary">{pmExcerpt(b.content, 220) || blockTitle(b)}</span>
              </button>
              <span className="flex flex-wrap items-center gap-x-2 text-small text-secondary tabular-nums" data-pinned-block-meta>
                <AuthorRef kind={b.authoredByKind} id={b.authoredBy} />
                <span>· version {b.version}</span>
                {b.updatedAt ? <span>· {formatRelative(b.updatedAt)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Spec at a glance" span={4} className="self-start" loading={spec.isLoading} error={spec.error ? spec.error.message : undefined} onRetry={spec.refetch}>
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
          // The outline as a quiet two-column list of section names (a count only where a section has several blocks).
          <nav aria-label="Spec outline" className="mt-3 border-t border-subtle/50 pt-3">
            <ol className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {groups.map((g) => (
                <li key={g.section} className="min-w-0">
                  <button type="button" onClick={() => openBlock(g.blocks[0]!.id)} className="flex min-h-target w-full items-center gap-1.5 rounded-xs py-1 text-left text-small text-secondary outline-none hover:text-primary focus-visible:outline-2 focus-visible:outline-link" data-outline-section={g.section}>
                    <span className="min-w-0 break-words">{g.section}</span>
                    {g.blocks.length > 1 ? <span className="tabular-nums text-tertiary">{g.blocks.length}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </Panel>

      <Panel
        title="Now on the roadmap"
        span={8}
        className="self-start"
        loading={roadmap.isLoading}
        error={roadmap.error ? roadmap.error.message : undefined}
        onRetry={roadmap.refetch}
        empty={roadmap.data && now.length === 0 && next.length === 0 ? { icon: MapIcon, children: "Nothing is in Now. Move items there on the Roadmap tab and the team picks them up next cycle.", action: { label: "Open roadmap", onClick: () => navigate(href("roadmap")) } } : undefined}
        footer={roadmap.data ? <button type="button" className="text-link hover:underline focus-visible:outline-2 focus-visible:outline-link" onClick={() => navigate(href("roadmap"))}>Open the roadmap</button> : undefined}
        flush
      >
        {[
          { key: "now", label: "Now", items: now },
          { key: "next", label: "Next up", items: next },
        ]
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.key}>
              {g.key === "next" || now.length === 0 ? <h3 className="t-label border-t border-subtle/50 px-panel-pad pb-1 pt-3">{g.label}</h3> : null}
              <ul className="flex flex-col divide-y divide-subtle/50" aria-label={g.key === "now" ? "Roadmap items in Now" : "Roadmap items in Next"}>
                {g.items.map((item) => {
                  const st = computeRoadmapStatus(item);
                  const ts = taskSummary(item);
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-panel-pad py-2">
                      <button type="button" className="min-w-0 flex-[1_1_14rem] text-pretty break-words text-left text-body-strong text-primary hover:underline focus-visible:outline-2 focus-visible:outline-link" onClick={() => navigate(href("roadmap", `?item=${item.id}`))}>
                        {item.title}
                      </button>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-small text-secondary tabular-nums">{ts.total ? `${ts.done} of ${ts.total} task${ts.total === 1 ? "" : "s"}` : "No tasks yet"}</span>
                        {item.targetEnd ? <span className="text-small text-secondary tabular-nums">by {formatDateShort(item.targetEnd)}</span> : null}
                        <StatusPill tone={st.tone} icon={st.icon}>
                          {st.word}
                        </StatusPill>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </Panel>
    </Screen>
  );
}
