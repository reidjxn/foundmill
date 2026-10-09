"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Columns2, Pencil, Rows3, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { StatusPill } from "../foundation/StatusPill";
import { Textarea } from "../foundation/Textarea";
import {
  applyDecisions,
  buildHunks,
  diffLines,
  hunkHeader,
  hunkSides,
  summariseDiff,
  threeWay,
  type DiffLine,
  type Hunk,
  type HunkDecisionState,
  type HunkDecisions,
  type ThreeWayHunk,
  type ThreeWayRow,
} from "./diff";

export type DiffMode = "inline" | "side-by-side";

export interface DiffViewProps {
  /** The current text (ours). */
  original: string;
  /** The proposed text (theirs). */
  proposed: string;
  /** Common ancestor: when given, hunks show base / ours / theirs and flag conflicts (BUILD §11.5 three-way). */
  base?: string;
  mode?: DiffMode;
  defaultMode?: DiffMode;
  onModeChange?: (mode: DiffMode) => void;
  /** Per-hunk decisions keyed by hunk id (`h0`, `h1`, …). Controlled when given with `onDecision`. */
  decisions?: HunkDecisions;
  onDecision?: (hunkId: string, state: HunkDecisionState, merged: string) => void;
  /** Hide the accept/reject/edit controls. */
  readOnly?: boolean;
  contextLines?: number;
  /** Shown in the header (block title, file name). */
  title?: ReactNode;
  /** Labels for the two sides. Default "Current" / "Proposed". */
  labels?: { original?: string; proposed?: string; base?: string };
  className?: string;
  /** Max body height in px before the diff scrolls. Default none. */
  maxHeight?: number;
}

const LINE_CLASS: Record<DiffLine["kind"], string> = {
  equal: "text-primary",
  insert: "bg-status-good/10 text-primary diff-edge-add",
  delete: "bg-status-bad/10 text-secondary diff-edge-del",
};
/** The sign column's colour per kind. */
const SIGN_CLASS: Record<DiffLine["kind"], string> = { equal: "text-tertiary", insert: "text-status-good", delete: "text-status-bad" };
const SIGN: Record<DiffLine["kind"], string> = { equal: " ", insert: "+", delete: "−" };

function Gutter({ n }: { n: number | undefined }) {
  return (
    <span className="w-10 shrink-0 select-none pr-2 text-right text-tertiary/80 tabular-nums">
      {n ?? ""}
    </span>
  );
}

/** An empty cell on the side a line does not exist on (side by side): a faint hatch, so the gap reads as absent. */
function Absent() {
  return <div className="diff-absent min-h-4.5 min-w-0" aria-hidden />;
}

/**
 * One diff line. Lines wrap (pre-wrap, breaking long words) inside their own cell, so the columns of a side-by-side or
 * three-way diff can never print over each other.
 */
function Line({ line, side }: { line: DiffLine; side?: "old" | "new" }) {
  const hiddenOnSide =
    side === "old" ? line.kind === "insert" : side === "new" ? line.kind === "delete" : false;
  if (hiddenOnSide) return <Absent />;
  return (
    <div
      className={cn("flex min-h-4.5 min-w-0 whitespace-pre-wrap break-words font-mono text-mono", LINE_CLASS[line.kind])}
      data-kind={line.kind}
    >
      {side !== "new" ? <Gutter n={line.oldLine} /> : null}
      {side !== "old" ? <Gutter n={line.newLine} /> : null}
      <span className={cn("w-4 shrink-0 select-none text-center", SIGN_CLASS[line.kind])} aria-hidden>
        {SIGN[line.kind]}
      </span>
      <span className="sr-only">
        {line.kind === "insert" ? "added: " : line.kind === "delete" ? "removed: " : ""}
      </span>
      <span className="min-w-0 flex-1 pr-3">{line.text || " "}</span>
    </div>
  );
}

function DecisionPill({ decision }: { decision: HunkDecisionState["decision"] }) {
  switch (decision) {
    case "accepted":
      return (
        <StatusPill tone="good" icon={Check}>
          Accepted
        </StatusPill>
      );
    case "rejected":
      return (
        <StatusPill tone="bad" icon={X}>
          Rejected
        </StatusPill>
      );
    case "edited":
      return (
        <StatusPill tone="info" icon={Pencil}>
          Edited
        </StatusPill>
      );
    default:
      return <StatusPill tone="neutral">Pending</StatusPill>;
  }
}

interface HunkControlsProps {
  state: HunkDecisionState;
  onDecide: (s: HunkDecisionState) => void;
  onEdit: () => void;
  editing: boolean;
}

function HunkControls({ state, onDecide, onEdit, editing }: HunkControlsProps) {
  const d = state.decision;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Hunk decision">
      <Button
        size="sm"
        variant={d === "accepted" ? "primary" : "ghost"}
        icon={Check}
        aria-pressed={d === "accepted"}
        onClick={() => onDecide({ decision: d === "accepted" ? "pending" : "accepted" })}
      >
        Accept
      </Button>
      <Button
        size="sm"
        variant={d === "rejected" ? "danger" : "ghost"}
        icon={X}
        aria-pressed={d === "rejected"}
        onClick={() => onDecide({ decision: d === "rejected" ? "pending" : "rejected" })}
      >
        Reject
      </Button>
      <Button
        size="sm"
        variant={editing || d === "edited" ? "default" : "ghost"}
        icon={Pencil}
        aria-pressed={editing}
        onClick={onEdit}
      >
        Edit
      </Button>
    </div>
  );
}

function HunkEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface-1 p-2.5">
      <Textarea
        mono
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(16, Math.max(3, initial.split("\n").length + 1))}
        aria-label="Edit this hunk"
        autoFocus
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={Check} onClick={() => onSave(text)}>
          Use this text
        </Button>
      </div>
    </div>
  );
}

/**
 * DiffView (BUILD §5.4, §11.5): inline or side-by-side line diff on `bg-ink`, per-hunk Accept / Reject / Edit with an
 * inline editor, and a three-way base / ours / theirs display when `base` is given. Decisions are plain data
 * (`HunkDecisions`) and `onDecision` also receives the merged text so a caller can save a new version.
 */
export function DiffView({
  original,
  proposed,
  base,
  mode: modeProp,
  defaultMode = "inline",
  onModeChange,
  decisions: decisionsProp,
  onDecision,
  readOnly,
  contextLines = 3,
  title,
  labels,
  className,
  maxHeight,
}: DiffViewProps) {
  const [modeState, setModeState] = useState<DiffMode>(defaultMode);
  const mode = modeProp ?? modeState;
  const setMode = (m: DiffMode) => {
    setModeState(m);
    onModeChange?.(m);
  };
  const [decisionsState, setDecisionsState] = useState<HunkDecisions>(decisionsProp ?? {});
  useEffect(() => {
    if (decisionsProp) setDecisionsState(decisionsProp);
  }, [decisionsProp]);
  const decisions = decisionsProp ?? decisionsState;
  const [editing, setEditing] = useState<string | null>(null);

  const ops = useMemo(() => diffLines(original, proposed), [original, proposed]);
  const hunks = useMemo(() => buildHunks(ops, contextLines), [ops, contextLines]);
  const three = useMemo(
    () => (base !== undefined ? threeWay(base, original, proposed, contextLines) : null),
    [base, original, proposed, contextLines],
  );
  const summary = summariseDiff(hunks, decisions);

  const decide = (h: Hunk, state: HunkDecisionState) => {
    const next = { ...decisions, [h.id]: state };
    if (!decisionsProp) setDecisionsState(next);
    onDecision?.(h.id, state, applyDecisions(ops, hunks, next));
    setEditing(null);
  };

  const labelOld = labels?.original ?? "Current";
  const labelNew = labels?.proposed ?? "Proposed";
  const labelBase = labels?.base ?? "Base";

  return (
    <div
      className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", className)}
      data-diff-view
      data-mode={mode}
    >
      <header className="flex min-h-panel-header shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-panel-pad py-1.5 rule-fade">
        {title ? (
          <h3 className="t-title min-w-0 flex-1 break-words text-primary">{title}</h3>
        ) : (
          <span className="flex-1" />
        )}
        <span className="flex flex-wrap items-center gap-x-1.5 font-mono text-micro tabular-nums">
          <span className="text-status-good">+{summary.added}</span>
          <span className="text-status-bad">−{summary.removed}</span>
          <span className="text-tertiary">
            · {summary.hunks} {summary.hunks === 1 ? "hunk" : "hunks"}
          </span>
          {!readOnly && summary.hunks > 0 ? (
            <span className="text-tertiary">
              · {summary.accepted} accepted, {summary.rejected} rejected
              {summary.edited ? `, ${summary.edited} edited` : ""}, {summary.pending} pending
            </span>
          ) : null}
        </span>
        {three ? null : (
          <div role="radiogroup" aria-label="Diff layout" className="seg-track ml-1 h-control-sm">
            {(
              [
                { m: "inline", label: "Inline", icon: Rows3 },
                { m: "side-by-side", label: "Side by side", icon: Columns2 },
              ] as const
            ).map((o) => (
              <button
                key={o.m}
                type="button"
                role="radio"
                aria-checked={mode === o.m}
                onClick={() => setMode(o.m)}
                className={cn("seg-item font-body text-action-sm font-medium focus-visible:shadow-ring", mode === o.m && "tile-tab-on text-primary")}
              >
                <Icon icon={o.icon} size="inline" />
                {o.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="min-w-0 overflow-auto bg-ink" style={maxHeight ? { maxHeight } : undefined}>
        {hunks.length === 0 && !three ? (
          <p className="p-panel-pad text-body text-secondary">No differences.</p>
        ) : null}
        {three
          ? three.map((h) => (
              <ThreeWayHunkView
                key={h.id}
                hunk={h}
                labels={{ base: labelBase, ours: labelOld, theirs: labelNew }}
              />
            ))
          : hunks.map((h) => {
              const state = decisions[h.id] ?? { decision: "pending" as const };
              const isEditing = editing === h.id;
              return (
                <section
                  key={h.id}
                  data-hunk={h.id}
                  data-decision={state.decision}
                  aria-label={`Hunk ${h.index + 1}`}
                  className="border-b border-line last:border-b-0"
                >
                  <div className="flex min-h-control-lg flex-wrap items-center gap-2 border-b border-line-faint bg-surface-1/70 px-2.5 py-1">
                    <span className="font-mono text-micro text-tertiary">{hunkHeader(h)}</span>
                    <DecisionPill decision={state.decision} />
                    <span className="flex-1" />
                    {!readOnly ? (
                      <HunkControls
                        state={state}
                        editing={isEditing}
                        onDecide={(s) => decide(h, s)}
                        onEdit={() => setEditing(isEditing ? null : h.id)}
                      />
                    ) : null}
                  </div>
                  {mode === "side-by-side" ? (
                    // Row by row, so a wrapped line keeps its partner level with it; each cell is min-w-0.
                    <div className="grid grid-cols-2 divide-x divide-line" data-diff-columns="2">
                      <p className="t-data px-2.5 py-1">{labelOld}</p>
                      <p className="t-data px-2.5 py-1">{labelNew}</p>
                      {h.lines.map((l) => (
                        <Fragment key={l.key}>
                          <Line line={l} side="old" />
                          <Line line={l} side="new" />
                        </Fragment>
                      ))}
                    </div>
                  ) : (
                    <div className={cn(state.decision === "rejected" && "opacity-70")}>
                      {h.lines.map((l) => (
                        <Line key={l.key} line={l} />
                      ))}
                    </div>
                  )}
                  {state.decision === "edited" && state.text !== undefined && !isEditing ? (
                    <div className="border-t border-line bg-surface-1/50 p-2.5">
                      <p className="t-data mb-1">Edited text</p>
                      <pre className="whitespace-pre-wrap font-mono text-mono text-primary">
                        {state.text}
                      </pre>
                    </div>
                  ) : null}
                  {isEditing ? (
                    <HunkEditor
                      initial={state.text ?? hunkSides(h).newText}
                      onSave={(text) => decide(h, { decision: "edited", text })}
                      onCancel={() => setEditing(null)}
                    />
                  ) : null}
                </section>
              );
            })}
      </div>
    </div>
  );
}

const CELL_CLASS: Record<ThreeWayRow["oursKind"], string> = {
  equal: "text-primary",
  changed: "bg-status-warn/10 text-primary diff-edge-change",
  added: "bg-status-good/10 text-primary diff-edge-add",
  missing: "bg-status-bad/10 text-secondary diff-edge-del",
};

function ThreeWayHunkView({
  hunk,
  labels,
}: {
  hunk: ThreeWayHunk;
  labels: { base: string; ours: string; theirs: string };
}) {
  return (
    <section
      data-hunk={hunk.id}
      data-conflict={hunk.conflict || undefined}
      aria-label={`Hunk ${hunk.index + 1}${hunk.conflict ? ", conflict" : ""}`}
      className="border-b border-line last:border-b-0"
    >
      <div className="flex min-h-control-lg flex-wrap items-center gap-2 border-b border-line-faint bg-surface-1/70 px-2.5 py-1">
        <span className="font-mono text-micro text-tertiary">
          @@ base {hunk.baseStart}
          {hunk.baseEnd >= hunk.baseStart ? `–${hunk.baseEnd}` : ""} @@
        </span>
        {hunk.conflict ? (
          <StatusPill tone="warn">Conflict</StatusPill>
        ) : (
          <Chip tone="neutral">
            {hunk.oursChanged && hunk.theirsChanged
              ? "Both changed, same result"
              : hunk.oursChanged
                ? `${labels.ours} changed`
                : `${labels.theirs} changed`}
          </Chip>
        )}
      </div>
      {/* Row by row in three min-w-0 columns: each cell wraps its own text, so a long line can never print over the
          next column, and a row's three cells stay level. */}
      <div className="grid grid-cols-3 divide-x divide-line" data-diff-columns="3">
        {(["base", "ours", "theirs"] as const).map((col) => (
          <p key={col} className="t-data min-w-0 px-2.5 py-1">
            {labels[col]}
          </p>
        ))}
        {hunk.rows.map((r, i) =>
          (["base", "ours", "theirs"] as const).map((col) => {
            const kind =
              col === "base" ? ("equal" as const) : col === "ours" ? r.oursKind : r.theirsKind;
            const text = col === "base" ? r.base : col === "ours" ? r.ours : r.theirs;
            const show =
              col === "base"
                ? r.baseLine !== undefined
                : kind !== "missing" && text !== undefined;
            return show ? (
              <div
                key={`${i}-${col}`}
                className={cn("flex min-h-4.5 min-w-0 whitespace-pre-wrap break-words font-mono text-mono", CELL_CLASS[kind])}
                data-kind={kind}
                data-col={col}
              >
                <Gutter n={col === "base" ? r.baseLine : undefined} />
                <span className="min-w-0 flex-1 pr-3">{text || " "}</span>
              </div>
            ) : (
              <div key={`${i}-${col}`} className="diff-absent min-h-4.5 min-w-0" data-kind={kind} data-col={col} aria-hidden />
            );
          }),
        )}
      </div>
    </section>
  );
}
