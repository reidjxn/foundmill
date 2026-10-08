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
import { ArrowRight, Check, Plus, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { APP_NAME } from "@foundmill/config";
import { Button, Chip, Field, Input, Kbd, Panel, RadioGroup, RadioGroupItem, RatingBar, SimpleSelect, Slider, StatusPill, cn, ratingBandLabel, ratingClass, useToast } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { StudioFrame } from "@/components/new/StudioFrame";
import {
  CONSTRAINT_SUGGESTIONS,
  COUNTRIES,
  CURRENCIES,
  EXPERIENCE_OPTIONS,
  MARKET_SUGGESTIONS,
  PROFILE_SECTIONS,
  RISK_OPTIONS,
  SKILL_KEYS,
  SKILL_LABELS,
  TIME_OPTIONS,
  addChip,
  formFromProfile,
  profilePatch,
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
      onError: (err) => toast({ title: "Profile not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );

  return <OnboardingForm profile={profile} email={email} saving={save.isPending} error={save.error ? errorMessage(save.error) : null} onSubmit={(patch) => save.mutate(patch)} />;
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
          <div className="sticky top-6 flex flex-col gap-4">
            <nav aria-label="Profile sections" className="surface-panel overflow-hidden">
              <div className="flex h-panel-header items-center border-b border-subtle bg-panel-alt px-panel-pad">
                <span className="t-label">Sections</span>
              </div>
              <ol className="flex flex-col py-1">
                {PROFILE_SECTIONS.map((s, i) => {
                  const done = status[s.id];
                  return (
                    <li key={s.id}>
                      <a href={`#section-${s.id}`} className={cn("flex h-8 items-center gap-2 px-panel-pad t-tab hover:bg-white/4 hover:no-underline", done ? "text-primary" : "text-secondary")} data-section-link={s.id} data-done={done || undefined}>
                        <span className={cn("inline-flex size-4 items-center justify-center rounded-full border text-label tabular-nums", done ? "border-status-good text-status-good" : "border-subtle")} aria-hidden>
                          {done ? <Check size={10} strokeWidth={2.5} /> : i + 1}
                        </span>
                        {s.label}
                      </a>
                    </li>
                  );
                })}
              </ol>
            </nav>
            <div className="surface-panel overflow-hidden" data-testid="profile-summary">
              <div className="flex h-panel-header items-center border-b border-subtle bg-panel-alt px-panel-pad">
                <span className="t-label">How the team reads you</span>
              </div>
              <p className="p-panel-pad text-body text-secondary">{summary || "Pick your experience and time to see the one-line brief every agent starts from."}</p>
            </div>
            <p className="px-1 text-small text-secondary">Your profile is private. Agents read it as context; it is never shown in LIVE mode.</p>
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

          <Section id="skills" title="Skills" hint="1 to 20. Honest ratings make the team cover the gaps; the Ideation agent scores founder fit from these.">
            <div className="flex flex-col gap-3">
              {SKILL_KEYS.map((key) => {
                const value = form.skills[key];
                return (
                  <div key={key} className="grid grid-cols-[160px_1fr_56px_220px] items-center gap-4" data-skill={key}>
                    <div className="min-w-0">
                      <div className="text-body-strong">{SKILL_LABELS[key].label}</div>
                      <div className="truncate text-small text-secondary">{SKILL_LABELS[key].hint}</div>
                    </div>
                    <Slider value={[value]} min={1} max={20} step={1} onValueChange={([v]) => set("skills", { ...form.skills, [key]: v ?? value })} thumbLabels={[`${SKILL_LABELS[key].label} rating`]} aria-label={`${SKILL_LABELS[key].label} rating`} />
                    <div className={cn("t-display-sm text-right tabular-nums", ratingClass(value))} aria-live="polite" data-skill-value={key}>
                      {value}
                    </div>
                    <div className="flex items-center gap-2">
                      <RatingBar value={value} name={SKILL_LABELS[key].label} className="flex-1" />
                      <span className="w-16 text-small text-secondary">{ratingBandLabel(value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section id="time" title="Time and budget">
            <Field htmlFor="profile-time" label="Time commitment" required error={show("timeCommitment")}>
              <RadioGroup id="profile-time" value={form.timeCommitment} onValueChange={(v) => set("timeCommitment", v)} className="grid-cols-4" aria-label="Time commitment">
                {TIME_OPTIONS.map((o) => (
                  <OptionCard key={o.value} id={`time-${o.value}`} value={o.value} label={o.label} description={o.description} selected={form.timeCommitment === o.value} />
                ))}
              </RadioGroup>
            </Field>
            <div className="grid grid-cols-[1fr_160px] gap-gutter">
              <Field htmlFor="profile-budget" label="Budget you can commit" hint="Your own money for the first year, before any revenue. Leave empty if none. Accepts 25k." error={show("budget")}>
                <Input id="profile-budget" numeric inputMode="decimal" value={form.budget} onChange={(e) => set("budget", e.target.value)} placeholder="25000" invalid={Boolean(show("budget"))} trailing={<span className="text-small text-secondary">{form.currency}</span>} />
              </Field>
              <Field htmlFor="profile-currency" label="Currency" error={show("currency")}>
                <SimpleSelect id="profile-currency" value={form.currency} onValueChange={(v) => set("currency", v)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} aria-label="Currency" />
              </Field>
            </div>
          </Section>

          <Section id="place" title="Where you operate" hint="Citizenship and residence drive the jurisdiction recommender; markets drive pricing, channels and compliance.">
            <div className="grid grid-cols-2 gap-gutter">
              <Field htmlFor="profile-citizenship" label="Citizenship">
                <CountryInput id="profile-citizenship" value={form.citizenship} onChange={(v) => set("citizenship", v)} />
              </Field>
              <Field htmlFor="profile-residence" label="Residence">
                <CountryInput id="profile-residence" value={form.residence} onChange={(v) => set("residence", v)} />
              </Field>
            </div>
            <ChipField id="profile-markets" label="Target markets" required error={show("targetMarkets")} values={form.targetMarkets} suggestions={MARKET_SUGGESTIONS} onChange={(v) => set("targetMarkets", v)} placeholder="Add a market and press Enter" />
          </Section>

          <Section id="constraints" title="Constraints and risk">
            <ChipField id="profile-constraints" label="Constraints" hint="Free text. The Ideation agent treats these as hard limits; 'surprise me' stays inside them." values={form.constraints} suggestions={CONSTRAINT_SUGGESTIONS} onChange={(v) => set("constraints", v)} placeholder="Add a constraint and press Enter" />
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

function Section({ id, title, hint, children }: { id: ProfileSectionId; title: string; hint?: string; children: ReactNode }) {
  return (
    <Panel id={`section-${id}`} title={title} data-section={id} className="scroll-mt-6">
      <div className="flex flex-col gap-4">
        {hint ? <p className="text-body text-secondary">{hint}</p> : null}
        {children}
      </div>
    </Panel>
  );
}

/** A radio option drawn as a selectable card: panel-alt, hairline, 3 px kit edge when selected (DESIGN §8 sidebar). */
export function OptionCard({ id, value, label, description, selected }: { id: string; value: string; label: string; description?: string; selected: boolean }) {
  return (
    <div className={cn("relative flex items-start gap-2 rounded-panel border border-subtle bg-panel-alt p-3 transition-colors duration-micro ease-dugout hover:border-secondary/50", selected && "border-link")} data-option={value} data-selected={selected || undefined}>
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.75 rounded-l-panel bg-kit-primary" /> : null}
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <label htmlFor={id} className="flex cursor-pointer flex-col text-body text-primary">
        <span className="text-body-strong">{label}</span>
        {description ? <span className="text-small text-secondary">{description}</span> : null}
      </label>
    </div>
  );
}

function CountryInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const listId = `${id}-countries`;
  return (
    <>
      <Input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Country" autoComplete="off" />
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
}

/** Chips you can type (Enter adds) plus suggestion chips you can toggle. */
export function ChipField({ id, label, hint, error, required, values, suggestions, onChange, placeholder }: ChipFieldProps) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const next = addChip(values, draft);
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
  const remaining = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
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
        <Input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} placeholder={placeholder} invalid={Boolean(error)} trailing={draft ? <Button type="button" size="sm" variant="ghost" icon={Plus} onClick={commit} aria-label={`Add ${draft}`} className="h-6 px-1" /> : <Kbd>↵</Kbd>} />
        {remaining.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={`${label} suggestions`}>
            {remaining.map((s) => (
              <Chip key={s} onClick={() => onChange(toggleChip(values, s))} icon={Plus}>
                {s}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
