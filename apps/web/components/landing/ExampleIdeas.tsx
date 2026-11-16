"use client";
/**
 * The rated examples beside the idea box (founder, 2026-11-16): a row of examples just under the Example line, Northwind
 * Skincare first, then Sole Revival, Tutorlane and Glitchwick, and the chosen one's real `IdeaCard` under it. A radio
 * group: one tab stop, arrow keys and Home/End move and choose. Small pills, so the four fit on one line in the hero's
 * example column on a desktop (founder, 2026-11-16): 28 px tall from 1280 px, 44 px tap targets below.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { BusinessLogo, IdeaCard, cn } from "@foundmill/dugout";
import type { ExampleIdea } from "./first-timer-examples";

export const EXAMPLE_IDEAS_LABEL = "Example ideas";

export function ExampleIdeas({ ideas, cardClassName }: { ideas: readonly ExampleIdea[]; cardClassName?: string }) {
  const [chosen, setChosen] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const idea = ideas[chosen]!;

  const choose = (i: number) => {
    setChosen(i);
    buttons.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const last = ideas.length - 1;
    const next = { ArrowRight: chosen + 1, ArrowDown: chosen + 1, ArrowLeft: chosen - 1, ArrowUp: chosen - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    choose((next + ideas.length) % ideas.length);
  };

  return (
    <div className="flex flex-col gap-3" data-example-ideas="">
      <div role="radiogroup" aria-label={EXAMPLE_IDEAS_LABEL} className="flex flex-wrap gap-1" onKeyDown={onKeyDown}>
        {ideas.map((x, i) => {
          const on = i === chosen;
          return (
            <button
              key={x.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(i)}
              data-example-idea={x.id}
              className={cn(
                "t-label inline-flex min-h-tap items-center gap-1.5 rounded-sm px-1.5 transition-colors duration-hover desktop:min-h-control-sm",
                on ? "bg-surface-2 text-primary ring-1 ring-line-strong" : "text-secondary hover:text-primary",
              )}
            >
              <BusinessLogo src={x.logo} name={x.label} primary="" size={16} title="" />
              {x.label}
            </button>
          );
        })}
      </div>
      <IdeaCard key={idea.id} card={idea.card} logo={idea.logo} className={cardClassName} />
    </div>
  );
}
