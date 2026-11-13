"use client";
/**
 * Distribution › Creative (BUILD §11.7 Create → Approve): every asset the engines drafted, as a gallery grouped by
 * kind (email, post, ad, video, article, mailer, print, script) with its campaign, author and approval state.
 * Approve / Reject call `distribution.assets.approve/reject`. `?asset=<id>` highlights one.
 *
 * Tap-to-post (docs/NETWORK.md F3; docs/DESIGN.md §9g): a post drafted for a channel the founder posts by tap (social)
 * carries "Share", which opens the share panel with the draft's own words and, while the project's page is published,
 * the page's address with `via`. The founder's own press in the network's window is the only approval a post needs
 * there, so Share is offered on any draft that was not rejected. A press is recorded as a share that was opened
 * (`share.opened`), fire-and-forget; nothing here marks a draft as posted.
 *
 * A post the team wrote to be shared (a team post: no campaign, `sharePost` from the api) is an offer, not a decision:
 * it reads "Written by your team for you to share" where a campaign's name would be, its pill says where it stands
 * ("Not shared yet", "Share opened", "Set aside"), and in place of Approve and Reject it carries Share and "Not this
 * one", which sets it aside (`distribution.assets.reject`) so it is not offered again. Opening a share for it tells the
 * api which post it was, and the post stops waiting. It never counts as awaiting approval. Once a shared post led to a
 * real outcome, one line under it says so ("Led to 2 follows and 1 reply", item 8): outcomes only, as the api walls
 * them (follows and replies behind the CRM, payments behind Finance), never a visit, never a zero.
 */
import { useCallback, useMemo, useState } from "react";
import { Check, ExternalLink, FileText, Film, Image, Mail, Mailbox, Megaphone, Newspaper, ScrollText, Share2, X } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, EntityLink, Icon, Panel, SegmentedControl, SharePost, StatusPill, Term, cn, formatRelative, type IconComponent } from "@foundmill/dugout";
import { CHANNELS_SHARED_BY_TAP } from "@foundmill/shared/channel-availability";
import { APPROVAL_STATES, ASSET_KINDS, type ApprovalState, type AssetKind } from "@foundmill/shared/constants";
import { SHARE_OPEN_WORDS, writtenPostDraft } from "@foundmill/shared/share-drafts";
import { postOutcomeLine } from "@foundmill/shared/post-outcomes";
import { TEAM_POST_WORDS, isTeamPost } from "@foundmill/shared/team-posts";
import type { ShareOpened } from "@foundmill/shared/share-targets";
import { routes } from "@foundmill/widgets/shared/routes";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { APPROVAL_WORDS } from "./channel-data";
import { InlineError, Screen, searchParam, useAction } from "./shared";
import type { AgentsListResponse, AssetRow, CampaignRow, ChannelsListResponse, Page } from "./types";

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

/** What the screen reads of `page.get` (the project's public page): enough to point a shared post at it. */
interface PageForShare {
  url: string;
  slug: string;
  live: boolean;
  isSample?: boolean;
  published: { pitch: string } | null;
  preview: { name: string };
}

/** Whether an asset is a post the team wrote for the founder to share, with its share draft from the api. */
export function teamPostOf(asset: Pick<Partial<AssetRow>, "kind" | "contentRef" | "sharePost">): boolean {
  return !!asset.sharePost && isTeamPost({ kind: asset.kind, contentRef: asset.contentRef });
}

/**
 * Whether a draft can be shared by tap: a post with words, not rejected, drafted for a channel the founder posts by tap
 * (`CHANNELS_SHARED_BY_TAP`, today social). `tapChannelIds` are the ids of those channels for this business.
 */
export function assetSharedByTap(asset: Pick<AssetRow, "kind" | "body" | "approvalState" | "campaignId"> & Pick<Partial<AssetRow>, "contentRef" | "sharePost">, campaigns: readonly Pick<CampaignRow, "id" | "channelId">[], tapChannelIds: ReadonlySet<string>): boolean {
  if (asset.kind !== "post" || asset.approvalState === "rejected" || !asset.body?.trim()) return false;
  // A post the team wrote to be shared needs no campaign: sharing it is what it is for.
  if (teamPostOf(asset)) return true;
  if (!asset.campaignId) return false;
  const campaign = campaigns.find((c) => c.id === asset.campaignId);
  return !!campaign && tapChannelIds.has(campaign.channelId);
}

export function CreativeScreen({ businessId }: ModuleScreenProps) {
  const { navigate, mutate } = useWidgetData();
  const departments = useDepartments();
  const campaignsHref = moduleHref(businessId, departments.data, "distribution", "campaigns");
  const assets = useWidgetQuery<AssetRow[]>("distribution.assets.list", {});
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const agents = useWidgetQuery<AgentsListResponse>("team.agents.list", {});
  // Tap-to-post: which channels the founder posts by tap, and the project's page to point a shared post at. A reader
  // with no view of the page gets no link, never an error on this screen.
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const page = useWidgetQuery<PageForShare>("page.get", {});
  const tapChannelIds = useMemo(() => new Set((channels.data?.channels ?? []).filter((c) => CHANNELS_SHARED_BY_TAP.includes(c.channelKey)).map((c) => c.id)), [channels.data]);
  const [sharing, setSharing] = useState<AssetRow | null>(null);
  const shareDraft = useMemo(() => {
    if (!sharing?.body) return null;
    // A team post arrives with its link and picture attached by the api (the card or the page, with `via`).
    if (teamPostOf(sharing) && sharing.sharePost) return sharing.sharePost;
    const p = page.data;
    const live = p && p.live && !p.isSample && p.published ? { origin: new URL(p.url).origin, slug: p.slug, projectName: p.preview.name, pitch: p.published.pitch } : null;
    return writtenPostDraft({ text: sharing.body, page: live });
  }, [sharing, page.data]);
  const recordShare = useCallback(
    (opened: ShareOpened) => {
      // Fire-and-forget: the share has already happened in the browser, and never fails because of this.
      // A team post names itself, so the api can stop it from waiting; any other draft has no id to give.
      const team = sharing && teamPostOf(sharing) ? sharing : null;
      void mutate("share.opened", { kind: "draft", ...(team ? { refId: team.id } : {}), ...opened })
        .then(() => (team ? assets.refetch() : undefined))
        .catch(() => undefined);
    },
    [mutate, sharing, assets],
  );
  const action = useAction();
  const [state, setState] = useState<ApprovalState | null>(null);
  const [highlight] = useState<string | null>(() => searchParam("asset"));
  useBusinessEvents(() => assets.refetch(), ["approval.resolved", "campaign.launched", "post.drafted", "post.outcome_attributed"]);

  const groups = useMemo(() => groupAssets(assets.data ?? [], state), [assets.data, state]);
  const counts = useMemo(() => {
    const c: Record<ApprovalState, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };
    for (const a of assets.data ?? []) c[a.approvalState] += 1;
    return c;
  }, [assets.data]);
  const campaignName = useCallback((id: string | null) => (id ? (campaigns.data?.items.find((c) => c.id === id)?.name ?? "Campaign") : null), [campaigns.data]);
  const agentName = useCallback((id: string) => agents.data?.agents.find((a) => a.id === id)?.name ?? "Agent", [agents.data]);

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
        title={<Term id="creative">Creative</Term>}
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
                      <AssetCard asset={a} highlighted={a.id === highlight} campaign={campaignName(a.campaignId)} author={a.authoredByAgentId ? { id: a.authoredByAgentId, name: agentName(a.authoredByAgentId) } : null} businessId={businessId} pending={action.pending} onDecide={decide} onShare={assetSharedByTap(a, campaigns.data?.items ?? [], tapChannelIds) ? setSharing : undefined} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
      {shareDraft ? <SharePost open onOpenChange={(o) => (o ? undefined : setSharing(null))} title={SHARE_OPEN_WORDS.draftTitle} description={SHARE_OPEN_WORDS.description} draft={shareDraft} appName={APP_NAME} onShare={recordShare} /> : null}
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

function AssetCard({ asset, highlighted, campaign, author, businessId, pending, onDecide, onShare }: { asset: AssetRow; highlighted: boolean; campaign: string | null; author: { id: string; name: string } | null; businessId: string; pending: string | null; onDecide: (a: AssetRow, d: "approve" | "reject") => void; onShare?: (a: AssetRow) => void }) {
  const meta = ASSET_KIND_META[asset.kind];
  // A post the team wrote to be shared is an offer: it is shared or set aside, never approved or rejected.
  const team = teamPostOf(asset);
  const decidable = !team && (asset.approvalState === "pending" || asset.approvalState === "draft");
  const title = asset.title || `${meta.word} draft`;
  // What a team post led to, counted from real outcomes; nothing for a post that led to nothing (never a zero).
  const outcomes = team && asset.postOutcomes ? postOutcomeLine(asset.postOutcomes) : null;
  const state = team ? { word: TEAM_POST_WORDS.states[asset.approvalState], tone: asset.approvalState === "approved" ? ("good" as const) : ("neutral" as const) } : APPROVAL_WORDS[asset.approvalState];
  return (
    <article aria-label={title} data-asset={asset.id} data-state={asset.approvalState} data-team-post={team ? "" : undefined} className={cn("surface-panel flex h-full flex-col gap-2 p-3", highlighted && "outline outline-2 outline-link")}>
      <div className="flex items-start gap-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-panel-alt text-secondary">
          <Icon icon={meta.icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-body-strong text-primary" title={title}>
            {title}
          </p>
          <p className="truncate text-small text-secondary" title={team ? TEAM_POST_WORDS.source : (campaign ?? undefined)}>
            {team ? TEAM_POST_WORDS.source : (campaign ?? "No campaign")}
          </p>
        </div>
        <StatusPill tone={state.tone} className="shrink-0 whitespace-nowrap">
          {state.word}
        </StatusPill>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-small text-secondary">
        {author ? <EntityLink entity={{ id: author.id, kind: "agent", name: author.name, href: routes.agent(businessId, author.id) }} /> : <span>Author unknown</span>}
        {asset.createdAt ? <span className="ml-auto tabular-nums">{formatRelative(asset.createdAt)}</span> : null}
      </div>
      {asset.body ? (
        <p className="line-clamp-4 whitespace-pre-line text-small text-secondary" data-testid="asset-body">
          {asset.body}
        </p>
      ) : null}
      {outcomes ? (
        <p className="text-small text-primary" data-testid="post-outcomes">
          {outcomes}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {team ? null : isHttpRef(asset.contentRef) ? (
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => openPreview(asset.contentRef)} aria-label={`Preview ${title}`}>
            Preview
          </Button>
        ) : asset.contentRef ? (
          <span className="truncate font-mono text-mono text-secondary" title={asset.contentRef}>
            {asset.contentRef}
          </span>
        ) : null}
        {/* Tap-to-post: the founder posts this one themselves, with one press in the network's own window. */}
        {onShare ? (
          <Button size="sm" variant={team ? "tinted" : "ghost"} icon={Share2} onClick={() => onShare(asset)} aria-label={`${SHARE_OPEN_WORDS.share}: ${title}`} data-asset-share="">
            {SHARE_OPEN_WORDS.share}
          </Button>
        ) : null}
        {/* "Not this one": the draft is set aside and not offered again. Only while it waits. */}
        {team && asset.approvalState === "draft" ? (
          <Button size="sm" variant="ghost" icon={X} className="ml-auto" loading={pending === `reject:${asset.id}`} onClick={() => onDecide(asset, "reject")} aria-label={`${TEAM_POST_WORDS.dismiss}: ${title}`} data-asset-dismiss="">
            {TEAM_POST_WORDS.dismiss}
          </Button>
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
