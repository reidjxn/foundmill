"use client";
/**
 * The hero: the tagline, one line about how it works, and the idea box (founder, 2026-11-13; docs/IDEA_BOX.md): a
 * visitor types one line and gets a rated card before any sign-up. When the card lands the headline becomes "<name> is
 * yours to keep." Below, on a desktop, the example business runs in the deck (Or watch an example run). On a phone
 * (`layout="phone"`, from 390 px) the hero is the box alone.
 */
import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { APP_TAGLINE, CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { Icon, formatMoney } from "@foundmill/dugout";
import { CycleDeck } from "./CycleDeck";
import { ExamplePicker } from "./ExamplePicker";
import { useExample } from "./examples/context";
import { IdeaBox, type IdeaBoxLanded } from "./idea-box/IdeaBox";
import { Container, goToSection } from "./parts";

/** The words the headline lights; the h1's text stays exactly the tagline. */
const LIT = "real business";

/**
 * The first money a visitor reads about (docs/UX_AUDIT_AND_PLAN.md §7.1, A13): the free plan's included credits, read
 * from packages/config so the figure stays true, in credits' own currency ("$5.00"). The key assurance lives in "You
 * decide" (Control.tsx), beside "Your key, sealed".
 */
const INCLUDED_CREDITS = formatMoney({ amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY }, { locale: "en-US" });
export const INCLUDED_CREDITS_ASSURANCE = `Starts with ${INCLUDED_CREDITS} of included credits · no card`;

export function Hero({ layout = "desktop" }: { layout?: "desktop" | "phone" }) {
  const business = useExample();
  const [landed, setLanded] = useState<IdeaBoxLanded | null>(null);
  const phone = layout === "phone";
  const at = APP_TAGLINE.indexOf(LIT);
  const headline = landed ? (
    <>
      {landed.name} is <span className="landing-lit">yours to keep</span>.
    </>
  ) : at < 0 ? (
    APP_TAGLINE
  ) : (
    <>
      {APP_TAGLINE.slice(0, at)}
      <span className="landing-lit">{LIT}</span>
      {APP_TAGLINE.slice(at + LIT.length)}
    </>
  );
  return (
    <section aria-labelledby="hero-title" className="relative">
      {/*
        On a desktop the idea box stands apart from the example run below it. The deck's Continue stays high enough at
        1440 × 900 for its callout to open under it, not over the picker.
      */}
      <Container className={phone ? "flex flex-col items-center gap-10 px-4 pb-10 pt-7" : "flex flex-col items-center gap-20 pb-16 pt-14"}>
        <div className="flex w-full max-w-6xl animate-rise-in flex-col items-center gap-5 text-center">
          {!landed ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-subtle bg-panel/70 py-1 pl-1 pr-3 text-small text-secondary backdrop-blur">
              <span className="rounded-full bg-kit-primary px-2 py-0.5 t-label text-kit-on-primary">For founders</span>
              {phone ? "The team comes with it" : "First company or fifth, the team comes with it"}
            </span>
          ) : null}
          <h1 id="hero-title" className={phone ? "t-display-lg max-w-full text-balance text-primary" : "t-display-hero max-w-5xl text-balance text-primary"}>
            {headline}
          </h1>
          {!landed ? (
            <p className="mx-auto max-w-3xl text-pretty text-reading text-secondary" data-testid="hero-lede">
              {phone
                ? "Start with one line. Your team shapes it, builds it and runs it. You make the calls only a founder should make."
                : "Start with one line. Your team of AI agents shapes it, builds it and runs it, in the open. You set the direction and make the calls only a founder should make."}
            </p>
          ) : null}
          <div className="mt-3 w-full">
            <IdeaBox layout={layout} onLanded={setLanded} />
          </div>
        </div>
        {!phone ? (
          <div className="flex w-full flex-col gap-6" data-testid="hero-example">
            <span className="inline-flex items-center justify-center gap-2 font-medium text-secondary">
              <span aria-hidden className="size-1.5 rounded-full bg-kit-lift shadow-[0_0_10px_var(--kit-lift)]" />
              Or watch an example run
            </span>
            <ExamplePicker />
            <CycleDeck key={business.identity.id} onOpenJourney={() => goToSection("journey")} />
            <p className="text-center text-small text-secondary">
              {business.identity.name} is an example business. Press Continue, answer what comes back, and run another cycle.
            </p>
          </div>
        ) : null}
      </Container>
    </section>
  );
}

/**
 * A full-bleed band of what the example team did this week, drifting left. It pauses while the pointer is over it, and
 * its button pauses it for keyboard and screen-reader users (WCAG 2.2.2). Each item carries its own trailing space, so
 * the track is two identical halves and the loop never jumps.
 */
export function Ticker() {
  const { activity, identity } = useExample();
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const items = [...activity, ...activity];
  return (
    <div aria-label={`What the ${identity.name} team did this week`} role="region" className="relative flex items-center gap-3 border-y border-subtle/70 bg-ink/60 pl-6">
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        aria-label={paused ? "Play the activity ticker" : "Pause the activity ticker"}
        className="relative z-20 grid size-7 shrink-0 place-items-center rounded-panel border border-subtle bg-panel text-secondary transition-colors duration-micro hover:text-primary"
      >
        <Icon icon={paused ? Play : Pause} size={14} />
      </button>
      <div className="relative min-w-0 flex-1 overflow-hidden py-3" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-base to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-40 bg-gradient-to-l from-base to-transparent" />
        <ul className="flex w-max animate-marquee items-center whitespace-nowrap" style={{ animationPlayState: paused || hovered ? "paused" : "running" }}>
          {items.map((l, i) => (
            <li key={i} aria-hidden={i >= activity.length || undefined} className="inline-flex items-center gap-2 pr-10 text-small">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: `var(--${l.dept})` }} />
              <span className="font-medium text-primary">{l.who}</span>
              <span className="text-secondary">{l.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
