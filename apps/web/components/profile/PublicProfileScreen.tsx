"use client";
/**
 * /public-profile — Your public profile (docs/THESIS_REVIEW.md package 2.3): the person's own page at `/u/<handle>`,
 * which needs no project and is public only when they publish it. The account frame without the step trail, like Your
 * businesses; reached from the business switcher ("Your public profile") and Settings › Preferences. Desktop only, like
 * the rest of the console; the public page itself works from 390 px.
 *
 * The person writes a headline, about, what they are good at and want to learn (tags, with suggestions), the place and
 * "What are you here for?" ("Building on my own" by default, a complete answer: nothing else here asks about people),
 * sees it live in a phone-width preview drawn by the same `PersonPage` the public route uses, chooses the address, and
 * publishes it behind a confirmation that says what becomes public, saves changes, takes it down or copies the link.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink, Globe, Pencil, Rocket, Save, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Icon, Input, Panel, PersonPage, RadioGroup, RadioOption, StatusPill, Textarea, useFormatters } from "@foundmill/dugout";
import {
  LEARN_SUGGESTIONS,
  LOOKING_FOR_OPTIONS,
  LOOKING_FOR_QUESTION,
  PERSON_ABOUT_MAX,
  PERSON_HEADLINE_MAX,
  PERSON_PLACE_MAX,
  PERSON_TAGS_MAX,
  PERSON_TAG_MAX,
  STRENGTH_SUGGESTIONS,
  personHandleProblem,
  personProfileProblems,
  personStateLine,
  samePersonProfile,
  type PersonLookingFor,
  type PersonProfileContent,
} from "@foundmill/shared/person-profile";
import { PAGE_SLUG_MAX, PAGE_SLUG_RULE } from "@foundmill/shared/project-page";
import { routes } from "@foundmill/widgets/shared/routes";
import { accountRoutes } from "@/lib/account-routes";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "@/components/new/LinkButton";
import { StudioFrame } from "@/components/new/StudioFrame";
import { ChipField } from "@/components/onboarding/OnboardingScreen";

/** The words of the screen, in one place (the e2e spec and the unit test read them). */
export const PUBLIC_PROFILE_WORDS = {
  title: "Your public profile",
  lede: "A page about you that anyone with the link can open. It needs no project, and it is public only when you publish it.",
  yourProfile: "Your profile",
  preview: "Preview",
  previewNote: "As it looks on a phone.",
  name: "Name",
  nameLine: (name: string) => `Shown as ${name}.`,
  changeName: "Change your name in Your profile",
  headline: "Headline",
  headlineHint: "One line under your name, like what you make or what you are working on.",
  about: "About",
  aboutHint: "Plain text. Leave a blank line between paragraphs.",
  strengths: "Good at",
  strengthsHint: `Up to ${PERSON_TAGS_MAX}. Type your own and press Enter, or pick one below.`,
  wantsToLearn: "Wants to learn",
  wantsToLearnHint: `Up to ${PERSON_TAGS_MAX}. Type your own and press Enter, or pick one below.`,
  place: "Place",
  placeHint: "Optional, like “Manchester, UK”. Left off the page when empty.",
  placePlaceholder: "City, country",
  privateNote: "Only what you write here is shown. Your email, where you live, your budget and the rest of your profile are never on this page.",
  address: "Address",
  changeAddress: "Change address",
  newAddress: "New address",
  saveAddress: "Save address",
  cancel: "Cancel",
  copyLink: "Copy link",
  copied: "Link copied",
  open: "Open",
  save: "Save",
  saveChanges: "Save changes",
  saved: "Saved",
  savedLive: "Saved. Your public profile shows it now.",
  unsaved: "Changes not saved yet",
  publish: "Publish",
  takeDown: "Take it down",
  takenDown: "Your profile is not public now. Everything you wrote is kept.",
  published: "Your profile is public.",
  confirmTitle: "Make your profile public?",
  confirmPublish: "Publish it",
  back: (name: string) => `Back to ${name}`,
} as const;

/** What the confirmation says becomes public, field by field, and that it can be taken down. */
export function publishProfileConsequence(content: PersonProfileContent, projects: number): string {
  const parts = ["your name"];
  if (content.headline.trim()) parts.push("your headline");
  if (content.place.trim()) parts.push("your place");
  if (content.about.trim()) parts.push("about");
  if (content.strengths.length) parts.push("what you are good at");
  if (content.wantsToLearn.length) parts.push("what you want to learn");
  if (content.lookingFor !== "on_my_own") parts.push("what you are here for");
  if (projects > 0) parts.push(projects === 1 ? "your public project page" : "your public project pages");
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
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

export interface PublicProfileScreenProps {
  viewer: { email: string | null };
  /** The business the person opened last: Back to it. */
  lastBusiness: { id: string; name: string } | null;
}

export function PublicProfileScreen({ viewer, lastBusiness }: PublicProfileScreenProps) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { formatDate } = useFormatters();
  const viewQ = useQuery(trpc.founder.publicProfile.get.queryOptions(undefined, { staleTime: 5_000 }));
  const data = viewQ.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("founder.publicProfile") as unknown[] });
  const update = useMutation(trpc.founder.publicProfile.update.mutationOptions());
  const publish = useMutation(trpc.founder.publicProfile.publish.mutationOptions());
  const unpublish = useMutation(trpc.founder.publicProfile.unpublish.mutationOptions());

  // The form follows the server until the person types; a save or publish answer resets it.
  const [draft, setDraft] = useState<PersonProfileContent | null>(null);
  const [base, setBase] = useState<PersonProfileContent | null>(null);
  useEffect(() => {
    if (!data) return;
    if (!base || !draft || samePersonProfile(draft, base)) {
      setDraft(data.content);
      setBase(data.content);
    }
    // Only a new server copy matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const content = draft ?? data?.content ?? null;
  const problems = useMemo(() => (content ? personProfileProblems(content) : {}), [content]);
  const dirty = Boolean(content && base && !samePersonProfile(content, base));
  const live = Boolean(data?.public);
  const canPress = Boolean(content) && Object.keys(problems).length === 0;
  const busy = update.isPending || publish.isPending || unpublish.isPending;

  type View = NonNullable<typeof data>;
  const apply = (next: View) => {
    setDraft(next.content);
    setBase(next.content);
    queryClient.setQueryData(trpc.founder.publicProfile.get.queryKey(), next);
    void refresh();
  };
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setHeld(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const set = <K extends keyof PersonProfileContent>(key: K, value: PersonProfileContent[K]) => {
    setHeld(null);
    setNotice(null);
    setDraft((d) => ({ ...(d ?? data!.content), [key]: value }));
  };

  const save = () =>
    run(async () => {
      const result = await update.mutateAsync({ content: content! });
      apply(result.profile);
      if (result.outcome === "held") setHeld(result.message);
      else setNotice(live ? PUBLIC_PROFILE_WORDS.savedLive : PUBLIC_PROFILE_WORDS.saved);
    });
  const doPublish = () =>
    run(async () => {
      const result = await publish.mutateAsync({ content: content! });
      setConfirming(false);
      apply(result.profile);
      if (result.outcome === "held") setHeld(result.message);
      else setNotice(PUBLIC_PROFILE_WORDS.published);
    });
  const takeDown = () =>
    run(async () => {
      apply(await unpublish.mutateAsync());
      setNotice(PUBLIC_PROFILE_WORDS.takenDown);
    });
  const saveHandle = () => {
    const next = handle.trim().toLowerCase();
    const problem = personHandleProblem(next);
    if (problem) return setHandleError(problem);
    setHandleError(null);
    void run(async () => {
      try {
        const result = await update.mutateAsync({ handle: next, content: base ?? content! });
        apply(result.profile);
        if (result.outcome === "held") setHeld(result.message);
        else setEditingHandle(false);
      } catch (err) {
        setHandleError(errorMessage(err));
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

  const stateLine = data ? personStateLine({ public: live, publishedOn: data.publishedAt ? formatDate(data.publishedAt) : null }) : "";
  const projects = data?.projects ?? [];

  return (
    <StudioFrame
      title={PUBLIC_PROFILE_WORDS.title}
      lede={PUBLIC_PROFILE_WORDS.lede}
      viewer={viewer}
      actions={
        lastBusiness ? (
          <LinkButton variant="ghost" icon={ArrowLeft} href={routes.today(lastBusiness.id)} data-testid="public-profile-back">
            {PUBLIC_PROFILE_WORDS.back(lastBusiness.name)}
          </LinkButton>
        ) : null
      }
    >
      <div className="grid grid-cols-12 items-start gap-gutter" data-testid="public-profile-screen">
        <Panel
          title={PUBLIC_PROFILE_WORDS.yourProfile}
          className="col-span-7"
          loading={viewQ.isLoading}
          error={viewQ.error ? errorMessage(viewQ.error) : undefined}
          onRetry={() => void viewQ.refetch()}
          actions={
            data ? (
              <StatusPill tone={live ? "good" : "neutral"} data-testid="public-profile-state">
                {stateLine}
              </StatusPill>
            ) : undefined
          }
          data-testid="public-profile-editor"
        >
          {data && content ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <span className="t-label text-secondary">{PUBLIC_PROFILE_WORDS.name}</span>
                <p className="t-body text-primary" data-testid="public-profile-name">
                  {PUBLIC_PROFILE_WORDS.nameLine(data.displayName)}{" "}
                  <Link href={accountRoutes.profile} className="text-secondary underline-offset-2 hover:text-primary">
                    {PUBLIC_PROFILE_WORDS.changeName}
                  </Link>
                </p>
              </div>
              <Counted id={`${id}-headline`} label={PUBLIC_PROFILE_WORDS.headline} hint={PUBLIC_PROFILE_WORDS.headlineHint} error={problems.headline} used={content.headline.length} max={PERSON_HEADLINE_MAX}>
                <Input id={`${id}-headline`} value={content.headline} onChange={(e) => set("headline", e.target.value)} controlSize="lg" />
              </Counted>
              <Counted id={`${id}-about`} label={PUBLIC_PROFILE_WORDS.about} hint={PUBLIC_PROFILE_WORDS.aboutHint} error={problems.about} used={content.about.length} max={PERSON_ABOUT_MAX}>
                <Textarea id={`${id}-about`} value={content.about} rows={6} onChange={(e) => set("about", e.target.value)} />
              </Counted>
              <ChipField id={`${id}-strengths`} label={PUBLIC_PROFILE_WORDS.strengths} hint={PUBLIC_PROFILE_WORDS.strengthsHint} error={problems.strengths} values={content.strengths} suggestions={STRENGTH_SUGGESTIONS} onChange={(v) => set("strengths", v)} maxLength={PERSON_TAG_MAX} max={PERSON_TAGS_MAX} />
              <ChipField id={`${id}-learn`} label={PUBLIC_PROFILE_WORDS.wantsToLearn} hint={PUBLIC_PROFILE_WORDS.wantsToLearnHint} error={problems.wantsToLearn} values={content.wantsToLearn} suggestions={LEARN_SUGGESTIONS} onChange={(v) => set("wantsToLearn", v)} maxLength={PERSON_TAG_MAX} max={PERSON_TAGS_MAX} />
              <Counted id={`${id}-place`} label={PUBLIC_PROFILE_WORDS.place} hint={PUBLIC_PROFILE_WORDS.placeHint} error={problems.place} used={content.place.length} max={PERSON_PLACE_MAX}>
                <Input id={`${id}-place`} value={content.place} placeholder={PUBLIC_PROFILE_WORDS.placePlaceholder} onChange={(e) => set("place", e.target.value)} />
              </Counted>
              <fieldset className="flex flex-col gap-2" data-testid="public-profile-looking-for">
                <legend className="t-label mb-2 text-secondary">{LOOKING_FOR_QUESTION}</legend>
                <RadioGroup value={content.lookingFor} onValueChange={(v) => set("lookingFor", v as PersonLookingFor)} aria-label={LOOKING_FOR_QUESTION}>
                  {LOOKING_FOR_OPTIONS.map((o) => (
                    <RadioOption key={o.value} id={`${id}-looking-${o.value}`} value={o.value} label={o.label} />
                  ))}
                </RadioGroup>
              </fieldset>
              <p className="t-small text-secondary">{PUBLIC_PROFILE_WORDS.privateNote}</p>

              <section aria-labelledby={`${id}-address`} className="flex flex-col gap-2 border-t border-line pt-4" data-testid="public-profile-address">
                <h3 id={`${id}-address`} className="t-label text-secondary">
                  {PUBLIC_PROFILE_WORDS.address}
                </h3>
                {editingHandle ? (
                  <div className="flex flex-col gap-2">
                    <Field htmlFor={`${id}-handle`} label={PUBLIC_PROFILE_WORDS.newAddress} hint={PAGE_SLUG_RULE} error={handleError ?? undefined}>
                      <Input id={`${id}-handle`} value={handle} maxLength={PAGE_SLUG_MAX + 10} prefix={data.url.slice(0, data.url.length - data.handle.length)} onChange={(e) => setHandle(e.target.value)} mono />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" onClick={saveHandle} loading={update.isPending}>
                        {PUBLIC_PROFILE_WORDS.saveAddress}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => (setEditingHandle(false), setHandleError(null))}>
                        {PUBLIC_PROFILE_WORDS.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="t-mono min-w-0 break-all text-primary" data-testid="public-profile-url">
                      {data.url}
                    </span>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => (setHandle(data.handle), setEditingHandle(true))}>
                      {PUBLIC_PROFILE_WORDS.changeAddress}
                    </Button>
                    {live ? (
                      <>
                        <Button size="sm" icon={Copy} onClick={() => void copy()}>
                          {copied ? PUBLIC_PROFILE_WORDS.copied : PUBLIC_PROFILE_WORDS.copyLink}
                        </Button>
                        <Button size="sm" icon={ExternalLink} asChild>
                          <a href={data.url} target="_blank" rel="noopener noreferrer">
                            {PUBLIC_PROFILE_WORDS.open}
                          </a>
                        </Button>
                      </>
                    ) : null}
                  </div>
                )}
              </section>

              {held ? (
                <p role="alert" className="t-body text-status-warn" data-testid="public-profile-held">
                  {held}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="t-body text-status-bad">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="t-body text-secondary" data-testid="public-profile-notice">
                  {notice}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="public-profile-actions">
                {!live ? (
                  <Button variant="primary" icon={Rocket} disabled={!canPress || busy} onClick={() => setConfirming(true)}>
                    {PUBLIC_PROFILE_WORDS.publish}
                  </Button>
                ) : null}
                <Button icon={Save} onClick={() => void save()} loading={update.isPending && !editingHandle} disabled={!dirty || !canPress}>
                  {live ? PUBLIC_PROFILE_WORDS.saveChanges : PUBLIC_PROFILE_WORDS.save}
                </Button>
                {live ? (
                  <Button variant="ghost" icon={Undo2} onClick={() => void takeDown()} loading={unpublish.isPending}>
                    {PUBLIC_PROFILE_WORDS.takeDown}
                  </Button>
                ) : null}
                {dirty ? <span className="t-small text-secondary">{PUBLIC_PROFILE_WORDS.unsaved}</span> : null}
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel title={PUBLIC_PROFILE_WORDS.preview} className="col-span-5" meta={<span className="t-small text-secondary">{PUBLIC_PROFILE_WORDS.previewNote}</span>} loading={viewQ.isLoading} data-testid="public-profile-preview">
          {data && content ? (
            <div className="mx-auto w-phone max-w-full overflow-hidden rounded-md border border-line-strong">
              <PersonPage
                variant="preview"
                name={data.displayName}
                headline={content.headline}
                about={content.about}
                strengths={content.strengths}
                wantsToLearn={content.wantsToLearn}
                lookingFor={content.lookingFor}
                place={content.place}
                projects={projects}
                homeHref="/"
              />
            </div>
          ) : null}
        </Panel>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent size="sm" aria-describedby={`${id}-confirm`}>
          <DialogHeader>
            <DialogTitle>{PUBLIC_PROFILE_WORDS.confirmTitle}</DialogTitle>
            <DialogDescription id={`${id}-confirm`}>{content ? publishProfileConsequence(content, projects.length) : null}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="flex items-center gap-2 t-body text-secondary">
              <Icon icon={Globe} size="inline" />
              <span className="t-mono break-all">{data?.url}</span>
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {PUBLIC_PROFILE_WORDS.cancel}
            </Button>
            <Button variant="primary" icon={Rocket} loading={publish.isPending} onClick={() => void doPublish()} data-testid="public-profile-confirm-publish">
              {PUBLIC_PROFILE_WORDS.confirmPublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StudioFrame>
  );
}
