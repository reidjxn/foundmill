"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { Bot, Building2, ChevronRight, Globe, Inbox, LayoutGrid, MapPin, Search, Terminal, UserCog, User, Users, type LucideIcon } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Chip, DeptChip } from "../foundation/Chip";
import { Dialog, DialogContent, DialogTitle } from "../foundation/Dialog";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Kbd, Keys } from "../foundation/Kbd";
import { Skeleton } from "../foundation/Skeleton";

/** What a palette row can be: a CRM entity kind (shared vocabulary), a screen, a department, an inbox item or a command. */
export type PaletteKind = EntityKind | "screen" | "department" | "inbox" | "command";

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  label: string;
  /** Small-style line under the label (role, organisation, department). */
  description?: string;
  /** Extra words the local matcher sees (aliases, slugs). */
  keywords?: string[];
  /** Override the kind icon. */
  icon?: IconComponent;
  href?: string;
  /** Department colour for department rows and department-scoped screens. */
  dept?: DeptColourToken;
  /** A command's chord, shown right-aligned. */
  shortcut?: string[];
  /** LIVE: a public profile from the network, labelled "On {APP_NAME}" (BUILD §11.12). */
  public?: boolean;
  disabled?: boolean;
}

/** BUILD §11.12 search operators. `kind:` is applied locally; the rest are handed to the app with the parsed query. */
export const SEARCH_OPERATORS = ["kind", "role", "stage", "owner", "department"] as const;
export type SearchOperator = (typeof SEARCH_OPERATORS)[number];

export interface SearchQuery {
  /** The raw input. */
  raw: string;
  /** Free text with the operators removed, trimmed. */
  text: string;
  /** Operator values, lower-cased. Quotes around a value are stripped. */
  filters: Partial<Record<SearchOperator, string>>;
  /** Leading ">" restricts the palette to commands. */
  commandsOnly: boolean;
}

const OPERATOR_RE = new RegExp(`(?:^|\\s)(${SEARCH_OPERATORS.join("|")}):("[^"]*"|\\S*)`, "gi");

/** Parse `kind:person owner:me acme` → { text: "acme", filters: { kind: "person", owner: "me" } }. Pure. */
export function parseSearchQuery(raw: string): SearchQuery {
  const filters: Partial<Record<SearchOperator, string>> = {};
  let rest = raw.replace(OPERATOR_RE, (_m, op: string, value: string) => {
    const key = op.toLowerCase() as SearchOperator;
    const v = value.replace(/^"|"$/g, "").trim().toLowerCase();
    if (v) filters[key] = v;
    return " ";
  });
  rest = rest.trim();
  const commandsOnly = rest.startsWith(">");
  if (commandsOnly) rest = rest.slice(1).trim();
  return { raw, text: rest.replace(/\s+/g, " "), filters, commandsOnly };
}

const KIND_ALIASES: Record<string, PaletteKind[]> = {
  person: ["person"],
  people: ["person"],
  contact: ["person"],
  organisation: ["organisation"],
  organization: ["organisation"],
  org: ["organisation"],
  company: ["organisation"],
  agent: ["agent"],
  agents: ["agent"],
  team_member: ["team_member"],
  team: ["team_member"],
  staff: ["team_member"],
  member: ["platform_member"],
  platform_member: ["platform_member"],
  community: ["community"],
  venue: ["venue"],
  screen: ["screen"],
  page: ["screen"],
  department: ["department"],
  dept: ["department"],
  inbox: ["inbox"],
  note: ["inbox"],
  command: ["command"],
  action: ["command"],
};

/** Kinds a `kind:` value selects; undefined when the value is unknown (then nothing is filtered out). */
export function kindsForFilter(value: string | undefined): PaletteKind[] | undefined {
  if (!value) return undefined;
  return KIND_ALIASES[value.toLowerCase()];
}

/** Score a label against free text: 3 prefix, 2 word-prefix, 1 substring (label or keywords), 0 no match. Pure. */
export function matchScore(item: Pick<PaletteItem, "label" | "keywords" | "description">, text: string): number {
  const q = text.trim().toLowerCase();
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  if (label.includes(q)) return 1;
  const extra = [...(item.keywords ?? []), item.description ?? ""].map((k) => k.toLowerCase());
  if (extra.some((k) => k.includes(q))) return 1;
  return 0;
}

/**
 * Apply the query to a list: `>` keeps commands, `kind:` keeps the named kinds, free text ranks by `matchScore`
 * (skipped when `remote` is set because the app already searched). Stable for equal scores.
 */
export function filterPaletteItems(items: readonly PaletteItem[], query: SearchQuery, opts: { remote?: boolean } = {}): PaletteItem[] {
  const kinds = query.commandsOnly ? (["command"] as PaletteKind[]) : kindsForFilter(query.filters.kind);
  const scored = items
    .map((item, index) => ({ item, index, score: opts.remote ? 1 : matchScore(item, query.text) }))
    .filter(({ item, score }) => score > 0 && (!kinds || kinds.includes(item.kind)));
  if (!opts.remote) scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}

export const PALETTE_KIND_ORDER: readonly PaletteKind[] = ["command", "screen", "department", "inbox", "person", "organisation", "agent", "team_member", "platform_member", "community", "venue"];

export const PALETTE_KIND_INFO: Record<PaletteKind, { label: string; icon: LucideIcon }> = {
  command: { label: "Commands", icon: Terminal },
  screen: { label: "Screens", icon: LayoutGrid },
  department: { label: "Departments", icon: LayoutGrid },
  inbox: { label: "Inbox", icon: Inbox },
  person: { label: "People", icon: User },
  organisation: { label: "Organisations", icon: Building2 },
  agent: { label: "Agents", icon: Bot },
  team_member: { label: "Staff", icon: UserCog },
  platform_member: { label: "Members", icon: Users },
  community: { label: "Communities", icon: Globe },
  venue: { label: "Venues", icon: MapPin },
};

export interface PaletteGroup {
  kind: PaletteKind;
  label: string;
  items: PaletteItem[];
}

/** Group by kind in the fixed order; empty kinds are omitted. */
export function groupPaletteItems(items: readonly PaletteItem[]): PaletteGroup[] {
  const by = new Map<PaletteKind, PaletteItem[]>();
  for (const it of items) {
    const list = by.get(it.kind) ?? [];
    list.push(it);
    by.set(it.kind, list);
  }
  return PALETTE_KIND_ORDER.filter((k) => by.has(k)).map((k) => ({ kind: k, label: PALETTE_KIND_INFO[k].label, items: by.get(k) as PaletteItem[] }));
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everything searchable, or the app's results when `remote` is set. */
  items: readonly PaletteItem[];
  /** Shown under a "Recent" heading when the query is empty. */
  recent?: readonly PaletteItem[];
  /** Controlled query. */
  query?: string;
  /** Fired on every keystroke with the raw and the parsed query, so the app can run the hybrid search (BUILD §11.12). */
  onQueryChange?: (raw: string, parsed: SearchQuery) => void;
  /** The app searched already: skip local text matching (kind:/> still apply). */
  remote?: boolean;
  loading?: boolean;
  onSelect: (item: PaletteItem) => void;
  placeholder?: string;
  /** Text when nothing matches. */
  emptyText?: string;
  /** Extra content under the list (natural-language filter chips, for instance). */
  footer?: ReactNode;
}

/**
 * Universal search (BUILD §5.3, §11.12): a cmdk command menu in a Dugout overlay. Results are grouped by kind with icons,
 * operators are parsed locally (`kind:`, `role:`, `stage:`, `owner:`, `department:`, leading `>` for commands) and shown
 * as a hint row. Arrow keys move, Enter opens, Esc closes; `/` and ⌘K open it through the keyboard map.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  recent = [],
  query,
  onQueryChange,
  remote,
  loading,
  onSelect,
  placeholder = "Search, or type > for commands",
  emptyText = "Nothing matches. Try fewer words, or an operator such as kind:person.",
  footer,
}: CommandPaletteProps) {
  const [internal, setInternal] = useState("");
  const raw = query ?? internal;
  const parsed = useMemo(() => parseSearchQuery(raw), [raw]);

  useEffect(() => {
    if (!open) setInternal("");
  }, [open]);

  const setQuery = (next: string) => {
    if (query === undefined) setInternal(next);
    onQueryChange?.(next, parseSearchQuery(next));
  };

  const showRecent = parsed.text === "" && !parsed.commandsOnly && Object.keys(parsed.filters).length === 0 && recent.length > 0;
  const visible = useMemo(() => filterPaletteItems(items, parsed, { remote }), [items, parsed, remote]);
  const groups = useMemo(() => groupPaletteItems(visible), [visible]);
  const activeFilters = (Object.entries(parsed.filters) as Array<[SearchOperator, string]>).filter(([k]) => k !== "kind" || !kindsForFilter(parsed.filters.kind));

  const select = (item: PaletteItem) => {
    if (item.disabled) return;
    onSelect(item);
    onOpenChange(false);
  };

  const renderItem = (item: PaletteItem) => {
    const info = PALETTE_KIND_INFO[item.kind];
    return (
      <Command.Item
        key={item.id}
        value={item.id}
        keywords={[item.label, ...(item.keywords ?? [])]}
        disabled={item.disabled}
        onSelect={() => select(item)}
        data-kind={item.kind}
        className={cn(
          "flex h-row-comfortable cursor-default select-none items-center gap-2 rounded-chip px-2 text-body text-primary outline-none",
          "aria-selected:bg-white/4 data-[disabled=true]:opacity-50",
        )}
      >
        <Icon icon={item.icon ?? info.icon} size="inline" className="text-secondary" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate">{item.label}</span>
          {item.description && !item.dept ? <span className="truncate text-small text-secondary">{item.description}</span> : null}
        </span>
        {item.dept && item.description ? <DeptChip dept={item.dept}>{item.description}</DeptChip> : null}
        {item.public ? <Chip tone="info">On {APP_NAME}</Chip> : null}
        {item.shortcut ? <Keys keys={item.shortcut} /> : null}
        <Icon icon={ChevronRight} size={12} className="text-secondary/60" />
      </Command.Item>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="top-24 translate-y-0 p-0" aria-describedby={undefined} data-testid="command-palette">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command label="Search" shouldFilter={false} loop className="flex max-h-[70vh] flex-col">
          <div className="flex h-10 items-center gap-2 border-b border-subtle px-3">
            <Icon icon={Search} className="text-secondary" />
            <Command.Input
              value={raw}
              onValueChange={setQuery}
              placeholder={placeholder}
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-secondary"
            />
            {activeFilters.map(([k, v]) => (
              <Chip key={k} tone="neutral" mono>
                {k}:{v}
              </Chip>
            ))}
            {parsed.commandsOnly ? <Chip tone="neutral">Commands</Chip> : null}
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1" label="Results">
            {loading ? (
              <div className="flex flex-col gap-2 p-2" aria-busy>
                <Skeleton className="w-2/3" />
                <Skeleton className="w-1/2" />
                <Skeleton className="w-3/5" />
              </div>
            ) : null}
            {showRecent ? (
              <Command.Group heading="Recent" className="[&_[cmdk-group-heading]]:t-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5">
                {recent.map(renderItem)}
              </Command.Group>
            ) : null}
            {groups.map((g) => (
              <Command.Group key={g.kind} heading={g.label} data-group={g.kind} className="[&_[cmdk-group-heading]]:t-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5">
                {g.items.map(renderItem)}
              </Command.Group>
            ))}
            {!loading && visible.length === 0 && !showRecent ? (
              <div role="status" className="flex flex-col items-center gap-1 px-4 py-6 text-center">
                <Icon icon={Search} size="empty" className="text-secondary" />
                <p className="text-body text-secondary">{emptyText}</p>
              </div>
            ) : null}
          </Command.List>
          {footer ? <div className="border-t border-subtle px-3 py-2">{footer}</div> : null}
          <div className="flex h-8 items-center gap-3 border-t border-subtle px-3 text-small text-secondary" data-testid="palette-hints">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> open
            </span>
            <span className="ml-auto inline-flex items-center gap-1" aria-label="Search operators">
              <span>Operators</span>
              {SEARCH_OPERATORS.map((op) => (
                <code key={op} className="rounded-chip bg-panel px-1 font-mono text-label text-secondary">
                  {op}:
                </code>
              ))}
              <code className="rounded-chip bg-panel px-1 font-mono text-label text-secondary">&gt;</code>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
