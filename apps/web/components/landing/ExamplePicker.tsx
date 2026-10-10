"use client";
/**
 * Watch it run: the picker above the hero's deck. One pill track of glass holding the three example businesses, each
 * with its logo, name and vertical; the chosen one is a brand-tinted glass pill in its own colours (the landing page's
 * call-to-action language, `btn-glass`). Choosing one re-themes the whole page and swaps the example in every section.
 *
 * A proper radio group (WAI-ARIA radio pattern): one tab stop on the chosen option, arrow keys (and Home/End) move and
 * choose, each option is named by its business and described by its vertical and one line. Pointing at or focusing an
 * option starts loading that business. While it loads, a spinner sits over its logo inside the same box (no layout
 * shift) and a polite status says so; when it lands, the status names the business now shown.
 */
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { BusinessLogo, Spinner, cn, kitStyle } from "@foundmill/dugout";
import { useExampleChoice } from "./examples/context";
import { EXAMPLE_IDENTITIES, exampleIdentities, type ExampleId } from "./examples/index";

const OPTIONS = exampleIdentities();

export function ExamplePicker() {
  const { business, selected, pending, select, prefetch } = useExampleChoice();
  const base = useId();
  const buttons = useRef(new Map<ExampleId, HTMLButtonElement>());
  // The status speaks only after the visitor has chosen something, never on first paint.
  const [chosen, setChosen] = useState(false);

  const choose = (id: ExampleId) => {
    setChosen(true);
    select(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = OPTIONS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    const id = OPTIONS[next]!.id;
    choose(id);
    buttons.current.get(id)?.focus();
  };

  const status = !chosen ? "" : pending ? `Loading ${EXAMPLE_IDENTITIES[pending].name}` : `Showing ${business.identity.name}, ${business.identity.vertical}`;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" data-testid="example-picker">
      <span id={`${base}-label`} className="t-label inline-flex items-center gap-2 whitespace-nowrap">
        <span aria-hidden className="size-1.5 rounded-full bg-kit-lift" style={{ boxShadow: "0 0 8px 1px color-mix(in oklab, var(--kit-lift) 70%, transparent)" }} />
        Watch it run
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${base}-label`}
        className="flex items-center gap-1 rounded-full border border-subtle bg-panel/60 p-1 backdrop-blur-md"
        style={{ boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--white) 6%, transparent), 0 12px 32px -18px color-mix(in oklab, var(--black) 80%, transparent)" }}
      >
        {OPTIONS.map((o, i) => {
          const on = o.id === selected;
          const busy = o.id === pending;
          const id = `${base}-${o.id}`;
          return (
            <button
              key={o.id}
              ref={(el) => {
                if (el) buttons.current.set(o.id, el);
                else buttons.current.delete(o.id);
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-labelledby={`${id}-name`}
              aria-describedby={`${id}-vertical ${id}-about`}
              aria-busy={busy || undefined}
              tabIndex={on ? 0 : -1}
              data-example-option={o.id}
              data-pending={busy || undefined}
              onClick={() => choose(o.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onPointerEnter={() => prefetch(o.id)}
              onFocus={() => prefetch(o.id)}
              style={kitStyle(o.kit)}
              className={cn(
                "pressable relative flex h-12 items-center gap-2.5 rounded-full py-1 pl-1.5 pr-4 text-left",
                on ? "btn-glass" : "text-secondary hover:bg-white/6 hover:text-primary",
              )}
            >
              <span className="relative grid shrink-0 place-items-center">
                <BusinessLogo src={o.logo} name={o.name} primary={o.kit.primary} size={32} title="" />
                {busy ? (
                  <span aria-hidden className="absolute inset-0 grid place-items-center rounded-panel bg-ink/60 text-primary">
                    <Spinner decorative size={16} />
                  </span>
                ) : null}
              </span>
              <span className="flex flex-col">
                <span id={`${id}-name`} className="t-body-strong whitespace-nowrap">
                  {o.name}
                </span>
                <span id={`${id}-vertical`} className={cn("whitespace-nowrap text-small", on ? "text-primary/75" : "text-tertiary")}>
                  {o.vertical}
                </span>
              </span>
              <span id={`${id}-about`} className="sr-only">
                {o.description}
              </span>
            </button>
          );
        })}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}
