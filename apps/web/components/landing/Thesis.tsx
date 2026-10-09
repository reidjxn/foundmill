"use client";
/**
 * Why now: one statement and four pillars. The statement's second sentence lights word by word as it scrolls through
 * the window (all lit at once under reduced motion); each pillar links to the section that shows it.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, BadgeCheck, Layers, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Icon, prefersReducedMotion } from "@foundmill/dugout";
import { Container, Eyebrow, Reveal } from "./parts";

const PILLARS: ReadonlyArray<{ icon: LucideIcon; title: string; text: string; href: string; link: string; tone: string }> = [
  { icon: Layers, title: "A whole company, in parallel", text: "Six departments work at once every cycle, against one plan, one budget and one picture of the business. A Chief of Staff keeps them in step.", href: "#team", link: "Meet the team", tone: "var(--dept-1)" },
  { icon: BadgeCheck, title: "Real work, real outcomes", text: "Code lands in your repository. Campaigns reach real people. Payments reconcile in a real ledger. Nothing here is a simulation.", href: "#live", link: "Watch the work", tone: "var(--dept-2)" },
  { icon: TrendingUp, title: "Better every cycle", text: "Agents are trained against real tests between cycles. Ratings move only with evidence, and the business remembers what it learns.", href: "#journey", link: "See it grow", tone: "var(--dept-3)" },
  { icon: ShieldCheck, title: "You stay in charge", text: "Money, contracts, filings and anything irreversible wait for you, with the work prepared and a recommendation attached.", href: "#control", link: "Your calls", tone: "var(--status-good)" },
];

const STATEMENT = `AI agents can now write the code, run the channels and keep the books. ${APP_NAME} turns them into one team, gives them a real business to run, and keeps you in charge of every call that matters.`;

export function Thesis() {
  return (
    <section id="why" aria-labelledby="why-title" className="relative scroll-mt-16 pb-12 pt-28">
      <Container className="flex flex-col gap-20">
        <div className="flex max-w-5xl flex-col gap-8">
          <Reveal>
            <Eyebrow>Why now</Eyebrow>
          </Reveal>
          <Reveal>
            <h2 id="why-title" className="t-display-hero text-primary">
              The team used to be <span className="landing-lit">the hard part.</span>
            </h2>
          </Reveal>
          <ScrollLit text={STATEMENT} />
        </div>
        <ol className="grid grid-cols-4 gap-px overflow-hidden rounded-panel border border-subtle bg-subtle">
          {PILLARS.map((p, i) => (
            <Reveal as="li" key={p.title} delay={i * 80} className="group relative flex flex-col gap-4 bg-base p-6">
              <span aria-hidden className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-panel group-hover:opacity-100" style={{ background: `linear-gradient(90deg, transparent, ${p.tone}, transparent)` }} />
              <span className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-panel border" style={{ borderColor: `color-mix(in oklab, ${p.tone} 45%, transparent)`, backgroundColor: `color-mix(in oklab, ${p.tone} 12%, var(--bg-ink))`, color: `color-mix(in oklab, ${p.tone} 80%, var(--white))` }}>
                  <Icon icon={p.icon} size={20} />
                </span>
                <span className="t-display-md tabular-nums text-secondary/60">0{i + 1}</span>
              </span>
              <h3 className="t-display-md text-primary">{p.title}</h3>
              <p className="text-body text-secondary">{p.text}</p>
              <a href={p.href} className="t-tab mt-auto inline-flex items-center gap-1.5 text-link">
                {p.link}
                <Icon icon={ArrowDown} size={14} />
              </a>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/** Words light from secondary to primary as the paragraph moves from 85 % to 40 % of the window's height. */
function ScrollLit({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = text.split(" ");
  const [lit, setLit] = useState(words.length);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const h = window.innerHeight;
      const progress = Math.min(1, Math.max(0, (h * 0.85 - r.top) / (h * 0.45 + r.height * 0.6)));
      setLit(Math.round(progress * words.length));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [words.length]);
  return (
    <p ref={ref} className="t-display-xl max-w-5xl">
      {words.map((w, i) => (
        <span key={i} className="transition-colors duration-view" style={{ color: i < lit ? "var(--text-primary)" : "color-mix(in oklab, var(--text-secondary) 45%, transparent)" }}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
