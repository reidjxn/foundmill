"use client";
/**
 * Helpers shared by the legal screens: layout, clock, mutations with pending/error state, the mandatory
 * "Information, not legal or tax advice" caption, founder-only link-outs (the only way to an external submit,
 * pay or sign page) and the legal entity query every tab reads.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Info, ShieldCheck } from "lucide-react";
import { Button, Chip, PageGrid, StatusPill, cn, formatMoney, useGuided, type ButtonProps, type StatusTone } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery, type QueryState } from "@foundmill/widgets/data";
import { plainWords, type CalendarStatus } from "./legal-data";
import type { ContractStatus, IncorporationStatus, IncorporationStatusResponse, LegalEntityStatus } from "./types";

/* ---------- Options (host or tests) ---------- */

export interface LegalScreenOptions {
  /** Fixed "now" for deterministic deadlines in stories and tests. */
  now?: Date;
  /** Opens an external page (founder link-outs). Default `window.open(href, "_blank", "noopener")`. */
  openExternal?: (href: string) => void;
}

const OptionsCtx = createContext<LegalScreenOptions>({});

export function LegalScreenOptionsProvider({ value, children }: { value: LegalScreenOptions; children: ReactNode }) {
  return <OptionsCtx.Provider value={value}>{children}</OptionsCtx.Provider>;
}

/** The clock a screen reads once per mount (so query inputs stay stable between renders). */
export function useNow(): Date {
  const opts = useContext(OptionsCtx);
  const [now] = useState(() => opts.now ?? new Date());
  return now;
}

export function useOpenExternal(): (href: string) => void {
  const opts = useContext(OptionsCtx);
  return useCallback(
    (href: string) => {
      if (opts.openExternal) return opts.openExternal(href);
      if (typeof window !== "undefined" && typeof window.open === "function") window.open(href, "_blank", "noopener,noreferrer");
    },
    [opts],
  );
}

/* ---------- Layout ---------- */

/** A module screen fills the content region: a 12-column PageGrid with the content gutter. */
export function Screen({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <PageGrid data-module-screen={name} className={cn("p-gutter", className)}>
      {children}
    </PageGrid>
  );
}

/** Label + value pair for compact fact rows. Values wrap (an address, a long legal name); numbers never break. */
export function Fact({ label, children, numeric, mono, className }: { label: ReactNode; children: ReactNode; numeric?: boolean; mono?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="t-label">{label}</p>
      <p className={cn("text-primary", mono ? "t-mono break-all" : "t-body break-words", numeric && "whitespace-nowrap tabular-nums")}>{children}</p>
    </div>
  );
}

/* ---------- Captions and gates ---------- */

export const INFORMATION_CAPTION = "Information, not legal or tax advice";
export const SCREEN_CAPTION = "Screen, not legal clearance";

/** The caption DESIGN §9 requires on every recommender output; `kind="screen"` for the trademark screen. */
export function InformationNotice({ kind = "advice", className, children }: { kind?: "advice" | "screen"; className?: string; children?: ReactNode }) {
  return (
    <p className={cn("flex items-center gap-1.5 t-small text-secondary", className)} data-caption={kind}>
      <Info size={14} aria-hidden />
      <span>{kind === "screen" ? SCREEN_CAPTION : INFORMATION_CAPTION}</span>
      {children ? <span>· {children}</span> : null}
    </p>
  );
}

/** "Founder only" chip next to actions agents never perform (submit, pay, sign, accept terms). */
export function FounderOnlyChip({ className }: { className?: string }) {
  return (
    <Chip tone="kit" icon={ShieldCheck} className={cn("whitespace-nowrap", className)} title="Agents never perform this step; it is yours alone">
      Founder only
    </Chip>
  );
}

export interface FounderLinkOutProps extends Omit<ButtonProps, "onClick" | "children"> {
  href: string;
  children: ReactNode;
  /** The screen's clock-free external opener (tests inject one). */
  onOpened?: (href: string) => void;
}

/**
 * A founder-only button that only opens an external page (Atlas, Companies House, the e-signature envelope). It never
 * submits, pays or signs anything itself (AC-11.11.4): the founder does that on the vendor's page, signed in as
 * themselves.
 */
export function FounderLinkOut({ href, children, onOpened, icon = ExternalLink, variant = "primary", size = "md", className, ...rest }: FounderLinkOutProps) {
  const open = useOpenExternal();
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Button
        type="button"
        icon={icon}
        variant={variant}
        size={size}
        data-founder-only="true"
        data-href={href}
        onClick={() => {
          open(href);
          onOpened?.(href);
        }}
        {...rest}
      >
        {children}
      </Button>
      <FounderOnlyChip />
    </span>
  );
}

/* ---------- Status pills ---------- */

export const ENTITY_STATUS_PILL: Record<LegalEntityStatus, { tone: StatusTone; word: string }> = {
  planned: { tone: "neutral", word: "Planned" },
  forming: { tone: "info", word: "Forming" },
  active: { tone: "good", word: "Active" },
  dissolved: { tone: "bad", word: "Dissolved" },
};

export const INCORPORATION_PILL: Record<IncorporationStatus, { tone: StatusTone; word: string }> = {
  draft: { tone: "neutral", word: "Draft" },
  in_progress: { tone: "info", word: "Preparing" },
  awaiting_founder: { tone: "warn", word: "Needs your go-ahead" },
  submitted: { tone: "info", word: "Submitted" },
  complete: { tone: "good", word: "Complete" },
  abandoned: { tone: "bad", word: "Abandoned" },
};

export const CALENDAR_PILL: Record<CalendarStatus, { tone: StatusTone; word: string }> = {
  upcoming: { tone: "neutral", word: "Upcoming" },
  due: { tone: "warn", word: "Due soon" },
  overdue: { tone: "bad", word: "Overdue" },
  done: { tone: "good", word: "Done" },
  waived: { tone: "neutral", word: "Waived" },
};

export const CONTRACT_PILL: Record<ContractStatus, { tone: StatusTone; word: string }> = {
  draft: { tone: "neutral", word: "Draft" },
  review: { tone: "info", word: "In review" },
  awaiting_signature: { tone: "warn", word: "Awaiting signature" },
  signed: { tone: "good", word: "Signed" },
  active: { tone: "good", word: "Active" },
  expired: { tone: "neutral", word: "Expired" },
  terminated: { tone: "bad", word: "Terminated" },
};

/** A status pill that keeps its words on one line (it never wraps inside a row; the row wraps around it). */
export function Pill({ tone, word, className }: { tone: StatusTone; word: string; className?: string }) {
  return (
    <StatusPill tone={tone} className={cn("shrink-0 whitespace-nowrap", className)}>
      {word}
    </StatusPill>
  );
}

/* ---------- Tables ---------- */

/** DataTable body height that shows `rows` compact rows under the sticky header (no dead space under short tables). */
export function fitTableHeight(rows: number, opts: { minRows?: number; maxRows?: number; rowHeight?: number } = {}): number {
  const { minRows = 4, maxRows = 18, rowHeight = 28 } = opts;
  return 41 + Math.min(maxRows, Math.max(minRows, rows)) * rowHeight;
}

/** The built-in "Simple" saved view every table carries: its four most important columns (UX plan §7.10). */
export const SIMPLE_VIEW_ID = "simple";

/**
 * The view a table opens on before the person picks one: "Simple" while guidance is on, the screen's general view
 * otherwise. A view the person left open (stored per table) still wins; this only fills the gap (saved-views.ts).
 */
export function useDefaultViewId(general: string): string {
  return useGuided() ? SIMPLE_VIEW_ID : general;
}

/** The department's intro, on its first tab while guidance is on (UX plan §7.10). */
export const LEGAL_EXPLAINER = {
  screenId: "legal/entity",
  purpose: "The company itself: where it is registered, what it must file, what it has signed.",
  action: "Import an existing company or start an incorporation; the legal lead fills the compliance calendar from it.",
  watchFor: "Information, not legal advice. Signing, filing and paying are always yours.",
} as const;

/* ---------- Money ---------- */

export function useCurrency(): string {
  return useWidgetData().currency;
}

export function fmtMoney(amountMinor: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) return "—";
  return formatMoney({ amountMinor: Math.round(amountMinor), currency }, opts);
}

/* ---------- Queries ---------- */

const EMPTY_INPUT: Record<string, unknown> = {};

/** The operating entity, the incorporation in flight and the history (legal.incorporate.status). */
export function useLegalStatus(): QueryState<IncorporationStatusResponse> {
  return useWidgetQuery<IncorporationStatusResponse>("legal.incorporate.status", EMPTY_INPUT);
}

/* ---------- Mutations ---------- */

export interface ActionState {
  pending: string | null;
  error: Error | null;
  clearError: () => void;
  /**
   * Run a mutation; resolves to the result or undefined when it failed (the error is kept in state). `fresh`: wait, still
   * pending, until the reads the change made stale have reloaded (the host's `settled`), for a caller that drops what it
   * showed meanwhile and shows those reads next.
   */
  run: <T = unknown>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void; fresh?: boolean }) => Promise<T | undefined>;
}

/** Mutations through the host data source with one pending key and the last error, for buttons and inline errors. */
export function useAction(): ActionState {
  const { mutate } = useWidgetData();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);
  const run = useCallback(
    async <T,>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void; fresh?: boolean }): Promise<T | undefined> => {
      const key = opts?.key ?? path;
      setPending(key);
      setError(null);
      try {
        const change = mutate<T>(path, input);
        const result = await change;
        if (opts?.fresh) await change.settled;
        opts?.then?.(result);
        return result;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e : new Error(String(e)));
        return undefined;
      } finally {
        if (alive.current) setPending((p) => (p === key ? null : p));
      }
    },
    [mutate],
  );
  return { pending, error, clearError: () => setError(null), run };
}

export function errorMessage(e: Error | string | null | undefined): string {
  if (!e) return "";
  const m = typeof e === "string" ? e : e.message;
  return m && m.length < 200 ? m : "Something went wrong. Try again.";
}

/** One line of status-bad text under a control (never the only signal: the control also stays enabled). */
export function InlineError({ error, className }: { error: Error | string | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn("t-small text-status-bad", className)}>
      {errorMessage(error)}
    </p>
  );
}

/** Sentence-case a snake_case key for display. */
export function humanise(s: string | null | undefined): string {
  return plainWords(s);
}

export { archetypeLabel, entityTypeLabel, jurisdictionName } from "./legal-data";
