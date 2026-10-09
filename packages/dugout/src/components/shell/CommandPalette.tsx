"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { Bot, Building2, ChevronRight, CornerDownLeft, Fan, Globe, Inbox, LayoutGrid, MapPin, MessageCircle, Search, Terminal, UserCog, User, Users, type LucideIcon } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Chip, DeptChip } from "../foundation/Chip";
import { Dialog, DialogContent, DialogTitle } from "../foundation/Dialog";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Kbd, Keys } from "../foundation/Kbd";
import { Skeleton } from "../foundation/Skeleton";

/**
 * What a palette row can be: a CRM entity kind (shared vocabulary), a screen, a department, an inbox item, a command,
 * or one of the lead rows: talk to an agent ("ask") or make something ("generate").
 */
export type PaletteKind = EntityKind | "screen" | "department" | "inbox" | "command" | "ask" | "generate";

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
  /** A ready avatar or logo (18–24 px) in place of the icon: agents, people, the business. */
  avatar?: ReactNode;
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
  ask: ["ask"],
  generate: ["generate"],
  draft: ["generate"],
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

/**
 * Group order: talk and make first (Ask, Generate), then where to go — departments and agents before screens, the
 * Inbox and the CRM — and commands (settings among them) last.
 */
export const PALETTE_KIND_ORDER: readonly PaletteKind[] = ["ask", "generate", "department", "agent", "screen", "inbox", "person", "organisation", "team_member", "platform_member", "community", "venue", "command"];

export const PALETTE_KIND_INFO: Record<PaletteKind, { label: string; icon: LucideIcon }> = {
  ask: { label: "Ask", icon: MessageCircle },
  generate: { label: "Generate", icon: Fan },
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
  /**
   * Lead rows: talk to an agent ("Ask the Chief of Staff", "Ask Juno"). Shown first and kept while typing, carrying the
   * query ("Ask Juno · “why is cash down?”"); choosing one calls `onAsk` with the query (or `onSelect`).
   */
  ask?: readonly PaletteItem[];
  /** Lead rows: make something ("Draft 12 concepts", "Draft a cover plan"), after Ask; matched against the query. */
  generate?: readonly PaletteItem[];
  /** An Ask row was chosen, with the query typed so far ("" when none). Defaults to `onSelect(item)`. */
  onAsk?: (item: PaletteItem, text: string) => void;
  /**
   * The business itself, matched locally even when `remote` is set: typing part of its name finds it ("north" →
   * Northwind Skincare, opening `href`). AppShell fills this in from the business name and Home.
   */
  business?: { name: string; href?: string; description?: string; logo?: ReactNode; keywords?: string[] };
}

/** Static class map so Tailwind emits every department tone for the row glyphs. */
const GLYPH_TONE: Record<DeptColourToken, string> = {
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:t-data [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5";

/**
 * Universal search (BUILD §5.3, §11.12): a cmdk command menu on the dialog glass. It leads with what the founder can
 * do — Ask an agent (the query travels with it) and Generate — then recent items, then where to go: departments and
 * agents before screens, the Inbox, the CRM, and commands (settings among them) last. The business itself matches its
 * name. Rows carry a glyph tinted by their department; the selected row takes the brand plate and a lit edge. Operators
 * are parsed locally (`kind:`, `role:`, `stage:`, `owner:`, `department:`, leading `>` for commands) and shown as a hint
 * row. Arrow keys move, Enter opens, Esc closes; `/` and ⌘K open it through the keyboard map.
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
  placeholder = "Search, ask or generate · type > for commands",
  emptyText = "Nothing matches. Try fewer words, or an operator such as kind:person.",
  footer,
  ask = [],
  generate = [],
  onAsk,
  business,
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

  const noFilters = !parsed.commandsOnly && Object.keys(parsed.filters).length === 0;
  const kinds = kindsForFilter(parsed.filters.kind);
  const showRecent = parsed.text === "" && noFilters && recent.length > 0;
  const visible = useMemo(() => filterPaletteItems(items, parsed, { remote }), [items, parsed, remote]);
  const groups = useMemo(() => groupPaletteItems(visible), [visible]);
  // Lead rows are always matched here, whatever `remote` says: Ask stays while typing; Generate follows the query.
  const askRows = !parsed.commandsOnly && (!kinds || kinds.includes("ask")) ? ask : [];
  const generateRows = useMemo(() => {
    if (kinds && !kinds.includes("generate")) return [];
    const rows = generate.map((it) => ({ ...it, kind: "generate" as const }));
    return filterPaletteItems(rows, { ...parsed, commandsOnly: false });
  }, [generate, parsed, kinds]);
  const businessRow: PaletteItem | null =
    business && parsed.text !== "" && noFilters && matchScore({ label: business.name, keywords: business.keywords }, parsed.text) > 0
      ? { id: "business", kind: "screen", label: business.name, description: business.description ?? "Home", href: business.href, avatar: business.logo, icon: Building2 }
      : null;
  const activeFilters = (Object.entries(parsed.filters) as Array<[SearchOperator, string]>).filter(([k]) => k !== "kind" || !kindsForFilter(parsed.filters.kind));
  const nothing = visible.length === 0 && askRows.length === 0 && generateRows.length === 0 && !businessRow && !showRecent;

  const select = (item: PaletteItem) => {
    if (item.disabled) return;
    if (item.kind === "ask" && onAsk) onAsk(item, parsed.text);
    else onSelect(item);
    onOpenChange(false);
  };

  const glyph = (item: PaletteItem) => {
    if (item.avatar) return <span className="inline-flex size-gen-core-md shrink-0 items-center justify-center">{item.avatar}</span>;
    const info = PALETTE_KIND_INFO[item.kind];
    if (item.kind === "generate")
      return (
        <span aria-hidden className="gen-core size-gen-core-md">
          <Icon icon={item.icon ?? Fan} size="inline" strokeWidth={1.9} />
        </span>
      );
    return (
      <span aria-hidden className={cn("palette-glyph", item.kind === "ask" ? "tone-kit-lift" : item.dept ? GLYPH_TONE[item.dept] : undefined)}>
        <Icon icon={item.icon ?? info.icon} size="inline" />
      </span>
    );
  };

  const renderItem = (item: PaletteItem, keyPrefix = "") => {
    const description = item.kind === "ask" && parsed.text ? `“${parsed.text}”` : item.description;
    return (
      <Command.Item
        key={`${keyPrefix}${item.id}`}
        value={`${keyPrefix}${item.id}`}
        keywords={[item.label, ...(item.keywords ?? [])]}
        disabled={item.disabled}
        onSelect={() => select(item)}
        data-kind={item.kind}
        className="palette-row group/item flex min-h-row-comfortable cursor-default select-none items-center gap-2.5 px-2.5 py-1.5 text-body text-primary outline-none"
      >
        {glyph(item)}
        <span className="flex min-w-0 flex-1 flex-col gap-px leading-tight">
          <span className="truncate">{item.label}</span>
          {description && (!item.dept || item.kind === "ask") ? <span className="truncate text-small text-secondary">{description}</span> : null}
        </span>
        {item.dept && item.description && item.kind !== "ask" ? <DeptChip dept={item.dept}>{item.description}</DeptChip> : null}
        {item.public ? <Chip tone="info">On {APP_NAME}</Chip> : null}
        {item.shortcut ? <Keys keys={item.shortcut} /> : null}
        <Icon icon={item.kind === "ask" || item.kind === "generate" ? CornerDownLeft : ChevronRight} size={12} className="text-tertiary opacity-0 transition-opacity duration-hover ease-out group-aria-selected/item:opacity-100" />
      </Command.Item>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="top-24 w-palette translate-y-0 p-0" aria-describedby={undefined} data-testid="command-palette">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command label="Search" shouldFilter={false} loop className="palette-list flex flex-col">
          <div className="flex h-control-xl shrink-0 items-center gap-2.5 border-b border-line px-gutter">
            <Icon icon={Search} className="text-tertiary" />
            <Command.Input
              value={raw}
              onValueChange={setQuery}
              placeholder={placeholder}
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-chat text-primary outline-none placeholder:text-tertiary"
            />
            {activeFilters.map(([k, v]) => (
              <Chip key={k} tone="neutral" mono>
                {k}:{v}
              </Chip>
            ))}
            {parsed.commandsOnly ? <Chip tone="neutral">Commands</Chip> : null}
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5" label="Results">
            {loading ? (
              <div className="flex flex-col gap-2 p-2" aria-busy>
                <Skeleton className="w-2/3" />
                <Skeleton className="w-1/2" />
                <Skeleton className="w-3/5" />
              </div>
            ) : null}
            {askRows.length > 0 ? (
              <Command.Group heading={PALETTE_KIND_INFO.ask.label} data-group="ask" className={GROUP_CLASS}>
                {askRows.map((it) => renderItem({ ...it, kind: "ask" }, "ask:"))}
              </Command.Group>
            ) : null}
            {generateRows.length > 0 ? (
              <Command.Group heading={PALETTE_KIND_INFO.generate.label} data-group="generate" className={GROUP_CLASS}>
                {generateRows.map((it) => renderItem(it, "generate:"))}
              </Command.Group>
            ) : null}
            {businessRow ? (
              <Command.Group heading="Business" data-group="business" className={GROUP_CLASS}>
                {renderItem(businessRow, "business:")}
              </Command.Group>
            ) : null}
            {showRecent ? (
              <Command.Group heading="Recent" data-group="recent" className={GROUP_CLASS}>
                {recent.map((it) => renderItem(it, "recent:"))}
              </Command.Group>
            ) : null}
            {groups.map((g) => (
              <Command.Group key={g.kind} heading={g.label} data-group={g.kind} className={GROUP_CLASS}>
                {g.items.map((it) => renderItem(it))}
              </Command.Group>
            ))}
            {!loading && nothing ? (
              <div role="status" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                <span aria-hidden className="icon-halo size-control-lg">
                  <Icon icon={Search} size="empty" />
                </span>
                <p className="text-body text-pretty text-secondary">{emptyText}</p>
              </div>
            ) : null}
          </Command.List>
          {footer ? <div className="shrink-0 border-t border-line-faint px-gutter py-2">{footer}</div> : null}
          <div className="flex h-control-md shrink-0 items-center gap-3 border-t border-line-faint bg-black/15 px-gutter text-small text-tertiary" data-testid="palette-hints">
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
                <code key={op} className="rounded-xs bg-white/5 px-1 font-mono text-micro text-secondary">
                  {op}:
                </code>
              ))}
              <code className="rounded-xs bg-white/5 px-1 font-mono text-micro text-secondary">&gt;</code>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
