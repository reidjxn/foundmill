"use client";
/**
 * The signed-out landing page at `/`: what Foundmill is, why now, how it works, and a way in. Built from the product's
 * own parts on an example business the visitor picks above the hero's deck (Tutorlane, Glitchwick or Northwind
 * Skincare: the deck runs real cycles, the concept cards, the team's attribute ratings, live agent tiles, the Journey
 * Ribbon, a Customer Update, the Channel Board, an Inbox note with its DecisionBar), so what a visitor sees is the
 * product itself. The page wears the chosen business's brand colours. Desktop only, like the app: under 1280 px it
 * shows NeedsLargerWindow.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { Button, NeedsLargerWindow, Wordmark, isViewportTooSmall, kitStyle, useViewportWidth } from "@foundmill/dugout";
import { Channels, LiveSessions } from "./LiveSessions";
import { FinalCall, YourCall } from "./Control";
import { Hero, Ticker } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { JourneySection } from "./Journey";
import { TeamSection } from "./TeamSection";
import { Thesis } from "./Thesis";
import { Container, RenderDayProvider, SIGN_IN, useToday } from "./parts";
import { ExampleProvider, useExample } from "./examples/context";
import type { ExampleBusiness } from "./examples/types";

export interface LandingPageProps {
  /** Terminal renderer for the live tiles; tests pass "plain" (no canvas). */
  terminalRenderer?: "plain" | "xterm";
  /**
   * The business a deep link chose (`/?example=northwind`), loaded on the server so the first paint and hydration
   * agree. Absent: the default business, Tutorlane.
   */
  initialExample?: ExampleBusiness;
  /**
   * The UTC day the server rendered the page on ("2026-10-12"). The page is prerendered and served for up to an hour,
   * so hydration reads this day rather than the browser's clock (`useToday`). Absent: the UTC day at render time.
   */
  renderDay?: string;
}

export function LandingPage({ terminalRenderer, initialExample, renderDay }: LandingPageProps) {
  return (
    <RenderDayProvider value={renderDay ?? null}>
      <ExampleProvider initial={initialExample}>
        <LandingContent terminalRenderer={terminalRenderer} />
      </ExampleProvider>
    </RenderDayProvider>
  );
}

/**
 * Everything that shows the example is keyed by the business, so choosing another one starts each part afresh on it
 * (the deck's cycle loop, the department tour, the live tiles, the board); the hero's headline and the picker stay put.
 */
function LandingContent({ terminalRenderer }: { terminalRenderer?: "plain" | "xterm" }) {
  const width = useViewportWidth();
  const business = useExample();
  const id = business.identity.id;
  if (isViewportTooSmall(width)) return <NeedsLargerWindow width={width} />;
  return (
    <div className="relative min-h-screen overflow-x-clip bg-base text-primary" style={kitStyle(business.identity.kit)} data-testid="landing" data-example={id}>
      <Backdrop />
      <TopBar />
      <main>
        <Hero />
        <Ticker key={`ticker-${id}`} />
        <Thesis />
        <HowItWorks key={`how-${id}`} />
        <TeamSection key={`team-${id}`} />
        <LiveSessions key={`live-${id}`} terminalRenderer={terminalRenderer} />
        <JourneySection key={`journey-${id}`} />
        <Channels key={`channels-${id}`} />
        <YourCall key={`control-${id}`} />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-300">
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 45% at 50% 0%, color-mix(in oklab, var(--kit-primary) 34%, transparent), transparent 70%), radial-gradient(ellipse 35% 30% at 10% 30%, color-mix(in oklab, var(--dept-6) 9%, transparent), transparent 70%), radial-gradient(ellipse 35% 30% at 92% 34%, color-mix(in oklab, var(--dept-5) 9%, transparent), transparent 70%)" }} />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklab, var(--white) 9%, transparent) 1px, transparent 1.5px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 60% 40% at 50% 10%, black 20%, transparent 80%)",
        }}
      />
    </div>
  );
}

const NAV = [
  { href: "#why", label: "Why now" },
  { href: "#how", label: "How it works" },
  { href: "#team", label: "Your team" },
  { href: "#live", label: "Live sessions" },
  { href: "#journey", label: "Journey" },
  { href: "#control", label: "You decide" },
];

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-subtle/60 bg-base/70 backdrop-blur-md">
      <Container className="flex h-16 items-center gap-6">
        <Link href="/" className="flex items-center text-primary hover:no-underline" aria-label={`${APP_NAME} home`}>
          <Wordmark height={20} label={APP_NAME} />
        </Link>
        <nav aria-label="Sections" className="flex items-center gap-5">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="t-tab whitespace-nowrap text-secondary transition-colors duration-micro hover:text-primary hover:no-underline">
              {n.label}
            </a>
          ))}
        </nav>
        <span className="flex-1" />
        <Button asChild variant="ghost">
          <Link href={SIGN_IN}>Sign in</Link>
        </Button>
        <Button asChild variant="glass" iconRight={ArrowRight}>
          <Link href={SIGN_IN}>Start your business</Link>
        </Button>
      </Container>
    </header>
  );
}

function Footer() {
  // The year of the day the page shows (the render day until hydrated), so a page rendered last year still hydrates.
  const year = useToday().slice(0, 4);
  return (
    <footer className="border-t border-subtle/60">
      <Container className="flex h-20 items-center gap-6 text-small text-secondary">
        <Wordmark height={12} label={APP_NAME} className="text-secondary" />
        <span>{APP_TAGLINE}</span>
        <span className="flex-1" />
        <span>Desktop only · 1280 px and wider</span>
        <span>
          © {year} {APP_NAME}
        </span>
      </Container>
    </footer>
  );
}
