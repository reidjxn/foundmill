import { useMemo } from "react";
import { FileCode, FileWarning } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatBytes, formatNumber } from "../../lib/format";
import { EmptyState } from "../foundation/EmptyState";
import { Icon } from "../foundation/Icon";
import { SkeletonText } from "../foundation/Skeleton";

export interface CodeViewerProps {
  /** Relative path, shown in the header. */
  path: string;
  /** File contents; null for a binary file. */
  text: string | null;
  /** Bytes on disk, shown in the header. */
  size?: number;
  binary?: boolean;
  /** Only the start of the file was sent. */
  truncated?: boolean;
  loading?: boolean;
  className?: string;
}

/**
 * A read-only source file: path and size on a header line, then the text on `bg-ink` in the mono face with line
 * numbers in a gutter that is not selected with the code. Binary files and partial files say so instead of guessing.
 * Two text nodes (gutter and code) keep a 20,000-line file cheap to render.
 */
export function CodeViewer({ path, text, size, binary, truncated, loading, className }: CodeViewerProps) {
  const lines = useMemo(() => (text === null ? 0 : text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length), [text]);
  const gutter = useMemo(() => Array.from({ length: Math.max(1, lines) }, (_, i) => i + 1).join("\n"), [lines]);
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-line bg-ink shadow-elev-1", className)} aria-label={`File ${path}`} data-code-viewer={path}>
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3">
        <Icon icon={FileCode} size="inline" className="text-secondary" />
        <span className="min-w-0 flex-1 truncate font-mono text-mono text-primary">{path}</span>
        {binary ? null : <span className="text-small tabular-nums text-secondary">{formatNumber(lines, { maxDigits: 0 })} lines</span>}
        {size !== undefined ? <span className="text-small tabular-nums text-secondary">{formatBytes(size)}</span> : null}
      </header>
      {loading ? (
        <SkeletonText lines={8} className="p-panel-pad" />
      ) : binary || text === null ? (
        <EmptyState icon={FileWarning} className="py-6">
          This is a binary file, so it is not shown as text.
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-auto" data-code-body data-scroll-region="code">
          <pre aria-hidden className="m-0 select-none border-r border-line-faint px-2.5 py-2 text-right font-mono text-mono text-tertiary/70">
            {gutter}
          </pre>
          <pre className="m-0 min-w-0 flex-1 px-3 py-2 font-mono text-mono text-primary">
            <code>{text}</code>
          </pre>
        </div>
      )}
      {truncated ? <footer className="shrink-0 border-t border-line px-3 py-1.5 text-small text-tertiary">Showing the first 1 MB of this file.</footer> : null}
    </section>
  );
}
