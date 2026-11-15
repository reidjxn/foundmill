/**
 * The landing page's questions (DESIGN §9a): native `<details>`, so they open and close without script, by keyboard
 * and on a phone. Each summary is a 44 px tap target with a chevron that turns when open.
 *
 * Server-safe: plain markup.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export interface QuestionItem {
  /** A stable key ("cost", "phone"). */
  id: string;
  question: string;
  answer: ReactNode;
}

export interface QuestionListProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  items: readonly QuestionItem[];
}

export function QuestionList({ items, className, ...rest }: QuestionListProps) {
  return (
    <div data-question-list="" className={cn("flex flex-col border-t border-line", className)} {...rest}>
      {items.map((q) => (
        <details key={q.id} data-question={q.id} className="group border-b border-line">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-3 py-3 font-medium text-primary [&::-webkit-details-marker]:hidden">
            <span className="flex-1">{q.question}</span>
            <Icon icon={ChevronDown} size="default" className="shrink-0 text-tertiary transition-transform duration-hover group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="pb-4 text-secondary">{q.answer}</div>
        </details>
      ))}
    </div>
  );
}
