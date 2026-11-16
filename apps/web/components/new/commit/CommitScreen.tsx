"use client";
import Link from "next/link";
/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7; docs/UX_AUDIT_AND_PLAN.md §7.6). Name
 * with suggestions, live domain availability (the registry's answer through `idea.domainCheck`) and the trademark
 * quick screen ("Screen, not legal clearance"), the logo (upload a real one or generate marks; `idea.logo.*`) and
 * brand colors, then "How it runs": one line of chips ("Personal · Assisted · B2B SaaS · Asks you above €250 ·
 * Autopilot off") with a ghost "Change" that opens the five controls, game mode LIVE / Personal, archetype cards,
 * business mode (Augmented / Assisted default / Automated) with the default spend cap, and Autopilot (A3; open by
 * default when guidance is off). The team the archetype seeds (idea.preview) sits in the rail, then "Take charge" →
 * idea.commit (with the chosen logo) → Home, where the foundations draft.
 *
 * `CommitForm` is pure apart from the local trademark screen and the logo and domain calls it is handed (`logoApi`,
 * `domainApi`); `CommitScreen` loads the idea, wires those calls to tRPC and commits.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Globe, Lock, RotateCw, Scale, SearchX, ThumbsUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { ARCHETYPES, ARCHETYPE_LABELS, FIRST_DAY_PROMISE, type Archetype, type BusinessMode, type DeptColourToken, type GameMode } from "@foundmill/shared";
import { DEFAULT_AGENT_STYLE, type AgentStyle } from "@foundmill/shared/personas";
import { routes } from "@foundmill/widgets/shared/routes";
import { AgentStylePicker, Avatar, Button, Checkbox, Chip, ConceptCard, EmptyState, Field, Icon, Input, Label, MoneyInput, Panel, ProvenanceChip, RadioGroup, RadioGroupItem, ReassuranceLine, SkeletonRows, StatusPill, Switch, Term, cn, fieldDescribedBy, formatMoney, useDateFormat, useFormatters, useGuided, useToast, type Kit } from "@foundmill/dugout";
import { ANTHROPOMORPHIC_EXPLAINER } from "@/lib/anthropomorphic";
import { formatDate, formatMoney as formatCredits, plainWords, plural } from "@/lib/format";
import { agentStyleOf, useGuidancePreferences } from "@/components/providers/guidance-context";
import { useSingleFlight } from "@/lib/single-flight";
import { errorMessage, tierLimitOf, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { IMPORT_STEPS, STUDIO_STEPS, StudioFrame, type StudioStepItem } from "../StudioFrame";
import { conceptErrorMessage, isConceptGone } from "../ideate/concept-errors";
import { readMeta, toConcept, type IdeaLike } from "../ideate/concepts";
import type { GeneratedLogoSet, LogoActions, LogoProgress } from "@/components/logo/LogoPicker";
import { readLogoStream } from "@/components/logo/logo-stream";
import { creditsNoticeOf } from "./credits-notice";
import { LogoColoursEditor } from "./LogoColoursEditor";
import {
  ARCHETYPE_CARDS,
  BUSINESS_MODE_CARDS,
  DOMAIN_NOTE,
  DOMAIN_STATUS_WORDS,
  GAME_MODE_CARDS,
  TRADEMARK_REGISTRY_WORDS,
  TRADEMARK_STATUS_WORDS,
  commitInput,
  couldNotCheck,
  defaultSpendCapMinor,
  domainCandidates,
  DNS_ESTIMATE_HINT,
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
import { browserTimeZone } from "@/lib/today";

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
  const featuresQ = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
  // This month's included-credit pool (SEC2 S6): Commit says before Take charge when the new team would start paused.
  const allowanceQ = useQuery(trpc.founder.businesses.allowance.queryOptions(undefined, { staleTime: 60_000, retry: false }));
  const datePrefs = useDateFormat();
  const guidancePrefs = useGuidancePreferences();
  const queryClient = useQueryClient();
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
  const domainApi = useMemo<CommitDomainApi>(() => ({ check: (input, signal) => client.idea.domainCheck.mutate(input, { signal }) }), [client]);
  const commit = useMutation(
    trpc.idea.commit.mutationOptions({
      onSuccess: (res) => {
        // A second Take charge of this idea (another tab, a retried request) answers with the business the first created.
        // The first days are about the product (founder, 2026-10-18): Home shows the foundations drafting; the Inbox has
        // the Chief of Staff's welcome note and, once drafted, the two sign-off notes.
        toast({ title: res.alreadyCommitted ? `${res.business.name} is already yours` : `${res.business.name} is yours`, description: FIRST_DAY_PROMISE.sentence, tone: "good" });
        const to = routes.today(res.business.id);
        // The new business is in the founder's lists at once (Switch business, Your businesses).
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("founder") as unknown[] });
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
  // A concept that is not there (deleted, another account's, a wrong link) says so with the way back, and no Try again
  // that can never succeed (audit IAE-16); any other failure keeps its retry.
  if (!idea && (!ideaQ.error || trpcErrorCode(ideaQ.error) === "NOT_FOUND")) {
    return (
      <StudioFrame step="commit" steps={steps} title="Commit" viewer={viewer} actions={back}>
        <Panel title="Concept" data-testid="concept-not-found">
          <EmptyState icon={SearchX} title="No such concept" actions={<LinkButton variant="primary" size="sm" icon={ArrowLeft} href="/new/ideate">Back to your concepts</LinkButton>}>
            This concept was deleted, belongs to another account, or the link is wrong.
          </EmptyState>
        </Panel>
      </StudioFrame>
    );
  }
  if (!idea) {
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
          <EmptyState icon={Check} tone="kit" title="This concept already became a business" actions={<LinkButton variant="primary" size="sm" iconRight={ArrowRight} href={routes.today(bid)}>Open the business</LinkButton>}>
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
      creditsNotice={creditsNoticeOf(allowanceQ.data?.includedCredits, (d) => formatDate(d, datePrefs))}
      adultConfirmed={summaryQ.data?.adultConfirmed === true}
      anthropomorphicDefault={guidancePrefs.prefs.anthropomorphicAgents === true}
      agentStyleDefault={agentStyleOf(guidancePrefs.prefs)}
      liveOpen={featuresQ.data?.features.liveMode ?? false}
      hasBudget={featuresQ.data ? (featuresQ.data.profile?.budgetMinor ?? 0) > 0 : true}
      onCommit={onCommit}
      logoApi={logoApi}
      domainApi={domainApi}
      back={back}
    />
  );
}

/* ---------- the form ---------- */

/** What the founder reads while Take charge runs (a few seconds in mock mode). */
const SETTING_UP = "Setting up your business: departments, team and the first tasks. This takes a few seconds.";

/**
 * What happens after Take charge, in the order `apps/api/src/services/commit.ts` runs it (A4): the team is hired, the
 * Product lead drafts the foundations, two sign-off notes land, then building starts. Nothing is spent before the
 * founder approves it.
 */
export const WHAT_HAPPENS_NEXT: readonly string[] = FIRST_DAY_PROMISE.steps;

/** "Starts with $5.00 of included credits this month. No card." — the free tier's grant, in credits' own currency (A10). */
export function includedCreditsLine(): string {
  return `Starts with ${formatCredits({ amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY })} of included credits this month. No card.`;
}

/** The spend cap in words for the "How it runs" line: "Asks you above €250", "No spend cap", or what is wrong with it. */
export function spendCapSummary(spendCap: string, currency: string): string {
  const typed = spendCap.trim();
  if (!typed) return "No spend cap";
  const minor = Math.round(Number(typed.replace(/[\s,_]/g, "")) * 100);
  return Number.isFinite(minor) ? `Asks you above ${formatMoney({ amountMinor: minor, currency })}` : "Spend cap to fix";
}

/** Where "How it runs" is changed later, under its summary (§7.6). */
export const HOW_IT_RUNS_REASSURANCE = "You can change all of this later in Settings › Business and Settings › What the team can do.";

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
  /** This month's included credits already went to the founder's other businesses: the team starts paused (SEC2 S6). */
  creditsNotice?: string | null;
  /** The founder's 18+ confirmation is on record already (`live.summary`), so a LIVE start does not ask again. */
  adultConfirmed?: boolean;
  /** The founder's account preference (Settings › Preferences): the Anthropomorphic agents switch starts here. Default off. */
  anthropomorphicDefault?: boolean;
  /** The founder's account preference for the style of character (Settings › Preferences): the Style choice starts here. Default Humans. */
  agentStyleDefault?: AgentStyle;
  /** Whether LIVE is open on this deployment (`founder.profile.get` features); while it is not, only Personal is offered. */
  liveOpen?: boolean;
  /** Whether the founder's profile names a budget; without one the spend line starts at 0, so every spend asks first (WP-04 T3). Default true. */
  hasBudget?: boolean;
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

type PreviewDepartment = { slug: string; name: string; baseName?: string };
type PreviewAgent = { templateKey: string; layer: string; background?: boolean; wageCapMinor: number; wageCurrency?: string };

/** The standard name of a department the archetype renamed ("Product" for "Editorial"), or null when it keeps its name. */
export function renamedDepartment(d: PreviewDepartment): string | null {
  return d.baseName && d.baseName !== d.name ? d.baseName : null;
}

export function renamedDepartments(departments: readonly PreviewDepartment[]): PreviewDepartment[] {
  return departments.filter((d) => renamedDepartment(d) !== null);
}

/** "A content and media business calls its Product department Editorial; it does the same work." */
export function departmentRenameNote(departments: readonly PreviewDepartment[], archetype: Archetype | null): string {
  const renamed = renamedDepartments(departments);
  if (!renamed.length) return "";
  // A plain label loses its capital mid-sentence ("a marketplace business"); an acronym keeps it ("a B2B SaaS business").
  const label = archetype ? ARCHETYPE_LABELS[archetype] : "";
  const kind = label ? `${/^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label} business` : "this kind of business";
  const parts = renamed.map((d) => `its ${renamedDepartment(d)} department ${d.name}`);
  return `A ${kind} calls ${parts.join(" and ")}; ${renamed.length === 1 ? "it does" : "they do"} the same work.`;
}

/** The agents a founder sees: the platform's background helpers stay off the list, as on the Team screen. */
export function visibleAgents<A extends PreviewAgent>(agents: readonly A[]): A[] {
  return agents.filter((a) => !(a.background ?? a.layer === "utility"));
}

/**
 * "6 agents · 6 departments · 4 channels on · plus 2 background helpers". The channels are the starters that can really
 * run for a new project (the API's preview); with none, the line says nothing about channels instead of "0 channels on".
 */
export function teamCountsLine(preview: { agents: readonly PreviewAgent[]; departments: readonly unknown[]; defaultChannels: readonly unknown[] }): string {
  const visible = visibleAgents(preview.agents);
  const helpers = preview.agents.length - visible.length;
  const channels = preview.defaultChannels.length ? ` · ${plural(preview.defaultChannels.length, "channel")} on` : "";
  return `${plural(visible.length, "agent")} · ${plural(preview.departments.length, "department")}${channels}${helpers ? ` · plus ${plural(helpers, "background helper")}` : ""}`;
}

/**
 * What the team's wage caps add up to a month, in the credits' own currency (wages are model credits, counted in US
 * dollars whatever the business counts in; the business's currency is named when it differs so nobody adds them up).
 */
export function monthlyWageLine(agents: readonly PreviewAgent[], businessCurrency: string): string {
  const visible = visibleAgents(agents);
  const total = visible.reduce((s, a) => s + (a.wageCapMinor > 0 ? a.wageCapMinor : 0), 0);
  const wageCurrency = visible.find((a) => a.wageCurrency)?.wageCurrency ?? "USD";
  if (total <= 0) return "No wage caps are set yet: the team costs what its work costs, in credits.";
  const amount = formatCredits({ amountMinor: total, currency: wageCurrency });
  const note = wageCurrency !== businessCurrency ? ` Wages are counted in ${wageCurrency === "USD" ? "US dollars" : wageCurrency}, not in your ${businessCurrency}.` : "";
  return `Up to ${amount} a month in wage caps: the most the team can spend on its own work before it pauses.${note}`;
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

export function CommitForm({ idea, viewer, currency, initialName, suggestedArchetype, steps, preview, previewLoading, onArchetypeChange, committing, error, upgradeHref, creditsNotice, adultConfirmed = false, anthropomorphicDefault = false, agentStyleDefault = DEFAULT_AGENT_STYLE, liveOpen = true, hasBudget = true, onCommit, logoApi, domainApi, back }: CommitFormProps) {
  const concept = useMemo(() => toConcept(idea), [idea]);
  // Guidance off: an operator sees the five "How it runs" controls at once (§7.6); on, they open from "Change".
  const guided = useGuided();
  const [runsChosen, setRunsChosen] = useState<boolean | null>(null);
  // The idea's seed only picks the starting brand colours now; the logo is uploaded or generated.
  const ideaSeed = String(readMeta(idea.current?.research).crest_seed ?? idea.id);
  const [form, setForm] = useState<CommitFormValues>(() => {
    const base = initialCommitForm({ title: idea.current?.title ?? idea.title, archetype: suggestedArchetype ?? idea.archetype }, kitFromSeed(ideaSeed), currency, anthropomorphicDefault, agentStyleDefault, { hasBudget });
    return initialName ? { ...base, name: initialName } : base;
  });
  const [capTouched, setCapTouched] = useState(false);
  // The spend line follows the profile's budget (it may arrive after the form) until the founder types one here.
  useEffect(() => {
    if (!capTouched) setForm((f) => {
      const spendCap = String(defaultSpendCapMinor(f.businessMode, { hasBudget }) / 100);
      return f.spendCap === spendCap ? f : { ...f, spendCap };
    });
  }, [hasBudget, capTouched]);
  // The switch follows the account preference until the founder chooses here (the preference may arrive after the form).
  const [facesChosen, setFacesChosen] = useState(false);
  useEffect(() => {
    if (!facesChosen) setForm((f) => (f.anthropomorphicAgents === anthropomorphicDefault ? f : { ...f, anthropomorphicAgents: anthropomorphicDefault }));
  }, [anthropomorphicDefault, facesChosen]);
  // The style follows the account preference the same way, until the founder picks one here.
  const [styleChosen, setStyleChosen] = useState(false);
  useEffect(() => {
    if (!styleChosen) setForm((f) => (f.agentStyle === agentStyleDefault ? f : { ...f, agentStyle: agentStyleDefault }));
  }, [agentStyleDefault, styleChosen]);
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateCommitForm(form, { adultOnRecord: adultConfirmed }), [form, adultConfirmed]);
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
  // When this browser received the answer: the registry's own `checkedAt` can be a cached or a mock time ("Checked
  // 9:00 AM" at 2:50 PM, first-time founder report, Nov 8, 2026); what the founder wants to know is how fresh the list is.
  const [checkedClientAt, setCheckedClientAt] = useState<Date | null>(null);
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
          if (controller.signal.aborted) return;
          setDomainList({ name, rows });
          setCheckedClientAt(new Date());
        },
        // The call itself failed (not one registry): every row says so, nothing is guessed, and nothing was checked.
        () => {
          if (controller.signal.aborted) return;
          setDomainList({ name, rows: couldNotCheck(candidates) });
          setCheckedClientAt(null);
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
      // A retry that answered counts as a check; one the checker could not answer does not.
      if (row.checkedAt) setCheckedClientAt(new Date());
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
  // The moment this list was received here, not the registry's stamp (see `checkedClientAt`); nothing until a list is in.
  const lastChecked = domainList && domainList.rows.length ? checkedClientAt : null;

  const suggestions = useMemo(() => nameSuggestions(idea.current?.title ?? idea.title, idea.current?.pitch ?? idea.pitch, idea.archetype), [idea]);
  const generateWith = useCallback<LogoActions["generate"]>((round, onProgress, signal) => logoApi.generate({ name: form.name, colours: form.kit, archetype: form.archetype, round }, onProgress, signal), [logoApi, form.name, form.kit, form.archetype]);
  const logoActions = useMemo<LogoActions>(() => ({ prepare: logoApi.prepare, generate: generateWith }), [logoApi, generateWith]);

  function chooseMode(mode: BusinessMode) {
    setForm((f) => ({ ...f, businessMode: mode, spendCap: capTouched ? f.spendCap : String(defaultSpendCapMinor(mode, { hasBudget }) / 100) }));
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (!valid || committing) return;
    onCommit(commitInput(idea.id, form, browserTimeZone()));
  }

  const show = (key: keyof CommitFormValues) => (touched ? errors[key] : undefined);
  // A refused answer among the five controls opens them, so the founder sees what to fix.
  const runsOpen = (runsChosen ?? !guided) || (touched && Boolean(errors.archetype || errors.spendCap || errors.adult));
  const modeCard = BUSINESS_MODE_CARDS.find((m) => m.value === form.businessMode);
  const modeLabel = modeCard?.label ?? form.businessMode;
  const modeTagline = modeCard?.tagline ?? "";

  return (
    <StudioFrame
      step="commit"
      steps={steps}
      title={form.name.trim() ? `Commit to ${form.name.trim()}` : "Commit"}
      // While the business is set up the header says so, beside the button that started it (the panel's own status line
      // sits at the foot of a long column, usually off screen).
      lede={
        committing ? (
          SETTING_UP
        ) : (
          <>
            Name it, give it a logo, choose how it is run. Taking charge hires the team, which starts by drafting your public page, then your plan.
          </>
        )
      }
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
              <ReassuranceLine icon="settings" data-testid="reassure-name">
                You can change this later in Settings › Business.
              </ReassuranceLine>
            </div>
          </Panel>

          {/* The two checks of the name in one panel, acronyms expanded where they are first read (A12). */}
          <Panel title="Check the name (domains and trademarks)" data-testid="name-checks-panel">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-gutter">
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
                    <span className="t-label">Trademarks</span>
                    {(screened?.marks[0]?.provenance ?? "Estimate") === "Estimate" ? <ProvenanceChip kind="estimate" data-testid="trademark-provenance" /> : <Chip>{screened?.marks[0]?.provenance}</Chip>}
                  </div>
                  {screened && !screening ? (
                    <ul className="flex flex-col gap-1">
                      {screened.marks.map((m) => (
                        <li key={m.registry} className="flex items-center justify-between gap-2 text-body" data-registry={m.registry} data-status={m.status}>
                          <span>
                            {TRADEMARK_REGISTRY_WORDS[m.registry]}
                            {m.similar.length ? <span className="text-small text-secondary"> · {m.similar.join(", ")}</span> : null}
                          </span>
                          <StatusPill tone={m.status === "clear" ? "good" : m.status === "similar" ? "warn" : "bad"}>{TRADEMARK_STATUS_WORDS[m.status]}</StatusPill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-secondary">{form.name.trim() ? "Checking…" : "Type a name to check it."}</p>
                  )}
                  <p className="mt-1.5 text-small text-secondary" data-testid="trademark-caveat">
                    A quick check against a list of well-known marks, not a registry search. Screen, not legal clearance: a lawyer or an attorney search confirms it.
                  </p>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Logo and brand colors" data-testid="logo-panel">
            <div className="flex flex-col gap-3">
              <LogoColoursEditor name={form.name} kit={form.kit} onKitChange={(kit: Kit) => set("kit", kit)} logo={form.logo} onLogoChange={(logo) => set("logo", logo)} logoActions={logoActions} error={show("kit")} />
              <ReassuranceLine icon="settings" data-testid="reassure-logo">
                You can change this later in Settings › Business.
              </ReassuranceLine>
            </div>
          </Panel>

          {/* How it runs (A3): the five choices in one line of chips; "Change" opens the controls below. */}
          <Panel
            title="How it runs"
            data-testid="how-it-runs"
            actions={
              <Button type="button" size="sm" variant="ghost" icon={runsOpen ? ChevronUp : ChevronDown} aria-expanded={runsOpen} aria-controls="how-it-runs-controls" onClick={() => setRunsChosen(!runsOpen)} data-testid="how-it-runs-change">
                {runsOpen ? "Hide" : "Change"}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {/* Labeled lines, not a chip row (first-time founder report, Nov 8, 2026: "Personal · Assisted · Marketplace"
                  meant nothing to a first-time founder): each choice says what it is about, then the answer. */}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body" aria-label="How it runs" data-testid="how-it-runs-summary">
                <dt className="text-small text-secondary">Where it runs</dt>
                <dd className="flex items-center gap-1.5 text-primary">
                  <Icon icon={form.gameMode === "live" ? Globe : Lock} size="inline" className="text-tertiary" />
                  <span data-summary="game-mode">{form.gameMode === "live" ? "Live" : "Personal"}</span>
                  <span className="text-small text-secondary">{form.gameMode === "live" ? "· on the network, where other founders can find it" : "· only you and the people you invite see it"}</span>
                </dd>
                <dt className="text-small text-secondary">Who decides</dt>
                <dd className="flex flex-wrap items-center gap-x-1.5 text-primary">
                  <span data-summary="business-mode">
                    <Term id="business_mode">{modeLabel}</Term>
                  </span>
                  <span className="text-small text-secondary">· {modeTagline}</span>
                  <span className="text-small text-secondary">
                    · <span data-summary="spend-cap">{spendCapSummary(form.spendCap, form.currency)}</span>
                  </span>
                </dd>
                <dt className="text-small text-secondary">Kind of business</dt>
                <dd className="flex flex-wrap items-center gap-x-1.5 text-primary">
                  {form.archetype ? (
                    <span data-summary="archetype">
                      <Term id="archetype">{ARCHETYPE_LABELS[form.archetype]}</Term>
                    </span>
                  ) : (
                    <span className="text-status-warn" data-summary="archetype">
                      Pick an <Term id="archetype">archetype</Term>
                    </span>
                  )}
                  <span className="text-small text-secondary">· decides which departments and agents you start with</span>
                </dd>
                <dt className="text-small text-secondary">On a schedule</dt>
                <dd className="flex flex-wrap items-center gap-x-1.5 text-primary">
                  <span data-summary="autopilot">
                    <Term id="autopilot">{form.autopilot ? "Overnight shift" : "Autopilot"}</Term>
                    {form.autopilot ? " on" : " off"}
                  </span>
                  <span className="text-small text-secondary">{form.autopilot ? "· one round of work each night, news every morning" : "· the team works when you press Continue"}</span>
                </dd>
              </dl>
              <ReassuranceLine icon="settings" data-testid="reassure-how-it-runs">
                {HOW_IT_RUNS_REASSURANCE}
              </ReassuranceLine>
            </div>
          </Panel>

          {runsOpen ? (
            <div id="how-it-runs-controls" className="contents" data-testid="how-it-runs-controls">
              <Panel title="Personal or live">
                <RadioGroup value={form.gameMode} onValueChange={(v) => set("gameMode", v as GameMode)} className="grid-cols-2" aria-label="Personal or live">
                  {GAME_MODE_CARDS.filter((m) => liveOpen || m.value !== "live").map((m) => (
                    <ModeCardOption key={m.value} id={`game-${m.value}`} value={m.value} label={m.label} tagline={m.tagline} details={m.details} selected={form.gameMode === m.value} icon={m.value === "live" ? Globe : Lock} />
                  ))}
                </RadioGroup>
                {/* A LIVE business is on the network from the start, and the network is for adults: asked once (Settings › Business asks the same). */}
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
                {liveOpen ? null : <p className="mt-2 text-small text-secondary" data-testid="live-closed-note">Live is not open yet. Your business starts Personal.</p>}
              </Panel>

              <Panel title={<Term id="archetype">Archetype</Term>} data-testid="archetype-panel">
                <div className="flex flex-col gap-3">
                  <Field htmlFor="archetype-group" label="The kind of business: it decides which departments and agents you start with, and the first roadmap" required error={show("archetype")}>
                    <RadioGroup id="archetype-group" value={form.archetype ?? ""} onValueChange={(v) => set("archetype", v as Archetype)} className="grid-cols-4" aria-label="Archetype">
                      {ARCHETYPE_CARDS.map((a) => (
                        <ModeCardOption key={a.value} id={`arch-${a.value}`} value={a.value} label={a.label} tagline={a.tagline} details={[`First win: ${a.firstWin}`]} selected={form.archetype === a.value} badge={suggestedArchetype === a.value ? "From the import report" : !suggestedArchetype && idea.archetype === a.value ? "From the card" : undefined} />
                      ))}
                    </RadioGroup>
                  </Field>
                  <ReassuranceLine icon="settings" data-testid="reassure-archetype">
                    You can change this later in Settings › Business.
                  </ReassuranceLine>
                </div>
              </Panel>

              <Panel title={<Term id="business_mode">Business mode</Term>} data-testid="business-mode-panel">
                <div className="flex flex-col gap-3">
                  <RadioGroup value={form.businessMode} onValueChange={(v) => chooseMode(v as BusinessMode)} className="grid-cols-3" aria-label="Business mode">
                    {BUSINESS_MODE_CARDS.map((m) => (
                      <ModeCardOption key={m.value} id={`mode-${m.value}`} value={m.value} label={m.label} tagline={m.tagline} details={m.details} example={m.example} selected={form.businessMode === m.value} badge={m.value === "assisted" ? "Default" : undefined} />
                    ))}
                  </RadioGroup>
                  <div className="grid grid-cols-12 items-start gap-gutter border-t border-line pt-3">
                    <Field htmlFor="spend-cap" label="Spend cap per action" hint="Above this amount, every spend asks you first, whatever the mode. Leave it empty for no limit." error={show("spendCap")} className="col-span-6">
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
                        Default for {modeLabel}: <span className="tabular text-primary">{formatMoney({ amountMinor: defaultSpendCapMinor(form.businessMode, { hasBudget }), currency: form.currency })}</span>
                      </span>
                      <ProvenanceChip kind="estimate" />
                      <span>Money, signatures and identity always ask.</span>
                    </p>
                  </div>
                  <div className="flex items-start gap-3 border-t border-line pt-3" data-testid="autopilot-choice">
                    <Switch id="run-on-autopilot" checked={form.autopilot} onCheckedChange={(on) => set("autopilot", on)} aria-describedby="run-on-autopilot-hint" data-testid="run-on-autopilot" />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="run-on-autopilot">Overnight shift</Label>
                      <p id="run-on-autopilot-hint" className="text-small text-secondary">
                        On by default. While you sleep, the team runs one <Term id="cycle">cycle</Term> a night, at about 2 AM your time, with a budget of $0.15 (Estimate), so there is news every morning. Continue keeps its own limits. It never answers notes for you: every approval and <Term id="hard_gate">hard gate</Term> still waits for you, and it pauses itself when <Term id="credits">credits</Term> run out. Change it any time in Settings › What the team can do.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border-t border-line pt-3" data-testid="anthropomorphic-choice">
                    <Switch
                      id="anthropomorphic-agents"
                      checked={form.anthropomorphicAgents}
                      onCheckedChange={(on) => {
                        setFacesChosen(true);
                        set("anthropomorphicAgents", on);
                      }}
                      aria-describedby="anthropomorphic-agents-hint"
                      data-testid="anthropomorphic-agents"
                    />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="anthropomorphic-agents">Give agents names and faces</Label>
                      <p id="anthropomorphic-agents-hint" className="text-small text-secondary">
                        {ANTHROPOMORPHIC_EXPLAINER} It is your account setting, so it applies to every business; Settings › Preferences changes it any time.
                      </p>
                      {form.anthropomorphicAgents ? (
                        <AgentStylePicker
                          className="mt-2"
                          value={form.agentStyle}
                          onChange={(style) => {
                            setStyleChosen(true);
                            set("agentStyle", style);
                          }}
                          testIdPrefix="agent-style"
                        />
                      ) : null}
                    </div>
                  </div>
                  <ReassuranceLine icon="settings" data-testid="reassure-mode">
                    You can change this later in Settings › What the team can do.
                  </ReassuranceLine>
                </div>
              </Panel>
            </div>
          ) : null}

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
            {/* Whose words the team builds from (first-time founder report, Nov 8, 2026): the founder's, or a drafted card they can still edit in the studio. */}
            <p className="text-small text-secondary" data-testid="commit-words-note">
              {concept.yourWords ? (
                "The pitch is in your words. The team drafts the vision and the specification from them, keeping your audience, problem and place names as written."
              ) : (
                <>
                  The pitch is the Ideation agent's draft. The team drafts the vision and the specification from it{concept.sample ? " (a sample card: add a model key for real drafts)" : ""}.{" "}
                  <Link href="/new/ideate" className="text-link underline-offset-2 hover:underline">
                    Edit it in your words first
                  </Link>{" "}
                  if it is not quite your idea.
                </>
              )}
            </p>
            <Panel title="Day one" loading={previewLoading} empty={!form.archetype ? "Pick an archetype to see who gets hired." : undefined} data-testid="squad-preview">
              {preview ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5" aria-label="Departments">
                    {preview.departments.map((d) => (
                      <Chip key={d.slug} tone={d.colourToken} data-department-chip={d.slug}>
                        {d.name}
                        {/* An archetype's own name for a standard department, said as such (first-time founder report: "Product became Editorial"). */}
                        {renamedDepartment(d) ? <span className="text-tertiary"> · your {renamedDepartment(d)} department</span> : null}
                      </Chip>
                    ))}
                  </div>
                  {renamedDepartments(preview.departments).length ? (
                    <p className="text-small text-secondary" data-testid="department-rename-note">
                      {departmentRenameNote(preview.departments, form.archetype)}
                    </p>
                  ) : null}
                  <ul className="flex flex-col divide-y divide-line-faint" aria-label="Team">
                    {visibleAgents(preview.agents).map((a) => (
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
                  <p className="text-small text-secondary" data-testid="squad-preview-counts">
                    {teamCountsLine(preview)}
                  </p>
                  {/* The first money a founder sees about the team: what the wage caps add up to a month (first-time founder report). */}
                  <p className="flex flex-wrap items-center gap-x-1.5 text-small text-secondary" data-testid="squad-preview-wages">
                    <span>{monthlyWageLine(preview.agents, currency)}</span>
                    <ProvenanceChip kind="estimate" appearance="word" />
                  </p>
                </div>
              ) : null}
            </Panel>
            <Panel title="What happens next" data-testid="what-happens-next">
              <ol className="flex flex-col gap-1.5 text-body">
                {WHAT_HAPPENS_NEXT.map((s, i) => (
                  <li key={s} className="flex items-start gap-2">
                    <span className="inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro text-tertiary ring-1 ring-line-strong">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              {/* The first money a founder reads about: included credits, no card (A10). Not when this month's pool is spent: that notice says so below. */}
              {creditsNotice ? null : (
                <p className="mt-3 text-small text-secondary" data-testid="commit-credits-line">
                  {includedCreditsLine()}
                </p>
              )}
              {creditsNotice ? (
                <div data-testid="commit-credits-notice" className="mt-3 flex flex-col items-start gap-1.5">
                  <StatusPill tone="warn">Team starts paused</StatusPill>
                  <p className="text-small text-pretty text-secondary">{creditsNotice}</p>
                </div>
              ) : null}
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

function ModeCardOption({ id, value, label, tagline, details, example, selected, badge, icon: Icon }: { id: string; value: string; label: string; tagline: string; details: string[]; example?: string; selected: boolean; badge?: string; icon?: typeof Globe }) {
  // A radio card (DESIGN §8): the whole card is the target; the selected card takes the accent ring. A badge
  // ("Default", "From the card") sits on its own line so it never squeezes the title; the example line closes the card.
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
        {example ? (
          <span className="mt-1 border-t border-line-faint pt-1.5 text-small text-tertiary" data-mode-example="">
            {example}
          </span>
        ) : null}
      </label>
    </div>
  );
}

/** "Registry", "DNS (Estimate)" or "Mock": where the domain answers came from. Only a DNS answer is an estimate. */
function DomainProvenanceChip({ provenance }: { provenance: DomainProvenance }) {
  return (
    <Chip data-testid="domain-provenance" data-source={provenance} title={provenance === "DNS" ? DNS_ESTIMATE_HINT : undefined}>
      {domainProvenanceWord(provenance)}
    </Chip>
  );
}
