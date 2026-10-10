"use client";
/**
 * Distribution › Creative (BUILD §11.7 Create → Approve): every asset the engines drafted, as a gallery grouped by
 * kind (email, post, ad, video, article, mailer, print, script) with its campaign, author and approval state.
 * Approve / Reject call `distribution.assets.approve/reject`. `?asset=<id>` highlights one.
 */
import { useCallback, useMemo, useState } from "react";
import { Check, ExternalLink, FileText, Film, Image, Mail, Mailbox, Megaphone, Newspaper, ScrollText, Share2, X } from "lucide-react";
import { Button, EntityLink, Icon, Panel, SegmentedControl, StatusPill, cn, formatRelative, type IconComponent } from "@foundmill/dugout";
import { APPROVAL_STATES, ASSET_KINDS, type ApprovalState, type AssetKind } from "@foundmill/shared/constants";
import { routes } from "@foundmill/widgets/shared/routes";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { APPROVAL_WORDS } from "./channel-data";
import { InlineError, Screen, searchParam, useAction } from "./shared";
import type { AgentRow, AssetRow, CampaignRow, Page } from "./types";

export const ASSET_KIND_META: Record<AssetKind, { word: string; plural: string; icon: IconComponent }> = {
  email: { word: "Email", plural: "Emails", icon: Mail },
  post: { word: "Post", plural: "Posts", icon: Share2 },
  ad: { word: "Ad", plural: "Ads", icon: Image },
  video: { word: "Video", plural: "Videos", icon: Film },
  article: { word: "Article", plural: "Articles", icon: FileText },
  mailer: { word: "Mailer", plural: "Mailers", icon: Mailbox },
  print: { word: "Print", plural: "Print", icon: Newspaper },
  script: { word: "Script", plural: "Scripts", icon: ScrollText },
};

export interface AssetGroup {
  kind: AssetKind;
  assets: AssetRow[];
}

/** Assets grouped by kind in ASSET_KINDS order; pending ones first inside a group, then newest. */
export function groupAssets(assets: readonly AssetRow[], state: ApprovalState | null): AssetGroup[] {
  const filtered = state ? assets.filter((a) => a.approvalState === state) : assets;
  const rank: Record<ApprovalState, number> = { pending: 0, draft: 1, approved: 2, rejected: 3 };
  return ASSET_KINDS.map((kind) => ({
    kind,
    assets: filtered
      .filter((a) => a.kind === kind)
      .slice()
      .sort((a, b) => rank[a.approvalState] - rank[b.approvalState] || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || a.title.localeCompare(b.title)),
  })).filter((g) => g.assets.length > 0);
}

export function isHttpRef(ref: string | null): boolean {
  return !!ref && /^https?:\/\//i.test(ref);
}

/** Open an asset's web preview in a new tab; returns false outside a browser or for non-http refs. */
export function openPreview(ref: string | null): boolean {
  if (!isHttpRef(ref) || typeof window === "undefined") return false;
  window.open(ref!, "_blank", "noopener,noreferrer");
  return true;
}

const ALL = "all";

export function CreativeScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const departments = useDepartments();
  const campaignsHref = moduleHref(businessId, departments.data, "distribution", "campaigns");
  const assets = useWidgetQuery<AssetRow[]>("distribution.assets.list", {});
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const agents = useWidgetQuery<AgentRow[]>("team.agents.list", {});
  const action = useAction();
  const [state, setState] = useState<ApprovalState | null>(null);
  const [highlight] = useState<string | null>(() => searchParam("asset"));
  useBusinessEvents(() => assets.refetch(), ["approval.resolved", "campaign.launched"]);

  const groups = useMemo(() => groupAssets(assets.data ?? [], state), [assets.data, state]);
  const counts = useMemo(() => {
    const c: Record<ApprovalState, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };
    for (const a of assets.data ?? []) c[a.approvalState] += 1;
    return c;
  }, [assets.data]);
  const campaignName = useCallback((id: string | null) => (id ? (campaigns.data?.items.find((c) => c.id === id)?.name ?? "Campaign") : null), [campaigns.data]);
  const agentName = useCallback((id: string) => agents.data?.find((a) => a.id === id)?.name ?? "Agent", [agents.data]);

  const decide = useCallback(
    async (asset: AssetRow, decision: "approve" | "reject") => {
      const ok = await action.run(`distribution.assets.${decision}`, { assetId: asset.id }, { key: `${decision}:${asset.id}` });
      if (ok !== undefined) assets.refetch();
    },
    [action, assets],
  );

  const total = assets.data?.length ?? 0;
  return (
    <Screen name="distribution/creative">
      <Panel
        title="Creative"
        span={12}
        loading={assets.isLoading}
        error={assets.error ? assets.error.message : undefined}
        onRetry={assets.refetch}
        empty={
          assets.data && total === 0
            ? { icon: Image, title: "No creative yet", children: "Each campaign's emails, posts, ads and print artwork land here for your approval as its engine drafts them.", action: campaignsHref ? { label: "Open campaigns", icon: Megaphone, onClick: () => navigate(campaignsHref) } : undefined }
            : undefined
        }
        meta={total ? `${total} asset${total === 1 ? "" : "s"} · ${counts.pending} awaiting approval` : undefined}
        actions={
          total ? (
            <SegmentedControl<string>
              aria-label="Filter by approval state"
              size="sm"
              value={state ?? ALL}
              onValueChange={(v) => setState(v === ALL ? null : (v as ApprovalState))}
              options={[
                { value: ALL, label: <FilterLabel word="All" count={total} /> },
                ...APPROVAL_STATES.map((s) => ({ value: s, label: <FilterLabel word={APPROVAL_WORDS[s].word} count={counts[s]} /> })),
              ]}
            />
          ) : undefined
        }
        footer={<span>Anything in the founder's name needs your approval before it ships.</span>}
        flush
      >
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        {groups.length === 0 && total > 0 ? <p className="px-panel-pad py-4 text-small text-secondary">No {state ? APPROVAL_WORDS[state].word.toLowerCase() : ""} assets. Pick All to see the rest.</p> : null}
        <div className="flex flex-col gap-4 p-panel-pad">
          {groups.map((g) => {
            const meta = ASSET_KIND_META[g.kind];
            return (
              <section key={g.kind} aria-label={meta.plural} className="flex flex-col gap-2">
                <h3 className="t-title flex items-center gap-1.5 text-primary">
                  <Icon icon={meta.icon} size="inline" className="text-tertiary" /> {meta.plural} <span className="t-mono text-tertiary">{g.assets.length}</span>
                </h3>
                <ul className="grid grid-cols-3 gap-3 2xl:grid-cols-4">
                  {g.assets.map((a) => (
                    <li key={a.id}>
                      <AssetCard asset={a} highlighted={a.id === highlight} campaign={campaignName(a.campaignId)} author={a.authoredByAgentId ? { id: a.authoredByAgentId, name: agentName(a.authoredByAgentId) } : null} businessId={businessId} pending={action.pending} onDecide={decide} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
    </Screen>
  );
}

/** A filter option: the state's word and its count in mono. */
function FilterLabel({ word, count }: { word: string; count: number }) {
  return (
    <>
      {word} <span className="t-mono text-tertiary">{count}</span>
    </>
  );
}

function AssetCard({ asset, highlighted, campaign, author, businessId, pending, onDecide }: { asset: AssetRow; highlighted: boolean; campaign: string | null; author: { id: string; name: string } | null; businessId: string; pending: string | null; onDecide: (a: AssetRow, d: "approve" | "reject") => void }) {
  const meta = ASSET_KIND_META[asset.kind];
  const decidable = asset.approvalState === "pending" || asset.approvalState === "draft";
  const title = asset.title || `${meta.word} draft`;
  return (
    <article aria-label={title} data-asset={asset.id} data-state={asset.approvalState} className={cn("surface-panel flex h-full flex-col gap-2 p-3", highlighted && "outline outline-2 outline-link")}>
      <div className="flex items-start gap-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-panel-alt text-secondary">
          <Icon icon={meta.icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-body-strong text-primary" title={title}>
            {title}
          </p>
          <p className="truncate text-small text-secondary" title={campaign ?? undefined}>
            {campaign ?? "No campaign"}
          </p>
        </div>
        <StatusPill tone={APPROVAL_WORDS[asset.approvalState].tone} className="shrink-0 whitespace-nowrap">
          {APPROVAL_WORDS[asset.approvalState].word}
        </StatusPill>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-small text-secondary">
        {author ? <EntityLink entity={{ id: author.id, kind: "agent", name: author.name, href: routes.agent(businessId, author.id) }} /> : <span>Author unknown</span>}
        {asset.createdAt ? <span className="ml-auto tabular-nums">{formatRelative(asset.createdAt)}</span> : null}
      </div>
      <div className="mt-auto flex items-center gap-1.5 pt-1">
        {isHttpRef(asset.contentRef) ? (
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => openPreview(asset.contentRef)} aria-label={`Preview ${title}`}>
            Preview
          </Button>
        ) : asset.contentRef ? (
          <span className="truncate font-mono text-mono text-secondary" title={asset.contentRef}>
            {asset.contentRef}
          </span>
        ) : null}
        {decidable ? (
          <span className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="primary" icon={Check} loading={pending === `approve:${asset.id}`} onClick={() => onDecide(asset, "approve")} aria-label={`Approve ${title}`}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" icon={X} loading={pending === `reject:${asset.id}`} onClick={() => onDecide(asset, "reject")} aria-label={`Reject ${title}`}>
              Reject
            </Button>
          </span>
        ) : null}
      </div>
    </article>
  );
}
