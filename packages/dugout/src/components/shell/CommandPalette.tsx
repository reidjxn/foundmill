"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { Bot, Building2, ChevronRight, CircleHelp, CornerDownLeft, Fan, Globe, Inbox, LayoutGrid, MapPin, MessageCircle, Search, Terminal, UserCog, User, Users, type LucideIcon } from "lucide-react";
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
 * one of the lead rows: talk to an agent ("ask") or make something ("generate"), or a Help row (a defined term, the
 * keyboard shortcuts).
 */
export type PaletteKind = EntityKind | "screen" | "department" | "inbox" | "command" | "ask" | "generate" | "help";

/**
 * A Help row (docs/UX_AUDIT_AND_PLAN.md §7.7, B12): a defined term from `TERMS` ("Runway" with its one-line meaning,
 * opening the screen that shows it) or the keyboard shortcuts. The app builds them (apps/web/lib/search.ts).
 */
export interface PaletteHelpItem {
  id: string;
  /** The word or the entry's name, sentence case: "Runway", "Keyboard shortcuts". */
  title: string;
  /** One line a student understands: "How many months your cash lasts at today's spending." */
  line: string;
  /**
   * Where "learn more" goes. A row without one opens its definition in place when chosen (the word, `line` and `long`
   * under the list, the palette staying open), so Estimate or Vacation can be read in full without leaving the search.
   */
  href?: string;
  /** The longer explanation of a defined term (TERMS `long`), shown when the row opens its definition in place. */
  long?: string;
}

/** The Help row every palette has: the AppShell opens the keyboard overlay when it is chosen. */
export const KEYBOARD_SHORTCUTS_HELP_ITEM: PaletteHelpItem = { id: "help:keyboard-shortcuts", title: "Keyboard shortcuts", line: "Every key the product listens for, and the single keys you can turn on in Settings." };

/** At most this many Help rows for a query, so a one-letter query never floods the list with definitions. */
export const HELP_ROW_LIMIT = 6;

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
  /** A Help row's definition: choosing the row shows it in the palette instead of opening anything (`helpPaletteRows`). */
  definition?: { word: string; short: string; long?: string };
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
  help: ["help"],
  term: ["help"],
  terms: ["help"],
  define: ["help"],
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
 * Inbox and the CRM — then commands (settings among them) and Help last.
 */
export const PALETTE_KIND_ORDER: readonly PaletteKind[] = ["ask", "generate", "department", "agent", "screen", "inbox", "person", "organisation", "team_member", "platform_member", "community", "venue", "command", "help"];

export const PALETTE_KIND_INFO: Record<PaletteKind, { label: string; icon: LucideIcon }> = {
  ask: { label: "Ask", icon: MessageCircle },
  generate: { label: "Generate", icon: Fan },
  command: { label: "Commands", icon: Terminal },
  help: { label: "Help", icon: CircleHelp },
  screen: { label: "Screens", icon: LayoutGrid },
  department: { label: "Departments", icon: LayoutGrid },
  inbox: { label: "Inbox", icon: Inbox },
  person: { label: "People", icon: User },
  organisation: { label: "Organizations", icon: Building2 },
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

/** A row as the palette renders it: the item and the cmdk value that selects it (unique across sections). */
export interface PaletteRow {
  item: PaletteItem;
  value: string;
}

/** One headed block of rows. `id` is also the block's `data-group`. */
export interface PaletteSection {
  id: string;
  heading: string;
  rows: PaletteRow[];
}

export interface PaletteSectionInput {
  /** Free text was typed (operators alone do not count). */
  typed: boolean;
  ask: readonly PaletteItem[];
  generate: readonly PaletteItem[];
  /** The business itself when its name matches the query. */
  business: PaletteItem | null;
  /** Shown only when nothing is typed. */
  recent: readonly PaletteItem[];
  /** The matched items by kind, in `PALETTE_KIND_ORDER`. */
  groups: readonly PaletteGroup[];
  /** The Help rows that match (`helpPaletteRows`); last among the matches, before Ask. */
  help?: readonly PaletteItem[];
}

const rowsOf = (items: readonly PaletteItem[], prefix: string): PaletteRow[] => items.map((item) => ({ item, value: `${prefix}${item.id}` }));

/**
 * The palette's blocks in order (pure). With nothing typed it leads with what the founder can do (Ask, Generate), then
 * Recent, then where to go, commands, then Help. Once the query matches something specific (the business, a
 * department, a screen, an Inbox note, a CRM record, a Generate row, a command or a Help entry) the matches lead: the
 * business, then where to go, then Generate, the commands and Help, and Ask follows as the fallback that carries the
 * query. Ask is the only block that is always there, so ranking it first would make Enter ask an agent even when the
 * founder typed a name to open. When nothing specific matches, Ask leads and Enter asks.
 */
export function paletteSections({ typed, ask, generate, business, recent, groups, help = [] }: PaletteSectionInput): PaletteSection[] {
  const askSection: PaletteSection = { id: "ask", heading: PALETTE_KIND_INFO.ask.label, rows: rowsOf(ask.map((it) => ({ ...it, kind: "ask" as const })), "ask:") };
  const generateSection: PaletteSection = { id: "generate", heading: PALETTE_KIND_INFO.generate.label, rows: rowsOf(generate, "generate:") };
  const businessSection: PaletteSection = { id: "business", heading: "Business", rows: business ? rowsOf([business], "business:") : [] };
  const recentSection: PaletteSection = { id: "recent", heading: "Recent", rows: typed ? [] : rowsOf(recent, "recent:") };
  const places = groups.filter((g) => g.kind !== "command" && g.kind !== "help").map((g): PaletteSection => ({ id: g.kind, heading: g.label, rows: rowsOf(g.items, "") }));
  const commands = groups.filter((g) => g.kind === "command").map((g): PaletteSection => ({ id: g.kind, heading: g.label, rows: rowsOf(g.items, "") }));
  // Help rows the app put among `items` join the ones matched from `helpItems`.
  const helpRows = [...groups.filter((g) => g.kind === "help").flatMap((g) => g.items), ...help.map((it) => ({ ...it, kind: "help" as const }))];
  const helpSection: PaletteSection = { id: "help", heading: PALETTE_KIND_INFO.help.label, rows: rowsOf(helpRows, "help:") };
  const specific = business !== null || groups.length > 0 || generate.length > 0 || help.length > 0;
  const ordered = typed && specific ? [businessSection, ...places, generateSection, ...commands, helpSection, askSection] : [askSection, generateSection, businessSection, recentSection, ...places, ...commands, helpSection];
  return ordered.filter((s) => s.rows.length > 0);
}

/** The question words a founder may type before a term ("what is runway", "define burn"), dropped before matching. */
const HELP_QUESTION_RE = /^(?:what(?:'s| is| are| does)|define|explain|meaning of|help(?: with| on)?)\s+/i;
const HELP_ARTICLE_RE = /^(?:a|an|the|my|our)\s+/i;

/** "what is the runway?" → "runway". Exported for tests. */
export function helpQuery(text: string): string {
  return text.trim().replace(HELP_QUESTION_RE, "").replace(HELP_ARTICLE_RE, "").replace(/\s*\??\s*(?:mean)?\s*\??$/i, "").trim();
}

/**
 * The Help rows for a query (pure): nothing typed shows the keyboard shortcuts alone (so Help is always one row, never
 * sixty); typed, the entries whose title or line the query matches, best first, at most `HELP_ROW_LIMIT`. Exported for
 * tests.
 */
export function helpPaletteRows(items: readonly PaletteHelpItem[], text: string): PaletteItem[] {
  const toRow = (it: PaletteHelpItem): PaletteItem => ({
    id: it.id,
    kind: "help",
    label: it.title,
    description: it.line,
    href: it.href,
    keywords: [it.line],
    // A term with nowhere to go reads in place; the keyboard shortcuts row opens the overlay instead.
    ...(!it.href && it.id !== KEYBOARD_SHORTCUTS_HELP_ITEM.id ? { definition: { word: it.title, short: it.line, ...(it.long ? { long: it.long } : {}) } } : {}),
  });
  const q = helpQuery(text);
  if (!q) return items.filter((it) => it.id === KEYBOARD_SHORTCUTS_HELP_ITEM.id).map(toRow);
  // A question about a term ("what is runway") must not be out-scored by a plain substring; score the stripped query.
  return items
    .map((it, index) => ({ it, index, score: matchScore({ label: it.title, description: it.line }, q) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, HELP_ROW_LIMIT)
    .map((s) => toRow(s.it));
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
   * Talk to an agent ("Ask the Chief of Staff", "Ask Juno"). They lead while nothing is typed and stay while typing,
   * carrying the query ("Ask Juno · “why is cash down?”"), below whatever the query matched (`paletteSections`);
   * choosing one calls `onAsk` with the query (or `onSelect`).
   */
  ask?: readonly PaletteItem[];
  /** Make something ("Draft 12 concepts", "Draft a cover plan"), after Ask on the empty palette; matched against the query. */
  generate?: readonly PaletteItem[];
  /** An Ask row was chosen, with the query typed so far ("" when none). Defaults to `onSelect(item)`. */
  onAsk?: (item: PaletteItem, text: string) => void;
  /**
   * The business itself, matched locally even when `remote` is set: typing part of its name finds it ("north" →
   * Northwind Skincare, opening `href`). AppShell fills this in from the business name and Home.
   */
  business?: { name: string; href?: string; description?: string; logo?: ReactNode; keywords?: string[] };
  /**
   * The Help group (B12): defined terms and the keyboard shortcuts, matched locally whatever `remote` says. Nothing typed
   * shows the keyboard shortcuts row alone; "what is runway" finds the term. Choosing a row opens its `href` through
   * `onSelect` (AppShell opens the keyboard overlay for `KEYBOARD_SHORTCUTS_HELP_ITEM`).
   */
  helpItems?: readonly PaletteHelpItem[];
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
 * Universal search (BUILD §5.3, §11.12): a cmdk command menu on the dialog glass. Empty, it leads with what the
 * founder can do — Ask an agent and Generate — then recent items, then where to go: departments and agents before
 * screens, the Inbox, the CRM, and commands (settings among them) last. Typed, whatever the query matches leads (the
 * business by its name, places, records, Generate, commands) and Ask follows, carrying the query (`paletteSections`).
 * The first row is selected and is what Enter runs, also when results arrive after the keystroke; once the founder
 * moves the selection (arrows, pointer) their row stays selected for that query. Rows carry a glyph tinted by their
 * department; the selected row takes the brand plate and a lit edge. Operators are parsed locally (`kind:`, `role:`,
 * `stage:`, `owner:`, `department:`, leading `>` for commands); their hint row appears once the founder types `>` or a
 * colon, never before (B12). A Help group (defined terms, the keyboard shortcuts) closes the list. Arrow keys move,
 * Enter opens, Esc closes; `/` and ⌘K open it through the keyboard map.
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
  emptyText = "Nothing matches. Try a person, a screen or an agent's name.",
  footer,
  ask = [],
  generate = [],
  onAsk,
  business,
  helpItems = [],
}: CommandPaletteProps) {
  const [internal, setInternal] = useState("");
  const raw = query ?? internal;
  const parsed = useMemo(() => parseSearchQuery(raw), [raw]);
  // The row the founder moved to (arrows, pointer) for this query; without one the first row is selected.
  const [pick, setPick] = useState<{ raw: string; value: string } | null>(null);
  // The list in state, not a ref: the dialog portals its content in after the first open render, and the selection
  // sync below must run once the rows are there.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The Help row whose definition is shown under the list (chosen without an href); a new query puts it away.
  const [defined, setDefined] = useState<{ raw: string; item: PaletteItem } | null>(null);

  useEffect(() => {
    if (open) return;
    setInternal("");
    setPick(null);
    setDefined(null);
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
  // Ask and Generate are matched here, whatever `remote` says: Ask stays while typing; Generate follows the query.
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
  // Help rows: the keyboard shortcuts alone while nothing is typed, the matching terms once there is a query.
  const helpRows = useMemo(() => (parsed.commandsOnly || (kinds && !kinds.includes("help")) ? [] : helpPaletteRows(helpItems, parsed.text)), [helpItems, parsed.text, parsed.commandsOnly, kinds]);
  const sections = paletteSections({ typed: parsed.text !== "", ask: askRows, generate: generateRows, business: businessRow, recent: showRecent ? recent : [], groups, help: helpRows });
  const nothing = sections.length === 0;
  // The operators are for people who already reach for them: the hint appears once a ">" or a colon is typed.
  const showOperators = raw.includes(">") || raw.includes(":");

  // Selection (cmdk's controlled value): the founder's own pick while it is still listed, else the first row. cmdk alone
  // keeps a selected row even when rows arrive above it (the CRM answers after the keystroke), so Enter would run a row
  // that is no longer first.
  const values = sections.flatMap((s) => s.rows.filter((r) => !r.item.disabled).map((r) => r.value));
  const first = values[0] ?? "";
  const selected = pick && pick.raw === raw && values.includes(pick.value) ? pick.value : first;
  const valuesKey = values.join("\n");
  const lastSelected = useRef(selected);
  useLayoutEffect(() => {
    const list = listEl;
    if (!list) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>("[cmdk-item]")).find((el) => el.getAttribute("data-value") === selected);
    // cmdk names the active row for assistive tech only when it moved the selection itself; name it here too.
    if (row?.id) {
      inputRef.current?.setAttribute("aria-activedescendant", row.id);
      list.setAttribute("aria-activedescendant", row.id);
    }
    if (row && lastSelected.current !== selected) {
      if (selected === first) list.scrollTop = 0;
      else row.scrollIntoView?.({ block: "nearest" });
    }
    lastSelected.current = selected;
  }, [listEl, selected, first, valuesKey]);

  const shownDefinition = defined && defined.raw === raw ? defined.item.definition : undefined;

  const select = (item: PaletteItem) => {
    if (item.disabled) return;
    if (item.kind === "help" && item.definition && !item.href) {
      // Read in place: the palette stays open with the definition under the list.
      setDefined({ raw, item });
      return;
    }
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

  const renderRow = ({ item, value }: PaletteRow) => {
    const description = item.kind === "ask" && parsed.text ? `“${parsed.text}”` : item.description;
    const shortcut = item.shortcut ?? (item.id === KEYBOARD_SHORTCUTS_HELP_ITEM.id ? ["?"] : undefined);
    return (
      <Command.Item
        key={value}
        value={value}
        keywords={[item.label, ...(item.keywords ?? [])]}
        disabled={item.disabled}
        onSelect={() => select(item)}
        data-kind={item.kind}
        className="palette-row group/item flex min-h-row-comfortable cursor-default select-none items-center gap-2.5 px-2.5 py-1.5 text-body text-primary outline-none"
      >
        {glyph(item)}
        {/* Words wrap (two lines at most) rather than being cut at the row's edge. */}
        <span className="flex min-w-0 flex-1 flex-col gap-px leading-tight">
          <span className="line-clamp-2 break-words">{item.label}</span>
          {description && (!item.dept || item.kind === "ask") ? <span className="line-clamp-2 break-words text-small text-secondary">{description}</span> : null}
        </span>
        {item.dept && item.description && item.kind !== "ask" ? <DeptChip dept={item.dept}>{item.description}</DeptChip> : null}
        {item.public ? <Chip tone="info">On {APP_NAME}</Chip> : null}
        {shortcut ? <Keys keys={shortcut} /> : null}
        <Icon icon={item.kind === "ask" || item.kind === "generate" ? CornerDownLeft : ChevronRight} size={12} className="shrink-0 text-tertiary opacity-0 transition-opacity duration-hover ease-out group-aria-selected/item:opacity-100" />
      </Command.Item>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="top-24 w-palette translate-y-0 p-0" aria-describedby={undefined} data-testid="command-palette">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command
          label="Search"
          shouldFilter={false}
          loop
          value={selected}
          onValueChange={(v) => setPick(v && v !== first ? { raw, value: v } : null)}
          className="palette-list flex flex-col"
        >
          <div className="flex h-control-xl shrink-0 items-center gap-2.5 border-b border-line px-gutter">
            <Icon icon={Search} className="text-tertiary" />
            <Command.Input
              ref={inputRef}
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
          <Command.List ref={setListEl} className="min-h-0 flex-1 overflow-y-auto p-1.5" label="Results">
            {sections.map((section) => (
              <Command.Group key={section.id} heading={section.heading} data-group={section.id} className={GROUP_CLASS}>
                {section.rows.map(renderRow)}
              </Command.Group>
            ))}
            {/* Under the rows, so the selected first row never moves while more results load. */}
            {loading ? (
              <div className="flex flex-col gap-2 p-2" aria-busy>
                <Skeleton className="w-2/3" />
                <Skeleton className="w-1/2" />
                <Skeleton className="w-3/5" />
              </div>
            ) : null}
            {!loading && nothing ? (
              <div role="status" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                <span aria-hidden className="icon-halo size-control-lg">
                  <Icon icon={Search} size="empty" />
                </span>
                <p className="text-body text-pretty text-secondary">{emptyText}</p>
              </div>
            ) : null}
          </Command.List>
          {shownDefinition ? (
            <section
              aria-label={`${shownDefinition.word}: definition`}
              aria-live="polite"
              data-palette-definition=""
              data-testid="palette-definition"
              className="flex shrink-0 flex-col gap-2 border-t border-line px-gutter py-3 text-pretty"
            >
              <p className="t-display-sm text-primary">{shownDefinition.word}</p>
              <p className="t-body text-primary">{shownDefinition.short}</p>
              {shownDefinition.long ? <p className="t-small text-secondary">{shownDefinition.long}</p> : null}
            </section>
          ) : null}
          {footer ? <div className="shrink-0 border-t border-line-faint px-gutter py-2">{footer}</div> : null}
          <div className="flex h-control-md shrink-0 items-center gap-3 border-t border-line-faint bg-black/15 px-gutter text-small text-tertiary" data-testid="palette-hints">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> open
            </span>
            {showOperators ? (
              <span className="ml-auto inline-flex items-center gap-1" aria-label="Search operators" data-testid="palette-operators">
                <span>Operators</span>
                {SEARCH_OPERATORS.map((op) => (
                  <code key={op} className="rounded-xs bg-white/5 px-1 font-mono text-micro text-secondary">
                    {op}:
                  </code>
                ))}
                <code className="rounded-xs bg-white/5 px-1 font-mono text-micro text-secondary">&gt;</code>
              </span>
            ) : null}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
