import type { HTMLAttributes } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { toneClass, typingSentence } from "./types";

export interface TypingLineProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The agent's name. */
  name: string;
  /** What the agent is looking at ("reading Boots UK's supplier terms"). Always name something. */
  phrase: string;
  /** The dots take the agent's department colour. */
  dept?: DeptColourToken | "kit";
  /** Line up with bubbles that carry a portrait slot (compact and sheet desks). */
  indent?: boolean;
}

/**
 * "Juno is typing · reading Boots UK's supplier terms" (SPEC "Typing line"): three dots hopping in the agent's colour
 * and a line that always names what the agent is looking at. Shown only while a reply is genuinely in flight (no fake
 * delay). A polite status, so screen readers hear it once. Reduced motion: still dots, the words carry it. Server-safe.
 */
export function TypingLine({ name, phrase, dept, indent, className, ...rest }: TypingLineProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("desk-typing", toneClass(dept), className)}
      data-indent={indent || undefined}
      data-testid="typing-line"
      {...rest}
    >
      <span aria-hidden className="typing-dots flex-none">
        <span />
        <span />
        <span />
      </span>
      <span className="min-w-0">{typingSentence(name, phrase)}</span>
    </div>
  );
}
