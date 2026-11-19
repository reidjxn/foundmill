/**
 * Foundmill Sites in the console (WP-07 T5): the Product › Site tab's view, Publish, Take down and the address.
 * Publishing is the founder's own press, as for the public page (`publishPage`): never an agent's, no capability in
 * packages/connectors reaches these procedures. Everything is refused while SITES_DOMAIN is unset.
 */
import { siteHeldSentence, type SiteFlag } from "@foundmill/agents";
import { repos, type InboxItem, type SiteRelease } from "@foundmill/db";
import { AppError, ConflictError, ForbiddenError, hasSectionAccess, isAdminRole, ValidationError } from "@foundmill/shared";
import { SITE_LIMITS, SITE_READY_NOTE, sitePreviewUrl, siteSlugProblem, sitesDomain, siteUrl } from "@foundmill/shared/sites";
import { audit, emit, type BusinessContext } from "../trpc";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";

export const SITE_PUBLISH_ROLE_MESSAGE = "Only an owner or an admin can publish this site or take it down.";
export const SITE_SAMPLE_MESSAGE = "This is a sample business, so it has no site. Start your own project to publish one.";
export const SITE_LIVE_SLUG_MESSAGE = "Only an owner or an admin can change the address of a live site.";
export const SITE_SLUG_TAKEN = "That address is taken. Try another one.";
export const SITE_PUBLISH_LIMIT_MESSAGE = `A site can be published ${SITE_LIMITS.publishesPerDay} times a day. Try again tomorrow.`;
export const SITE_RELEASE_NOT_PREVIEW = "That version cannot be published. Choose a version that is ready to look at.";
const OFF_MESSAGE = "Sites are not available yet.";
export const SITE_TAKEN_DOWN_MESSAGE = "This site was taken down and cannot be published again.";
const takenDown = () => new AppError("site_taken_down", SITE_TAKEN_DOWN_MESSAGE, 409);

export interface SiteReleaseView {
  id: string;
  number: number;
  state: "preview" | "held";
  flags: SiteFlag[];
  /** "Held back: … The next round of work fixes it." for a held release, else null. */
  heldSentence: string | null;
  previewUrl: string | null;
  taskTitle: string | null;
  createdAt: string;
  isLive: boolean;
}

export interface SiteView {
  enabled: boolean;
  site: { slug: string; status: "draft" | "live" | "taken_down"; url: string; liveReleaseNumber: number | null; publishedAt: string | null } | null;
  releases: SiteReleaseView[];
  canPublish: boolean;
}

export type SitePublishResult = { outcome: "published"; url: string; view: SiteView } | { outcome: "held"; flags: SiteFlag[]; view: SiteView };

const canPublishSite = (ctx: BusinessContext): boolean => isAdminRole(ctx.role) && hasSectionAccess(ctx.membership, "product", "write");

function domainOf(ctx: BusinessContext): string {
  const domain = sitesDomain(ctx.env);
  if (!domain) throw new AppError("sites_off", OFF_MESSAGE, 404);
  return domain;
}

const flagsOf = (release: SiteRelease): SiteFlag[] => (Array.isArray(release.screening?.flags) ? (release.screening.flags as SiteFlag[]) : []);

/** `site.get`: the tab's view. `enabled: false` (and nothing else) while SITES_DOMAIN is unset. */
export async function siteView(ctx: BusinessContext): Promise<SiteView> {
  const domain = sitesDomain(ctx.env);
  const canPublish = canPublishSite(ctx) && !ctx.business.isDemo;
  if (!domain) return { enabled: false, site: null, releases: [], canPublish: false };
  return ctx.rls(async (tx) => {
    const site = await repos.sites.get(tx, ctx.businessId);
    if (!site) return { enabled: true, site: null, releases: [], canPublish };
    const mayPublish = canPublish && site.status !== "taken_down";
    const releases = await repos.sites.listReleases(tx, ctx.businessId, 20);
    const taskIds = [...new Set(releases.map((r) => r.taskId).filter((id): id is string => id !== null))];
    const titles = new Map((taskIds.length ? await repos.tasks.byIds(tx, ctx.businessId, taskIds) : []).map((t) => [t.id, t.title]));
    const live = releases.find((r) => r.id === site.liveReleaseId) ?? null;
    return {
      enabled: true,
      site: {
        slug: site.slug,
        status: site.status as "draft" | "live" | "taken_down",
        url: siteUrl(domain, site.slug),
        liveReleaseNumber: live?.number ?? null,
        publishedAt: live?.publishedAt?.toISOString() ?? null,
      },
      releases: releases.map((r) => {
        const flags = flagsOf(r);
        const state = r.state as "preview" | "held";
        return {
          id: r.id,
          number: r.number,
          state,
          flags,
          heldSentence: state === "held" ? siteHeldSentence(flags) : null,
          // Only a release apps/sites serves gets a link (0124: the newest previews).
          previewUrl: state === "preview" && site.status !== "taken_down" ? sitePreviewUrl(domain, r.previewToken) : null,
          taskTitle: r.taskId ? (titles.get(r.taskId) ?? null) : null,
          createdAt: r.createdAt.toISOString(),
          isLive: r.id === site.liveReleaseId && site.status === "live",
        };
      }),
      canPublish: mayPublish,
    };
  });
}

/** `site.publish`: the founder's press. A held release is refused with its flags; nothing changes. */
export async function publishSite(ctx: BusinessContext, input: { releaseId: string }, options: { fromNote?: boolean } = {}): Promise<SitePublishResult> {
  const domain = domainOf(ctx);
  if (ctx.business.isDemo) throw new AppError("site_sample_business", SITE_SAMPLE_MESSAGE, 409);
  if (!canPublishSite(ctx)) throw new ForbiddenError(SITE_PUBLISH_ROLE_MESSAGE);
  const [release, current] = await ctx.rls((tx) => Promise.all([repos.sites.getRelease(tx, ctx.businessId, input.releaseId), repos.sites.get(tx, ctx.businessId)]));
  if (!release) throw new ValidationError(SITE_RELEASE_NOT_PREVIEW, { field: "releaseId" });
  if (release.state === "held") return { outcome: "held", flags: flagsOf(release), view: await siteView(ctx) };
  if (current?.status === "taken_down") throw takenDown();
  const url = await ctx.rls(async (tx) => {
    // Counted under a per-business lock, so two presses at once cannot pass the daily limit together.
    await repos.sites.lockPublishes(tx, ctx.businessId);
    if ((await repos.sites.publishPressesToday(tx, ctx.businessId)) >= SITE_LIMITS.publishesPerDay) throw new ValidationError(SITE_PUBLISH_LIMIT_MESSAGE, { field: "releaseId" });
    const { site, release: published } = await repos.sites.publish(tx, ctx.businessId, { releaseId: release.id, userId: ctx.userId });
    const url = siteUrl(domain, site.slug);
    await emit(tx, ctx, { type: "site.published", payload: { siteId: site.id, releaseId: published.id, number: published.number, slug: site.slug, url } });
    await emit(tx, ctx, { type: "deploy.succeeded", payload: { taskId: published.taskId, environment: "production", provider: "foundmill", url, commitSha: published.contentHash, branch: null, durationMs: null } });
    // The note asked for exactly this: it stops waiting in Needs you (answered by its own handler when pressed there).
    if (!options.fromNote) await repos.sites.closeReadyNote(tx, ctx.businessId, ctx.userId);
    await audit(tx, ctx, { action: "site.published", target: { kind: "site", id: site.id }, details: { releaseId: published.id, number: published.number, slug: site.slug, url } });
    return url;
  });
  return { outcome: "published", url, view: await siteView(ctx) };
}

/** `site.unpublish`: the site stops answering (the releases stay). A site that is not live changes nothing. */
export async function unpublishSite(ctx: BusinessContext): Promise<SiteView> {
  const domain = domainOf(ctx);
  if (ctx.business.isDemo) throw new AppError("site_sample_business", SITE_SAMPLE_MESSAGE, 409);
  if (!canPublishSite(ctx)) throw new ForbiddenError(SITE_PUBLISH_ROLE_MESSAGE);
  const current = await ctx.rls((tx) => repos.sites.get(tx, ctx.businessId));
  if (!current || current.status !== "live") return siteView(ctx);
  await ctx.rls(async (tx) => {
    const site = await repos.sites.unpublish(tx, ctx.businessId);
    const url = siteUrl(domain, site.slug);
    await emit(tx, ctx, { type: "site.unpublished", payload: { siteId: site.id, slug: site.slug, url, by: "founder" } });
    await audit(tx, ctx, { action: "site.unpublished", target: { kind: "site", id: site.id }, details: { slug: site.slug, url } });
  });
  return siteView(ctx);
}

/** `site.setSlug`: the site's address. A live site's address is an owner's or an admin's to move. */
export async function setSiteSlug(ctx: BusinessContext, input: { slug: string }): Promise<SiteView> {
  domainOf(ctx);
  if (ctx.business.isDemo) throw new AppError("site_sample_business", SITE_SAMPLE_MESSAGE, 409);
  const slug = input.slug.trim().toLowerCase();
  const problem = siteSlugProblem(slug);
  if (problem) throw new ValidationError(problem, { field: "slug" });
  if (!canPublishSite(ctx)) throw new ForbiddenError(SITE_LIVE_SLUG_MESSAGE);
  const site = await ctx.rls((tx) => repos.sites.get(tx, ctx.businessId));
  if (!site) throw new ValidationError("Your site gets an address with its first version.", { field: "slug" });
  if (site.slug === slug) return siteView(ctx);
  try {
    await ctx.rls(async (tx) => {
      await repos.sites.setSlug(tx, ctx.businessId, slug);
      await audit(tx, ctx, { action: "site.address_changed", target: { kind: "site", id: site.id }, details: { from: site.slug, to: slug, live: site.status === "live" } });
    });
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message))) throw new ConflictError(SITE_SLUG_TAKEN);
    throw e;
  }
  return siteView(ctx);
}

/**
 * The Product lead's "Your site is ready to look at" note (WP-07 T3): "Publish it" publishes the newest version (the
 * same press as the tab's Publish, with its rules); "Not yet" leaves the site as it is. Decided in-process.
 */
export async function decideSiteNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const option = input.chosenOption;
  if (option !== SITE_READY_NOTE.options.publish && option !== SITE_READY_NOTE.options.later) throw new ValidationError(`Choose ${SITE_READY_NOTE.publishLabel} or ${SITE_READY_NOTE.laterLabel}.`, { itemId: item.id });
  let summary = "The site waits until later.";
  if (option === SITE_READY_NOTE.options.publish) {
    const newest = await repos.sites.latestRelease(ctx.db, ctx.businessId);
    if (!newest) throw new ValidationError(SITE_RELEASE_NOT_PREVIEW, { itemId: item.id });
    const res = await publishSite(ctx, { releaseId: newest.id }, { fromNote: true });
    if (res.outcome !== "published") throw new ValidationError(siteHeldSentence(res.flags), { itemId: item.id });
    summary = `Published the site at ${res.url}.`;
  }
  const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, summary, { params: { site_option: option }, result: { siteOption: option } }));
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
}

