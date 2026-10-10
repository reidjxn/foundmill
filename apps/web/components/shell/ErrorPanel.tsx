"use client";
/**
 * One on-brand error surface for route errors and unreachable services. The founder reads one plain line; a
 * technical message (a runtime error, a network code, a driver message) never takes that line: it goes behind the
 * Details disclosure, where it still helps whoever fixes it.
 */
import { ErrorState, Panel } from "@foundmill/dugout";

export interface ErrorPanelProps {
  title?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

const TECHNICAL = /\b(TypeError|ReferenceError|SyntaxError|RangeError|is not a function|is not defined|Cannot read|undefined|null|NaN|ECONN\w*|ETIMEDOUT|ENOTFOUND|fetch failed|Failed to fetch|NetworkError|Unexpected token|JSON|stack|enableOfflineQueue|writeable|TRPC|tRPC|INTERNAL_SERVER_ERROR|status code|\d{3} \w+Error)\b|=>|\(\)|\w+\.\w+\(|[{}<>]/;

/** A message fit to show as the one line: short, and not a runtime or transport error. */
export function isPlainMessage(message: string): boolean {
  return message.length > 0 && message.length <= 180 && !TECHNICAL.test(message);
}

export const FALLBACK_ERROR_LINE = "This did not load. Try again; if it keeps happening, the details below say what went wrong.";

export function ErrorPanel({ title = "Something went wrong", message, detail, onRetry, retryLabel }: ErrorPanelProps) {
  const plain = isPlainMessage(message);
  return (
    <div className="p-gutter" data-testid="error-panel">
      <Panel title={title} span={12}>
        <ErrorState onRetry={onRetry} retryLabel={retryLabel} detail={plain ? detail : [message, detail].filter(Boolean).join("\n\n")}>
          {plain ? message : FALLBACK_ERROR_LINE}
        </ErrorState>
      </Panel>
    </div>
  );
}
