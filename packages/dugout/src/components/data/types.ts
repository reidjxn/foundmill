/** Shared types for the data group (BUILD §5.4 DataTable/EntityLink/SkillGrid/DiffView/WidgetGrid, §11.2, §11.10). */
import type { ReactNode } from "react";
import type {
  AgentStatus,
  DeptColourToken,
  EntityKind,
  Money,
  SkillGroup,
} from "@foundmill/shared";
import type { IconComponent } from "../foundation/Icon";
import type { ChipTone } from "../foundation/Chip";
import type { FilterChipValue } from "./filters";

// ---------------------------------------------------------------------------------------------------------------------
// Saved views (DataTable)
// ---------------------------------------------------------------------------------------------------------------------

export interface SavedViewSort {
  id: string;
  desc: boolean;
}

/** `{id, name, columns, sort, filters}` per the assignment; `density` is optional sugar. */
export interface SavedView {
  id: string;
  name: string;
  /** Visible column ids in display order. */
  columns: string[];
  sort: SavedViewSort[];
  filters: FilterChipValue[];
  density?: TableDensity;
  /** Built-in views cannot be deleted or overwritten; "Save as" creates a copy. */
  builtIn?: boolean;
}

export type TableDensity = "compact" | "comfortable";

export const ROW_HEIGHT: Record<TableDensity, number> = { compact: 28, comfortable: 34 };

export interface RowAction<T> {
  id: string;
  label: string;
  icon?: IconComponent;
  onSelect: (row: T) => void;
  variant?: "default" | "danger";
  disabled?: boolean;
  shortcut?: string;
  /** Start a new group (separator before). */
  separatorBefore?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Entities (EntityLink, EntityText)
// ---------------------------------------------------------------------------------------------------------------------

export type EntityVerb = "message" | "assign_agent" | "add_to_list" | "open_profile";

export interface EntityRef {
  id: string;
  kind: EntityKind;
  name: string;
  href?: string;
}

export interface EntityFact {
  label: string;
  value: ReactNode;
}

export interface EntityChip {
  label: string;
  tone?: ChipTone;
  icon?: IconComponent;
}

export interface EntityAction {
  id: string;
  label: string;
  icon?: IconComponent;
  onSelect: (entity: EntityRef) => void;
  variant?: "default" | "primary" | "danger";
}

export type EntityPortrait =
  | { type: "agent"; seed: string | number; dept: DeptColourToken; status?: AgentStatus }
  | { type: "person"; src?: string }
  | {
      /** An organisation or business: its logo as a data URL, or the initials mark in `primary`. */
      type: "logo";
      src?: string | null;
      primary: string;
      monogram?: string;
    };

/** What the hover card shows (DESIGN §8 EntityLink): avatar/logo, name, chips, three facts, actions. */
export interface EntityDetails extends EntityRef {
  subtitle?: string;
  portrait?: EntityPortrait;
  chips?: EntityChip[];
  /** Up to three; extra facts are dropped. */
  facts?: EntityFact[];
  actions?: EntityAction[];
  /** Verbs the right-click menu offers. Default: all four. */
  verbs?: EntityVerb[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Skills and attributes
// ---------------------------------------------------------------------------------------------------------------------

export interface SkillRow {
  id: string;
  name: string;
  group: SkillGroup;
  /** Displayed rating 1–20. */
  value: number;
  /** Change since the previous version or training run; positive is good. */
  delta?: number;
  tested?: number;
  proven?: number;
  /** Live tasks exercising the skill (n in BUILD §11.10's blend). */
  tasks?: number;
  potential?: number;
  /** "Custom skill" or other note shown as a chip. */
  note?: string;
}

export interface AttributeRow {
  id: string;
  name: string;
  /** 1–20. */
  value: number;
  /** Evidence on hover: a sentence and optional sources. */
  evidence?: string | { summary: string; sources?: string[]; provenance?: "forecast" | "estimate" };
  /** Second value drawn as an outline marker (Compare view). */
  compare?: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------------------------------

export interface MetricDelta {
  /** The change; sign carries direction. */
  value: number;
  /** Format as a percentage of 1 (0.125 → 12.5%). */
  percent?: boolean;
  /** Which direction is good. Default "up". */
  goodWhen?: "up" | "down" | "neutral";
  /** "vs last week" */
  label?: string;
}

export interface MetricProvenance {
  /** Where the number comes from: "Stripe, invoices paid", "journey_daily". */
  source: string;
  asOf?: Date | string;
  /** Named query or formula, shown in mono. */
  query?: string;
  note?: string;
}

export type MetricValue = number | Money | string;

// ---------------------------------------------------------------------------------------------------------------------
// Widget grid
// ---------------------------------------------------------------------------------------------------------------------

export interface WidgetLayoutItem {
  /** Instance id (unique in the layout). */
  i: string;
  /** Registry key. */
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  settings?: Record<string, unknown>;
}

export type WidgetLayout = WidgetLayoutItem[];

export type WidgetSettingField =
  | { key: string; label: string; kind: "text"; placeholder?: string; hint?: string }
  | {
      key: string;
      label: string;
      kind: "number";
      min?: number;
      max?: number;
      step?: number;
      hint?: string;
    }
  | { key: string; label: string; kind: "boolean"; hint?: string }
  | {
      key: string;
      label: string;
      kind: "select";
      options: readonly { value: string; label: string }[];
      hint?: string;
    };

export interface WidgetRenderContext {
  item: WidgetLayoutItem;
  settings: Record<string, unknown>;
  editing: boolean;
  /** Pixel size of the cell, for charts. */
  size: { width: number; height: number };
}

export interface WidgetRegistryEntry {
  key: string;
  title: string;
  description?: string;
  icon?: IconComponent;
  /** Grid units: 12 columns, 8 px rows. */
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  /** Settings dialog fields; omit for widgets without settings. */
  settings?: readonly WidgetSettingField[];
  defaultSettings?: Record<string, unknown>;
  /** Widgets that may appear once per dashboard (Journey Ribbon). */
  single?: boolean;
  /** Only in LIVE mode, for example. */
  hidden?: boolean;
  /**
   * The widget draws its own panel (title, actions, states), so the grid adds no header or surface around it and each
   * widget shows one title. In edit mode the grid's controls (move, settings, remove) float over the widget's header.
   */
  framed?: boolean;
  render: (ctx: WidgetRenderContext) => ReactNode;
}

export interface WidgetPreset {
  id: string;
  name: string;
  description?: string;
  layout: WidgetLayout;
}
