"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: IconComponent;
  disabled?: boolean;
  /** Tooltip / accessible description. */
  title?: string;
}

export interface SegmentedControlProps<T extends string = string> extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  options: readonly SegmentedOption<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  /** sm: a 28 px track (default; toolbars), md: 32 px. */
  size?: "sm" | "md";
  /** Required: the group's accessible name ("Zoom"). */
  "aria-label": string;
  /** Classes for every option button. */
  itemClassName?: string;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Segmented control (DESIGN §8): a well; the active plate is surface 3 with a ring and a highlight, and it slides to the
 * chosen option in 260 ms (`slide-plate`). Options are toggle buttons (aria-pressed) in a labelled group, so they read
 * like the zoom buttons they replace; ← → move between them. Until the plate is measured (the server render) the
 * pressed option draws its own plate, so there is never a frame without one.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  size = "sm",
  className,
  itemClassName,
  ...rest
}: SegmentedControlProps<T>) {
  const [own, setOwn] = useState<T | undefined>(defaultValue ?? options[0]?.value);
  const current = value ?? own;
  const track = useRef<HTMLDivElement | null>(null);
  const measured = useRef(false);

  const place = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!active) {
      el.style.setProperty("--indicator-w", "0px");
      return;
    }
    el.style.setProperty("--indicator-x", `${active.offsetLeft}px`);
    el.style.setProperty("--indicator-w", `${active.offsetWidth}px`);
    if (!measured.current) {
      // First placement: no slide in from the left edge.
      measured.current = true;
      el.setAttribute("data-instant", "");
      el.setAttribute("data-ready", "");
      requestAnimationFrame(() => el.removeAttribute("data-instant"));
    }
  }, []);

  useIsoLayoutEffect(() => {
    place();
  }, [current, options, place]);

  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  const choose = (v: T) => {
    if (v === current) return;
    if (value === undefined) setOwn(v);
    onValueChange?.(v);
  };
  const enabled = options.filter((o) => !o.disabled);
  const move = (from: T | undefined, delta: number) => {
    const i = enabled.findIndex((o) => o.value === from);
    const next = enabled[(i + delta + enabled.length) % enabled.length];
    if (!next) return;
    choose(next.value);
    const buttons = track.current?.querySelectorAll<HTMLElement>("[data-value]") ?? [];
    for (const b of buttons) if (b.dataset.value === next.value) b.focus();
  };

  return (
    <div
      ref={track}
      role="group"
      data-segmented=""
      className={cn("seg-track", size === "md" ? "h-control-md" : "h-control-sm", className)}
      {...rest}
    >
      <span aria-hidden className="slide-plate" />
      {options.map((o) => {
        const on = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            title={o.title}
            data-value={o.value}
            className={cn("seg-item font-body font-medium", size === "md" ? "text-action" : "text-action-sm", itemClassName)}
            onClick={() => choose(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                move(o.value, e.key === "ArrowRight" ? 1 : -1);
              }
            }}
          >
            {o.icon ? <Icon icon={o.icon} size="inline" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
