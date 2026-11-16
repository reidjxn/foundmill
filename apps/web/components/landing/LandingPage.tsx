/**
 * The signed-out page at `/` (DESIGN §9a; docs/holistic-plan/landing/DIRECTION.md), for one reader: a first-timer,
 * most likely on a phone. One job: type a sentence, get a card back, want to keep it. Everything else answers a fear
 * (cost, something done behind your back, looking stupid) or offers people, never as a requirement.
 *
 * One page for every width from 390 px: no phone branch, so the server's HTML is the page a phone keeps. It lays itself
 * out from its own width (`landing-page` is a container). A server component: only the hero (the idea box) and the
 * closing button run in the browser. Every string is in words.ts; every switch arrives in `switches`, read once at
 * build time (flags.ts). The earlier page, for an investor or an experienced founder, is `/tour` (TourPage.tsx).
 */
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import type { StoreLinks } from "@foundmill/config/app-links";
import { DayList, GetTheApp, Icon, IdeaCard, LandingSection, PersonPage, ProjectPage, QuestionList, ScreenFrame, Wordmark, type QuestionItem } from "@foundmill/dugout";
import { LEGAL_ROUTES } from "@/content/legal/facts";
import { publicEnv } from "@/lib/env";
import { EXAMPLE_CARD, EXAMPLE_PERSON, EXAMPLE_PROJECT } from "./first-timer-examples";
import { SWITCHES_OFF, TOUR_ENABLED, type LandingSwitches } from "./flags";
import { LandingHero } from "./LandingHero";
import { SIGN_IN } from "./parts";
import { HomeJsonLd } from "./seo";
import { StartButton } from "./StartButton";
import { LANDING_WORDS as W } from "./words";

/** Where "Find people" goes when the people layer is on (the network; sign-in first for a stranger). */
export const FIND_PEOPLE_HREF = "/network";

export interface LandingPageProps {
  /** The page's switches; all off when absent (production today). */
  switches?: LandingSwitches;
  /** The UTC day the page was rendered on ("2026-11-15"), for the footer's year. Absent: today. */
  renderDay?: string;
  /** The native app's store links (WP-03 T9); absent: `publicEnv().storeLinks`, null until the app launches. */
  storeLinks?: StoreLinks | null;
}

export function LandingPage({ switches = SWITCHES_OFF, renderDay, storeLinks = publicEnv().storeLinks }: LandingPageProps) {
  const year = (renderDay ?? new Date().toISOString()).slice(0, 4);
  return (
    <div className="landing-page" data-testid="landing" data-landing="" data-people={switches.peopleOpen ? "open" : "closed"}>
      <HomeJsonLd />
      <TopBar peopleOpen={switches.peopleOpen} />
      <main>
        <LandingHero signupOpen={switches.signupOpen} />
        <CardSection />
        <PeopleSection peopleOpen={switches.peopleOpen} />
        <FirstWeekSection platformMail={switches.platformMail} />
        <LandingSection id="control" title={W.control.title}>
          <p className="text-secondary">{W.control.rules}</p>
          <p className="text-secondary">{W.control.yes}</p>
        </LandingSection>
        <LandingSection id="cost" title={W.cost.title} lede={W.cost.free}>
          <p className="text-secondary">{W.cost.allowance}</p>
          <p className="text-secondary">{W.cost.people}</p>
        </LandingSection>
        <LandingSection id="questions" title={W.questions.title}>
          <QuestionList items={questions(switches)} />
        </LandingSection>
        <section id="start" aria-labelledby="start-title" className="landing-section">
          <div className="landing-col flex flex-col items-start gap-5 @page-wide:items-center @page-wide:text-center">
            <h2 id="start-title" className="t-landing-h2 text-primary">
              {W.start.title}
            </h2>
            <p className="t-landing-lede">{W.start.text}</p>
            <StartButton />
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="landing-col flex flex-col gap-6 py-10">
          <div className="landing-measure flex flex-col gap-2">
            <h2 className="t-landing-body font-semibold text-primary">{W.footer.whatTitle}</h2>
            <p className="t-landing-small text-secondary" data-testid="what-foundmill-is">
              {W.footer.what}
            </p>
          </div>
          {/* Under 640 px only (the page's own width); renders nothing while the store links are unset. */}
          <GetTheApp links={storeLinks} className="@page-wide:hidden" />
          <div className="t-landing-small flex flex-wrap items-center gap-x-5 gap-y-1 text-secondary">
            <span>{APP_TAGLINE}</span>
            <nav aria-label="Legal" className="flex items-center gap-4">
              <Link href={LEGAL_ROUTES.terms} className="inline-flex min-h-tap items-center hover:text-primary" data-testid="landing-terms">
                {W.footer.terms}
              </Link>
              <Link href={LEGAL_ROUTES.privacy} className="inline-flex min-h-tap items-center hover:text-primary" data-testid="landing-privacy">
                {W.footer.privacy}
              </Link>
              {TOUR_ENABLED ? (
                <Link href="/tour" className="hidden min-h-tap items-center hover:text-primary desktop:inline-flex">
                  {W.footer.tour}
                </Link>
              ) : null}
            </nav>
            <span>
              © {year} {APP_NAME}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The wordmark, "Find people" with the people layer on, and Sign in. No second start button: the box is the one. */
function TopBar({ peopleOpen }: { peopleOpen: boolean }) {
  return (
    <header className="border-b border-line">
      <div className="landing-col flex h-16 items-center gap-2">
        <Link href="/" className="flex min-h-tap items-center text-primary hover:no-underline" aria-label={W.topBar.home}>
          <Wordmark height={16} label={APP_NAME} />
        </Link>
        <span className="flex-1" />
        {peopleOpen ? (
          <Link href={FIND_PEOPLE_HREF} className="inline-flex min-h-tap items-center px-3 font-medium text-secondary hover:text-primary">
            {W.topBar.findPeople}
          </Link>
        ) : null}
        <Link href={SIGN_IN} className="inline-flex min-h-tap items-center px-3 font-medium text-secondary hover:text-primary">
          {W.topBar.signIn}
        </Link>
      </div>
    </header>
  );
}

function Points({ items }: { items: ReadonlyArray<{ lead: string; rest: string }> }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0 text-secondary">
      {items.map((p) => (
        <li key={p.lead}>
          <strong className="font-semibold text-primary">{p.lead}</strong>
          {p.rest}
        </li>
      ))}
    </ul>
  );
}

/** Section 2: the prize, before any explanation. Its example steps aside once the visitor's own card has landed. */
function CardSection() {
  return (
    <LandingSection
      id="card"
      title={W.card.title}
      lede={W.card.lede}
      screen={
        <ScreenFrame className="in-data-landed:hidden">
          <IdeaCard card={EXAMPLE_CARD} className="max-w-full" />
        </ScreenFrame>
      }
    >
      <Points items={W.card.points} />
    </LandingSection>
  );
}

/** Section 3: solo is complete; people are one step away. The find block exists only with the people layer on. */
function PeopleSection({ peopleOpen }: { peopleOpen: boolean }) {
  return (
    <LandingSection
      id="people"
      title={W.people.title}
      lede={W.people.lede}
      screen={
        <ScreenFrame>
          <PersonPage {...EXAMPLE_PERSON} />
        </ScreenFrame>
      }
    >
      <p className="text-secondary">{W.people.intro}</p>
      <Points items={W.people.points} />
      {peopleOpen ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5" data-testid="people-find">
          <h3 className="t-landing-body flex items-center gap-2 font-semibold text-primary">
            <Icon icon={Users} size="default" className="text-accent" />
            {W.people.findTitle}
          </h3>
          <p className="text-secondary">{W.people.findText}</p>
          <Link href={FIND_PEOPLE_HREF} className="inline-flex min-h-tap items-center gap-2 self-start font-medium text-accent">
            {W.people.findLink}
            <Icon icon={ArrowRight} size="default" />
          </Link>
        </div>
      ) : null}
    </LandingSection>
  );
}

/** Section 4: an example first week, using only what works today. Kept out of search snippets. */
function FirstWeekSection({ platformMail }: { platformMail: boolean }) {
  const d = W.firstWeek.days;
  return (
    <LandingSection
      id="first-week"
      data-nosnippet=""
      title={W.firstWeek.title}
      lede={W.firstWeek.lede}
      screen={
        <ScreenFrame label={W.firstWeek.label}>
          <ProjectPage {...EXAMPLE_PROJECT} />
        </ScreenFrame>
      }
    >
      <p className="t-landing-small text-secondary">
        <span className="font-medium text-primary">{W.firstWeek.label}</span> · {W.firstWeek.project} · {W.firstWeek.pitch}
      </p>
      <DayList
        days={[
          { day: "Day 1", text: d.d1 },
          { day: "Day 2", text: d.d2 },
          { day: "Day 3", text: platformMail ? `${d.d3} ${d.d3Follow}` : d.d3 },
          { day: "Day 4", text: d.d4 },
          { day: "Day 5", text: d.d5, milestone: true },
          { day: "Day 7", text: d.d7 },
        ]}
      />
      <details className="group">
        <summary className="inline-flex min-h-tap cursor-pointer items-center font-medium text-accent">{W.firstWeek.another}</summary>
        <div className="flex flex-col gap-4 pt-3">
          <p className="t-landing-small text-secondary">
            <span className="font-medium text-primary">{W.firstWeek.label}</span> · {W.firstWeek.second.project} · {W.firstWeek.second.pitch}
          </p>
          <DayList days={W.firstWeek.second.days} />
        </div>
      </details>
    </LandingSection>
  );
}

/** The questions, the door's only while sign-up is closed, the limits line by whether platform mail is on. */
function questions(switches: LandingSwitches): QuestionItem[] {
  const q = W.questions;
  const limits = [q.limitsBase, switches.platformMail ? null : q.limitsMail, q.limitsEnd].filter(Boolean).join(" ");
  return [...(switches.signupOpen ? [] : [q.getIn]), ...q.always, { ...q.limits, answer: limits }, q.adults];
}
