"use client";
/**
 * The hero: the tagline over the deck. The headline sits centred in display-hero; the deck below is one screen of
 * the product on the example business, and pressing its Continue button runs a cycle. Above the deck the visitor picks
 * which business it runs (Watch it run); the deck starts afresh on each.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, Coins, Monitor, Pause, Play, ShieldCheck, type LucideIcon } from "lucide-react";
import { APP_NAME, APP_TAGLINE, CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { Button, Icon, formatMoney } from "@foundmill/dugout";
import { CycleDeck } from "./CycleDeck";
import { ExamplePicker } from "./ExamplePicker";
import { useExample } from "./examples/context";
import { Container, SIGN_IN, goToSection } from "./parts";

/** The words the headline lights; the h1's text stays exactly the tagline. */
const LIT = "real business";

/**
 * The first money a visitor reads about (docs/UX_AUDIT_AND_PLAN.md §7.1, A13): the free plan's included credits, read
 * from packages/config so the figure stays true, in credits' own currency ("$5.00"). The key assurance lives in "You
 * decide" (Control.tsx), beside "Your key, sealed".
 */
export const INCLUDED_CREDITS_ASSURANCE = `Starts with ${formatMoney({ amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY }, { locale: "en-US" })} of included credits · no card`;

export function Hero() {
  const business = useExample();
  const at = APP_TAGLINE.indexOf(LIT);
  const headline =
    at < 0 ? (
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
      <Container className="flex flex-col items-center gap-14 pb-10 pt-14">
        <div className="flex max-w-6xl animate-rise-in flex-col items-center gap-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-subtle bg-panel/70 py-1 pl-1 pr-3 text-small text-secondary backdrop-blur">
            <span className="rounded-full bg-kit-primary px-2 py-0.5 t-label text-kit-on-primary">For founders</span>
            First company or fifth, the team comes with it
          </span>
          <h1 id="hero-title" className="t-display-hero max-w-5xl text-balance text-primary">
            {headline}
          </h1>
          <p className="mx-auto max-w-3xl text-pretty text-reading text-secondary">
            {APP_NAME} hires, trains and runs a team of AI agents across product, development, distribution, finance, legal and hiring. You set the direction and make the calls only a founder should make. They do the rest, every cycle, in the open.
          </p>
          <div className="flex items-center gap-3">
            <Button asChild variant="glass" size="lg" iconRight={ArrowRight}>
              <Link href={SIGN_IN}>Start your business</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <a href="#how">See how it works</a>
            </Button>
          </div>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-small text-secondary">
            <Assurance icon={ShieldCheck}>Nothing moves money or signs in your name without you</Assurance>
            <Assurance icon={Coins}>{INCLUDED_CREDITS_ASSURANCE}</Assurance>
            <Assurance icon={Monitor}>A desktop app, built for focus</Assurance>
          </ul>
        </div>
        <div className="flex w-full flex-col gap-5">
          <ExamplePicker />
          <CycleDeck key={business.identity.id} onOpenJourney={() => goToSection("journey")} />
          <p className="text-center text-small text-secondary">
            {business.identity.name} is an example business. Press Continue, answer what comes back, and run another cycle.
          </p>
        </div>
      </Container>
    </section>
  );
}

function Assurance({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <Icon icon={icon} size={14} className="text-status-good" />
      {children}
    </li>
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
