"use client";
/**
 * Building blocks shared by the landing page's sections: the page container, section frame and heading, the glass
 * panel, the window frame around live product parts, and the one-shot rise-in as a block enters the window.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn, prefersReducedMotion } from "@foundmill/dugout";

export const SIGN_IN = "/login";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-10", className)}>{children}</div>;
}

export function Eyebrow({ children, tone = "var(--accent-link)" }: { children: ReactNode; tone?: string }) {
  return (
    <span className="t-label inline-flex items-center gap-2" style={{ color: tone }}>
      <span aria-hidden className="h-px w-6" style={{ backgroundColor: tone }} />
      {children}
    </span>
  );
}

export function SectionHeading({ id, eyebrow, title, lede, align = "left", tone }: { id: string; eyebrow: string; title: ReactNode; lede?: ReactNode; align?: "left" | "center"; tone?: string }) {
  return (
    <Reveal>
      <header className={cn("flex max-w-3xl flex-col gap-4", align === "center" && "mx-auto items-center text-center")}>
        <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
        <h2 id={`${id}-title`} tabIndex={-1} className="t-display-xl text-balance text-primary outline-none">
          {title}
        </h2>
        {lede ? <p className={cn("t-reading text-pretty text-secondary", align === "center" && "mx-auto")}>{lede}</p> : null}
      </header>
    </Reveal>
  );
}

export function Section({ id, children, className, label }: { id: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <section id={id} aria-labelledby={label ? undefined : `${id}-title`} aria-label={label} className={cn("relative scroll-mt-16 py-24", className)}>
      <Container className="flex flex-col gap-14">{children}</Container>
    </section>
  );
}

/** A dark glass card: bg-panel at 80 % with a blur and a hairline; an accent tints the border and inner highlight. */
export function Glass({ children, className, accent, style }: { children: ReactNode; className?: string; accent?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn("rounded-panel border border-subtle bg-panel/80 backdrop-blur", className)}
      style={{
        ...(accent ? { borderColor: `color-mix(in oklab, ${accent} 35%, var(--line-subtle))`, boxShadow: `inset 0 1px 0 color-mix(in oklab, ${accent} 25%, transparent)` } : { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A frame around live product parts: a hairline window with a soft brand glow under it, so a real component reads as
 * "this is the product" rather than an illustration. The bar on top carries a label and chips (Example, Estimate).
 */
export function ProductWindow({ title, chips, children, className, glow = "var(--kit-primary)" }: { title: ReactNode; chips?: ReactNode; children: ReactNode; className?: string; glow?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div aria-hidden className="pointer-events-none absolute -inset-x-16 -bottom-20 top-1/3 opacity-70 blur-3xl" style={{ background: `radial-gradient(ellipse 50% 60% at 50% 60%, color-mix(in oklab, ${glow} 28%, transparent), transparent 70%)` }} />
      <div className="relative overflow-hidden rounded-panel border border-subtle bg-panel" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px -40px rgba(0,0,0,0.9)" }}>
        <div className="flex h-10 items-center gap-3 border-b border-subtle bg-panel-alt/80 px-4">
          <span aria-hidden className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-subtle" />
            <span className="size-2.5 rounded-full bg-subtle" />
            <span className="size-2.5 rounded-full bg-subtle" />
          </span>
          <span className="t-label">{title}</span>
          <span className="flex-1" />
          {chips}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Takes the visitor to a section: scrolls (instantly under reduced motion) and moves keyboard focus to the section's
 * heading, so a screen reader announces where they landed and Tab continues from there.
 */
export function goToSection(id: string): void {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
}

/** The live parts run on a clock or measure the window, so they render in the browser only. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** True once the element has come within `margin` of the window (and stays true). No IntersectionObserver: true. */
export function useSeen<T extends Element>(margin = "200px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return [ref, seen];
}

/**
 * Rises in once as it first enters the window (DESIGN §9a). Only a block that starts below the fold is ever hidden,
 * and never under reduced motion or without IntersectionObserver, so the page reads the same without script.
 */
export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" }) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const [state, setState] = useState<"static" | "pending" | "shown">("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState("pending");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={className} data-reveal={state === "static" ? undefined : state} style={delay && state !== "static" ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </Tag>
  );
}
