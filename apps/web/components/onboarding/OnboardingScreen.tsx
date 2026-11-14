"use client";
/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1; docs/UX_AUDIT_AND_PLAN.md §7.3). Two passes: the first
 * screen asks four things, your name (prefilled from the email), experience (four cards), the time you can give and
 * where you live (which derives the currency and the first market the ideas aim at), and Continue is enabled from the
 * start. Below them one collapsed section, "Add detail (optional, improves the ideas)", holds the five skills 1–20
 * (with a legend and a None / Some / Solid / Expert picker per skill), the budget and currency, target markets,
 * constraint chips and risk appetite; it opens by default for an Exited founder or an Operator and remembers each
 * account's own choice. → founder.profile.update → /new. A rail on the left tracks the four questions and the
 * optional section as one ("N of 5 done"); the form sits in Dugout panels on the right.
 *
 * "Show me an example" on the optional section (UX plan §6.2 ExampleToggle, Phase 3) fills every answer but the name
 * with a labeled example founder (`EXAMPLE_PROFILE`): the detail section opens inside a dashed Example frame and the
 * first-pass panels it touched carry the Example chip. Continue waits until the example is hidden ("Replace the
 * example with your own answers to continue"); "Hide the example" puts back only what the example filled, so an
 * answer the founder typed over it stays. Guidance off: no toggle, no example.
 *
 * `OnboardingForm` is pure (props in, `onSubmit(patch)` out) so it is tested without tRPC; `OnboardingScreen` wires
 * the mutation, the toasts (including "Guidance is off for experienced founders" when the save turned it off) and the
 * redirect.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Lock,
  Plus,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { APP_NAME } from "@foundmill/config";
import {
  AdultCheck,
  Button,
  Chip,
  EXAMPLE_TAG,
  ExampleFrame,
  ExampleToggle,
  Field,
  Icon,
  Input,
  Kbd,
  MoneyInput,
  Panel,
  RadioCard,
  RadioGroup,
  ReassuranceLine,
  SKILL_SCALE_LEGEND,
  ScaleLabel,
  SimpleSelect,
  SkillSlider,
  StatusPill,
  cn,
  ratingClass,
  useGuided,
  useToast,
} from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix, validationIssues } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { currencyName, DISPLAY_LOCALE } from "@/lib/format";
import { StudioFrame } from "@/components/new/StudioFrame";
import {
  CONSTRAINT_SUGGESTIONS,
  COUNTRIES,
  CURRENCIES,
  DETAIL_SECTION_TITLE,
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
  clearExampleProfile,
  defaultCurrency,
  defaultMarket,
  detailOpenByDefault,
  detailStorageKey,
  fillExampleProfile,
  firstInvalidSection,
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
import { AccountId } from "@/components/settings/AccountId";
import { forgetVia } from "@/app/onboarding/actions";
import { isAdultUnconfirmed } from "@/lib/adult";
import { AdultStep } from "./AdultStep";

export interface OnboardingScreenProps {
  profile: ProfileLike | null;
  email: string | null;
  /** The signed-in person's account ID, for support (people join a project by invitation, not by it). */
  accountId?: string | null;
  /**
   * Who or what brought a new founder: the reference in the httpOnly `fm_via` cookie, read by the page on the server
   * (lib/via.ts). Sent with the save that creates the profile, never with an edit. Null when there is none.
   */
  via?: string | null;
  /**
   * Whether the account's "I am 18 or older" is on record (`founder.profile.get` `adultConfirmed`; 0104). A new account
   * without it ticks the box on the form, and the save that creates the profile carries it; a person with a profile and
   * no record (here before sign-up asked) sees the one step instead of the form (`AdultStep`). Required: the page reads
   * it from the api, and a screen that does not know never assumes it. A save the api refuses with `adult_unconfirmed`
   * asks for it too, whatever this said.
   */
  adultConfirmed: boolean;
}

/** Under the box on the form that creates an account: asked once, never again. */
export const ADULT_FORM_HINT = "You confirm this once.";
/** When Continue is pressed with the box empty. */
export const ADULT_FORM_NEEDED = "Confirm that you are 18 or older to continue.";

/** How long the first save waits for the attribution cookie to be cleared before it moves on without that. */
export const FORGET_VIA_WAIT_MS = 3_000;

/**
 * Said once, after the save that created the profile with an Exited or Operator experience (UX plan §6.3, decided
 * Oct 20, 2026): guidance was turned off for them, and where to turn it back on.
 */
export const GUIDANCE_OFF_TOAST = {
  title: "Guidance is off for experienced founders",
  description: "Turn it on any time in Settings › Preferences.",
} as const;

/** Under Continue: the whole profile is editable later (UX plan §7.3). */
export const PROFILE_REASSURANCE = "Everything here can be changed later in Settings.";

/** Above the skill sliders: honest ratings are what the team hires around (UX plan §7.3, A2). */
export const SKILLS_HINT = "Be honest: the team hires to cover what you don't have.";

/** Under Continue while the example founder is in: the example is never saved as the founder's own profile. */
export const EXAMPLE_PROFILE_LINE = "Replace the example with your own answers to continue.";

export function OnboardingScreen({ profile, email, accountId = null, via = null, adultConfirmed }: OnboardingScreenProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const editing = profile !== null;
  /** Only the save that creates the profile carries the reference. */
  const handOver = editing ? null : via;
  /** The api refused a save for want of the confirmation: ask for it, whatever the page was told. */
  const [serverAsked, setServerAsked] = useState(false);
  const needsAdult = !adultConfirmed || serverAsked;

  const save = useMutation(
    trpc.founder.profile.update.mutationOptions({
      onSuccess: async (data) => {
        // The api has read the reference (it reads it once): clear the cookie, and never hold the founder up for it.
        if (handOver) await Promise.race([forgetVia().catch(() => undefined), new Promise((done) => setTimeout(done, FORGET_VIA_WAIT_MS))]);
        // The founder's own queries, the guidance switch among them (`founder.preferences.guidance`), read again.
        await queryClient.invalidateQueries({ queryKey: trpcPathPrefix("founder") as unknown[] });
        toast({
          title: editing ? "Profile updated" : "Welcome aboard",
          description: editing
            ? "Your constraints shape every concept the studio drafts."
            : "Next: ideate a concept or import what already exists.",
          tone: "good",
        });
        if (data.guidanceTurnedOff) toast({ ...GUIDANCE_OFF_TOAST, tone: "info" });
        router.push("/new");
        router.refresh();
      },
      onError: (err) => {
        if (isAdultUnconfirmed(err)) setServerAsked(true);
        toast({ title: "Profile not saved", description: saveErrorMessage(err), tone: "bad" });
      },
    }),
  );

  // A person from before (a profile, no "18 or older" on record) is asked once, in one step, instead of the form.
  if (editing && needsAdult) return <AdultStep />;

  return (
    <OnboardingForm
      profile={profile}
      email={email}
      accountId={accountId}
      askAdult={!editing && needsAdult}
      saving={save.isPending}
      error={save.error ? saveErrorMessage(save.error) : null}
      onSubmit={(patch) => save.mutate(handOver ? { ...patch, via: handOver } : patch)}
    />
  );
}

/** A refused save in the founder's words: the answers the API named, not its field names or Zod text. */
function saveErrorMessage(err: unknown): string {
  return profileSaveMessage(validationIssues(err), errorMessage(err));
}

export interface OnboardingFormProps {
  profile: ProfileLike | null;
  email: string | null;
  accountId?: string | null;
  saving?: boolean;
  error?: string | null;
  /** A new account with no "I am 18 or older" on record: the box is on the form, and the save carries `confirmAdult`. */
  askAdult?: boolean;
  onSubmit: (patch: ProfilePatch & { confirmAdult?: true }) => void;
}

export function OnboardingForm({
  profile,
  email,
  accountId = null,
  saving = false,
  error,
  askAdult = false,
  onSubmit,
}: OnboardingFormProps) {
  const editing = profile !== null;
  const [form, setForm] = useState<ProfileForm>(() => formFromProfile(profile, email));
  const [touched, setTouched] = useState(false);
  const [adult, setAdult] = useState(false);
  const errors = useMemo(() => validateProfileForm(form), [form]);
  const status = useMemo(() => sectionStatus(form), [form]);
  const summary = useMemo(() => profileSummary(form), [form]);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const detail = useDetailOpen(accountId, editing, form.experience);

  // The example founder (UX plan §6.2): the form as it was before the example went in, or null while it is out. Only
  // while guidance is on: the toggle renders nothing otherwise, so the example can never be in without it.
  const guided = useGuided();
  const [exampleBefore, setExampleBefore] = useState<ProfileForm | null>(null);
  const exampleOn = guided && exampleBefore !== null;
  const showExample = () => {
    setExampleBefore(form);
    setForm((f) => fillExampleProfile(f));
    detail.set(true);
  };
  const hideExample = () => {
    if (!exampleBefore) return;
    setForm((f) => clearExampleProfile(f, exampleBefore));
    setExampleBefore(null);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    // An example is never saved as the founder's own answers (the buttons are disabled; Enter in a field lands here).
    if (exampleOn) return;
    setTouched(true);
    if (!valid) {
      const first = firstInvalidSection(errors);
      if (first === "detail") detail.set(true);
      if (first)
        document
          .getElementById(`section-${first}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (askAdult && !adult) {
      document.getElementById("profile-adult")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    onSubmit(askAdult ? { ...profilePatch(form), confirmAdult: true } : profilePatch(form));
  }

  const show = (key: keyof ProfileForm) => (touched ? errors[key] : undefined);
  const errorCount = Object.keys(errors).length;
  const doneCount = PROFILE_SECTIONS.filter((s) => status[s.id]).length;
  const inView = useSectionInView();

  // The currency follows where the founder lives (then the browser's language, then US dollars) until they pick one
  // themselves; a saved profile keeps its own (A11). Read after mount: the server does not know the browser's language.
  const [currencyTouched, setCurrencyTouched] = useState(false);
  useEffect(() => {
    if (editing || currencyTouched) return;
    const next = defaultCurrency(
      form.residence,
      typeof navigator === "undefined" ? null : navigator.language,
    );
    setForm((f) => (f.currency === next ? f : { ...f, currency: next }));
  }, [editing, currencyTouched, form.residence]);
  // What where-you-live decides, said under the fields: the first market the ideas aim at and the currency.
  const derivedMarket = defaultMarket(form.residence);
  const marketsEmpty = form.targetMarkets.length === 0;

  return (
    <StudioFrame
      step="profile"
      title={editing ? "Your founder profile" : "Before you start"}
      lede={
        editing
          ? "Every concept, forecast and decision is shaped by this. Change it any time."
          : `${APP_NAME} drafts concepts, hires the team and runs the business within your constraints. Four quick answers are enough to start; add detail when you have it.`
      }
      viewer={{ email }}
      actions={
        <Button
          variant="primary"
          iconRight={ArrowRight}
          onClick={submit}
          loading={saving}
          disabled={exampleOn}
          data-testid="profile-submit"
        >
          {editing ? "Save and continue" : "Continue"}
        </Button>
      }
    >
      <form
        onSubmit={submit}
        className="grid grid-cols-12 gap-gutter"
        data-testid="onboarding-form"
        noValidate
      >
        <aside className="col-span-3">
          <div className="sticky top-20 flex flex-col gap-gutter">
            <Panel title="Sections" meta={`${doneCount} of ${PROFILE_SECTIONS.length} done`} flush>
              <nav aria-label="Profile sections" className="py-1.5">
                <ol className="flex flex-col gap-0.5">
                  {PROFILE_SECTIONS.map((s, i) => {
                    const done = status[s.id];
                    return (
                      <li key={s.id}>
                        <a
                          href={`#section-${s.id}`}
                          className="sidebar-item hover:no-underline"
                          data-active={inView === s.id || undefined}
                          aria-current={inView === s.id ? "location" : undefined}
                          data-section-link={s.id}
                          data-done={done || undefined}
                          onClick={s.id === "detail" ? () => detail.set(true) : undefined}
                        >
                          <span
                            className={cn(
                              "inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro tabular-nums",
                              done
                                ? "bg-status-good/12 text-status-good ring-1 ring-status-good/40"
                                : "text-tertiary ring-1 ring-line-strong",
                            )}
                            aria-hidden
                          >
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
            <Panel title="How the team reads you" meta={exampleOn ? <ExampleMeta /> : undefined} data-testid="profile-summary">
              <p
                className={cn(
                  "text-body [overflow-wrap:anywhere]",
                  summary ? "text-primary" : "text-secondary",
                )}
              >
                {summary ||
                  "Pick your experience and time to see the one-line brief every agent starts from."}
              </p>
            </Panel>
            <p className="flex items-start gap-2 px-1 text-small text-secondary">
              <Lock size={14} className="mt-px shrink-0 text-tertiary" aria-hidden />
              Your profile is private. Agents read it as context; it is never shown on the network,
              even when a business goes live.
            </p>
            {/* The account ID is for support, not for a first screen: behind a disclosure (A17). People join a project by invitation. */}
            {accountId ? (
              <details className="group/account px-1" data-testid="profile-account-id">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-small text-secondary transition-colors duration-hover ease-out hover:text-primary focus-visible:shadow-ring [&::-webkit-details-marker]:hidden">
                  <Icon
                    icon={ChevronRight}
                    size="inline"
                    className="transition-transform duration-overlay ease-out group-open/account:rotate-90"
                  />
                  Your account ID
                </summary>
                <div className="mt-2">
                  <p className="t-data mb-1.5">Your account ID</p>
                  <AccountId accountId={accountId} />
                </div>
              </details>
            ) : null}
          </div>
        </aside>

        <div className="col-span-9 flex flex-col gap-gutter">
          {/* The first pass: four questions, each its own panel so the rail can tick them one by one. */}
          <Section id="name" title="Your name">
            <div className="grid grid-cols-2 gap-gutter">
              <Field
                htmlFor="profile-name"
                label="What the team calls you"
                required
                error={show("displayName")}
              >
                <Input
                  id="profile-name"
                  icon={UserRound}
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  maxLength={120}
                  autoFocus={!editing}
                  placeholder="Your name"
                  invalid={Boolean(show("displayName"))}
                />
              </Field>
            </div>
          </Section>

          <Section id="experience" title="Experience" example={exampleOn}>
            <Field
              htmlFor="profile-experience"
              label="Which fits you best"
              required
              error={show("experience")}
            >
              <RadioGroup
                id="profile-experience"
                value={form.experience}
                onValueChange={(v) => set("experience", v)}
                className="grid-cols-2"
                aria-label="Experience"
              >
                {EXPERIENCE_OPTIONS.map((o) => (
                  <OptionCard
                    key={o.value}
                    id={`exp-${o.value}`}
                    value={o.value}
                    label={o.label}
                    description={o.description}
                    selected={form.experience === o.value}
                  />
                ))}
              </RadioGroup>
            </Field>
          </Section>

          <Section id="time" title="Time you can give" example={exampleOn}>
            <Field
              htmlFor="profile-time"
              label="Time commitment"
              required
              error={show("timeCommitment")}
            >
              <RadioGroup
                id="profile-time"
                value={form.timeCommitment}
                onValueChange={(v) => set("timeCommitment", v)}
                className="grid-cols-4"
                aria-label="Time commitment"
              >
                {TIME_OPTIONS.map((o) => (
                  <OptionCard
                    key={o.value}
                    id={`time-${o.value}`}
                    value={o.value}
                    label={o.label}
                    description={o.description}
                    selected={form.timeCommitment === o.value}
                  />
                ))}
              </RadioGroup>
            </Field>
          </Section>

          <Section
            id="place"
            title="Where you live"
            example={exampleOn}
            hint="Where you live decides which countries we suggest for registering the business, the currency you see and the first market the ideas aim at."
          >
            <div className="grid grid-cols-2 gap-gutter">
              <Field htmlFor="profile-residence" label="Residence" error={show("residence")}>
                <CountryInput
                  id="profile-residence"
                  value={form.residence}
                  onChange={(v) => set("residence", v)}
                />
              </Field>
              <Field htmlFor="profile-citizenship" label="Citizenship" error={show("citizenship")}>
                <CountryInput
                  id="profile-citizenship"
                  value={form.citizenship}
                  onChange={(v) => set("citizenship", v)}
                />
              </Field>
            </div>
            {derivedMarket || form.residence.trim() ? (
              <p className="text-small text-secondary" data-testid="profile-place-derived">
                {derivedMarket && marketsEmpty
                  ? `Ideas will aim at ${derivedMarket} first and count money in ${currencyName(form.currency)}.`
                  : `Money is counted in ${currencyName(form.currency)}.`}{" "}
                Change either under Add detail.
              </p>
            ) : null}
          </Section>

          {/* The second pass: everything else, behind one disclosure (A1). */}
          <Panel
            id="section-detail"
            title={DETAIL_SECTION_TITLE}
            data-section="detail"
            data-open={detail.open || undefined}
            className="scroll-mt-20"
            actions={
              <>
                {/* The example founder (UX plan §6.2): fills every answer but the name; Continue waits until it is hidden. */}
                <ExampleToggle
                  shown={exampleOn}
                  onFill={showExample}
                  onClear={hideExample}
                  disabled={saving}
                  data-testid="profile-example-toggle"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={detail.open ? ChevronUp : ChevronDown}
                  aria-expanded={detail.open}
                  aria-controls="profile-detail"
                  onClick={() => {
                    // Closing the section with the example in takes the example out with it.
                    if (detail.open && exampleOn) hideExample();
                    detail.set(!detail.open);
                  }}
                  data-testid="profile-detail-toggle"
                >
                  {detail.open ? "Hide detail" : "Add detail"}
                </Button>
              </>
            }
          >
            {detail.open ? (
              <DetailBody example={exampleOn}>
                <div className="flex flex-col gap-4" data-testid="profile-skills">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="t-label">Skills</span>
                      <span className="font-mono text-mono text-tertiary">1 – 20</span>
                    </div>
                    <p className="text-small text-secondary" data-testid="skill-legend">
                      {SKILL_SCALE_LEGEND}
                    </p>
                    <p className="text-small text-secondary">{SKILLS_HINT}</p>
                  </div>
                  <div className="flex flex-col gap-4">
                    {SKILL_KEYS.map((key) => {
                      const value = form.skills[key];
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-12 items-end gap-4"
                          data-skill={key}
                        >
                          <div className="col-span-3 min-w-0 pb-2">
                            <div className="text-body-strong">{SKILL_LABELS[key].label}</div>
                            <div className="text-small text-tertiary">{SKILL_LABELS[key].hint}</div>
                          </div>
                          {/* One control (DESIGN §8 skill input): the four-word picker sets the number, the 20 cells are the slider's track. */}
                          <SkillSlider
                            className="col-span-6"
                            anchors
                            anchorsLabel={`${SKILL_LABELS[key].label}: level`}
                            value={value}
                            min={1}
                            max={20}
                            onValueChange={(v) => set("skills", { ...form.skills, [key]: v })}
                            aria-label={`${SKILL_LABELS[key].label} rating`}
                          />
                          <div
                            className={cn(
                              "col-span-1 t-display-md pb-2 text-right tabular-nums",
                              ratingClass(value),
                            )}
                            aria-live="polite"
                            data-skill-value={key}
                          >
                            {value}
                          </div>
                          <div className="col-span-2 flex items-center pb-2">
                            <ScaleLabel value={value} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div
                  className="flex flex-col gap-3 border-t border-line pt-4"
                  data-testid="profile-budget"
                >
                  <span className="t-label">Budget</span>
                  <div className="grid grid-cols-4 items-start gap-gutter">
                    <Field
                      htmlFor="profile-budget"
                      label="Budget you can commit"
                      hint="Your own money for the first year, before any revenue. A number like 25,000 or 25k."
                      error={show("budget")}
                      className="col-span-2"
                    >
                      <MoneyInput
                        id="profile-budget"
                        value={form.budget}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, budget: e.target.value, noBudget: false }))
                        }
                        placeholder="25000"
                        invalid={Boolean(show("budget"))}
                        currency={form.currency}
                        disabled={form.noBudget}
                      />
                    </Field>
                    {/* Empty is a choice (A11): the card beside the amount says so in words; typing an amount unpicks it. */}
                    <RadioGroup
                      value={form.noBudget ? "none" : ""}
                      onValueChange={(v) =>
                        v === "none" && setForm((f) => ({ ...f, noBudget: true, budget: "" }))
                      }
                      aria-label="No budget"
                      className="pt-5"
                      data-testid="profile-no-budget"
                    >
                      <RadioCard
                        id="budget-none"
                        value="none"
                        label="I have no budget yet"
                        description="Ideas assume no money up front."
                        data-option="none"
                        data-selected={form.noBudget || undefined}
                      />
                    </RadioGroup>
                    <Field htmlFor="profile-currency" label="Currency" error={show("currency")}>
                      <SimpleSelect
                        id="profile-currency"
                        controlSize="xl"
                        value={form.currency}
                        onValueChange={(v) => {
                          setCurrencyTouched(true);
                          set("currency", v);
                        }}
                        options={CURRENCIES.map((c) => ({
                          value: c,
                          code: c,
                          label: currencyName(c),
                          textValue: c,
                        }))}
                        aria-label="Currency"
                      />
                    </Field>
                  </div>
                </div>

                <div
                  className="flex flex-col gap-3 border-t border-line pt-4"
                  data-testid="profile-markets"
                >
                  <ChipField
                    id="profile-markets"
                    label="Target markets"
                    hint={
                      derivedMarket && marketsEmpty
                        ? `Empty means the ideas start from where you live (${derivedMarket}). Your target markets shape pricing, channels and which rules apply.`
                        : "Your target markets shape pricing, channels and which rules apply."
                    }
                    error={show("targetMarkets")}
                    values={form.targetMarkets}
                    suggestions={MARKET_SUGGESTIONS}
                    maxLength={PROFILE_LIMITS.place}
                    onChange={(v) => set("targetMarkets", v)}
                    placeholder="Add a market and press Enter"
                  />
                </div>

                <div
                  className="flex flex-col gap-4 border-t border-line pt-4"
                  data-testid="profile-constraints"
                >
                  <ChipField
                    id="profile-constraints"
                    label="Constraints"
                    hint="Rules the ideas must respect, like 'no stock to buy' or 'fits around what I already do'. Write your own or pick one below; every one is a hard limit."
                    values={form.constraints}
                    suggestions={CONSTRAINT_SUGGESTIONS}
                    maxLength={PROFILE_LIMITS.constraint}
                    error={show("constraints")}
                    onChange={(v) => set("constraints", v)}
                    placeholder="Add a constraint and press Enter"
                  />
                  <Field
                    htmlFor="profile-risk"
                    label="Risk appetite"
                    required
                    error={show("riskAppetite")}
                  >
                    <RadioGroup
                      id="profile-risk"
                      value={form.riskAppetite}
                      onValueChange={(v) => set("riskAppetite", v)}
                      className="grid-cols-3"
                      aria-label="Risk appetite"
                    >
                      {RISK_OPTIONS.map((o) => (
                        <OptionCard
                          key={o.value}
                          id={`risk-${o.value}`}
                          value={o.value}
                          label={o.label}
                          description={o.description}
                          selected={form.riskAppetite === o.value}
                        />
                      ))}
                    </RadioGroup>
                  </Field>
                </div>
              </DetailBody>
            ) : (
              <p className="text-body text-secondary" data-testid="profile-detail-closed">
                Skills, budget, target markets, constraints and risk appetite. The ideas get sharper
                with them, and the team hires to cover what you don't have.
              </p>
            )}
          </Panel>

          {askAdult ? (
            <div id="profile-adult">
              <AdultCheck
                id="profile-adult-check"
                checked={adult}
                onCheckedChange={setAdult}
                hint={ADULT_FORM_HINT}
                error={touched && !adult ? ADULT_FORM_NEEDED : undefined}
                data-testid="profile-adult"
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 border-t border-subtle pt-4">
            <div className="text-small text-secondary">
              {error ? (
                <StatusPill tone="bad" role="alert">
                  {error}
                </StatusPill>
              ) : exampleOn ? (
                <ReassuranceLine icon="undo" data-testid="profile-example-line">
                  {EXAMPLE_PROFILE_LINE}
                </ReassuranceLine>
              ) : touched && !valid ? (
                <StatusPill tone="warn" role="alert">
                  {errorCount} field{errorCount === 1 ? "" : "s"} to complete
                </StatusPill>
              ) : (
                <ReassuranceLine icon="settings" data-testid="profile-reassurance">
                  {PROFILE_REASSURANCE}
                </ReassuranceLine>
              )}
            </div>
            <Button
              type="submit"
              variant="primary"
              iconRight={ArrowRight}
              loading={saving}
              disabled={exampleOn}
              data-testid="profile-submit-bottom"
            >
              {editing ? "Save and continue" : "Continue"}
            </Button>
          </div>
        </div>
      </form>
    </StudioFrame>
  );
}

/**
 * Whether "Add detail" is open: the account's own last choice (kept in the browser under `detailStorageKey`), else
 * open for an Exited founder or an Operator, or when a saved profile is being edited, else closed (UX plan §7.3).
 */
function useDetailOpen(
  accountId: string | null,
  editing: boolean,
  experience: string,
): { open: boolean; set: (open: boolean) => void } {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const key = detailStorageKey(accountId);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1") setChosen(true);
      else if (stored === "0") setChosen(false);
    } catch {
      // A browser that refuses storage opens the section by experience every time; nothing else depends on it.
    }
  }, [key]);
  const open = chosen ?? (editing || detailOpenByDefault(experience));
  const set = (next: boolean) => {
    setChosen(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // See above.
    }
  };
  return { open, set };
}

/** The Example chip in a panel's meta slot: the answers under it are the example founder's, not the founder's own. */
function ExampleMeta() {
  return (
    <Chip tone="neutral" data-example-meta="">
      {EXAMPLE_TAG}
    </Chip>
  );
}

/**
 * The open detail section's body: a plain stack, or the dashed Example frame while the example founder is in (its
 * padding stepped down, since the panel body already has the panel's).
 */
function DetailBody({ example, children }: { example: boolean; children: ReactNode }) {
  return example ? (
    <ExampleFrame id="profile-detail" className="gap-6 p-3" data-testid="profile-detail-example">
      {children}
    </ExampleFrame>
  ) : (
    <div id="profile-detail" className="flex flex-col gap-6">
      {children}
    </div>
  );
}

function Section({
  id,
  title,
  meta,
  hint,
  example,
  children,
}: {
  id: ProfileSectionId;
  title: string;
  meta?: ReactNode;
  hint?: string;
  /** The answers here are the example founder's: the Example chip takes the meta slot. */
  example?: boolean;
  children: ReactNode;
}) {
  return (
    <Panel
      id={`section-${id}`}
      title={title}
      meta={example ? <ExampleMeta /> : meta}
      data-section={id}
      data-example={example ? "" : undefined}
      className="scroll-mt-20"
    >
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
        for (const e of entries)
          visible.set((e.target as HTMLElement).dataset.section ?? "", e.isIntersecting);
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
export function OptionCard({
  id,
  value,
  label,
  description,
  selected,
}: {
  id: string;
  value: string;
  label: string;
  description?: string;
  selected: boolean;
}) {
  return (
    <RadioCard
      id={id}
      value={value}
      label={label}
      description={description}
      data-option={value}
      data-selected={selected || undefined}
    />
  );
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

function CountryInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const listId = `${id}-countries`;
  const name = countryNameOf(value);
  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={PROFILE_LIMITS.place}
        placeholder="Country"
        autoComplete="off"
        suffix={name ?? undefined}
      />
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
  /** The most chips it takes (default `MAX_CHIPS`; the public profile's tags take 8). */
  max?: number;
}

/** Chips you can type (Enter adds) plus suggestion chips you can toggle. */
export function ChipField({
  id,
  label,
  hint,
  error,
  required,
  values,
  suggestions,
  onChange,
  placeholder,
  maxLength = PROFILE_LIMITS.constraint,
  max = MAX_CHIPS,
}: ChipFieldProps) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const next = addChip(values, draft, max, maxLength);
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
  const remaining = suggestions.filter(
    (s) => s.length <= maxLength && !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );
  return (
    <Field htmlFor={id} label={label} hint={hint} error={error} required={required}>
      <div className="flex flex-col gap-2" data-chip-field={id}>
        {values.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label={`${label} chosen`}>
            {values.map((v) => (
              <Chip
                key={v}
                tone="kit"
                onRemove={() => onChange(removeChip(values, v))}
                removeLabel={`Remove ${v}`}
                role="listitem"
              >
                {v}
              </Chip>
            ))}
          </div>
        ) : null}
        {/* The trailing slot is always rendered: Dugout's Input changes its DOM shape when `trailing` appears, which would remount the field mid-word. */}
        <Input
          id={id}
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={placeholder}
          invalid={Boolean(error)}
          trailing={
            draft ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={Plus}
                onClick={commit}
                aria-label={`Add ${draft}`}
                className="px-1"
              />
            ) : (
              <Kbd>↵</Kbd>
            )
          }
        />
        {remaining.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={`${label} suggestions`}>
            {remaining.map((s) => (
              <Chip
                key={s}
                onClick={() => onChange(toggleChip(values, s, max, maxLength))}
                icon={Plus}
              >
                {s}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
