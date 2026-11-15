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
import { Term } from "../guidance/Term";
import { Panel, type PanelMenu } from "../shell/Panel";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export interface FirstWeekItem {
  id: string;
  label: string;
  /** Where "Go" leads; a router link through the shell link renderer. */
  href?: string;
  /** An action instead of a route ("Run a cycle" puts the focus on Continue); `href` wins when both are given. */
  onGo?: () => void;
  done: boolean;
}

/**
 * The seven first-week items, in order; the app fills in `href` and `done` from what the business has recorded. The
 * page comes first (docs/THESIS_REVIEW.md package 1.3: the first session ends on a link). A bank or Stripe is not an
 * item: it assumed a company bank account in week one (§5.7).
 */
export const DEFAULT_FIRST_WEEK_ITEMS = [
  { id: "publish_page", label: "Publish your page" },
  { id: "sign_off_specification", label: "Sign off the specification" },
  { id: "sign_off_roadmap", label: "Sign off the roadmap" },
  { id: "run_cycle", label: "Let the team work" },
  { id: "read_note", label: "Read a note from an agent" },
  { id: "talk_to_agent", label: "Talk to an agent" },
  { id: "start_distribution", label: "Start distribution" },
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

/** The ghost "Go": a link when the item has a route, a button when it has an action, nothing when it has neither. */
function Go({ item }: { item: FirstWeekItem }) {
  const renderLink = useShellLink();
  const className = cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-secondary hover:text-primary");
  const label = `Go: ${item.label}`;
  if (item.href) {
    return (
      <>
        {renderLink({
          href: item.href,
          className,
          "aria-label": label,
          children: (
            <>
              Go
              <Icon icon={ArrowRight} size="inline" />
            </>
          ),
        })}
      </>
    );
  }
  if (item.onGo) {
    return (
      <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={item.onGo} aria-label={label}>
        Go
      </Button>
    );
  }
  return null;
}

/**
 * The defined word in an item's line, by item id (the widget passes id and label only): the checklist is where a new
 * founder first meets "specification" and "cycle", so each is a `Term` there (UX plan §8.3: define on first use).
 */
const ITEM_TERMS: Partial<Record<string, { id: string; text: string }>> = {
  sign_off_specification: { id: "specification", text: "specification" },
  run_cycle: { id: "cycle", text: "cycle" },
};

/** The item's line, with its defined word as a `Term` when the line still contains it. */
function ItemLabel({ item }: { item: FirstWeekItem }) {
  const term = ITEM_TERMS[item.id];
  const at = term ? item.label.indexOf(term.text) : -1;
  if (!term || at < 0) return <>{item.label}</>;
  return (
    <>
      {item.label.slice(0, at)}
      <Term id={term.id}>{term.text}</Term>
      {item.label.slice(at + term.text.length)}
    </>
  );
}

function Row({ item }: { item: FirstWeekItem }) {
  return (
    <li className="flex min-h-row-comfortable items-center gap-2 border-b border-line-faint last:border-b-0" data-first-week-item={item.id} data-done={item.done || undefined}>
      {item.done ? <Icon icon={CircleCheck} className="text-status-good" label="Done" /> : <Icon icon={Circle} className="text-tertiary" label="Not done" />}
      <span className={cn("t-body min-w-0 flex-1 text-pretty", item.done ? "text-tertiary" : "text-primary")}>
        <ItemLabel item={item} />
      </span>
      {item.done ? null : <Go item={item} />}
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
