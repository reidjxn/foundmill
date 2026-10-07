/**
 * The frame every widget renders inside: a Dugout Panel with the three states the gallery requires (loading skeleton,
 * empty state, error state with retry) and a provenance footer. Widgets never draw a spinner (DESIGN §7).
 */
import type { ReactNode } from "react";
import { Panel, type EmptyStateProps, type IconComponent, type PanelMenu } from "@foundmill/dugout";
import type { QueryState } from "../data";

export interface WidgetEmpty {
  icon?: IconComponent;
  title?: ReactNode;
  /** One line saying what will appear and how to make it happen (DESIGN §10). */
  text: ReactNode;
  action?: EmptyStateProps["action"];
}

export interface WidgetFrameProps {
  title: ReactNode;
  /** Queries the body depends on; the frame derives loading/error/retry from them. */
  queries?: readonly QueryState<unknown>[];
  loading?: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  /** Rendered instead of the body when set and nothing is loading or failed. */
  empty?: WidgetEmpty | null | false;
  actions?: ReactNode;
  footer?: ReactNode;
  menu?: PanelMenu;
  flush?: boolean;
  bodyClassName?: string;
  className?: string;
  children?: ReactNode;
  "data-widget"?: string;
}

/** Fold several query states into one loading/error pair plus a refetch-all. */
export function combineQueries(queries: readonly QueryState<unknown>[]): { isLoading: boolean; error: Error | null; refetch: () => void } {
  return {
    isLoading: queries.some((q) => q.isLoading && q.data === undefined),
    error: queries.find((q) => q.error)?.error ?? null,
    refetch: () => queries.forEach((q) => q.refetch()),
  };
}

function errorText(error: Error | string): string {
  if (typeof error === "string") return error;
  return error.message && error.message.length < 160 ? error.message : "The data for this panel could not be loaded.";
}

export function WidgetFrame({ title, queries = [], loading, error, onRetry, empty, actions, footer, menu, flush, bodyClassName, className, children, ...rest }: WidgetFrameProps) {
  const combined = combineQueries(queries);
  const isLoading = loading ?? combined.isLoading;
  const err = error ?? combined.error;
  const retry = onRetry ?? (queries.length ? combined.refetch : undefined);
  const emptyProps = !isLoading && !err && empty ? { icon: empty.icon, title: empty.title, action: empty.action, children: empty.text } : undefined;
  return (
    <Panel
      title={title}
      menu={menu}
      actions={actions}
      loading={isLoading}
      error={err ? errorText(err) : undefined}
      onRetry={retry}
      empty={emptyProps}
      footer={footer}
      flush={flush}
      bodyClassName={bodyClassName ?? "flex min-h-0 flex-col"}
      className={className ? `h-full ${className}` : "h-full"}
      data-widget={rest["data-widget"]}
    >
      {children}
    </Panel>
  );
}
