"use client";
/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7). Name with suggestions, live domain
 * availability (the registry's answer through `idea.domainCheck`) and the trademark quick screen ("Screen, not legal
 * clearance"), the logo (upload a real one or
 * generate marks; `idea.logo.*`) and brand colours, game mode LIVE / Personal, archetype cards, business mode
 * (Augmented / Assisted default / Automated) with the default spend cap, the team the archetype seeds (idea.preview),
 * then "Take charge" → idea.commit (with the chosen logo) → the Board item in the Inbox.
 *
 * `CommitForm` is pure apart from the local trademark screen and the logo and domain calls it is handed (`logoApi`,
 * `domainApi`); `CommitScreen` loads the idea, wires those calls to tRPC and commits.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Globe, Lock, RotateCw, Scale, ThumbsUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype, type BusinessMode, type DeptColourToken, type GameMode } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { Avatar, Button, Chip, ConceptCard, EmptyState, Field, Input, MoneyInput, Panel, ProvenanceChip, RadioGroup, RadioGroupItem, SkeletonRows, StatusPill, cn, formatMoney, useFormatters, useToast, type Kit } from "@foundmill/dugout";
import { plainWords, plural } from "@/lib/format";
import { useSingleFlight } from "@/lib/single-flight";
import { errorMessage, tierLimitOf, type RouterOutputs } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { IMPORT_STEPS, STUDIO_STEPS, StudioFrame, type StudioStepItem } from "../StudioFrame";
import { conceptErrorMessage, isConceptGone } from "../ideate/concept-errors";
import { readMeta, toConcept, type IdeaLike } from "../ideate/concepts";
import type { GeneratedLogoSet, LogoActions, LogoProgress } from "@/components/logo/LogoPicker";
import { readLogoStream } from "@/components/logo/logo-stream";
import { LogoColoursEditor } from "./LogoColoursEditor";
import {
  ARCHETYPE_CARDS,
  BUSINESS_MODE_CARDS,
  DEFAULT_SPEND_CAP_MINOR,
  DOMAIN_NOTE,
  DOMAIN_STATUS_WORDS,
  GAME_MODE_CARDS,
  TRADEMARK_STATUS_WORDS,
  commitInput,
  couldNotCheck,
  domainCandidates,
  domainProvenanceWord,
  initialCommitForm,
  nameSuggestions,
  trademarkScreen,
  validateCommitForm,
  type CommitForm as CommitFormValues,
  type DomainCheck,
  type DomainProvenance,
  type TrademarkScreen,
} from "./naming";
import { kitFromSeed } from "../ideate/concepts";

export interface CommitScreenProps {
  ideaId: string;
  viewer: { email: string | null };
  currency: string;
}

type SquadPreview = RouterOutputs["idea"]["preview"];

/** The logo calls the Commit form makes (bound to `idea.logo.*` by CommitScreen; faked in tests). */
export interface CommitLogoApi {
  prepare(dataUrl: string): Promise<{ dataUrl: string; colours: string[] }>;
  /** A set, streamed (`idea.logo.stream`): `onProgress` gets each mark as it passes the server's check. */
  generate(input: { name: string; colours: Kit; archetype: Archetype | null; round: number }, onProgress?: (progress: LogoProgress) => void, signal?: AbortSignal): Promise<GeneratedLogoSet>;
}

/** The domain calls the Commit form makes (bound to `idea.domainCheck` by CommitScreen; faked in tests). */
export interface CommitDomainApi {
  /** The registry's answer for a business name's candidate domains, or for the given domains (a Retry); `signal` cancels a stale request. */
  check(input: { name: string } | { domains: string[] }, signal?: AbortSignal): Promise<DomainCheck[]>;
}

/** How long after a successful commit the screen waits for the client-side move before loading the Inbox outright. */
export const COMMIT_NAVIGATION_FALLBACK_MS = 4_000;
/** Full-page navigation (a seam for tests). */
export const commitNavigation = { assign: (url: string) => window.location.assign(url) };

export function CommitScreen({ ideaId, viewer, currency }: CommitScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const ideaQ = useQuery(trpc.idea.get.queryOptions({ ideaId }));
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const previewQ = useQuery(trpc.idea.preview.queryOptions({ archetype: archetype ?? "b2b_saas" }, { enabled: archetype !== null, staleTime: 60_000 }));
  const client = useTRPCClient();
  const prepareLogo = useMutation(trpc.idea.logo.prepare.mutationOptions());
  const { mutateAsync: prepareAsync } = prepareLogo;
  const logoApi = useMemo<CommitLogoApi>(
    () => ({
      prepare: (dataUrl) => prepareAsync({ dataUrl }),
      // Streamed: the four marks are drawn in parallel and each shows the moment it passes the check (audit P6).
      generate: async ({ name, colours, archetype, round }, onProgress, signal) =>
        readLogoStream(await client.idea.logo.stream.mutate({ ideaId, name: name.trim() || "Your business", colours, archetype: archetype ?? undefined, round }, { signal }), onProgress),
    }),
    [ideaId, prepareAsync, client],
  );
  const domainApi = useMemo<CommitDomainApi>(() => ({ check: (input, signal) => client.idea.domainCheck.mutate(input, { signal }) }), [client]);
  const commit = useMutation(
    trpc.idea.commit.mutationOptions({
      onSuccess: (res) => {
        // A second Take charge of this idea (another tab, a retried request) answers with the business the first created.
        toast({ title: res.alreadyCommitted ? `${res.business.name} is already yours` : `${res.business.name} is yours`, description: "The Board's first item is waiting in the Inbox.", tone: "good" });
        const to = routes.inbox(res.business.id, res.boardItem.id);
        router.push(to);
        // Belt and braces: if the client-side move has not happened in a few seconds, load the page outright.
        window.setTimeout(() => {
          if (window.location.pathname.startsWith("/new/")) commitNavigation.assign(to);
        }, COMMIT_NAVIGATION_FALLBACK_MS);
      },
      onError: (err) => toast({ title: "Not committed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  // One commit per press: a double click reaches here twice before `isPending` re-renders the button, so a ref guards
  // it, and stays closed after success while the page moves to the new business.
  const onCommit = useSingleFlight(commit.mutateAsync, { closeOnSuccess: true });

  const idea = ideaQ.data?.idea as IdeaLike | undefined;
  // Reached from Import: its own trail, Back to the finished report (the signed job id travels in the address), and the
  // report's archetype ahead of the card's (audit IAE-18, IAE-12, IAE-10).
  const fromImport = params.get("from") === "import";
  const jobId = fromImport ? params.get("job") : null;
  const steps = useMemo(() => commitSteps(fromImport, jobId), [fromImport, jobId]);
  const suggestedArchetype = fromImport ? archetypeParam(params.get("archetype")) : null;
  const back = (
    <LinkButton variant="ghost" icon={ArrowLeft} href={fromImport ? importHref(jobId) : "/new/ideate"}>
      Back
    </LinkButton>
  );

  if (ideaQ.isLoading) {
    return (
      <StudioFrame step="commit" steps={steps} title="Commit" viewer={viewer} actions={back}>
        <div className="grid grid-cols-12 gap-gutter" aria-busy="true" aria-label="Loading">
          <Panel title="Name" span={8}>
            <SkeletonRows rows={4} cols={2} />
          </Panel>
          <Panel title="Preview" span={4} loading />
        </div>
      </StudioFrame>
    );
  }
  if (ideaQ.error || !idea) {
    return (
      <StudioFrame step="commit" steps={steps} title="Commit" viewer={viewer} actions={back}>
        <Panel title="Concept" error={ideaQ.error ? conceptErrorMessage(ideaQ.error) : "This concept was not found."} onRetry={ideaQ.error && isConceptGone(ideaQ.error) ? undefined : () => ideaQ.refetch()} />
      </StudioFrame>
    );
  }
  if ((ideaQ.data?.idea as { committedAt?: Date | string | null } | undefined)?.committedAt && (ideaQ.data?.idea as { businessId?: string | null } | undefined)?.businessId) {
    const bid = (ideaQ.data!.idea as { businessId: string }).businessId;
    return (
      <StudioFrame step="commit" steps={steps} title="Already committed" viewer={viewer} actions={back}>
        <Panel title="Concept">
          <EmptyState icon={Check} tone="kit" title="This concept already became a business" actions={<LinkButton variant="primary" size="sm" iconRight={ArrowRight} href={routes.home(bid)}>Open the business</LinkButton>}>
            Its team is already at work. Open it to see what they are doing, or go back and commit another concept.
          </EmptyState>
        </Panel>
      </StudioFrame>
    );
  }

  return (
    <CommitForm
      idea={idea}
      viewer={viewer}
      currency={currency}
      initialName={params.get("name")}
      suggestedArchetype={suggestedArchetype}
      steps={steps}
      preview={previewQ.data}
      previewLoading={previewQ.isLoading}
      onArchetypeChange={setArchetype}
      committing={commit.isPending || commit.isSuccess}
      error={commit.error ? errorMessage(commit.error) : null}
      upgradeHref={upgradeHrefOf(commit.error)}
      onCommit={onCommit}
      logoApi={logoApi}
      domainApi={domainApi}
      back={back}
    />
  );
}

/* ---------- the form ---------- */

/** What the founder reads while Take charge runs (a few seconds in mock mode). */
const SETTING_UP = "Setting up your business: departments, team and the first cycle. This takes a few seconds.";

export interface CommitFormProps {
  idea: IdeaLike;
  viewer: { email: string | null };
  currency: string;
  initialName?: string | null;
  /** The Import report's archetype (Import's Continue): preselected ahead of the card's. */
  suggestedArchetype?: Archetype | null;
  /** The first-run trail to draw (Import has its own). */
  steps?: readonly StudioStepItem[];
  preview?: SquadPreview;
  previewLoading?: boolean;
  onArchetypeChange?: (archetype: Archetype | null) => void;
  committing?: boolean;
  error?: string | null;
  /** Where the plan changes when the commit was refused by the plan's business limit (an upgrade prompt). */
  upgradeHref?: string | null;
  onCommit: (input: ReturnType<typeof commitInput>) => void;
  /** Upload checks and logo generation (idea.logo.*). */
  logoApi: CommitLogoApi;
  /** Domain availability (idea.domainCheck). */
  domainApi: CommitDomainApi;
  back?: ReactNode;
}

/** Where Back and the trail's Import step go: the finished import when its job id is known, else a fresh picker. */
export function importHref(jobId: string | null | undefined): string {
  return jobId ? `/new/import?job=${encodeURIComponent(jobId)}` : "/new/import";
}

/** The trail the Commit screen draws: Import's when the founder came from Import (no Ideate or Compare), else the studio's. */
export function commitSteps(fromImport: boolean, jobId: string | null | undefined): readonly StudioStepItem[] {
  if (!fromImport) return STUDIO_STEPS;
  return IMPORT_STEPS.map((s) => (s.id === "import" ? { ...s, href: importHref(jobId) } : s));
}

/** `?archetype=` from Import's Continue: one of the known archetypes, else none. */
export function archetypeParam(value: string | null | undefined): Archetype | null {
  return value && (ARCHETYPES as readonly string[]).includes(value) ? (value as Archetype) : null;
}

/** The color an agent wears in the Day one list: its own department's, as on Home and Team (never its place in the list). */
export function departmentColour(preview: { departments: readonly { slug: string; colourToken: DeptColourToken }[] }, departmentSlug: string | null | undefined): DeptColourToken {
  return preview.departments.find((d) => d.slug === departmentSlug)?.colourToken ?? preview.departments[0]?.colourToken ?? "dept-1";
}

/** Settings › Billing of the business whose plan sets the owner's business limit, when the plan refused the commit. */
export function upgradeHrefOf(err: unknown): string | null {
  const tier = tierLimitOf(err);
  return tier?.limit === "businesses" && tier.planBusinessId ? routes.settings(tier.planBusinessId, "billing") : null;
}

const DEBOUNCE_MS = 350;

export function CommitForm({ idea, viewer, currency, initialName, suggestedArchetype, steps, preview, previewLoading, onArchetypeChange, committing, error, upgradeHref, onCommit, logoApi, domainApi, back }: CommitFormProps) {
  const concept = useMemo(() => toConcept(idea), [idea]);
  // The idea's seed only picks the starting brand colours now; the logo is uploaded or generated.
  const ideaSeed = String(readMeta(idea.current?.research).crest_seed ?? idea.id);
  const [form, setForm] = useState<CommitFormValues>(() => {
    const base = initialCommitForm({ title: idea.current?.title ?? idea.title, archetype: suggestedArchetype ?? idea.archetype }, kitFromSeed(ideaSeed), currency);
    return initialName ? { ...base, name: initialName } : base;
  });
  const [capTouched, setCapTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateCommitForm(form), [form]);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof CommitFormValues>(key: K, value: CommitFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    onArchetypeChange?.(form.archetype);
  }, [form.archetype, onArchetypeChange]);

  // The trademark quick screen is local and instant; it settles with the name like the domain list does.
  const [screened, setScreened] = useState<{ name: string; marks: TrademarkScreen[] } | null>(null);
  useEffect(() => {
    const name = form.name.trim();
    if (!name) {
      setScreened(null);
      return;
    }
    const t = setTimeout(() => setScreened({ name, marks: trademarkScreen(name) }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [form.name]);
  const screening = form.name.trim().length > 0 && screened?.name !== form.name.trim();

  // Domains: the registry's answer for the name's candidates, asked once the name settles. A newer name cancels the
  // request in flight and an answer for an older name is dropped, so a slow reply never overwrites a newer list.
  const [domainList, setDomainList] = useState<{ name: string; rows: DomainCheck[] } | null>(null);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const { formatTime } = useFormatters();
  useEffect(() => {
    const name = form.name.trim();
    setRetrying(new Set());
    if (!name) {
      setDomainList(null);
      return;
    }
    const candidates = domainCandidates(name);
    if (candidates.length === 0) {
      setDomainList({ name, rows: [] });
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      domainApi.check({ name }, controller.signal).then(
        (rows) => {
          if (!controller.signal.aborted) setDomainList({ name, rows });
        },
        // The call itself failed (not one registry): every row says so, nothing is guessed.
        () => {
          if (!controller.signal.aborted) setDomainList({ name, rows: couldNotCheck(candidates) });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [form.name, domainApi]);
  const checkingDomains = form.name.trim().length > 0 && domainList?.name !== form.name.trim();

  /** Ask again for one domain that could not be checked; the answer replaces its row if the name has not changed since. */
  function retryDomain(domain: string) {
    const name = domainList?.name;
    if (!name) return;
    setRetrying((r) => new Set(r).add(domain));
    const settle = (row: DomainCheck) => {
      setDomainList((cur) => (cur && cur.name === name ? { name, rows: cur.rows.map((r) => (r.domain === domain ? row : r)) } : cur));
      setRetrying((r) => {
        const next = new Set(r);
        next.delete(domain);
        return next;
      });
    };
    domainApi.check({ domains: [domain] }).then(
      (rows) => settle(rows.find((r) => r.domain === domain) ?? couldNotCheck([domain], "The checker gave no answer for this name.")[0]!),
      () => settle(couldNotCheck([domain], "The domain checker did not answer.")[0]!),
    );
  }
  const domainProvenances = (["Registry", "DNS", "Mock"] as const).filter((p) => domainList?.rows.some((r) => r.provenance === p));
  const lastChecked = domainList?.rows.reduce<string | null>((latest, r) => (r.checkedAt && (!latest || r.checkedAt > latest) ? r.checkedAt : latest), null) ?? null;

  const suggestions = useMemo(() => nameSuggestions(idea.current?.title ?? idea.title, idea.current?.pitch ?? idea.pitch, idea.archetype), [idea]);
  const generateWith = useCallback<LogoActions["generate"]>((round, onProgress, signal) => logoApi.generate({ name: form.name, colours: form.kit, archetype: form.archetype, round }, onProgress, signal), [logoApi, form.name, form.kit, form.archetype]);
  const logoActions = useMemo<LogoActions>(() => ({ prepare: logoApi.prepare, generate: generateWith }), [logoApi, generateWith]);

  function chooseMode(mode: BusinessMode) {
    setForm((f) => ({ ...f, businessMode: mode, spendCap: capTouched ? f.spendCap : String(DEFAULT_SPEND_CAP_MINOR[mode] / 100) }));
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (!valid || committing) return;
    onCommit(commitInput(idea.id, form));
  }

  const show = (key: keyof CommitFormValues) => (touched ? errors[key] : undefined);
  const capMinor = Math.round(Number(form.spendCap.replace(/[\s,_]/g, "")) * 100);

  return (
    <StudioFrame
      step="commit"
      steps={steps}
      title={form.name.trim() ? `Commit to ${form.name.trim()}` : "Commit"}
      // While the business is set up the header says so, beside the button that started it (the panel's own status line
      // sits at the foot of a long column, usually off screen).
      lede={committing ? SETTING_UP : "Name it, give it a logo, choose how it is run. Taking charge seeds the departments and the team and starts the first cycle."}
      viewer={viewer}
      actions={
        <>
          {back}
          <Button variant="primary" icon={ThumbsUp} loading={committing} onClick={() => submit()} data-testid="take-charge">
            {committing ? "Setting up…" : "Take charge"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-12 gap-gutter" noValidate data-testid="commit-form" data-business-mode={form.businessMode}>
        <div className="col-span-8 flex flex-col gap-gutter">
          <Panel title="Name" data-testid="name-panel">
            <div className="flex flex-col gap-3">
              <Field htmlFor="commit-name" label="Business name" required error={show("name")}>
                <Input id="commit-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoFocus invalid={Boolean(show("name"))} />
              </Field>
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Name suggestions">
                <span className="text-small text-secondary">Suggestions:</span>
                {suggestions.map((s) => (
                  <Chip key={s} onClick={() => set("name", s)} selected={form.name === s} data-suggestion={s}>
                    {s}
                  </Chip>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-gutter border-t border-line pt-3">
                <div data-testid="domain-checks" aria-busy={checkingDomains || undefined}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Globe size={14} className="text-secondary" aria-hidden />
                    <span className="t-label">Domains</span>
                    {domainProvenances.map((p) => (
                      <DomainProvenanceChip key={p} provenance={p} />
                    ))}
                  </div>
                  {domainList && !checkingDomains ? (
                    domainList.rows.length ? (
                      <ul className="flex flex-col gap-1">
                        {domainList.rows.map((d) => (
                          <li key={d.domain} className="flex flex-wrap items-center justify-between gap-x-2 text-body" data-domain={d.domain} data-status={d.status} data-provenance={d.provenance ?? "none"} title={d.status === "taken" && d.registrar ? `Registered with ${d.registrar}${d.expires ? `, expires ${d.expires}` : ""}` : undefined}>
                            <span className="font-mono text-mono">{d.domain}</span>
                            <span className="flex items-center gap-1.5">
                              {d.status === "unknown" ? (
                                <Button type="button" size="sm" variant="ghost" icon={RotateCw} loading={retrying.has(d.domain)} onClick={() => retryDomain(d.domain)} aria-label={`Retry ${d.domain}`} data-testid="domain-retry">
                                  Retry
                                </Button>
                              ) : null}
                              <StatusPill tone={d.status === "available" ? "good" : d.status === "taken" ? "bad" : "neutral"}>{DOMAIN_STATUS_WORDS[d.status]}</StatusPill>
                            </span>
                            {d.reason && (d.status === "unknown" || d.estimate) ? (
                              <span className="basis-full text-small text-secondary" data-testid="domain-reason">
                                {d.reason}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-small text-secondary">Add letters or numbers to the name to check domains.</p>
                    )
                  ) : (
                    <p className="text-small text-secondary">{form.name.trim() ? "Checking…" : "Type a name to check domains."}</p>
                  )}
                  {domainList && !checkingDomains && domainList.rows.length ? (
                    <p className="mt-1.5 text-small text-secondary" data-testid="domain-note">
                      {lastChecked ? <span data-testid="domain-checked">Checked {formatTime(lastChecked)}. </span> : null}
                      {DOMAIN_NOTE}
                    </p>
                  ) : null}
                </div>
                <div data-testid="trademark-screen">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Scale size={14} className="text-secondary" aria-hidden />
                    <span className="t-label">Trademark quick screen (Estimate, not legal clearance)</span>
                    {(screened?.marks[0]?.provenance ?? "Estimate") === "Estimate" ? <ProvenanceChip kind="estimate" data-testid="trademark-provenance" /> : <Chip>{screened?.marks[0]?.provenance}</Chip>}
                  </div>
                  {screened && !screening ? (
                    <ul className="flex flex-col gap-1">
                      {screened.marks.map((m) => (
                        <li key={m.registry} className="flex items-center justify-between gap-2 text-body" data-registry={m.registry} data-status={m.status}>
                          <span>
                            {m.registry}
                            {m.similar.length ? <span className="text-small text-secondary"> · {m.similar.join(", ")}</span> : null}
                          </span>
                          <StatusPill tone={m.status === "clear" ? "good" : m.status === "similar" ? "warn" : "bad"}>{TRADEMARK_STATUS_WORDS[m.status]}</StatusPill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-secondary">{form.name.trim() ? "Screening…" : "Type a name to screen it."}</p>
                  )}
                  <p className="mt-1.5 text-small text-secondary" data-testid="trademark-caveat">
                    A heuristic: the name is checked against a list of well-known marks, not a registry search. Screen, not legal clearance: a lawyer or an attorney search confirms it.
                  </p>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Logo and brand colors" data-testid="logo-panel">
            <LogoColoursEditor name={form.name} kit={form.kit} onKitChange={(kit: Kit) => set("kit", kit)} logo={form.logo} onLogoChange={(logo) => set("logo", logo)} logoActions={logoActions} error={show("kit")} />
          </Panel>

          <Panel title="Personal or live">
            <RadioGroup value={form.gameMode} onValueChange={(v) => set("gameMode", v as GameMode)} className="grid-cols-2" aria-label="Personal or live">
              {GAME_MODE_CARDS.map((m) => (
                <ModeCardOption key={m.value} id={`game-${m.value}`} value={m.value} label={m.label} tagline={m.tagline} details={m.details} selected={form.gameMode === m.value} icon={m.value === "live" ? Globe : Lock} />
              ))}
            </RadioGroup>
          </Panel>

          <Panel title="Archetype" data-testid="archetype-panel">
            <Field htmlFor="archetype-group" label="Seeds the departments, the team and the first roadmap" required error={show("archetype")}>
              <RadioGroup id="archetype-group" value={form.archetype ?? ""} onValueChange={(v) => set("archetype", v as Archetype)} className="grid-cols-4" aria-label="Archetype">
                {ARCHETYPE_CARDS.map((a) => (
                  <ModeCardOption key={a.value} id={`arch-${a.value}`} value={a.value} label={a.label} tagline={a.tagline} details={[`First win: ${a.firstWin}`]} selected={form.archetype === a.value} badge={suggestedArchetype === a.value ? "From the import report" : !suggestedArchetype && idea.archetype === a.value ? "From the card" : undefined} />
                ))}
              </RadioGroup>
            </Field>
          </Panel>

          <Panel title="Business mode" data-testid="business-mode-panel">
            <div className="flex flex-col gap-3">
              <RadioGroup value={form.businessMode} onValueChange={(v) => chooseMode(v as BusinessMode)} className="grid-cols-3" aria-label="Business mode">
                {BUSINESS_MODE_CARDS.map((m) => (
                  <ModeCardOption key={m.value} id={`mode-${m.value}`} value={m.value} label={m.label} tagline={m.tagline} details={m.details} selected={form.businessMode === m.value} badge={m.value === "assisted" ? "Default" : undefined} />
                ))}
              </RadioGroup>
              <div className="grid grid-cols-12 items-start gap-gutter border-t border-line pt-3">
                <Field htmlFor="spend-cap" label="Spend cap per action" hint="Above this every spend asks you first, whatever the mode. Empty means no cap." error={show("spendCap")} className="col-span-6">
                  <MoneyInput
                    id="spend-cap"
                    controlSize="lg"
                    inputMode="decimal"
                    value={form.spendCap}
                    currency={form.currency}
                    onChange={(e) => {
                      setCapTouched(true);
                      set("spendCap", e.target.value);
                    }}
                    invalid={Boolean(show("spendCap"))}
                  />
                </Field>
                <p className="col-span-6 flex flex-wrap items-center gap-x-2 gap-y-1 pt-6 text-small text-secondary">
                  <span>
                    Default for {BUSINESS_MODE_CARDS.find((m) => m.value === form.businessMode)?.label}: <span className="tabular text-primary">{formatMoney({ amountMinor: DEFAULT_SPEND_CAP_MINOR[form.businessMode], currency: form.currency })}</span>
                  </span>
                  <ProvenanceChip kind="estimate" />
                  <span>Money, signatures and identity always ask.</span>
                </p>
              </div>
            </div>
          </Panel>

          {error ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="commit-error">
              <StatusPill tone="bad" role="alert">
                {error}
              </StatusPill>
              {upgradeHref ? (
                <LinkButton variant="default" size="sm" iconRight={ArrowRight} href={upgradeHref} data-testid="commit-upgrade">
                  See plans
                </LinkButton>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="col-span-4">
          <div className="sticky top-20 flex flex-col gap-gutter">
            <ConceptCard concept={{ ...concept, name: form.name.trim() || concept.name, kit: form.kit, logoSrc: form.logo?.dataUrl ?? null }} hideActions className="w-full" />
            <Panel title="Day one" loading={previewLoading} empty={!form.archetype ? "Pick an archetype to see who gets hired." : undefined} data-testid="squad-preview">
              {preview ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5" aria-label="Departments">
                    {preview.departments.map((d) => (
                      <Chip key={d.slug} tone={d.colourToken}>
                        {d.name}
                      </Chip>
                    ))}
                  </div>
                  <ul className="flex flex-col divide-y divide-line-faint" aria-label="Team">
                    {preview.agents.map((a) => (
                      <li key={a.templateKey} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0" data-department={a.departmentSlug ?? undefined}>
                        <Avatar size={24} name={a.name} agent={{ seed: a.templateKey, dept: departmentColour(preview, a.departmentSlug) }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body-strong">{a.name}</div>
                          <div className="truncate text-small text-secondary">{a.role}</div>
                        </div>
                        <Chip>{plainWords(a.modelKey)}</Chip>
                      </li>
                    ))}
                  </ul>
                  <p className="text-small text-secondary">
                    {plural(preview.agents.length, "agent")} · {plural(preview.departments.length, "department")} · {plural(preview.defaultChannels.length, "channel")} on · wages are estimates until the first cycle
                  </p>
                </div>
              ) : null}
            </Panel>
            <Panel title="What happens next">
              <ol className="flex flex-col gap-1.5 text-body">
                {["Business, departments and team are created", "The logo and brand colors go on the top bar", "The first cycle starts", "The Board's first item lands in your Inbox: vision and three decisions"].map((s, i) => (
                  <li key={s} className="flex items-start gap-2">
                    <span className="inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro text-tertiary ring-1 ring-line-strong">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone={form.gameMode === "live" ? "kit" : "ink"} icon={form.gameMode === "live" ? Globe : Lock}>
                  {form.gameMode === "live" ? "Live" : "Personal"}
                </Chip>
                <Chip>{BUSINESS_MODE_CARDS.find((m) => m.value === form.businessMode)?.label}</Chip>
                {form.archetype ? <Chip>{ARCHETYPE_LABELS[form.archetype]}</Chip> : null}
                {Number.isFinite(capMinor) && form.spendCap.trim() ? <Chip>Cap {formatMoney({ amountMinor: capMinor, currency: form.currency })}</Chip> : null}
              </div>
              <Button type="submit" variant="primary" icon={ThumbsUp} loading={committing} className="mt-4 w-full" data-testid="take-charge-bottom">
                Take charge
              </Button>
              {committing ? (
                <p role="status" className="mt-2 text-small text-secondary" data-testid="committing-status">
                  {SETTING_UP}
                </p>
              ) : null}
              {touched && !valid ? (
                <StatusPill tone="warn" role="alert" className="mt-2">
                  {Object.keys(errors).length} thing{Object.keys(errors).length === 1 ? "" : "s"} to fix first
                </StatusPill>
              ) : null}
            </Panel>
          </div>
        </aside>
      </form>
    </StudioFrame>
  );
}

function ModeCardOption({ id, value, label, tagline, details, selected, badge, icon: Icon }: { id: string; value: string; label: string; tagline: string; details: string[]; selected: boolean; badge?: string; icon?: typeof Globe }) {
  // A radio card (DESIGN §8): the whole card is the target; the selected card takes the accent ring. A badge
  // ("Default", "From the card") sits on its own line so it never squeezes the title.
  return (
    <div
      className={cn(
        "relative flex h-full items-start gap-2.5 rounded-md bg-white/2 p-3 ring-1 ring-line transition-[box-shadow,background-color] duration-hover ease-out hover:bg-white/4 hover:ring-line-strong",
        selected && "bg-accent/6 ring-accent/60 hover:ring-accent/70",
      )}
      data-option={value}
      data-selected={selected || undefined}
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-body text-primary">
        {badge ? (
          <span className="flex">
            <Chip tone="kit">{badge}</Chip>
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          {Icon ? <Icon size={14} className="shrink-0 text-secondary" aria-hidden /> : null}
          <span className="t-display-sm text-balance">{label}</span>
        </span>
        <span className="text-small text-secondary">{tagline}</span>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {details.map((d) => (
            <li key={d} className="flex items-start gap-1 text-small text-secondary">
              <Check size={12} className="mt-0.5 shrink-0 text-tertiary" aria-hidden />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </label>
    </div>
  );
}

/** "Registry", "DNS (Estimate)" or "Mock": where the domain answers came from. Only a DNS answer is an estimate. */
function DomainProvenanceChip({ provenance }: { provenance: DomainProvenance }) {
  return (
    <Chip data-testid="domain-provenance" data-source={provenance}>
      {domainProvenanceWord(provenance)}
    </Chip>
  );
}
