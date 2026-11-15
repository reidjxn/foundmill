/**
 * Shared shapes for the shell group (BUILD §5.3–5.5, DESIGN §8).
 * Vocabulary enums come from @foundmill/shared; nothing here redeclares them.
 */
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import type { AreaKey, BusinessMode, DeptColourToken, GameMode } from "@foundmill/shared";
import type { IconComponent } from "../foundation/Icon";

/** Business brand colours as hex (business data, not design tokens). The `Kit` name is the internal identifier; copy says "brand colours". */
export interface Kit {
  primary: string;
  secondary: string;
}

/** Column spans a panel may snap to on the 12-column grid (BUILD §5.3). */
export const GRID_SPANS = [3, 4, 6, 8, 12] as const;
export type GridSpan = (typeof GRID_SPANS)[number];

/**
 * `main`: Today and Needs you. `area`: the founder areas (Plan, Customers, Money, Product, Team; docs/DESIGN.md §8),
 * each with its fixed G-chord letter. `department`: a department with no modules, which keeps its own item, dot and
 * letter after the areas. `live`: the LIVE block. `foot`: Settings and Sign out.
 */
export type SidebarGroup = "main" | "area" | "department" | "live" | "foot";

export interface SidebarItem {
  id: string;
  label: string;
  icon: IconComponent;
  /** Rendered through the shell link renderer when present; otherwise the item is a button. */
  href?: string;
  /** Which block the item belongs to. Items render in the order given; `live` gets the LIVE divider, `foot` sits at the bottom. */
  group: SidebarGroup;
  /** The founder area an `area` item opens; its G-chord letter is `AREA_LETTERS[area]` (G P, G C, G M, G R, G T). */
  area?: AreaKey;
  /** Department colour: paints the dot and the badge. */
  dept?: DeptColourToken;
  /** Count shown as an 18 px pill. Omitted or 0 hides the badge. */
  badge?: number;
  /** Tone for badges on non-department items (Inbox uses "bad": items that need a response). */
  badgeTone?: "bad" | "neutral";
  /** Keyboard chord shown in the tooltip, e.g. ["G", "H"]. AppShell fills this in from `fixed`, `area` and the department letters. */
  keys?: string[];
  /** The fixed surface this item opens (G H Today, G I Needs you). Areas are identified by `area`, departments by `group`. */
  fixed?: "home" | "inbox";
  /** A module-less department's stored G-chord letter (departments.shortcut); it wins over the letter its name would give. */
  shortcut?: string | null;
  /** A few words for the collapsed tooltip after the label, in brackets ("Customers (leads, campaigns and contacts)"). */
  hint?: string;
  disabled?: boolean;
}

/**
 * The product wordmark at the foot of the sidebar (DESIGN §8a). It is not an item: it has no icon, and it is drawn only
 * while the sidebar is expanded (the wordmark does not fit in 64 px, and the FM monogram is never used as an icon).
 */
export interface SidebarBrand {
  /** Where the wordmark links (the app passes "/"). Rendered through the shell link renderer. */
  href: string;
  /** Accessible name of the link. Defaults to the product name. */
  label?: string;
}

/** Continue button states (BUILD §5.4). */
export type ContinueState =
  | { kind: "idle" }
  | { kind: "blocked"; count: number }
  /**
   * `cycle`: the running cycle's number, for "The team is working · cycle 3" (the button's `cycleNumber` prop also carries
   * it). `run`: one press of Continue keeps the team working, so new cycles start on their own (between cycles too).
   */
  | { kind: "processing"; label?: string; cycle?: number; run?: boolean }
  | { kind: "matchday" }
  | { kind: "holiday"; until: Date | string | null; untilLabel?: string };

export type ContinueStateKind = ContinueState["kind"];

export interface ProcessingSegment {
  id: string;
  /** Department name for the accessible status text. */
  label: string;
  dept: DeptColourToken;
  /** True while agents in this department are working this cycle. */
  active: boolean;
  /** Relative width (default 1). */
  weight?: number;
}

export interface TabSubView {
  id: string;
  label: string;
  href?: string;
}

export interface TabItem {
  id: string;
  label: string;
  href?: string;
  /** Tabs with sub-views show a 12 px caret that opens a dropdown. */
  subViews?: TabSubView[];
  /** A count in a pill after the label. */
  badge?: number;
  /** "bad": the count needs the founder (Respond's count is red with ink text). Default neutral. */
  badgeTone?: "bad" | "neutral";
  disabled?: boolean;
  /**
   * "detail": the tab sits in the bar's "More detail" menu at the end (docs/DESIGN.md §9) unless it is the active tab,
   * which then shows in the bar. Default "default": inline.
   */
  tier?: "default" | "detail";
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: IconComponent;
}

/** Props the shell link renderer receives; apps swap in their router link. */
export interface ShellLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page" | "true";
  "aria-selected"?: boolean;
  "aria-label"?: string;
  title?: string;
  tabIndex?: number;
  role?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  style?: CSSProperties;
  "data-active"?: boolean;
  id?: string;
}

export type ShellLinkRenderer = (props: ShellLinkProps & { ref?: Ref<HTMLAnchorElement> }) => ReactNode;

export interface ShellModes {
  gameMode: GameMode;
  businessMode: BusinessMode;
}
