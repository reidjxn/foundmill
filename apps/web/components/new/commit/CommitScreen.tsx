"use client";
/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7). Name with suggestions, live domain
 * availability and the USPTO/EUIPO quick screen ("Screen, not legal clearance"), crest and brand colours, game mode
 * LIVE / Personal, archetype cards, business mode (Augmented / Assisted default / Automated) with the default spend
 * cap, the squad the archetype seeds (idea.preview), then "Take charge" → idea.commit → the Board item in the Inbox.
 *
 * `CommitForm` is pure apart from the local domain/trademark screens; `CommitScreen` loads the idea and commits.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Globe, Lock, Scale, Sparkles, ThumbsUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ARCHETYPE_LABELS, type Archetype, type BusinessMode, type GameMode } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { Avatar, Button, Chip, ConceptCard, Field, Input, Panel, RadioGroup, RadioGroupItem, SkeletonRows, StatusPill, cn, formatMoney, useToast, type Kit } from "@foundmill/dugout";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { StudioFrame } from "../StudioFrame";
import { readMeta, toConcept, type IdeaLike } from "../ideate/concepts";
import { CrestKitEditor } from "./CrestKitEditor";
import {
  ARCHETYPE_CARDS,
  BUSINESS_MODE_CARDS,
  DEFAULT_SPEND_CAP_MINOR,
  GAME_MODE_CARDS,
  commitInput,
  crestSeedFor,
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

export function CommitScreen({ ideaId, viewer, currency }: CommitScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const ideaQ = useQuery(trpc.idea.get.queryOptions({ ideaId }));
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const previewQ = useQuery(trpc.idea.preview.queryOptions({ archetype: archetype ?? "b2b_saas" }, { enabled: archetype !== null, staleTime: 60_000 }));
  const commit = useMutation(
    trpc.idea.commit.mutationOptions({
      onSuccess: (res) => {
        toast({ title: `${res.business.name} is yours`, description: "The Board's first item is waiting in the Inbox.", tone: "good" });
        router.push(routes.inbox(res.business.id, res.boardItem.id));
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
          <p className="text-body">This concept already became a business.</p>
          <LinkButton variant="primary" className="mt-3" href={routes.home(bid)}>
            Open it
          </LinkButton>
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
      onCommit={(input) => commit.mutate(input)}
      back={back}
    />
  );
}

/* ---------- the form ---------- */

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
  onCommit: (input: ReturnType<typeof commitInput>) => void;
  back?: ReactNode;
}

const DEBOUNCE_MS = 350;

export function CommitForm({ idea, viewer, currency, initialName, preview, previewLoading, onArchetypeChange, committing, error, onCommit, back }: CommitFormProps) {
  const concept = useMemo(() => toConcept(idea), [idea]);
  const ideaSeed = String(readMeta(idea.current?.research).crest_seed ?? idea.id);
  const [form, setForm] = useState<CommitFormValues>(() => {
    const base = initialCommitForm({ title: idea.current?.title ?? idea.title, archetype: idea.archetype, crestSeed: ideaSeed }, kitFromSeed(ideaSeed), currency);
    return initialName ? { ...base, name: initialName } : base;
  });
  const [salt, setSalt] = useState(0);
  const [capTouched, setCapTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateCommitForm(form), [form]);
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
  const seed = `${crestSeedFor(form.name, ideaSeed)}${salt ? `:${salt}` : ""}`;

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
      lede="Name it, dress it, choose how it is run. Taking charge seeds the departments and the squad and starts the first cycle."
      viewer={viewer}
      actions={
        <>
          {back}
          <Button variant="primary" icon={ThumbsUp} loading={committing} onClick={() => submit()} data-testid="take-charge">
            Take charge
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
                  <Chip key={s} onClick={() => set("name", s)} selected={form.name === s} icon={Sparkles} data-suggestion={s}>
                    {s}
                  </Chip>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-gutter border-t border-subtle pt-3">
                <div data-testid="domain-checks" aria-busy={screening || undefined}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Globe size={14} className="text-secondary" aria-hidden />
                    <span className="t-label">Domains</span>
                    <Chip>{screened?.domains[0]?.provenance ?? "Estimate"}</Chip>
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

          <Panel title="Crest and brand colours">
            <CrestKitEditor name={form.name} seed={seed} kit={form.kit} onKitChange={(kit: Kit) => set("kit", kit)} onShuffle={() => setSalt((s) => s + 1)} error={show("kit")} />
          </Panel>

          <Panel title="Game mode">
            <RadioGroup value={form.gameMode} onValueChange={(v) => set("gameMode", v as GameMode)} className="grid-cols-2" aria-label="Game mode">
              {GAME_MODE_CARDS.map((m) => (
                <ModeCardOption key={m.value} id={`game-${m.value}`} value={m.value} label={m.label} tagline={m.tagline} details={m.details} selected={form.gameMode === m.value} icon={m.value === "live" ? Globe : Lock} />
              ))}
            </RadioGroup>
          </Panel>

          <Panel title="Archetype" data-testid="archetype-panel">
            <Field htmlFor="archetype-group" label="Seeds the departments, the squad and the first roadmap" required error={show("archetype")}>
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
              <div className="grid grid-cols-[240px_1fr] items-end gap-gutter">
                <Field htmlFor="spend-cap" label="Spend cap per action" hint="Above this every spend asks you first, whatever the mode. Empty means no cap." error={show("spendCap")}>
                  <Input
                    id="spend-cap"
                    numeric
                    inputMode="decimal"
                    value={form.spendCap}
                    onChange={(e) => {
                      setCapTouched(true);
                      set("spendCap", e.target.value);
                    }}
                    invalid={Boolean(show("spendCap"))}
                    trailing={<span className="text-small text-secondary">{form.currency}</span>}
                  />
                </Field>
                <p className="pb-1 text-small text-secondary">
                  Default for {BUSINESS_MODE_CARDS.find((m) => m.value === form.businessMode)?.label}: {formatMoney({ amountMinor: DEFAULT_SPEND_CAP_MINOR[form.businessMode], currency: form.currency })} · Estimate. Money, signatures and identity always ask.
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
          <div className="sticky top-6 flex flex-col gap-gutter">
            <ConceptCard concept={{ ...concept, name: form.name.trim() || concept.name, kit: form.kit, crestSeed: seed }} hideActions className="w-full" />
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
                  <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Squad">
                    {preview.agents.map((a, i) => (
                      <li key={a.templateKey} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                        <Avatar size={24} name={a.name} agent={{ seed: a.templateKey, dept: preview.departments[i % preview.departments.length]?.colourToken ?? "dept-1" }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body-strong">{a.name}</div>
                          <div className="truncate text-small text-secondary">{a.role}</div>
                        </div>
                        <Chip mono>{a.modelKey}</Chip>
                      </li>
                    ))}
                  </ul>
                  <p className="text-small text-secondary">
                    {preview.agents.length} agents · {preview.departments.length} departments · {preview.defaultChannels.length} channels on · wages are estimates until the first cycle
                  </p>
                </div>
              ) : null}
            </Panel>
            <Panel title="What happens next">
              <ol className="flex flex-col gap-1.5 text-body">
                {["Business, departments and squad are created", "The crest and colours go on the kit bar", "The first cycle starts", "The Board's first item lands in your Inbox: vision and three decisions"].map((s, i) => (
                  <li key={s} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-subtle text-label tabular-nums">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-center gap-2">
                <Chip tone={form.gameMode === "live" ? "kit" : "ink"} icon={form.gameMode === "live" ? Globe : Lock}>
                  {form.gameMode === "live" ? "LIVE" : "Personal"}
                </Chip>
                <Chip>{BUSINESS_MODE_CARDS.find((m) => m.value === form.businessMode)?.label}</Chip>
                {form.archetype ? <Chip>{ARCHETYPE_LABELS[form.archetype]}</Chip> : null}
                {Number.isFinite(capMinor) && form.spendCap.trim() ? <Chip>Cap {formatMoney({ amountMinor: capMinor, currency: form.currency })}</Chip> : null}
              </div>
              <Button type="submit" variant="primary" icon={ThumbsUp} loading={committing} className="mt-4 w-full" data-testid="take-charge-bottom">
                Take charge
              </Button>
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
  return (
    <div className={cn("relative flex items-start gap-2 rounded-panel border border-subtle bg-panel-alt p-3 transition-colors duration-micro ease-dugout hover:border-secondary/50", selected && "border-link")} data-option={value} data-selected={selected || undefined}>
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.75 rounded-l-panel bg-kit-primary" /> : null}
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-1 text-body text-primary">
        <span className="flex items-center gap-1.5">
          {Icon ? <Icon size={14} className="text-secondary" aria-hidden /> : null}
          <span className="t-display-sm">{label}</span>
          {badge ? <Chip tone="kit">{badge}</Chip> : null}
        </span>
        <span className="text-small text-secondary">{tagline}</span>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {details.map((d) => (
            <li key={d} className="flex items-start gap-1 text-small text-secondary">
              <Check size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </label>
    </div>
  );
}
