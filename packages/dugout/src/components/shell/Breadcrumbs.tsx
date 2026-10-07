import { Fragment, type HTMLAttributes } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { ShellLink } from "./ShellLink";
import type { BreadcrumbItem } from "./types";

export interface BreadcrumbsProps extends HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
}

/** Small-style trail under the top bar; the last item is the current page. */
export function Breadcrumbs({ items, className, ...rest }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("flex min-w-0 items-center text-small text-secondary", className)} {...rest}>
      <ol className="flex min-w-0 items-center gap-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          const content = (
            <span className="inline-flex min-w-0 items-center gap-1">
              {item.icon ? <Icon icon={item.icon} size="inline" /> : null}
              <span className="truncate">{item.label}</span>
            </span>
          );
          return (
            <Fragment key={`${item.label}-${i}`}>
              {i > 0 ? <Icon icon={ChevronRight} size={12} className="text-secondary/60" /> : null}
              <li className="min-w-0">
                {last ? (
                  <span aria-current="page" className="text-primary">
                    {content}
                  </span>
                ) : item.href ? (
                  <ShellLink href={item.href} onClick={item.onClick} className="text-secondary hover:text-primary hover:no-underline">
                    {content}
                  </ShellLink>
                ) : item.onClick ? (
                  <button type="button" onClick={item.onClick} className="text-secondary hover:text-primary">
                    {content}
                  </button>
                ) : (
                  content
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
