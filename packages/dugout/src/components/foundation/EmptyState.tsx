import type { HTMLAttributes, ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, type ButtonProps } from "./Button";
import { Icon, type IconComponent } from "./Icon";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  icon?: IconComponent;
  variant?: ButtonProps["variant"];
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: IconComponent;
  /** One line saying what will appear here and how to make it happen (DESIGN §10). */
  children: ReactNode;
  /** Optional title in display-sm above the line. */
  title?: ReactNode;
  /** One small button. */
  action?: EmptyStateAction;
}

/** DESIGN §8: 20 px Lucide icon in text-secondary, one line of body text, one small button. */
export function EmptyState({ icon = Inbox, children, title, action, className, ...rest }: EmptyStateProps) {
  return (
    <div role="status" className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)} {...rest}>
      <Icon icon={icon} size="empty" className="text-secondary" />
      {title ? <p className="t-display-sm text-primary">{title}</p> : null}
      <p className="max-w-sm text-body text-secondary">{children}</p>
      {action ? (
        <Button size="sm" variant={action.variant ?? "default"} icon={action.icon} onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
