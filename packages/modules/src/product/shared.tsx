/** Helpers shared by the product screens: section ordering, authorship, mutations with pending/error state, layout. */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Bot, Lock, UserRound } from "lucide-react";
import { Chip, EntityLink, Icon, PageGrid, cn, useEntityLinkContext } from "@foundmill/dugout";
import { useWidgetData } from "@foundmill/widgets";
import type { AuthorKind, SpecBlockRow } from "./types";
import { pmTitle } from "./prosemirror";

/** Default spec outline order (BUILD §11.5); unknown sections follow alphabetically. */
export const SECTION_ORDER = [
  "Vision",
  "Problem",
  "Customers",
  "Value proposition",
  "Features",
  "Non-functional",
  "Data",
  "Integrations",
  "Pricing",
  "Metrics",
  "Risks",
  "Formulation/BOM",
  "Formulation",
  "BOM",
  "Manufacturing",
  "Packaging",
  "Compliance",
  "Fulfilment",
] as const;

const sectionRank = new Map<string, number>(SECTION_ORDER.map((s, i) => [s.toLowerCase(), i]));

export function compareSections(a: string, b: string): number {
  const ra = sectionRank.get(a.toLowerCase());
  const rb = sectionRank.get(b.toLowerCase());
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1;
  if (rb !== undefined) return 1;
  return a.localeCompare(b);
}

export interface SectionGroup {
  section: string;
  blocks: SpecBlockRow[];
}

/** Blocks grouped by section in outline order, blocks by position. */
export function groupBySection(blocks: readonly SpecBlockRow[]): SectionGroup[] {
  const map = new Map<string, SpecBlockRow[]>();
  for (const b of blocks) {
    const list = map.get(b.section) ?? [];
    list.push(b);
    map.set(b.section, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => compareSections(a, b))
    .map(([section, list]) => ({ section, blocks: list.slice().sort((x, y) => x.position - y.position || String(x.createdAt ?? "").localeCompare(String(y.createdAt ?? ""))) }));
}

export function blockTitle(block: Pick<SpecBlockRow, "content" | "section">): string {
  return pmTitle(block.content, block.section);
}

export function findBlock(blocks: readonly SpecBlockRow[] | undefined, id: string | null | undefined): SpecBlockRow | undefined {
  return id ? blocks?.find((b) => b.id === id) : undefined;
}

/* ---------- Authorship ---------- */

export function authorWord(kind: AuthorKind): string {
  return kind === "agent" ? "Agent" : kind === "user" ? "Team member" : "System";
}

/** Who wrote a block: an EntityLink for agents and people (names resolve through the host's EntityLinkProvider). */
export function AuthorRef({ kind, id, className }: { kind: AuthorKind; id: string | null; className?: string }) {
  const ctx = useEntityLinkContext();
  if (!id || kind === "system") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-small text-secondary", className)}>
        <Icon icon={kind === "agent" ? Bot : UserRound} size="inline" />
        {authorWord(kind)}
      </span>
    );
  }
  const resolved = ctx.resolve?.(id);
  return <EntityLink entity={{ id, kind: kind === "agent" ? "agent" : "team_member", name: resolved?.name ?? authorWord(kind) }} className={className} />;
}

/** "Pinned" lock chip: human-edited blocks agents never overwrite without an accepted hunk (AC-11.5.3). */
export function PinnedChip({ className }: { className?: string }) {
  return (
    <Chip tone="info" icon={Lock} className={className} title="Human-edited. Agents cannot change this block without an accepted change proposal.">
      Pinned
    </Chip>
  );
}

/* ---------- Mutations ---------- */

export interface ActionState {
  pending: string | null;
  error: Error | null;
  clearError: () => void;
  /** Run a mutation; resolves to the result or undefined when it failed (the error is kept in state). */
  run: <T = unknown>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void }) => Promise<T | undefined>;
}

/** Mutations through the host data source with one pending key and the last error, for buttons and inline errors. */
export function useAction(): ActionState {
  const { mutate } = useWidgetData();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);
  const run = useCallback(
    async <T,>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void }): Promise<T | undefined> => {
      const key = opts?.key ?? path;
      setPending(key);
      setError(null);
      try {
        const result = await mutate<T>(path, input);
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
    <p role="alert" className={cn("text-small text-status-bad", className)}>
      {errorMessage(error)}
    </p>
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

/** Label + value pair for compact fact rows. */
export function Fact({ label, children, numeric }: { label: ReactNode; children: ReactNode; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="t-label truncate">{label}</p>
      <p className={cn("truncate text-body text-primary", numeric && "tabular-nums")}>{children}</p>
    </div>
  );
}

export function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
