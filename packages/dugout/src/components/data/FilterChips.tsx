"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ListFilter, Plus, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Checkbox } from "../foundation/Checkbox";
import { useDateFormat } from "../foundation/DateFormatProvider";
import { Icon } from "../foundation/Icon";
import { Input } from "../foundation/Input";
import { Label } from "../foundation/Label";
import { Popover, PopoverContent, PopoverTrigger } from "../foundation/Popover";
import { SimpleSelect } from "../foundation/Select";
import {
  FILTER_OPS_BY_KIND,
  describeFilter,
  filterOpLabel,
  newFilterChipId,
  opTakesValue,
  type FilterChipValue,
  type FilterField,
  type FilterOp,
} from "./filters";

export interface FilterChipsProps {
  fields: readonly FilterField[];
  chips: readonly FilterChipValue[];
  onChange: (chips: FilterChipValue[]) => void;
  /** Hide the "Filter" add button (read-only chips, e.g. a saved view summary). */
  readOnly?: boolean;
  /** Label for the add button. */
  addLabel?: string;
  /** Shown when there are no chips and the control is read-only. */
  emptyText?: string;
  className?: string;
}

interface Draft {
  field: string;
  op: FilterOp;
  value: string;
  value2: string;
  list: string[];
  bool: boolean;
}

function draftFrom(chip: FilterChipValue | null, fields: readonly FilterField[]): Draft {
  const field = chip ? fields.find((f) => f.id === chip.field) : fields[0];
  const kind = field?.kind ?? "text";
  const op = chip?.op ?? (FILTER_OPS_BY_KIND[kind][0] as FilterOp);
  const v = chip?.value;
  return {
    field: field?.id ?? "",
    op,
    value: Array.isArray(v)
      ? String((v as readonly unknown[])[0] ?? "")
      : v === undefined || typeof v === "boolean"
        ? ""
        : String(v),
    value2: Array.isArray(v) ? String((v as readonly unknown[])[1] ?? "") : "",
    list: Array.isArray(v)
      ? (v as readonly unknown[]).map(String)
      : typeof v === "string" && kind === "select"
        ? [v]
        : [],
    bool: v === true || v === "true",
  };
}

function chipFrom(
  id: string,
  draft: Draft,
  fields: readonly FilterField[],
): FilterChipValue | null {
  const field = fields.find((f) => f.id === draft.field);
  if (!field) return null;
  const base = { id, field: field.id, op: draft.op };
  if (!opTakesValue(draft.op)) return base;
  switch (field.kind) {
    case "boolean":
      return { ...base, op: "eq", value: draft.bool };
    case "number": {
      if (draft.op === "between") {
        const a = Number(draft.value);
        const b = Number(draft.value2);
        if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
        return { ...base, value: [Number.isFinite(a) ? a : "", Number.isFinite(b) ? b : ""] };
      }
      const n = Number(draft.value);
      return Number.isFinite(n) && draft.value.trim() !== "" ? { ...base, value: n } : null;
    }
    case "date":
      if (draft.op === "between")
        return draft.value || draft.value2 ? { ...base, value: [draft.value, draft.value2] } : null;
      return draft.value ? { ...base, value: draft.value } : null;
    case "select":
      if (draft.op === "in") return draft.list.length > 0 ? { ...base, value: draft.list } : null;
      return draft.value ? { ...base, value: draft.value } : null;
    default:
      return draft.value.trim() !== "" ? { ...base, value: draft.value } : null;
  }
}

export interface FilterChipEditorProps {
  fields: readonly FilterField[];
  /** Existing chip to edit; null for a new one. */
  chip: FilterChipValue | null;
  onSubmit: (chip: FilterChipValue) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/** The chip editor form: field, operator, value(s). Enter applies, Esc cancels (handled by the popover). */
export function FilterChipEditor({
  fields,
  chip,
  onSubmit,
  onCancel,
  onDelete,
}: FilterChipEditorProps) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(chip, fields));
  useEffect(() => setDraft(draftFrom(chip, fields)), [chip, fields]);
  const field = fields.find((f) => f.id === draft.field);
  const kind = field?.kind ?? "text";
  const ops = FILTER_OPS_BY_KIND[kind];
  const result = chipFrom(chip?.id ?? "draft", draft, fields);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!result) return;
    onSubmit({ ...result, id: chip?.id ?? newFilterChipId() });
  };

  const setField = (fieldId: string) => {
    const next = fields.find((f) => f.id === fieldId);
    const nextKind = next?.kind ?? "text";
    setDraft({
      field: fieldId,
      op: FILTER_OPS_BY_KIND[nextKind][0] as FilterOp,
      value: "",
      value2: "",
      list: [],
      bool: true,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2"
      aria-label={chip ? "Edit filter" : "New filter"}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-field`}>Field</Label>
          <SimpleSelect
            id={`${id}-field`}
            controlSize="sm"
            value={draft.field}
            onValueChange={setField}
            options={fields.map((f) => ({ value: f.id, label: f.label }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-op`}>Condition</Label>
          <SimpleSelect
            id={`${id}-op`}
            controlSize="sm"
            value={draft.op}
            onValueChange={(op) => setDraft((d) => ({ ...d, op: op as FilterOp }))}
            options={ops.map((op) => ({ value: op, label: filterOpLabel(op) }))}
          />
        </div>
      </div>
      {opTakesValue(draft.op) ? (
        kind === "boolean" ? (
          <SimpleSelect
            aria-label="Value"
            controlSize="sm"
            value={draft.bool ? "true" : "false"}
            onValueChange={(v) => setDraft((d) => ({ ...d, bool: v === "true" }))}
            options={[
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]}
          />
        ) : kind === "select" && draft.op === "in" ? (
          <fieldset className="surface-well flex max-h-48 flex-col gap-1 overflow-y-auto rounded-sm p-2">
            <legend className="sr-only">Values</legend>
            {(field?.options ?? []).map((o) => {
              const checked = draft.list.includes(o.value);
              const cid = `${id}-opt-${o.value}`;
              return (
                <label
                  key={o.value}
                  htmlFor={cid}
                  className="flex h-6 cursor-pointer items-center gap-2 text-body"
                >
                  <Checkbox
                    id={cid}
                    checked={checked}
                    onCheckedChange={(c) =>
                      setDraft((d) => ({
                        ...d,
                        list:
                          c === true ? [...d.list, o.value] : d.list.filter((x) => x !== o.value),
                      }))
                    }
                  />
                  {o.label}
                </label>
              );
            })}
          </fieldset>
        ) : kind === "select" ? (
          <SimpleSelect
            aria-label="Value"
            controlSize="sm"
            value={draft.value}
            onValueChange={(v) => setDraft((d) => ({ ...d, value: v }))}
            options={(field?.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Choose…"
          />
        ) : (
          <div className={cn("grid gap-2", draft.op === "between" ? "grid-cols-2" : "grid-cols-1")}>
            <Input
              aria-label={draft.op === "between" ? "From" : "Value"}
              controlSize="sm"
              type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
              numeric={kind === "number"}
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
              autoFocus
            />
            {draft.op === "between" ? (
              <Input
                aria-label="To"
                controlSize="sm"
                type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
                numeric={kind === "number"}
                value={draft.value2}
                onChange={(e) => setDraft((d) => ({ ...d, value2: e.target.value }))}
              />
            ) : null}
          </div>
        )
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-1">
        {onDelete ? (
          <Button size="sm" variant="ghost" onClick={onDelete} icon={X}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!result}>
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * A row of filter chips with a chip editor (BUILD §5.4 "filter chips above", §11.12 editable chips). Click a chip to
 * edit it, its × to remove it, "Filter" to add one. Each chip reads "Field · condition · value" so colour is not a
 * signal here at all.
 */
export function FilterChips({
  fields,
  chips,
  onChange,
  readOnly,
  addLabel = "Filter",
  emptyText,
  className,
}: FilterChipsProps) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const datePrefs = useDateFormat();
  const editingChip =
    editing && editing !== "new" ? (chips.find((c) => c.id === editing) ?? null) : null;

  const upsert = (chip: FilterChipValue) => {
    const exists = chips.some((c) => c.id === chip.id);
    onChange(exists ? chips.map((c) => (c.id === chip.id ? chip : c)) : [...chips, chip]);
    setEditing(null);
  };
  const remove = (id: string) => {
    onChange(chips.filter((c) => c.id !== id));
    setEditing(null);
  };

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="group"
      aria-label="Filters"
      data-filter-chips
    >
      {chips.length === 0 && readOnly && emptyText ? (
        <span className="text-small text-secondary">{emptyText}</span>
      ) : null}
      {chips.map((chip) => {
        const d = describeFilter(chip, fields, datePrefs);
        const text = `${d.field} ${d.op}${d.value ? ` ${d.value}` : ""}`;
        const body = (
          <span className="inline-flex max-w-full items-center gap-1">
            <span className="t-data shrink-0 text-secondary">{d.field}</span>
            <span className="shrink-0 text-small text-tertiary">{d.op}</span>
            {/* The value wraps instead of being cut (a number in a filter is never truncated). */}
            {d.value ? <span className="break-words text-small font-medium text-primary">{d.value}</span> : null}
          </span>
        );
        const chipEl = (
          <span
            data-filter-chip={chip.id}
            className={cn(
              "chip-plate inline-flex max-w-full items-center gap-1 rounded-sm border py-px pl-2 pr-2",
              readOnly ? "min-h-chip" : "min-h-target pr-0.5",
            )}
          >
            {readOnly ? (
              body
            ) : (
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex max-w-full items-center rounded-xs text-left transition-colors hover:text-primary focus-visible:shadow-ring"
                  aria-label={`Edit filter: ${text}`}
                >
                  {body}
                </button>
              </PopoverTrigger>
            )}
            {!readOnly ? (
              <button
                type="button"
                aria-label={`Remove filter: ${text}`}
                onClick={() => remove(chip.id)}
                className="inline-flex size-badge shrink-0 items-center justify-center rounded-xs text-tertiary transition-colors hover:bg-white/8 hover:text-primary focus-visible:shadow-ring"
              >
                <Icon icon={X} size={10} strokeWidth={2.25} />
              </button>
            ) : null}
          </span>
        );
        if (readOnly) return <span key={chip.id}>{chipEl}</span>;
        return (
          <Popover
            key={chip.id}
            open={editing === chip.id}
            onOpenChange={(o) => setEditing(o ? chip.id : null)}
          >
            {chipEl}
            <PopoverContent className="w-80">
              <FilterChipEditor
                fields={fields}
                chip={editingChip?.id === chip.id ? editingChip : chip}
                onSubmit={upsert}
                onCancel={() => setEditing(null)}
                onDelete={() => remove(chip.id)}
              />
            </PopoverContent>
          </Popover>
        );
      })}
      {!readOnly ? (
        <Popover open={editing === "new"} onOpenChange={(o) => setEditing(o ? "new" : null)}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              icon={chips.length === 0 ? ListFilter : Plus}
              className="h-chip px-1.5 text-label"
              aria-label={addLabel}
            >
              {addLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <FilterChipEditor
              fields={fields}
              chip={null}
              onSubmit={upsert}
              onCancel={() => setEditing(null)}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
