"use client";
/**
 * One on-brand error surface for route errors and unreachable services. The founder reads one plain line; a
 * technical message (a runtime error, a network code, a driver message, a chunk that failed to load) never takes that
 * line: it goes behind the Details disclosure, where it still helps whoever fixes it.
 */
import { Lock } from "lucide-react";
import { EmptyState, ErrorState, Panel } from "@foundmill/dugout";
import { NO_ACCESS_PREFIX } from "@/lib/trpc";

export interface ErrorPanelProps {
  title?: string;
  /** Word in the status pill. Default "Error". */
  label?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

const TECHNICAL = /\b(TypeError|ReferenceError|SyntaxError|RangeError|ChunkLoadError|[Cc]hunks?|is not a function|is not defined|Cannot read|undefined|null|NaN|ECONN\w*|ETIMEDOUT|ENOTFOUND|fetch failed|Failed to fetch|NetworkError|Unexpected token|JSON|stack|enableOfflineQueue|writeable|TRPC|tRPC|INTERNAL_SERVER_ERROR|status code|\d{3} \w+Error)\b|=>|\(\)|\w+\.\w+\(|[{}<>]/;

/** A message fit to show as the one line: short, and not a runtime or transport error. */
export function isPlainMessage(message: string): boolean {
  return message.length > 0 && message.length <= 180 && !TECHNICAL.test(message);
}

export const FALLBACK_ERROR_LINE = "This did not load. Try again; if it keeps happening, the details below say what went wrong.";

export function ErrorPanel({ title = "Something went wrong", label, message, detail, onRetry, retryLabel }: ErrorPanelProps) {
  // A section this person may not open is not a failure: it says so, and offers no retry that could never work (RUI-05).
  if (message.startsWith(NO_ACCESS_PREFIX)) {
    const [heading = message, ...rest] = message.split(". ");
    return (
      <div className="p-gutter" data-testid="no-access-panel">
        <Panel title={title} span={12}>
          <EmptyState icon={Lock} title={heading.replace(/\.$/, "")}>
            {rest.join(". ") || "Ask an owner or admin if you need it."}
          </EmptyState>
        </Panel>
      </div>
    );
  }
  const plain = isPlainMessage(message);
  return (
    <div className="p-gutter" data-testid="error-panel">
      <Panel title={title} span={12}>
        <ErrorState label={label} onRetry={onRetry} retryLabel={retryLabel} detail={plain ? detail : [message, detail].filter(Boolean).join("\n\n")}>
          {plain ? message : FALLBACK_ERROR_LINE}
        </ErrorState>
      </Panel>
    </div>
  );
}
