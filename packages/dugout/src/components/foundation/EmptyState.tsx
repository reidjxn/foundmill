import type { HTMLAttributes, ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Button, type ButtonProps } from "./Button";
import { Icon, type IconComponent } from "./Icon";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  icon?: IconComponent;
  variant?: ButtonProps["variant"];
}

/** The light the icon sits in: a department colour, the brand (`kit`) or neutral (default). */
export type EmptyStateTone = DeptColourToken | "kit" | "neutral";

/** Literal class per tone so Tailwind sees every one. */
const HALO_TONE: Record<EmptyStateTone, string> = {
  neutral: "",
  kit: "tone-kit-lift",
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: IconComponent;
  /** One line saying what will appear here and how to make it happen (DESIGN §10). */
  children: ReactNode;
  /** Optional title in display-sm above the line. */
  title?: ReactNode;
  /** One small button. */
  action?: EmptyStateAction;
  /**
   * The action slot, for anything richer than `action`: typically a small generate control when the team can fill the
   * panel ("Draft with Juno"), or a generate control beside a secondary button. Rendered after `action`.
   */
  actions?: ReactNode;
  /** The halo's light: the department that would fill this panel, `kit` for the brand, or neutral. */
  tone?: EmptyStateTone;
  /** Tighter spacing for small panels and table bodies. */
  compact?: boolean;
}

/**
 * DESIGN §8: a 20 px Lucide icon on a soft disc of department light, one line of body text, one small button or an
 * action slot (a generate control when the team can fill the panel). Server-safe.
 */
export function EmptyState({ icon = Inbox, children, title, action, actions, tone = "neutral", compact, className, ...rest }: EmptyStateProps) {
  return (
    <div
      role="status"
      data-tone={tone}
      className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-5" : "gap-3 px-4 py-8", className)}
      {...rest}
    >
      <span aria-hidden className={cn("icon-halo", compact ? "size-control-md" : "size-control-lg", HALO_TONE[tone])}>
        <Icon icon={icon} size={compact ? "default" : "empty"} />
      </span>
      <div className="flex max-w-sm flex-col items-center gap-1">
        {title ? <p className="t-display-sm text-balance text-primary">{title}</p> : null}
        <p className="text-body text-pretty text-secondary">{children}</p>
      </div>
      {action || actions ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action ? (
            <Button size="sm" variant={action.variant ?? "default"} icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
