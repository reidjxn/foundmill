/**
 * The signed-out page at `/` (DESIGN §9a; founder, 2026-11-16), and its four other variants at `/lp/<id>`. One job:
 * type a sentence, get the idea back rated, want to keep it. Then the page shows what is inside: three ways to start
 * (one sentence, the Ideation Studio, bringing what you already have), the Studio itself, people, a first week, and
 * the answers to the three fears (cost, something done behind your back, looking stupid).
 *
 * It opens in daylight and descends into the product's night: the hero on the day canvas with a real result standing
 * in it as a lit screen, the ways in on one field of the brand's blue, then the canvas (landing.css).
 *
 * One page for every width from 390 px: no phone branch, so the server's HTML is the page a phone keeps. It lays itself
 * out from its own width (`landing-page` is a container). A server component: only the hero (the idea box) and the
 * closing button run in the browser. Every string is in words.ts; a variant changes the hero's words, the idea box's
 * label and examples, and which way in comes first (`VARIANT_WORDS`), never what is true. Every switch arrives in
 * `switches`, read once at build time (flags.ts). The earlier page, for an investor or an experienced founder, is
 * `/tour` (TourPage.tsx).
 */
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import type { StoreLinks } from "@foundmill/config/app-links";
import { Chip, DayList, GetTheApp, Icon, IdeaCard, LandingSection, PersonPage, ProjectPage, QuestionList, ScreenFrame, Wordmark, type QuestionItem } from "@foundmill/dugout";
import { LEGAL_ROUTES } from "@/content/legal/facts";
import { publicEnv } from "@/lib/env";
import { DEFAULT_LANDING_VARIANT, type LandingVariant } from "@/lib/landing-variant";
import { EXAMPLE_PERSON, EXAMPLE_PROJECT, STUDIO_SETS, exampleIdeasInOrder, type StudioSet } from "./first-timer-examples";
import { ExampleIdeas } from "./ExampleIdeas";
import { SWITCHES_OFF, TOUR_ENABLED, type LandingSwitches } from "./flags";
import { LandingHero } from "./LandingHero";
import { SIGN_IN } from "./parts";
import { HomeJsonLd } from "./seo";
import { StartButton } from "./StartButton";
import { LANDING_WORDS as W, VARIANT_WORDS, type WayId } from "./words";

/** Where "Find people" goes when the people layer is on (the network; sign-in first for a stranger). */
export const FIND_PEOPLE_HREF = "/network";

export interface LandingPageProps {
  /** Which page this is (lib/landing-variant.ts); absent: the first-timer's. */
  variant?: LandingVariant;
  /** The page's switches; all off when absent (production today). */
  switches?: LandingSwitches;
  /** The UTC day the page was rendered on ("2026-11-15"), for the footer's year. Absent: today. */
  renderDay?: string;
  /** The native app's store links (WP-03 T9); absent: `publicEnv().storeLinks`, null until the app launches. */
  storeLinks?: StoreLinks | null;
}

export function LandingPage({ variant = DEFAULT_LANDING_VARIANT, switches = SWITCHES_OFF, renderDay, storeLinks = publicEnv().storeLinks }: LandingPageProps) {
  const year = (renderDay ?? new Date().toISOString()).slice(0, 4);
  const V = VARIANT_WORDS[variant];
  return (
    <div className="landing-page" data-testid="landing" data-landing="" data-variant={variant} data-people={switches.peopleOpen ? "open" : "closed"}>
      <HomeJsonLd />
      <TopBar peopleOpen={switches.peopleOpen} />
      <main>
        <LandingHero
          signupOpen={switches.signupOpen}
          words={{ title: V.title, lede: V.lede, label: V.label, ideas: V.ideas, surpriseOpen: V.surpriseOpen }}
          example={
            <ScreenFrame label={W.hero.exampleLabel} className="in-data-landed:hidden">
              <ExampleIdeas ideas={exampleIdeasInOrder(V.examples)} cardClassName="world-night landing-screen-lit max-w-full" />
            </ScreenFrame>
          }
        />
        <ResultSection />
        <WaysSection order={V.ways} signupOpen={switches.signupOpen} />
        <StudioSection set={STUDIO_SETS[V.studio ?? "sneakers"]} />
        <PeopleSection peopleOpen={switches.peopleOpen} />
        <FirstWeekSection platformMail={switches.platformMail} />
        <section id="control" aria-labelledby="control-title" className="landing-section">
          <div className="landing-col landing-pair">
            <div className="flex flex-col gap-5">
              <h2 id="control-title" className="t-landing-h2 text-primary">
                {W.control.title}
              </h2>
              <p className="text-secondary">{W.control.rules}</p>
              <p className="text-secondary">{W.control.yes}</p>
              <p className="text-secondary" data-testid="control-honest">
                {W.control.honest}
              </p>
            </div>
            <div id="cost" className="flex flex-col gap-5">
              <h2 className="t-landing-h2 text-primary">{W.cost.title}</h2>
              <p className="t-landing-lede">{W.cost.free}</p>
              <p className="text-secondary">{W.cost.allowance}</p>
              <p className="text-secondary">{W.cost.people}</p>
            </div>
          </div>
        </section>
        <LandingSection id="vacation" title={W.vacation.title} lede={W.vacation.text} />
        <LandingSection id="questions" title={W.questions.title}>
          <QuestionList items={questions(switches)} />
        </LandingSection>
        <section id="start" aria-labelledby="start-title" className="landing-section landing-dusk landing-dawn">
          <div className="landing-col flex flex-col items-start gap-5">
            <h2 id="start-title" className="t-landing-h1">
              {W.start.title}
            </h2>
            <p className="t-landing-lede">{W.start.text}</p>
            <StartButton />
          </div>
        </section>
      </main>
      <footer>
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
    <header className="world-day landing-daylight">
      <div className="landing-col flex h-16 items-center gap-2">
        <Link href="/" className="flex min-h-tap items-center text-primary hover:no-underline" aria-label={W.topBar.home}>
          <Wordmark height={18} label={APP_NAME} />
        </Link>
        <span className="flex-1" />
        {/* The tour is built for a wide screen, so its links show from 1280 px only (the footer's too). */}
        {TOUR_ENABLED ? (
          <Link href="/tour" className="hidden min-h-tap items-center px-3 font-medium text-secondary hover:text-primary desktop:inline-flex" data-testid="landing-tour-top">
            {W.topBar.tour}
          </Link>
        ) : null}
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

/** What comes back, in three facts, still in daylight under the hero. The example beside the box shows them. */
function ResultSection() {
  return (
    <section id="result" aria-labelledby="result-title" className="world-day landing-daylight pb-16 @page-wide:pb-24">
      <div className="landing-col flex flex-col gap-6">
        <h2 id="result-title" className="t-landing-h3 text-primary">
          {W.result.title}
        </h2>
        <ul className="m-0 grid list-none gap-x-12 gap-y-4 p-0 text-secondary @page-wide:grid-cols-3">
          {W.result.points.map((p) => (
            <li key={p.lead} className="border-t border-line-strong pt-4">
              <strong className="font-semibold text-primary">{p.lead}</strong>
              {p.rest}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The three ways in, on the brand's blue: one sentence, the Ideation Studio, bringing what you already have. A variant
 * sets which comes first. They are choices, so they carry no numbers.
 */
function WaysSection({ order, signupOpen }: { order: readonly WayId[]; signupOpen: boolean }) {
  return (
    <section id="ways" aria-labelledby="ways-title" className="landing-section landing-dusk">
      <div className="landing-col flex flex-col gap-10">
        <h2 id="ways-title" className="t-landing-h1">
          {W.ways.title}
        </h2>
        <ul className="m-0 list-none p-0">
          {order.map((id) => (
            <li key={id} className="landing-way" data-way={id}>
              <h3 className="t-landing-h3">{W.ways[id].title}</h3>
              <div className="flex flex-col gap-4">
                <p className="t-landing-lede text-secondary">{W.ways[id].text}</p>
                {id === "bring" ? (
                  <p className="t-landing-small m-0 flex flex-wrap items-center gap-x-2 gap-y-2">
                    <span>{W.ways.bring.sourcesLabel}</span>
                    {W.ways.bring.sources.map((source) => (
                      <span key={source} className="rounded-pill border border-line px-3 py-1">
                        {source}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!signupOpen ? (
          <p className="t-landing-small m-0" data-testid="ways-closed">
            {W.ways.closed}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Inside the Ideation Studio: a set of example ideas from one brief (the variant's), and what a founder does with a set. */
function StudioSection({ set }: { set: StudioSet }) {
  return (
    <section id="studio" aria-labelledby="studio-title" data-nosnippet="" className="landing-section landing-nightfall">
      <div className="landing-col flex flex-col gap-12">
        <div className="landing-split">
          <div className="landing-measure flex flex-col gap-5">
            <h2 id="studio-title" className="t-landing-h2 text-primary">
              {W.studio.title}
            </h2>
            <p className="t-landing-lede">{W.studio.lede}</p>
          </div>
          <Points items={W.studio.points} />
        </div>
        <ScreenFrame label={W.studio.label}>
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="t-landing-small text-secondary">{W.studio.brief(set.brief)}</span>
              <span className="flex flex-wrap items-center gap-2" aria-label={W.studio.steerLabel}>
                {set.steer.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </span>
            </div>
            <div className="landing-ideas">
              {set.cards.map((card) => (
                <IdeaCard key={card.name} card={card} footnote={null} />
              ))}
            </div>
          </div>
        </ScreenFrame>
        {TOUR_ENABLED ? (
          <p className="landing-measure m-0 hidden flex-wrap items-center gap-x-3 gap-y-1 text-secondary desktop:flex" data-testid="landing-tour">
            {W.tour.text}
            <Link href="/tour" className="inline-flex min-h-tap items-center gap-2 font-medium text-accent">
              {W.tour.link}
              <Icon icon={ArrowRight} size="default" />
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Solo is complete; people are one step away. The find block exists only with the people layer on. */
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

/** An example first week, using only what works today. Kept out of search snippets. */
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

/** The questions, the door's only while sign-up is closed. */
function questions(switches: LandingSwitches): QuestionItem[] {
  const q = W.questions;
  const limits = q.limitsEnd;
  return [...(switches.signupOpen ? [] : [q.getIn]), ...q.always, { ...q.limits, answer: limits }, q.adults];
}
