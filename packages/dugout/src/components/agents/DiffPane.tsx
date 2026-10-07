import { Component, Suspense, lazy, useMemo, useState, type ReactNode } from "react";
import { Columns2, FileCode2, FileMinus2, FilePen, FilePlus2, Rows3 } from "lucide-react";
import { cn } from "../../lib/cn";
import { DiffView } from "../data/DiffView";
import { Button } from "../foundation/Button";
import { EmptyState } from "../foundation/EmptyState";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Skeleton } from "../foundation/Skeleton";
import { languageForPath, splitUnifiedDiff } from "./progress";
import type { FileChange } from "./types";

const MonacoDiff = lazy(() => import("./MonacoDiff"));

const CHANGE_ICON: Record<FileChange["change"], IconComponent> = { created: FilePlus2, modified: FilePen, deleted: FileMinus2, renamed: FileCode2 };
const CHANGE_WORD: Record<FileChange["change"], string> = { created: "Created", modified: "Modified", deleted: "Deleted", renamed: "Renamed" };

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}
class LoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface DiffPaneProps {
  files: readonly FileChange[];
  /** Selected path (controlled). Defaults to the most recently changed file. */
  selectedPath?: string;
  onSelectPath?: (path: string) => void;
  /** `monaco` (default) lazy-loads the Monaco DiffEditor; `local` uses Dugout's own DiffView (also the fallback). */
  engine?: "monaco" | "local";
  /** Hide the file list (very small tiles). */
  hideFiles?: boolean;
  className?: string;
}

/**
 * Diff body of an AgentTile: a file list with +/− counts and a Monaco DiffEditor (dark ink theme, lazy chunk) for the
 * selected file, rebuilt from the session's unified diff. Falls back to the local DiffView when Monaco cannot load.
 */
export function DiffPane({ files, selectedPath, onSelectPath, engine = "monaco", hideFiles, className }: DiffPaneProps) {
  const [internal, setInternal] = useState<string | undefined>(undefined);
  const [sideBySide, setSideBySide] = useState(false);
  const latest = files[files.length - 1]?.path;
  const current = selectedPath ?? internal ?? latest;
  const file = files.find((f) => f.path === current) ?? files[files.length - 1];
  const split = useMemo(() => (file?.diff ? splitUnifiedDiff(file.diff) : null), [file]);
  const select = (p: string) => {
    setInternal(p);
    onSelectPath?.(p);
  };

  if (files.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center bg-ink", className)}>
        <EmptyState icon={FileCode2}>No files changed yet. Diffs appear as the agent edits its worktree.</EmptyState>
      </div>
    );
  }

  const local = split ? (
    <DiffView original={split.original} proposed={split.modified} readOnly mode={sideBySide ? "side-by-side" : "inline"} title={file?.path} labels={{ original: "Before", proposed: "After" }} className="h-full rounded-none border-0" />
  ) : null;

  return (
    <div className={cn("flex h-full min-h-0 bg-ink", className)} data-diff-pane>
      {!hideFiles ? (
        <nav aria-label="Changed files" className="flex w-52 shrink-0 flex-col border-r border-subtle bg-panel">
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {files.map((f) => {
              const active = f.path === file?.path;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => select(f.path)}
                    title={`${CHANGE_WORD[f.change]} · ${f.path}`}
                    className={cn(
                      "flex h-row-compact w-full items-center gap-1.5 px-2 text-left text-small text-primary hover:bg-white/4",
                      active && "border-l-3 border-kit-primary bg-white/4 pl-1.5",
                    )}
                  >
                    <Icon icon={CHANGE_ICON[f.change]} size="inline" className="text-secondary" label={CHANGE_WORD[f.change]} />
                    <span className="min-w-0 flex-1 truncate font-mono text-mono">{f.path.split("/").pop()}</span>
                    <span className="shrink-0 font-mono text-mono tabular-nums">
                      <span className="text-status-good">+{f.additions}</span> <span className="text-status-bad">−{f.deletions}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex h-panel-header items-center justify-between border-t border-subtle px-2 text-small text-secondary">
            <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
            <div role="radiogroup" aria-label="Diff layout" className="flex gap-0.5">
              <Button size="sm" variant={sideBySide ? "ghost" : "default"} icon={Rows3} role="radio" aria-checked={!sideBySide} onClick={() => setSideBySide(false)} className="h-6 px-1" aria-label="Inline" />
              <Button size="sm" variant={sideBySide ? "default" : "ghost"} icon={Columns2} role="radio" aria-checked={sideBySide} onClick={() => setSideBySide(true)} className="h-6 px-1" aria-label="Side by side" />
            </div>
          </div>
        </nav>
      ) : null}
      <div className="min-w-0 flex-1">
        {!file?.diff || !split ? (
          <EmptyState icon={FileCode2}>Diff not available for {file?.path ?? "this file"}: the file is large or binary.</EmptyState>
        ) : engine === "local" ? (
          local
        ) : (
          <LoadBoundary fallback={local}>
            <Suspense fallback={<Skeleton className="m-2 h-3 w-1/2" />}>
              <MonacoDiff original={split.original} modified={split.modified} language={languageForPath(file.path)} sideBySide={sideBySide} label={`Diff of ${file.path}`} />
            </Suspense>
          </LoadBoundary>
        )}
      </div>
    </div>
  );
}
