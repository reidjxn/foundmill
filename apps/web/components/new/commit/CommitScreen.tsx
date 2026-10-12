"use client";
/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7). Name with suggestions, live domain
 * availability and the USPTO/EUIPO quick screen ("Screen, not legal clearance"), the logo (upload a real one or
 * generate marks; `idea.logo.*`) and brand colours, game mode LIVE / Personal, archetype cards, business mode
 * (Augmented / Assisted default / Automated) with the default spend cap, the team the archetype seeds (idea.preview),
 * then "Take charge" → idea.commit (with the chosen logo) → the Board item in the Inbox.
 *
 * `CommitForm` is pure apart from the local domain/trademark screens and the logo calls it is handed (`logoApi`);
 * `CommitScreen` loads the idea, wires those calls to tRPC and commits.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Globe, Lock, Scale, ThumbsUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ARCHETYPE_LABELS, type Archetype, type BusinessMode, type GameMode } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { Avatar, Button, Checkbox, Chip, ConceptCard, EmptyState, Field, Input, Label, MoneyInput, Panel, ProvenanceChip, RadioGroup, RadioGroupItem, SkeletonRows, StatusPill, cn, fieldDescribedBy, formatMoney, useToast, type Kit } from "@foundmill/dugout";
import { plainWords, plural } from "@/lib/format";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { StudioFrame } from "../StudioFrame";
import { readMeta, toConcept, type IdeaLike } from "../ideate/concepts";
import type { GeneratedLogoSet, LogoActions, LogoProgress } from "@/components/logo/LogoPicker";
import { readLogoStream } from "@/components/logo/logo-stream";
import { LogoColoursEditor } from "./LogoColoursEditor";
import {
  ARCHETYPE_CARDS,
  BUSINESS_MODE_CARDS,
  DEFAULT_SPEND_CAP_MINOR,
  GAME_MODE_CARDS,
  commitInput,
  domainCandidates,
  initialCommitForm,
  nameSuggestions,
  screenDomain,
  trademarkScreen,
  validateCommitForm,
  type CommitForm as CommitFormValues,
  type DomainCheck,
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
  // Whether the founder's 18+ confirmation is on record (a LIVE start asks for it otherwise).
  const summaryQ = useQuery(trpc.live.summary.queryOptions(undefined, { staleTime: 60_000, retry: false }));
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
  const commit = useMutation(
    trpc.idea.commit.mutationOptions({
      onSuccess: (res) => {
        toast({ title: `${res.business.name} is yours`, description: "The Board's first item is waiting in the Inbox.", tone: "good" });
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

  const idea = ideaQ.data?.idea as IdeaLike | undefined;
  const back = (
    <LinkButton variant="ghost" icon={ArrowLeft} href={params.get("from") === "import" ? "/new/import" : "/new/ideate"}>
      Back
    </LinkButton>
  );

  if (ideaQ.isLoading) {
    return (
      <StudioFrame step="commit" title="Commit" viewer={viewer} actions={back}>
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
      <StudioFrame step="commit" title="Commit" viewer={viewer} actions={back}>
        <Panel title="Concept" error={ideaQ.error ? errorMessage(ideaQ.error) : "This concept was not found."} onRetry={() => ideaQ.refetch()} />
      </StudioFrame>
    );
  }
  if ((ideaQ.data?.idea as { committedAt?: Date | string | null } | undefined)?.committedAt && (ideaQ.data?.idea as { businessId?: string | null } | undefined)?.businessId) {
    const bid = (ideaQ.data!.idea as { businessId: string }).businessId;
    return (
      <StudioFrame step="commit" title="Already committed" viewer={viewer} actions={back}>
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
      preview={previewQ.data}
      previewLoading={previewQ.isLoading}
      onArchetypeChange={setArchetype}
      committing={commit.isPending}
      error={commit.error ? errorMessage(commit.error) : null}
      adultConfirmed={summaryQ.data?.adultConfirmed === true}
      onCommit={(input) => commit.mutate(input)}
      logoApi={logoApi}
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
  preview?: SquadPreview;
  previewLoading?: boolean;
  onArchetypeChange?: (archetype: Archetype | null) => void;
  committing?: boolean;
  error?: string | null;
  /** The founder's 18+ confirmation is on record already (`live.summary`), so a LIVE start does not ask again. */
  adultConfirmed?: boolean;
  onCommit: (input: ReturnType<typeof commitInput>) => void;
  /** Upload checks and logo generation (idea.logo.*). */
  logoApi: CommitLogoApi;
  back?: ReactNode;
}

const DEBOUNCE_MS = 350;

export function CommitForm({ idea, viewer, currency, initialName, preview, previewLoading, onArchetypeChange, committing, error, adultConfirmed = false, onCommit, logoApi, back }: CommitFormProps) {
  const concept = useMemo(() => toConcept(idea), [idea]);
  // The idea's seed only picks the starting brand colours now; the logo is uploaded or generated.
  const ideaSeed = String(readMeta(idea.current?.research).crest_seed ?? idea.id);
  const [form, setForm] = useState<CommitFormValues>(() => {
    const base = initialCommitForm({ title: idea.current?.title ?? idea.title, archetype: idea.archetype }, kitFromSeed(ideaSeed), currency);
    return initialName ? { ...base, name: initialName } : base;
  });
  const [capTouched, setCapTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateCommitForm(form, { adultOnRecord: adultConfirmed }), [form, adultConfirmed]);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof CommitFormValues>(key: K, value: CommitFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    onArchetypeChange?.(form.archetype);
  }, [form.archetype, onArchetypeChange]);

  // Live screens, debounced on the name.
  const [screened, setScreened] = useState<{ name: string; domains: DomainCheck[]; marks: TrademarkScreen[] } | null>(null);
  useEffect(() => {
    const name = form.name.trim();
    if (!name) {
      setScreened(null);
      return;
    }
    const t = setTimeout(() => setScreened({ name, domains: domainCandidates(name).map(screenDomain), marks: trademarkScreen(name) }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [form.name]);
  const screening = form.name.trim().length > 0 && screened?.name !== form.name.trim();

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
                <div data-testid="domain-checks" aria-busy={screening || undefined}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Globe size={14} className="text-secondary" aria-hidden />
                    <span className="t-label">Domains</span>
                    {(screened?.domains[0]?.provenance ?? "Estimate") === "Estimate" ? <ProvenanceChip kind="estimate" /> : <Chip>{screened?.domains[0]?.provenance}</Chip>}
                  </div>
                  {screened && !screening ? (
                    <ul className="flex flex-col gap-1">
                      {screened.domains.map((d) => (
                        <li key={d.domain} className="flex items-center justify-between gap-2 text-body" data-domain={d.domain} data-status={d.status}>
                          <span className="font-mono text-mono">{d.domain}</span>
                          <StatusPill tone={d.status === "available" ? "good" : d.status === "premium" ? "warn" : "bad"}>{d.status === "available" ? "Available" : d.status === "premium" ? "Premium" : "Taken"}</StatusPill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-secondary">{form.name.trim() ? "Checking…" : "Type a name to check domains."}</p>
                  )}
                </div>
                <div data-testid="trademark-screen">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Scale size={14} className="text-secondary" aria-hidden />
                    <span className="t-label">USPTO / EUIPO quick screen</span>
                  </div>
                  {screened && !screening ? (
                    <ul className="flex flex-col gap-1">
                      {screened.marks.map((m) => (
                        <li key={m.registry} className="flex items-center justify-between gap-2 text-body" data-registry={m.registry} data-status={m.status}>
                          <span>
                            {m.registry}
                            {m.similar.length ? <span className="text-small text-secondary"> · similar: {m.similar.join(", ")}</span> : null}
                          </span>
                          <StatusPill tone={m.status === "clear" ? "good" : m.status === "similar" ? "warn" : "bad"}>{m.status === "clear" ? "No hit" : m.status === "similar" ? "Similar marks" : "Conflict"}</StatusPill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-secondary">{form.name.trim() ? "Screening…" : "Type a name to screen it."}</p>
                  )}
                  <p className="mt-1.5 text-small text-secondary" data-testid="trademark-caveat">
                    Screen, not legal clearance. A lawyer or an attorney search confirms it.
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
            {/* A LIVE business is on the network from the start, and the network is for adults: asked once (Settings › Mode asks the same). */}
            {form.gameMode === "live" && !adultConfirmed ? (
              <Field htmlFor="commit-adult" label="The network is for adults" error={show("adult")} className="mt-3">
                <span className="flex items-start gap-2" data-testid="commit-adult">
                  <Checkbox id="commit-adult" checked={form.adult} onCheckedChange={(v) => set("adult", v === true)} className="mt-0.5" aria-describedby={fieldDescribedBy("commit-adult", { error: Boolean(show("adult")) })} />
                  <Label htmlFor="commit-adult" className="normal-case tracking-normal text-body text-primary">
                    I am 18 or older. You confirm this once.
                  </Label>
                </span>
              </Field>
            ) : null}
          </Panel>

          <Panel title="Archetype" data-testid="archetype-panel">
            <Field htmlFor="archetype-group" label="Seeds the departments, the team and the first roadmap" required error={show("archetype")}>
              <RadioGroup id="archetype-group" value={form.archetype ?? ""} onValueChange={(v) => set("archetype", v as Archetype)} className="grid-cols-4" aria-label="Archetype">
                {ARCHETYPE_CARDS.map((a) => (
                  <ModeCardOption key={a.value} id={`arch-${a.value}`} value={a.value} label={a.label} tagline={a.tagline} details={[`First win: ${a.firstWin}`]} selected={form.archetype === a.value} badge={idea.archetype === a.value ? "From the card" : undefined} />
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
            <StatusPill tone="bad" role="alert">
              {error}
            </StatusPill>
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
                    {preview.agents.map((a, i) => (
                      <li key={a.templateKey} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                        <Avatar size={24} name={a.name} agent={{ seed: a.templateKey, dept: preview.departments[i % preview.departments.length]?.colourToken ?? "dept-1" }} />
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
