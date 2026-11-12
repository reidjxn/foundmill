"use client";
/**
 * Product › Public page (docs/THESIS_REVIEW.md package 1.1; apps/api services/pages.ts): the one page a project shows
 * to anyone, at its own address under /p/. The founder writes the pitch, about, who it is for and the stage, sees it
 * live in a phone-width preview drawn by the same component the public route uses, chooses the address, and publishes
 * it, publishes changes or takes it down. Nothing is public until an owner or an admin presses Publish and confirms.
 *
 * Who may do what follows `page.get`: owners and admins edit and publish (`canPublish`); everyone else reads it, with
 * one sentence saying who can change it. A sample business has no public page.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Globe, Pencil, Rocket, Undo2 } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Explainer,
  Field,
  Icon,
  Input,
  Panel,
  ProjectFollowForm,
  ProjectPage,
  SegmentedControl,
  StatusPill,
  Switch,
  Textarea,
  useFormatters,
} from "@foundmill/dugout";
import {
  PAGE_ABOUT_MAX,
  PAGE_FOR_WHOM_MAX,
  PAGE_PITCH_MAX,
  PAGE_SLUG_MAX,
  PAGE_SLUG_RULE,
  PAGE_STAGES,
  PAGE_STAGE_LABELS,
  builtOnWords,
  followerCountLine,
  pageContentProblems,
  pageSlugProblem,
  pageStateLine,
  samePageContent,
  type PageFieldErrors,
  type PageHoldReason,
  type PageStage,
  type ProjectPageContent,
} from "@foundmill/shared/project-page";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { Screen, errorMessage } from "./shared";

/** `page.get` as the screen reads it (apps/api services/pages.ts `PageView`). */
export interface PageViewResponse {
  slug: string;
  url: string;
  saved: boolean;
  draft: ProjectPageContent;
  published: ProjectPageContent | null;
  live: boolean;
  publishedAt: string | Date | null;
  unpublishedAt: string | Date | null;
  changed: boolean;
  canEdit: boolean;
  canPublish: boolean;
  isSample: boolean;
  preview: { name: string; brandPrimary: string; brandSecondary: string; founderNames: string[] };
  /** How many people follow the page (package 1.6); absent from an older api. */
  followers?: number;
  /** Whether visitors see the small "Built on" mark (the free plan; docs/NETWORK.md F2); absent from an older api. */
  mark?: boolean;
}

type PublishResponse = { outcome: "published"; page: PageViewResponse } | { outcome: "held"; reason: PageHoldReason; message: string; page: PageViewResponse };

export const PUBLIC_PAGE_EXPLAINER = {
  screenId: "product/public-page",
  purpose: "The one page anyone can open to see what your project is, at its own address.",
  action: "Write the one-line pitch and a few lines about it, check the preview, then publish it and send the link to someone.",
  watchFor: "Nothing is public until you publish. You can publish changes or take the page down any time.",
} as const;

/** The words of the tab, in one place (the e2e spec and the unit test read them). */
export const PUBLIC_PAGE_WORDS = {
  yourPage: "Your page",
  preview: "Preview",
  previewNote: "As it looks on a phone.",
  pitch: "One-line pitch",
  pitchHint: "The headline. Say what it is in one line.",
  about: "About",
  aboutHint: "Plain text. Leave a blank line between paragraphs.",
  forWhom: "Who it is for",
  forWhomHint: "Optional. Left off the page when empty.",
  stage: "Stage",
  showFounders: "Name the people building it",
  showFoundersHint: "Adds “Built by …” with the names of the project's owners.",
  followForm: "Let people follow this project",
  followFormHint: "Adds a form where visitors leave their email and agree to hear from you. Each one shows up in Customers.",
  save: "Save draft",
  saved: "Draft saved",
  unsaved: "Changes not saved yet",
  publish: "Publish",
  publishChanges: "Publish changes",
  takeDown: "Take it down",
  address: "Address",
  changeAddress: "Change address",
  newAddress: "New address",
  saveAddress: "Save address",
  cancel: "Cancel",
  copyLink: "Copy link",
  copied: "Link copied",
  open: "Open",
  readOnly: "An owner or an admin of this project can edit and publish this page.",
  sample: "This is a sample business, so it has no public page. Start your own project to publish one.",
  confirmTitle: "Publish your public page?",
  confirmChangesTitle: "Publish these changes?",
  confirmPublish: "Publish it",
  takenDown: "The page is down. The draft is kept.",
} as const;

/** What the confirm dialog says becomes public, field by field, and that it can be taken down. */
export function publishConsequence(content: ProjectPageContent, names: readonly string[]): string {
  const parts = ["the project's name and logo", "its one-line pitch", "about"];
  if (content.forWhom.trim()) parts.push("who it is for");
  parts.push("the stage");
  if (content.showFounders && names.length) parts.push("the names of the people building it");
  if (content.followForm) parts.push("a form to follow it");
  const list = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Anyone with the link can read ${list}. You can take it down any time.`;
}

const count = (n: number, max: number) => `${n.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`;

function Counted({ id, label, hint, error, used, max, children }: { id: string; label: string; hint: string; error?: string; used: number; max: number; children: ReactNode }) {
  return (
    <Field
      htmlFor={id}
      label={
        <span className="flex w-full items-baseline justify-between gap-2">
          <span>{label}</span>
          <span className={used > max ? "tabular-nums text-status-bad" : "tabular-nums text-tertiary"} data-count-for={id}>
            {count(used, max)}
          </span>
        </span>
      }
      hint={hint}
      error={error}
    >
      {children}
    </Field>
  );
}

export function PublicPageScreen(_props: ModuleScreenProps) {
  const id = useId();
  const { formatDate } = useFormatters();
  const { mutate } = useWidgetData();
  const view = useWidgetQuery<PageViewResponse>("page.get", {});
  useBusinessEvents(() => view.refetch(), ["page.published", "page.unpublished", "page.followed"]);
  const data = view.data;

  // The form follows the server's draft until the founder types; a save or publish answer resets it.
  const [draft, setDraft] = useState<ProjectPageContent | null>(null);
  const [base, setBase] = useState<ProjectPageContent | null>(null);
  useEffect(() => {
    if (!data) return;
    if (!base || !draft || samePageContent(draft, base)) {
      setDraft(data.draft);
      setBase(data.draft);
    }
    // Only a new server draft matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.draft.pitch, data?.draft.about, data?.draft.forWhom, data?.draft.stage, data?.draft.showFounders, data?.draft.followForm]);

  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<null | "save" | "publish" | "unpublish" | "slug">(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const content = draft ?? data?.draft ?? null;
  const problems: PageFieldErrors = useMemo(() => (content ? pageContentProblems(content) : {}), [content]);
  const canEdit = Boolean(data?.canPublish) && !data?.isSample;
  const dirty = Boolean(content && base && !samePageContent(content, base));
  const changedFromLive = Boolean(data?.published && content && !samePageContent(content, data.published));

  const apply = (next: PageViewResponse) => {
    setDraft(next.draft);
    setBase(next.draft);
    view.refetch();
  };
  const run = async (what: typeof pending, fn: () => Promise<void>) => {
    setPending(what);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err as Error));
    } finally {
      setPending(null);
    }
  };
  const set = <K extends keyof ProjectPageContent>(key: K, value: ProjectPageContent[K]) => {
    setHeld(null);
    setDraft((d) => ({ ...(d ?? data!.draft), [key]: value }));
  };

  const save = () =>
    run("save", async () => {
      apply(await mutate<PageViewResponse>("page.saveDraft", { draft: content }));
      setNotice(PUBLIC_PAGE_WORDS.saved);
    });
  const publish = () =>
    run("publish", async () => {
      const result = await mutate<PublishResponse>("page.publish", { content });
      setConfirming(false);
      apply(result.page);
      if (result.outcome === "held") setHeld(result.message);
    });
  const unpublish = () =>
    run("unpublish", async () => {
      apply(await mutate<PageViewResponse>("page.unpublish", {}));
      setNotice(PUBLIC_PAGE_WORDS.takenDown);
    });
  const saveSlug = () => {
    const next = slug.trim().toLowerCase();
    const problem = pageSlugProblem(next);
    if (problem) return setSlugError(problem);
    setSlugError(null);
    void run("slug", async () => {
      try {
        apply(await mutate<PageViewResponse>("page.setSlug", { slug: next, ...(data?.saved ? {} : { draft: content }) }));
        setEditingSlug(false);
      } catch (err) {
        setSlugError(errorMessage(err as Error));
      }
    });
  };
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The link could not be copied. Select the address and copy it instead.");
    }
  };

  const stateLine = data
    ? pageStateLine({ published: data.live, publishedOn: data.publishedAt ? formatDate(data.publishedAt) : null, changed: data.live && (data.changed || changedFromLive) })
    : "";
  const showErrors = touched || pending === "publish";
  const publishLabel = data?.live ? PUBLIC_PAGE_WORDS.publishChanges : PUBLIC_PAGE_WORDS.publish;
  const canPress = Boolean(content) && Object.keys(problems).length === 0;
  const founderNames = content?.showFounders ? (data?.preview.founderNames ?? []) : [];
  // "3 people follow this project": a count only, and only once someone does (no nag at zero).
  const followers = followerCountLine(data?.followers ?? 0);

  return (
    <Screen name="product/public-page">
      <Panel
        title={PUBLIC_PAGE_WORDS.yourPage}
        span={6}
        loading={view.isLoading}
        error={view.error ? view.error.message : undefined}
        onRetry={view.refetch}
        actions={
          data ? (
            <StatusPill tone={data.live ? (data.changed || changedFromLive ? "warn" : "good") : "neutral"} data-testid="page-state">
              {stateLine}
            </StatusPill>
          ) : undefined
        }
        data-testid="public-page-editor"
      >
        <Explainer {...PUBLIC_PAGE_EXPLAINER} className="mb-4" />
        {data && content ? (
          <div className="flex flex-col gap-5">
            {data.isSample ? <p className="t-body text-secondary">{PUBLIC_PAGE_WORDS.sample}</p> : !canEdit ? <p className="t-body text-secondary" data-testid="page-read-only">{PUBLIC_PAGE_WORDS.readOnly}</p> : null}

            <Counted id={`${id}-pitch`} label={PUBLIC_PAGE_WORDS.pitch} hint={PUBLIC_PAGE_WORDS.pitchHint} error={showErrors ? problems.pitch : undefined} used={content.pitch.length} max={PAGE_PITCH_MAX}>
              <Input id={`${id}-pitch`} value={content.pitch} readOnly={!canEdit} onChange={(e) => set("pitch", e.target.value)} onBlur={() => setTouched(true)} controlSize="lg" />
            </Counted>
            <Counted id={`${id}-about`} label={PUBLIC_PAGE_WORDS.about} hint={PUBLIC_PAGE_WORDS.aboutHint} error={showErrors ? problems.about : undefined} used={content.about.length} max={PAGE_ABOUT_MAX}>
              <Textarea id={`${id}-about`} value={content.about} readOnly={!canEdit} rows={7} onChange={(e) => set("about", e.target.value)} onBlur={() => setTouched(true)} />
            </Counted>
            <Counted id={`${id}-for-whom`} label={PUBLIC_PAGE_WORDS.forWhom} hint={PUBLIC_PAGE_WORDS.forWhomHint} error={showErrors ? problems.forWhom : undefined} used={content.forWhom.length} max={PAGE_FOR_WHOM_MAX}>
              <Textarea id={`${id}-for-whom`} value={content.forWhom} readOnly={!canEdit} rows={2} onChange={(e) => set("forWhom", e.target.value)} onBlur={() => setTouched(true)} />
            </Counted>
            <div className="flex flex-col gap-1.5">
              <span className="t-label text-secondary" id={`${id}-stage`}>
                {PUBLIC_PAGE_WORDS.stage}
              </span>
              <SegmentedControl<PageStage>
                aria-label={PUBLIC_PAGE_WORDS.stage}
                size="md"
                options={PAGE_STAGES.map((s) => ({ value: s, label: PAGE_STAGE_LABELS[s], disabled: !canEdit }))}
                value={content.stage}
                onValueChange={(v) => canEdit && set("stage", v)}
                className="self-start"
              />
            </div>
            <label className="flex items-start gap-3" htmlFor={`${id}-founders`}>
              <Switch id={`${id}-founders`} checked={content.showFounders} disabled={!canEdit} onCheckedChange={(on) => set("showFounders", on === true)} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="t-body text-primary">{PUBLIC_PAGE_WORDS.showFounders}</span>
                <span className="t-small text-secondary">{PUBLIC_PAGE_WORDS.showFoundersHint}</span>
              </span>
            </label>
            <label className="flex items-start gap-3" htmlFor={`${id}-follow`}>
              <Switch id={`${id}-follow`} checked={content.followForm} disabled={!canEdit} onCheckedChange={(on) => set("followForm", on === true)} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="t-body text-primary">{PUBLIC_PAGE_WORDS.followForm}</span>
                <span className="t-small text-secondary">{PUBLIC_PAGE_WORDS.followFormHint}</span>
              </span>
            </label>
            {followers ? (
              <p className="t-body text-primary" data-testid="page-followers">
                {followers}
              </p>
            ) : null}

            <section aria-labelledby={`${id}-address`} className="flex flex-col gap-2 border-t border-line pt-4" data-testid="page-address">
              <h3 id={`${id}-address`} className="t-label text-secondary">
                {PUBLIC_PAGE_WORDS.address}
              </h3>
              {editingSlug ? (
                <div className="flex flex-col gap-2">
                  <Field htmlFor={`${id}-slug`} label={PUBLIC_PAGE_WORDS.newAddress} hint={PAGE_SLUG_RULE} error={slugError ?? undefined}>
                    <Input id={`${id}-slug`} value={slug} maxLength={PAGE_SLUG_MAX + 10} prefix={data.url.slice(0, data.url.length - data.slug.length)} onChange={(e) => setSlug(e.target.value)} mono />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={saveSlug} loading={pending === "slug"}>
                      {PUBLIC_PAGE_WORDS.saveAddress}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => (setEditingSlug(false), setSlugError(null))}>
                      {PUBLIC_PAGE_WORDS.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-mono min-w-0 break-all text-primary" data-testid="page-url">
                    {data.url}
                  </span>
                  {canEdit ? (
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => (setSlug(data.slug), setEditingSlug(true))}>
                      {PUBLIC_PAGE_WORDS.changeAddress}
                    </Button>
                  ) : null}
                  {data.live ? (
                    <>
                      <Button size="sm" icon={Copy} onClick={() => void copy()}>
                        {copied ? PUBLIC_PAGE_WORDS.copied : PUBLIC_PAGE_WORDS.copyLink}
                      </Button>
                      <Button size="sm" icon={ExternalLink} asChild>
                        <a href={data.url} target="_blank" rel="noopener noreferrer">
                          {PUBLIC_PAGE_WORDS.open}
                        </a>
                      </Button>
                    </>
                  ) : null}
                </div>
              )}
            </section>

            {held ? (
              <p role="alert" className="t-body text-status-warn" data-testid="page-held">
                {held}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="t-body text-status-bad">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="t-body text-secondary">
                {notice}
              </p>
            ) : null}

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="page-actions">
                {!data.live || changedFromLive || data.changed ? (
                  <Button variant="primary" icon={Rocket} disabled={!canPress} onClick={() => (setTouched(true), setConfirming(true))}>
                    {publishLabel}
                  </Button>
                ) : null}
                <Button onClick={save} loading={pending === "save"} disabled={!dirty}>
                  {PUBLIC_PAGE_WORDS.save}
                </Button>
                {data.live ? (
                  <Button variant="ghost" icon={Undo2} onClick={unpublish} loading={pending === "unpublish"}>
                    {PUBLIC_PAGE_WORDS.takeDown}
                  </Button>
                ) : null}
                {dirty ? <span className="t-small text-secondary">{PUBLIC_PAGE_WORDS.unsaved}</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel title={PUBLIC_PAGE_WORDS.preview} span={6} meta={<span className="t-small text-secondary">{PUBLIC_PAGE_WORDS.previewNote}</span>} loading={view.isLoading} className="self-start" data-testid="public-page-preview">
        {data && content ? (
          <div className="mx-auto w-phone max-w-full overflow-hidden rounded-md border border-line-strong">
            <ProjectPage
              variant="preview"
              name={data.preview.name}
              pitch={content.pitch || data.preview.name}
              about={content.about}
              forWhom={content.forWhom}
              stage={content.stage}
              publishedAt={data.live ? data.publishedAt : null}
              brandPrimary={data.preview.brandPrimary}
              brandSecondary={data.preview.brandSecondary}
              founderNames={founderNames}
              mark={data.mark ? "visitor" : "none"}
              follow={content.followForm ? <ProjectFollowForm name={data.preview.name} preview /> : null}
            />
          </div>
        ) : null}
        {data?.mark && content ? (
          <p className="t-small mx-auto mt-3 w-phone max-w-full text-secondary" data-testid="page-mark-note">
            {builtOnWords(APP_NAME).previewNote}
          </p>
        ) : null}
      </Panel>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent size="sm" aria-describedby={`${id}-confirm`}>
          <DialogHeader>
            <DialogTitle>{data?.live ? PUBLIC_PAGE_WORDS.confirmChangesTitle : PUBLIC_PAGE_WORDS.confirmTitle}</DialogTitle>
            <DialogDescription id={`${id}-confirm`}>{content ? publishConsequence(content, data?.preview.founderNames ?? []) : null}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="flex items-center gap-2 t-body text-secondary">
              <Icon icon={Globe} size="inline" />
              <span className="t-mono break-all">{data?.url}</span>
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {PUBLIC_PAGE_WORDS.cancel}
            </Button>
            <Button variant="primary" icon={Rocket} loading={pending === "publish"} onClick={publish} data-testid="page-confirm-publish">
              {PUBLIC_PAGE_WORDS.confirmPublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
