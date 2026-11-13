"use client";
/**
 * The small-screen stand-in for a dense table on the people pages (connections, communities): one row per item, its
 * name and one key fact, and its main action as a 44 px tap target; the rest of the row's actions sit in a "More" menu.
 * Below `page-wide` only (CLAUDE.md "Small screens"); from there up the DataTable, with its saved views and right-click
 * menu, is unchanged. Rows open with a tap on the name.
 */
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon } from "@foundmill/dugout";

export interface PeopleListAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "danger";
  /** A rule above this action in the More menu. */
  separatorBefore?: boolean;
}

export interface PeopleListItem {
  id: string;
  name: string;
  /** The one fact worth a line: members and visibility, or when you connected. */
  fact?: ReactNode;
  /** Status chip or pill beside the fact. */
  status?: ReactNode;
  /** Tap the name to open the item. */
  onOpen?: () => void;
  /** The main action, always visible. */
  primary?: PeopleListAction & { ariaLabel?: string; testId?: string; ghost?: boolean };
  /** Everything else, in a menu. */
  more?: PeopleListAction[];
  /** Round avatar (people) or none (communities draw the name only). */
  avatar?: boolean;
}

export function PeopleList({ items, label, "data-testid": testId }: { items: readonly PeopleListItem[]; label: string; "data-testid"?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 border-b border-line-faint px-panel-pad py-1 last:border-b-0" data-testid="people-list-row" data-item={item.id}>
          {item.avatar !== false ? <Avatar size={32} name={item.name} /> : null}
          <button
            type="button"
            onClick={item.onOpen}
            disabled={!item.onOpen}
            className="flex min-h-tap min-w-0 flex-1 flex-col items-start justify-center rounded-sm text-left focus-visible:shadow-ring disabled:cursor-default"
          >
            <span className="t-body-strong block w-full truncate text-primary">{item.name}</span>
            {item.fact || item.status ? (
              <span className="flex w-full min-w-0 items-center gap-2 text-small text-secondary">
                {item.status}
                {item.fact ? <span className="min-w-0 truncate">{item.fact}</span> : null}
              </span>
            ) : null}
          </button>
          {item.primary ? (
            <Button
              size="sm"
              variant={item.primary.ghost ? "ghost" : "default"}
              icon={item.primary.icon}
              className="min-h-tap shrink-0"
              disabled={item.primary.disabled}
              title={item.primary.title}
              aria-label={item.primary.ariaLabel}
              data-testid={item.primary.testId}
              onClick={item.primary.onSelect}
            >
              {item.primary.label}
            </Button>
          ) : null}
          {item.more?.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" icon={MoreHorizontal} className="min-h-tap min-w-tap shrink-0" aria-label={`More for ${item.name}`} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {item.more.map((a) => (
                  <div key={a.label}>
                    {a.separatorBefore ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem variant={a.variant === "danger" ? "danger" : undefined} disabled={a.disabled} onSelect={a.onSelect} className="min-h-tap">
                      {a.icon ? <Icon icon={a.icon} size="inline" /> : null} {a.label}
                    </DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
