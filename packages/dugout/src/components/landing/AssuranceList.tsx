/**
 * The landing page's assurances (DESIGN §9a): each an icon in the good color and its words. All of them show at every
 * width; on a phone they stack, from 640 px they center under the idea box.
 *
 * Server-safe: plain markup.
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "../foundation/Icon";

export interface Assurance {
  icon: IconComponent;
  text: string;
}

export interface AssuranceListProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  items: readonly Assurance[];
}

export function AssuranceList({ items, className, ...rest }: AssuranceListProps) {
  return (
    <ul data-assurance-list="" className={cn("t-landing-small m-0 flex list-none flex-col gap-2.5 p-0 text-secondary", className)} {...rest}>
      {items.map((a) => (
        <li key={a.text} className="flex items-start gap-2.5">
          <Icon icon={a.icon} size="default" className="mt-0.5 shrink-0 text-status-good" />
          <span>{a.text}</span>
        </li>
      ))}
    </ul>
  );
}
