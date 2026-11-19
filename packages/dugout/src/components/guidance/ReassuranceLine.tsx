"use client";
/**
 * One sentence of reassurance under a first-run commitment or in a dialog footer (docs/UX_AUDIT_AND_PLAN.md §6.2,
 * principle 7): "You can change this later in Settings › Business." Small secondary text with an Undo2 (reversible)
 * or Settings (where to change it) icon at 14 px. Hidden when guidance is off: it is tutoring.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { Settings, Undo2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { useGuided } from "./GuidanceProvider";

export interface ReassuranceLineProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {
  /** "undo" (default): the action can be undone; "settings": where to change it later. */
  icon?: "undo" | "settings";
  /** One sentence. */
  children: ReactNode;
}

export function ReassuranceLine({ icon = "undo", children, className, ...rest }: ReassuranceLineProps) {
  const guided = useGuided();
  if (!guided) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-small text-secondary text-pretty", className)} data-reassurance={icon} {...rest}>
      <Icon icon={icon === "settings" ? Settings : Undo2} size="inline" className="mt-px" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
