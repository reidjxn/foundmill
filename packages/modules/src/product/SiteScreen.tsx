/**
 * Product › Site (WP-07 T5): the project's site, built by the team and served by Foundmill. The founder opens a
 * version's preview (a real page at its own address), publishes it with one press, or takes the site down. Nothing is
 * public until the founder publishes. The tab exists only where the platform made a site (SITES_DOMAIN set).
 */
import { useState } from "react";
import { ExternalLink, Rocket, Undo2 } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, Explainer, Panel, StatusPill, useFormatters } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { Screen, errorMessage } from "./shared";

export interface SiteFlagView {
  rule: string;
  path: string;
  detail: string;
}

export interface SiteReleaseView {
  id: string;
  number: number;
  state: "preview" | "held";
  flags: SiteFlagView[];
  heldSentence: string | null;
  previewUrl: string | null;
  taskTitle: string | null;
  createdAt: string | Date;
  isLive: boolean;
}

export interface SiteViewResponse {
  enabled: boolean;
  site: { slug: string; status: "draft" | "live" | "taken_down"; url: string; liveReleaseNumber: number | null; publishedAt: string | Date | null } | null;
  releases: SiteReleaseView[];
  canPublish: boolean;
}

type PublishResponse = { outcome: "published"; url: string; view: SiteViewResponse } | { outcome: "held"; flags: SiteFlagView[]; view: SiteViewResponse };

export const SITE_WORDS = {
  title: "Your site",
  versions: "Versions",
  empty: "Your team has not built a site yet. When a first version is ready you get a note with a preview link.",
  off: "Sites are not available yet.",
  draft: "Not published",
  live: "Live",
  takenDown: "Taken down",
  takenDownNote: `This site was taken down by ${APP_NAME} and cannot be published again. Write to support if you think this is a mistake.`,
  readOnly: "Only an owner or an admin can publish the site or take it down.",
  preview: "Open preview",
  publish: "Publish this version",
  republish: "Publish this version instead",
  takeDown: "Take the site down",
  liveBadge: "Live now",
  previewHelp: "A preview is a real page at its own address that only people with the link can open. Nothing is public until you publish.",
  published: (url: string) => `Published. Your site is live at ${url}`,
  takenDownDone: "The site is down. Your versions are kept.",
  version: (n: number) => `Version ${n}`,
  by: (title: string) => `From "${title}"`,
} as const;

export const SITE_EXPLAINER = {
  screenId: "product/site",
  purpose: "Your project's own small site, built by your team: what it is, a sign-up form and, if you want, a way to pay.",
  action: "Open the newest version's preview, and publish it when you like it. Then send the address to people.",
  watchFor: "Nothing is public until you publish. Each round of work saves a new version; a version that breaks a site rule is held back and the next round fixes it.",
} as const;

export function SiteScreen(_props: ModuleScreenProps) {
  const { formatDate } = useFormatters();
  const { mutate } = useWidgetData();
  const view = useWidgetQuery<SiteViewResponse>("site.get", {});
  useBusinessEvents(() => view.refetch(), ["site.release_created", "site.published", "site.unpublished"]);
  const data = view.data;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setPending(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await view.refetch();
    } catch (err) {
      setError(errorMessage(err as Error));
    } finally {
      setPending(null);
    }
  };
  const publish = (releaseId: string) =>
    run(releaseId, async () => {
      const res = await mutate<PublishResponse>("site.publish", { releaseId });
      setNotice(res.outcome === "published" ? SITE_WORDS.published(res.url) : (res.view.releases.find((r) => r.id === releaseId)?.heldSentence ?? null));
    });
  const takeDown = () =>
    run("down", async () => {
      await mutate("site.unpublish", {});
      setNotice(SITE_WORDS.takenDownDone);
    });

  const site = data?.site ?? null;
  const status = site?.status;
  const statusLine = status === "live" ? SITE_WORDS.live : status === "taken_down" ? SITE_WORDS.takenDown : SITE_WORDS.draft;
  const canAct = Boolean(data?.canPublish) && status !== "taken_down";

  return (
    <Screen name="product/site" stack>
      <Panel
        title={SITE_WORDS.title}
        span={12}
        loading={view.isLoading}
        error={view.error ? view.error.message : undefined}
        onRetry={view.refetch}
        actions={site ? <StatusPill tone={status === "live" ? "good" : status === "taken_down" ? "bad" : "neutral"} data-testid="site-state">{statusLine}</StatusPill> : undefined}
        data-testid="site-panel"
      >
        <Explainer {...SITE_EXPLAINER} className="mb-4" />
        {data && !data.enabled ? <p className="t-body text-secondary">{SITE_WORDS.off}</p> : null}
        {data?.enabled && !site ? (
          <p className="t-body text-secondary" data-testid="site-empty">
            {SITE_WORDS.empty}
          </p>
        ) : null}
        {site ? (
          <div className="flex flex-col gap-3">
            {status === "live" ? (
              <p className="t-body" data-testid="site-address">
                <a href={site.url} target="_blank" rel="noopener noreferrer" className="entity-link">
                  {site.url}
                </a>
                {site.publishedAt ? <span className="t-small text-secondary"> · Published {formatDate(new Date(site.publishedAt))}</span> : null}
              </p>
            ) : (
              <p className="t-body text-secondary" data-testid="site-address">
                {site.url}
              </p>
            )}
            {status === "taken_down" ? <p className="t-body text-secondary">{SITE_WORDS.takenDownNote}</p> : null}
            {!data?.canPublish ? <p className="t-small text-secondary">{SITE_WORDS.readOnly}</p> : null}
            {status === "live" && canAct ? (
              <div>
                <Button variant="secondary" size="sm" onClick={takeDown} disabled={pending !== null} data-testid="site-take-down">
                  <Undo2 aria-hidden size={14} /> {SITE_WORDS.takeDown}
                </Button>
              </div>
            ) : null}
            {notice ? (
              <p className="t-body" role="status" data-testid="site-notice">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="t-body text-status-bad" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {site && data && data.releases.length > 0 ? (
        <Panel title={SITE_WORDS.versions} span={12} data-testid="site-releases">
          <p className="t-small text-secondary mb-3">{SITE_WORDS.previewHelp}</p>
          <ul className="flex flex-col gap-3">
            {data.releases.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-subtle pb-3" data-testid={`site-release-${r.number}`}>
                <span className="t-body font-semibold">{SITE_WORDS.version(r.number)}</span>
                <span className="t-small text-secondary">{formatDate(new Date(r.createdAt))}</span>
                {r.taskTitle ? <span className="t-small text-secondary">{SITE_WORDS.by(r.taskTitle)}</span> : null}
                {r.isLive ? <StatusPill tone="good">{SITE_WORDS.liveBadge}</StatusPill> : null}
                {r.state === "held" ? (
                  <span className="t-small text-status-warn basis-full" data-testid="site-held">
                    {r.heldSentence}
                  </span>
                ) : null}
                <span className="ml-auto flex gap-2">
                  {r.previewUrl ? (
                    <Button asChild variant="secondary" size="sm">
                      <a href={r.previewUrl} target="_blank" rel="noopener noreferrer" data-testid="site-preview-link">
                        <ExternalLink aria-hidden size={14} /> {SITE_WORDS.preview}
                      </a>
                    </Button>
                  ) : null}
                  {canAct && r.state === "preview" && !r.isLive ? (
                    <Button size="sm" onClick={() => publish(r.id)} disabled={pending !== null} data-testid="site-publish">
                      <Rocket aria-hidden size={14} /> {status === "live" ? SITE_WORDS.republish : SITE_WORDS.publish}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </Screen>
  );
}
