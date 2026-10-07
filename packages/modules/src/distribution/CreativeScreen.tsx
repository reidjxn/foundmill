"use client";
/**
 * Distribution › Creative (BUILD §11.7 Create → Approve): every asset the engines drafted, as a gallery grouped by
 * kind (email, post, ad, video, article, mailer, print, script) with its campaign, author and approval state.
 * Approve / Reject call `distribution.assets.approve/reject`. `?asset=<id>` highlights one.
 */
import { useCallback, useMemo, useState } from "react";
import { Check, ExternalLink, FileText, Film, Image, Mail, Mailbox, Newspaper, ScrollText, Share2, X } from "lucide-react";
import { Button, Chip, EntityLink, Icon, Panel, StatusPill, cn, formatRelative, type IconComponent } from "@foundmill/dugout";
import { APPROVAL_STATES, ASSET_KINDS, type ApprovalState, type AssetKind } from "@foundmill/shared";
import { routes, useBusinessEvents, useWidgetQuery } from "@foundmill/widgets";
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

export function CreativeScreen({ businessId }: ModuleScreenProps) {
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
        empty={assets.data && total === 0 ? { icon: Image, title: "No creative yet", children: "Engines draft emails, posts, ads, videos, articles, mailers, print artwork and scripts for each campaign; they appear here grouped by kind, waiting for your approval." } : undefined}
        footer={
          <span className="tabular-nums">
            {total} assets · {counts.pending} awaiting approval · {counts.approved} approved · {counts.rejected} rejected. Anything in the founder's name needs your approval before it ships.
          </span>
        }
        flush
      >
        <div role="group" aria-label="Filter by approval state" className="flex flex-wrap items-center gap-1 border-b border-subtle px-panel-pad py-2">
          <Chip tone={state === null ? "kit" : "neutral"} selected={state === null} onClick={() => setState(null)}>
            All
          </Chip>
          {APPROVAL_STATES.map((s) => (
            <Chip key={s} tone={state === s ? APPROVAL_WORDS[s].tone : "neutral"} selected={state === s} onClick={() => setState(state === s ? null : s)}>
              {APPROVAL_WORDS[s].word}
              <span className="ml-1 text-secondary tabular-nums">{counts[s]}</span>
            </Chip>
          ))}
        </div>
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        {groups.length === 0 && total > 0 ? <p className="px-panel-pad py-4 text-small text-secondary">No {state ? APPROVAL_WORDS[state].word.toLowerCase() : ""} assets. Clear the filter to see the rest.</p> : null}
        <div className="flex flex-col gap-4 p-panel-pad">
          {groups.map((g) => {
            const meta = ASSET_KIND_META[g.kind];
            return (
              <section key={g.kind} aria-label={meta.plural} className="flex flex-col gap-2">
                <h3 className="t-label flex items-center gap-1.5">
                  <Icon icon={meta.icon} size="inline" /> {meta.plural} <span className="tabular-nums text-secondary">{g.assets.length}</span>
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
          <p className="truncate text-body-strong text-primary">{title}</p>
          <p className="truncate text-small text-secondary">{campaign ?? "No campaign"}</p>
        </div>
        <StatusPill tone={APPROVAL_WORDS[asset.approvalState].tone}>{APPROVAL_WORDS[asset.approvalState].word}</StatusPill>
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
