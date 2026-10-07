/**
 * Filter chips model (BUILD §5.4 DataTable "filter chips", §11.12 "natural-language filters → editable chips").
 * Pure: chips are data, `matchesFilter` is the predicate DataTable's filterFn and tests share.
 */

export type FilterFieldKind = "text" | "number" | "select" | "date" | "boolean";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterField {
  /** Column id. */
  id: string;
  label: string;
  kind: FilterFieldKind;
  /** For `select`. */
  options?: readonly FilterOption[];
}

export type FilterOp =
  | "contains"
  | "not_contains"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "in"
  | "is_empty"
  | "not_empty"
  | "before"
  | "after"
  | "on";

export interface FilterChipValue {
  id: string;
  field: string;
  op: FilterOp;
  /** Scalar, or `[from, to]` for `between`, or a list for `in`. Omitted for the empty/not-empty ops. */
  value?: string | number | boolean | readonly (string | number)[];
}

export const FILTER_OPS_BY_KIND: Record<FilterFieldKind, readonly FilterOp[]> = {
  text: ["contains", "not_contains", "eq", "neq", "is_empty", "not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"],
  select: ["in", "eq", "neq", "is_empty", "not_empty"],
  date: ["on", "before", "after", "between", "is_empty", "not_empty"],
  boolean: ["eq"],
};

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  contains: "contains",
  not_contains: "does not contain",
  eq: "is",
  neq: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
  in: "is any of",
  is_empty: "is empty",
  not_empty: "is not empty",
  before: "before",
  after: "after",
  on: "on",
};

export function filterOpLabel(op: FilterOp): string {
  return FILTER_OP_LABELS[op];
}

/** Does the op take a value input? */
export function opTakesValue(op: FilterOp): boolean {
  return op !== "is_empty" && op !== "not_empty";
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v !== null && "amountMinor" in (v as Record<string, unknown>))
    return (v as { amountMinor: number }).amountMinor;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

function asDay(v: unknown): number | null {
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? null
      : Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? null
      : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return null;
}

function asText(v: unknown): string {
  if (isEmpty(v)) return "";
  if (typeof v === "object" && v !== null && "name" in (v as Record<string, unknown>))
    return String((v as { name: unknown }).name);
  return String(v).toLowerCase();
}

/** The predicate: does a cell value satisfy the chip? Unknown ops never match. */
export function matchesFilter(
  cell: unknown,
  chip: Pick<FilterChipValue, "op" | "value">,
  kind: FilterFieldKind = "text",
): boolean {
  const { op, value } = chip;
  if (op === "is_empty") return isEmpty(cell);
  if (op === "not_empty") return !isEmpty(cell);

  if (kind === "boolean") {
    const want = value === true || value === "true";
    return Boolean(cell) === want;
  }

  if (kind === "number") {
    const n = asNumber(cell);
    if (op === "between") {
      const [lo, hi] = Array.isArray(value) ? value : [];
      const a = asNumber(lo);
      const b = asNumber(hi);
      return n !== null && (a === null || n >= a) && (b === null || n <= b);
    }
    const target = asNumber(value as string | number);
    if (n === null || target === null) return false;
    switch (op) {
      case "eq":
        return n === target;
      case "neq":
        return n !== target;
      case "gt":
        return n > target;
      case "gte":
        return n >= target;
      case "lt":
        return n < target;
      case "lte":
        return n <= target;
      default:
        return false;
    }
  }

  if (kind === "date") {
    const d = asDay(cell);
    if (op === "between") {
      const [lo, hi] = Array.isArray(value) ? value : [];
      const a = asDay(lo);
      const b = asDay(hi);
      return d !== null && (a === null || d >= a) && (b === null || d <= b);
    }
    const target = asDay(value as string | number);
    if (d === null || target === null) return false;
    switch (op) {
      case "on":
        return d === target;
      case "before":
        return d < target;
      case "after":
        return d > target;
      default:
        return false;
    }
  }

  if (kind === "select") {
    const text = isEmpty(cell) ? "" : String(cell);
    if (op === "in") {
      const list = Array.isArray(value)
        ? value.map(String)
        : value === undefined
          ? []
          : [String(value)];
      return list.length === 0 ? true : list.includes(text);
    }
    if (op === "eq") return text === String(value ?? "");
    if (op === "neq") return text !== String(value ?? "");
    return false;
  }

  const text = asText(cell);
  const needle = String(value ?? "").toLowerCase();
  switch (op) {
    case "contains":
      return needle === "" ? true : text.includes(needle);
    case "not_contains":
      return needle === "" ? true : !text.includes(needle);
    case "eq":
      return text === needle;
    case "neq":
      return text !== needle;
    default:
      return false;
  }
}

/** Every chip for a field must match (AND). Chips for fields not in `row` compare against undefined. */
export function matchesAllFilters<T extends Record<string, unknown>>(
  row: T,
  chips: readonly FilterChipValue[],
  fields: readonly FilterField[],
): boolean {
  for (const chip of chips) {
    const field = fields.find((f) => f.id === chip.field);
    if (!matchesFilter(row[chip.field], chip, field?.kind ?? "text")) return false;
  }
  return true;
}

/** Human text for a chip: "Stage is any of Qualified, Proposal". */
export function describeFilter(
  chip: FilterChipValue,
  fields: readonly FilterField[],
): { field: string; op: string; value: string } {
  const field = fields.find((f) => f.id === chip.field);
  const label = field?.label ?? chip.field;
  const op = filterOpLabel(chip.op);
  if (!opTakesValue(chip.op)) return { field: label, op, value: "" };
  const name = (v: string | number | boolean): string => {
    if (field?.kind === "select")
      return field.options?.find((o) => o.value === String(v))?.label ?? String(v);
    if (field?.kind === "boolean") return v === true || v === "true" ? "yes" : "no";
    return String(v);
  };
  const v = chip.value;
  if (Array.isArray(v)) {
    const list = v as readonly (string | number)[];
    return {
      field: label,
      op,
      value:
        chip.op === "between"
          ? `${name(list[0] ?? "")} and ${name(list[1] ?? "")}`
          : list.map(name).join(", "),
    };
  }
  return { field: label, op, value: v === undefined ? "" : name(v as string | number | boolean) };
}

let chipSeq = 0;
/** Stable-enough ids for new chips (tests may pass their own). */
export function newFilterChipId(): string {
  chipSeq += 1;
  return `f${Date.now().toString(36)}${chipSeq}`;
}
