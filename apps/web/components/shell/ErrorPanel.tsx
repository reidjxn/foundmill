"use client";
/** One on-brand error surface for route errors and unreachable services. */
import { ErrorState, Panel } from "@foundmill/dugout";

export interface ErrorPanelProps {
  title?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorPanel({ title = "Something went wrong", message, detail, onRetry, retryLabel }: ErrorPanelProps) {
  return (
    <div className="p-gutter" data-testid="error-panel">
      <Panel title={title} span={12}>
        <ErrorState onRetry={onRetry} retryLabel={retryLabel} detail={detail}>
          {message}
        </ErrorState>
      </Panel>
    </div>
  );
}
