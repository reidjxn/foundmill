"use client";
/**
 * FirstWeekChecklist (docs/UX_AUDIT_AND_PLAN.md §6.2, §7.8): a span-4 Panel titled "Your first week" with the mono meta
 * "2 of 7 done", 34 px rows (a CircleCheck in status-good or a neutral Circle, the line in `t-body`, a ghost "Go" link
 * through the shell link renderer), and a ghost "Hide" in the header that calls `onDismiss`. It is pinnable through the
 * panel's own menu (`menu.onPinToHome`). Guidance off: nothing renders. Every item done: one line "All done" for the
 * render in which it happens (and `onComplete` once), so the caller can hide the panel and record the dismissal.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, buttonVariants } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { useGuided } from "../guidance/GuidanceProvider";
import { Panel, type PanelMenu } from "../shell/Panel";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export interface FirstWeekItem {
  id: string;
  label: string;
  href: string;
  done: boolean;
}

/** The seven first-week items, in order; the app fills in `href` and `done` from what the business has recorded. */
export const DEFAULT_FIRST_WEEK_ITEMS = [
  { id: "sign_off_specification", label: "Sign off the specification" },
  { id: "sign_off_roadmap", label: "Sign off the roadmap" },
  { id: "run_cycle", label: "Run a cycle" },
  { id: "read_note", label: "Read a note from an agent" },
  { id: "talk_to_agent", label: "Talk to an agent" },
  { id: "start_distribution", label: "Start distribution" },
  { id: "connect_bank", label: "Connect a bank or Stripe" },
] as const satisfies readonly { id: string; label: string }[];

export type FirstWeekItemId = (typeof DEFAULT_FIRST_WEEK_ITEMS)[number]["id"];

export interface FirstWeekChecklistProps {
  items: readonly FirstWeekItem[];
  /** "Hide" in the header; the app records `checklist_dismissed_at`. */
  onDismiss: () => void;
  /** Called once when every item is done, in the render that shows "All done". */
  onComplete?: () => void;
  /** The panel's caret menu ("Pin to Home" and friends). */
  menu?: PanelMenu;
  /** Default 4 (beside the Inbox preview). */
  span?: GridSpan;
  title?: ReactNode;
  className?: string;
}

/** "2 of 7 done". */
export function checklistMeta(items: readonly { done: boolean }[]): string {
  return `${items.filter((i) => i.done).length} of ${items.length} done`;
}

function Row({ item }: { item: FirstWeekItem }) {
  const renderLink = useShellLink();
  return (
    <li className="flex min-h-row-comfortable items-center gap-2 border-b border-line-faint last:border-b-0" data-first-week-item={item.id} data-done={item.done || undefined}>
      {item.done ? <Icon icon={CircleCheck} className="text-status-good" label="Done" /> : <Icon icon={Circle} className="text-tertiary" label="Not done" />}
      <span className={cn("t-body min-w-0 flex-1 text-pretty", item.done ? "text-tertiary" : "text-primary")}>{item.label}</span>
      {item.done
        ? null
        : renderLink({
            href: item.href,
            className: cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-secondary hover:text-primary"),
            "aria-label": `Go: ${item.label}`,
            children: (
              <>
                Go
                <Icon icon={ArrowRight} size="inline" />
              </>
            ),
          })}
    </li>
  );
}

export function FirstWeekChecklist({ items, onDismiss, onComplete, menu, span = 4, title = "Your first week", className }: FirstWeekChecklistProps) {
  const guided = useGuided();
  const allDone = items.length > 0 && items.every((i) => i.done);
  const completed = useRef(false);
  useEffect(() => {
    if (!guided || !allDone || completed.current) return;
    completed.current = true;
    onComplete?.();
  }, [guided, allDone, onComplete]);
  if (!guided) return null;

  return (
    <Panel
      title={title}
      span={span}
      meta={checklistMeta(items)}
      menu={menu}
      actions={
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Hide
        </Button>
      }
      className={className}
      data-first-week-checklist=""
      data-complete={allDone || undefined}
    >
      {allDone ? (
        <p className="t-body flex items-center gap-2 text-primary" data-first-week-all-done="">
          <Icon icon={CircleCheck} className="text-status-good" />
          All done
        </p>
      ) : (
        <ol className="m-0 -my-1 flex list-none flex-col p-0">
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ol>
      )}
    </Panel>
  );
}
