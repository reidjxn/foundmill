"use client";
/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1): experience, five skills 1–20, time commitment, budget
 * and currency, citizenship and residence, target markets, constraint chips, risk appetite → founder.profile.update
 * → /new. A rail on the left tracks the sections; the form sits in Dugout panels on the right. First-run feel:
 * the page opens on the wordmark, a display line and a short promise, then the form.
 *
 * `OnboardingForm` is pure (props in, `onSubmit(patch)` out) so it is tested without tRPC; `OnboardingScreen` wires
 * the mutation, the toast and the redirect.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Lock, Plus, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { APP_NAME } from "@foundmill/config";
import { Button, Chip, Field, Input, Kbd, MoneyInput, Panel, RadioCard, RadioGroup, RatingBandPill, SimpleSelect, SkillSlider, StatusPill, cn, ratingClass, useToast } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix, validationIssues } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { currencyName, DISPLAY_LOCALE } from "@/lib/format";
import { StudioFrame } from "@/components/new/StudioFrame";
import {
  CONSTRAINT_SUGGESTIONS,
  COUNTRIES,
  CURRENCIES,
  EXPERIENCE_OPTIONS,
  MARKET_SUGGESTIONS,
  MAX_CHIPS,
  PROFILE_LIMITS,
  PROFILE_SECTIONS,
  RISK_OPTIONS,
  SKILL_KEYS,
  SKILL_LABELS,
  TIME_OPTIONS,
  addChip,
  formFromProfile,
  profilePatch,
  profileSaveMessage,
  profileSummary,
  removeChip,
  sectionStatus,
  toggleChip,
  validateProfileForm,
  type ProfileForm,
  type ProfileLike,
  type ProfilePatch,
  type ProfileSectionId,
} from "./profile-form";

export interface OnboardingScreenProps {
  profile: ProfileLike | null;
  email: string | null;
}

export function OnboardingScreen({ profile, email }: OnboardingScreenProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const editing = profile !== null;

  const save = useMutation(
    trpc.founder.profile.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpcPathPrefix("founder") as unknown[] });
        toast({
          title: editing ? "Profile updated" : "Welcome aboard",
          description: editing ? "Your constraints shape every concept the studio drafts." : "Next: ideate a concept or import what already exists.",
          tone: "good",
        });
        router.push("/new");
        router.refresh();
      },
      onError: (err) => toast({ title: "Profile not saved", description: saveErrorMessage(err), tone: "bad" }),
    }),
  );

  return <OnboardingForm profile={profile} email={email} saving={save.isPending} error={save.error ? saveErrorMessage(save.error) : null} onSubmit={(patch) => save.mutate(patch)} />;
}

/** A refused save in the founder's words: the answers the API named, not its field names or Zod text. */
function saveErrorMessage(err: unknown): string {
  return profileSaveMessage(validationIssues(err), errorMessage(err));
}

export interface OnboardingFormProps {
  profile: ProfileLike | null;
  email: string | null;
  saving?: boolean;
  error?: string | null;
  onSubmit: (patch: ProfilePatch) => void;
}

export function OnboardingForm({ profile, email, saving = false, error, onSubmit }: OnboardingFormProps) {
  const editing = profile !== null;
  const [form, setForm] = useState<ProfileForm>(() => formFromProfile(profile, email));
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateProfileForm(form), [form]);
  const status = useMemo(() => sectionStatus(form), [form]);
  const summary = useMemo(() => profileSummary(form), [form]);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) {
      const first = PROFILE_SECTIONS.find((s) => !status[s.id]);
      if (first) document.getElementById(`section-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    onSubmit(profilePatch(form));
  }

  const show = (key: keyof ProfileForm) => (touched ? errors[key] : undefined);
  const errorCount = Object.keys(errors).length;
  const doneCount = PROFILE_SECTIONS.filter((s) => status[s.id]).length;
  const timeAnswered = (form.timeCommitment ? 1 : 0) + (form.budget.trim() ? 1 : 0);
  const inView = useSectionInView();

  return (
    <StudioFrame
      step="profile"
      title={editing ? "Your founder profile" : "Before you start"}
      lede={editing ? "Every concept, forecast and decision is shaped by this. Change it any time." : `${APP_NAME} drafts concepts, hires the team and runs the business within your constraints. Five minutes here saves months of wrong turns.`}
      viewer={{ email }}
      actions={
        <Button variant="primary" iconRight={ArrowRight} onClick={submit} loading={saving} data-testid="profile-submit">
          {editing ? "Save and continue" : "Continue"}
        </Button>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-12 gap-gutter" data-testid="onboarding-form" noValidate>
        <aside className="col-span-3">
          <div className="sticky top-20 flex flex-col gap-gutter">
            <Panel title="Sections" meta={`${doneCount} of ${PROFILE_SECTIONS.length} done`} flush>
              <nav aria-label="Profile sections" className="py-1.5">
                <ol className="flex flex-col gap-0.5">
                  {PROFILE_SECTIONS.map((s, i) => {
                    const done = status[s.id];
                    return (
                      <li key={s.id}>
                        <a href={`#section-${s.id}`} className="sidebar-item hover:no-underline" data-active={inView === s.id || undefined} aria-current={inView === s.id ? "location" : undefined} data-section-link={s.id} data-done={done || undefined}>
                          <span className={cn("inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro tabular-nums", done ? "bg-status-good/12 text-status-good ring-1 ring-status-good/40" : "text-tertiary ring-1 ring-line-strong")} aria-hidden>
                            {done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                          </span>
                          <span className="min-w-0 flex-1">{s.label}</span>
                          {done ? <span className="sr-only">done</span> : null}
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </Panel>
            <Panel title="How the team reads you" data-testid="profile-summary">
              <p className={cn("text-body [overflow-wrap:anywhere]", summary ? "text-primary" : "text-secondary")}>{summary || "Pick your experience and time to see the one-line brief every agent starts from."}</p>
            </Panel>
            <p className="flex items-start gap-2 px-1 text-small text-secondary">
              <Lock size={14} className="mt-px shrink-0 text-tertiary" aria-hidden />
              Your profile is private. Agents read it as context; it is never shown on the network, even when a business goes live.
            </p>
          </div>
        </aside>

        <div className="col-span-9 flex flex-col gap-gutter">
          <Section id="identity" title="Who you are">
            <div className="grid grid-cols-2 gap-gutter">
              <Field htmlFor="profile-name" label="What the team calls you" required error={show("displayName")}>
                <Input id="profile-name" icon={UserRound} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={120} autoFocus={!editing} placeholder="Your name" invalid={Boolean(show("displayName"))} />
              </Field>
            </div>
            <Field htmlFor="profile-experience" label="Experience" required error={show("experience")}>
              <RadioGroup id="profile-experience" value={form.experience} onValueChange={(v) => set("experience", v)} className="grid-cols-2" aria-label="Experience">
                {EXPERIENCE_OPTIONS.map((o) => (
                  <OptionCard key={o.value} id={`exp-${o.value}`} value={o.value} label={o.label} description={o.description} selected={form.experience === o.value} />
                ))}
              </RadioGroup>
            </Field>
          </Section>

          <Section id="skills" title="Skills" meta="1 – 20" hint="Honest ratings make the team cover the gaps; the Ideation agent scores founder fit from these.">
            <div className="flex flex-col gap-3">
              {SKILL_KEYS.map((key) => {
                const value = form.skills[key];
                return (
                  <div key={key} className="grid grid-cols-12 items-center gap-4" data-skill={key}>
                    <div className="col-span-3 min-w-0">
                      <div className="text-body-strong">{SKILL_LABELS[key].label}</div>
                      <div className="text-small text-tertiary">{SKILL_LABELS[key].hint}</div>
                    </div>
                    {/* One control (DESIGN §8 skill input): the 20 cells are the slider's track. */}
                    <SkillSlider className="col-span-6" value={value} min={1} max={20} onValueChange={(v) => set("skills", { ...form.skills, [key]: v })} aria-label={`${SKILL_LABELS[key].label} rating`} />
                    <div className={cn("col-span-1 t-display-md text-right tabular-nums", ratingClass(value))} aria-live="polite" data-skill-value={key}>
                      {value}
                    </div>
                    <div className="col-span-2 flex items-center">
                      <RatingBandPill value={value} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section id="time" title="Time and budget" meta={`${timeAnswered} of 2 answered`}>
            <Field htmlFor="profile-time" label="Time commitment" required error={show("timeCommitment")}>
              <RadioGroup id="profile-time" value={form.timeCommitment} onValueChange={(v) => set("timeCommitment", v)} className="grid-cols-4" aria-label="Time commitment">
                {TIME_OPTIONS.map((o) => (
                  <OptionCard key={o.value} id={`time-${o.value}`} value={o.value} label={o.label} description={o.description} selected={form.timeCommitment === o.value} />
                ))}
              </RadioGroup>
            </Field>
            <div className="grid grid-cols-4 gap-gutter">
              <Field htmlFor="profile-budget" label="Budget you can commit" hint="Your own money for the first year, before any revenue. Leave it empty if there is none; 25k works too." error={show("budget")} className="col-span-3">
                <MoneyInput id="profile-budget" value={form.budget} onChange={(e) => set("budget", e.target.value)} placeholder="25000" invalid={Boolean(show("budget"))} currency={form.currency} />
              </Field>
              <Field htmlFor="profile-currency" label="Currency" error={show("currency")}>
                <SimpleSelect id="profile-currency" controlSize="xl" value={form.currency} onValueChange={(v) => set("currency", v)} options={CURRENCIES.map((c) => ({ value: c, code: c, label: currencyName(c), textValue: c }))} aria-label="Currency" />
              </Field>
            </div>
          </Section>

          <Section id="place" title="Where you operate" hint="Citizenship and residence drive the jurisdiction recommender; markets drive pricing, channels and compliance.">
            <div className="grid grid-cols-2 gap-gutter">
              <Field htmlFor="profile-citizenship" label="Citizenship" error={show("citizenship")}>
                <CountryInput id="profile-citizenship" value={form.citizenship} onChange={(v) => set("citizenship", v)} />
              </Field>
              <Field htmlFor="profile-residence" label="Residence" error={show("residence")}>
                <CountryInput id="profile-residence" value={form.residence} onChange={(v) => set("residence", v)} />
              </Field>
            </div>
            <ChipField id="profile-markets" label="Target markets" required error={show("targetMarkets")} values={form.targetMarkets} suggestions={MARKET_SUGGESTIONS} maxLength={PROFILE_LIMITS.place} onChange={(v) => set("targetMarkets", v)} placeholder="Add a market and press Enter" />
          </Section>

          <Section id="constraints" title="Constraints and risk">
            <ChipField id="profile-constraints" label="Constraints" hint="Write your own or pick one below. The Ideation agent treats every constraint as a hard limit, even when it surprises you." values={form.constraints} suggestions={CONSTRAINT_SUGGESTIONS} maxLength={PROFILE_LIMITS.constraint} error={show("constraints")} onChange={(v) => set("constraints", v)} placeholder="Add a constraint and press Enter" />
            <Field htmlFor="profile-risk" label="Risk appetite" required error={show("riskAppetite")}>
              <RadioGroup id="profile-risk" value={form.riskAppetite} onValueChange={(v) => set("riskAppetite", v)} className="grid-cols-3" aria-label="Risk appetite">
                {RISK_OPTIONS.map((o) => (
                  <OptionCard key={o.value} id={`risk-${o.value}`} value={o.value} label={o.label} description={o.description} selected={form.riskAppetite === o.value} />
                ))}
              </RadioGroup>
            </Field>
          </Section>

          <div className="flex items-center justify-between gap-4 border-t border-subtle pt-4">
            <div className="text-small text-secondary">
              {error ? (
                <StatusPill tone="bad" role="alert">
                  {error}
                </StatusPill>
              ) : touched && !valid ? (
                <StatusPill tone="warn" role="alert">
                  {errorCount} field{errorCount === 1 ? "" : "s"} to complete
                </StatusPill>
              ) : (
                <span>Everything can be changed later from Settings.</span>
              )}
            </div>
            <Button type="submit" variant="primary" iconRight={ArrowRight} loading={saving} data-testid="profile-submit-bottom">
              {editing ? "Save and continue" : "Continue to New business"}
            </Button>
          </div>
        </div>
      </form>
    </StudioFrame>
  );
}

function Section({ id, title, meta, hint, children }: { id: ProfileSectionId; title: string; meta?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <Panel id={`section-${id}`} title={title} meta={meta} data-section={id} className="scroll-mt-20">
      <div className="flex flex-col gap-4">
        {hint ? <p className="text-body text-secondary">{hint}</p> : null}
        {children}
      </div>
    </Panel>
  );
}

/** The section the founder is reading: the topmost one whose panel crosses the upper third of the window. */
function useSectionInView(): ProfileSectionId | null {
  const [id, setId] = useState<ProfileSectionId | null>(PROFILE_SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set((e.target as HTMLElement).dataset.section ?? "", e.isIntersecting);
        const first = PROFILE_SECTIONS.find((s) => visible.get(s.id));
        if (first) setId(first.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const s of PROFILE_SECTIONS) {
      const el = document.getElementById(`section-${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return id;
}

/** A radio option drawn as a selectable card (DESIGN §8 radio cards): the whole card is the radio. */
export function OptionCard({ id, value, label, description, selected }: { id: string; value: string; label: string; description?: string; selected: boolean }) {
  return <RadioCard id={id} value={value} label={label} description={description} data-option={value} data-selected={selected || undefined} />;
}

/** The country's name for a two-letter code ("GB" → "United Kingdom"), so a stored code never reads as a bare id. */
export function countryNameOf(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames([DISPLAY_LOCALE], { type: "region" }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

function CountryInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const listId = `${id}-countries`;
  const name = countryNameOf(value);
  return (
    <>
      <Input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} maxLength={PROFILE_LIMITS.place} placeholder="Country" autoComplete="off" suffix={name ?? undefined} />
      <datalist id={listId}>
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

export interface ChipFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  values: string[];
  suggestions: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** The longest a chip can be (the typed text stops here; a suggestion longer than this is not offered). */
  maxLength?: number;
}

/** Chips you can type (Enter adds) plus suggestion chips you can toggle. */
export function ChipField({ id, label, hint, error, required, values, suggestions, onChange, placeholder, maxLength = PROFILE_LIMITS.constraint }: ChipFieldProps) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const next = addChip(values, draft, MAX_CHIPS, maxLength);
    if (next.length !== values.length) onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  const remaining = suggestions.filter((s) => s.length <= maxLength && !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <Field htmlFor={id} label={label} hint={hint} error={error} required={required}>
      <div className="flex flex-col gap-2" data-chip-field={id}>
        {values.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label={`${label} chosen`}>
            {values.map((v) => (
              <Chip key={v} tone="kit" onRemove={() => onChange(removeChip(values, v))} removeLabel={`Remove ${v}`} role="listitem">
                {v}
              </Chip>
            ))}
          </div>
        ) : null}
        {/* The trailing slot is always rendered: Dugout's Input changes its DOM shape when `trailing` appears, which would remount the field mid-word. */}
        <Input id={id} value={draft} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} placeholder={placeholder} invalid={Boolean(error)} trailing={draft ? <Button type="button" size="sm" variant="ghost" icon={Plus} onClick={commit} aria-label={`Add ${draft}`} className="px-1" /> : <Kbd>↵</Kbd>} />
        {remaining.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={`${label} suggestions`}>
            {remaining.map((s) => (
              <Chip key={s} onClick={() => onChange(toggleChip(values, s, MAX_CHIPS, maxLength))} icon={Plus}>
                {s}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
