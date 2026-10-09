"use client";
/**
 * The signed-out landing page at `/`: what Foundmill is, how it works, and a way in. Built from design-system parts
 * only (the team orbit, live agent tiles replaying recorded sessions, the Channel Board on an example business), so
 * what a visitor sees is the product itself. Desktop only, like the app: under 1280 px it shows NeedsLargerWindow.
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CircleStop,
  Code2,
  Compass,
  FileSignature,
  Flag,
  Inbox,
  KeyRound,
  Landmark,
  Lightbulb,
  Lock,
  Megaphone,
  Monitor,
  Play,
  Radio,
  Scale,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import {
  AgentTile,
  Button,
  Chip,
  FormationBoard,
  Icon,
  NeedsLargerWindow,
  ProvenanceChip,
  TeamOrbit,
  TileGrid,
  Wordmark,
  isViewportTooSmall,
  mockChannels,
  toggleChannel,
  useLiveMockSessions,
  useViewportWidth,
  type AgentTileSession,
  type ChannelTokenData,
  type TileGridItem,
} from "@foundmill/dugout";
import { MODULE_TABS, type DeptColourToken, type ModuleKey } from "@foundmill/shared";

const SIGN_IN = "/login";

export interface LandingPageProps {
  /** Terminal renderer for the live tiles; tests pass "plain" (no canvas). */
  terminalRenderer?: "plain" | "xterm";
}

export function LandingPage({ terminalRenderer }: LandingPageProps) {
  const width = useViewportWidth();
  if (isViewportTooSmall(width)) return <NeedsLargerWindow width={width} />;
  return (
    <div className="relative min-h-screen overflow-x-clip bg-base text-primary" data-testid="landing">
      <Backdrop />
      <TopBar />
      <main>
        <Hero />
        <Facts />
        <HowItWorks />
        <Departments />
        <LiveSessions terminalRenderer={terminalRenderer} />
        <Channels />
        <YourCall />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------------------------------------------------

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[1100px]">
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 55% at 72% 30%, color-mix(in oklab, var(--kit-primary) 30%, transparent), transparent 70%), radial-gradient(ellipse 40% 40% at 12% 12%, color-mix(in oklab, var(--dept-5) 12%, transparent), transparent 70%)" }} />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklab, var(--white) 9%, transparent) 1px, transparent 1.5px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 70% 60% at 60% 30%, black 30%, transparent 85%)",
        }}
      />
    </div>
  );
}

function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-10 ${className ?? ""}`}>{children}</div>;
}

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#departments", label: "Departments" },
  { href: "#live", label: "Live sessions" },
  { href: "#channels", label: "Channels" },
  { href: "#control", label: "You decide" },
];

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-subtle/60 bg-base/70 backdrop-blur">
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
        <Button asChild variant="primary" iconRight={ArrowRight}>
          <Link href={SIGN_IN}>Start your business</Link>
        </Button>
      </Container>
    </header>
  );
}

function Eyebrow({ children, tone = "var(--accent-link)" }: { children: ReactNode; tone?: string }) {
  return (
    <span className="t-label inline-flex items-center gap-2" style={{ color: tone }}>
      <span aria-hidden className="h-px w-6" style={{ backgroundColor: tone }} />
      {children}
    </span>
  );
}

function SectionHeading({ id, eyebrow, title, lede }: { id: string; eyebrow: string; title: string; lede?: ReactNode }) {
  return (
    <header className="flex max-w-3xl flex-col gap-3">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={`${id}-title`} className="t-display-xl text-primary">
        {title}
      </h2>
      {lede ? <p className="t-reading text-secondary">{lede}</p> : null}
    </header>
  );
}

function Section({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`relative scroll-mt-20 py-24 ${className ?? ""}`}>
      <Container className="flex flex-col gap-12">{children}</Container>
    </section>
  );
}

/** A dark glass card used for the floating hero panels and feature cards. */
function Glass({ children, className, accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <div
      className={`rounded-panel border border-subtle bg-panel/80 backdrop-blur ${className ?? ""}`}
      style={accent ? { borderColor: `color-mix(in oklab, ${accent} 35%, var(--line-subtle))`, boxShadow: `inset 0 1px 0 color-mix(in oklab, ${accent} 25%, transparent)` } : { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------------------------------------------------

const LIVE_LINES: ReadonlyArray<{ who: string; dept: DeptColourToken; text: string }> = [
  { who: "Forge", dept: "dept-2", text: "opened a pull request for the onboarding emails" },
  { who: "Scout", dept: "dept-3", text: "scored all 15 channels for fit" },
  { who: "Ledger", dept: "dept-6", text: "reconciled this week's payments" },
  { who: "Lex", dept: "dept-5", text: "drafted the privacy policy for your review" },
  { who: "Iris", dept: "dept-1", text: "turned twelve customer interviews into the roadmap" },
];

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <Container className="grid min-h-[720px] grid-cols-12 items-center gap-10 py-16">
        <div className="col-span-6 flex animate-rise-in flex-col gap-7">
          <Eyebrow>An AI team for founders</Eyebrow>
          <h1 id="hero-title" className="t-display-hero text-primary">
            {APP_TAGLINE}
          </h1>
          <p className="t-reading max-w-xl text-secondary">
            {APP_NAME} hires, trains and runs a team of AI agents across product, development, distribution, finance, legal and hiring. You set the direction and make the calls that matter. They do the work every cycle, in the open, and bring you the decisions only a founder should make.
          </p>
          <div className="flex items-center gap-3">
            <Button asChild variant="primary" size="lg" iconRight={ArrowRight}>
              <Link href={SIGN_IN}>Start your business</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <a href="#how">See how it works</a>
            </Button>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-small text-secondary">
            <Assurance icon={ShieldCheck}>Nothing moves money or signs in your name without you</Assurance>
            <Assurance icon={KeyRound}>Bring your own Anthropic key</Assurance>
            <Assurance icon={Monitor}>A desktop app, built for focus</Assurance>
          </ul>
        </div>
        <div className="relative col-span-6 py-16">
          <TeamOrbit className="mx-auto max-w-[500px]" />
          <DecisionCard />
          <LiveNow />
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

function DecisionCard() {
  return (
    <Glass className="absolute -right-10 top-0 z-10 w-60 p-3" accent="var(--kit-primary)">
      <div aria-hidden className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={Inbox} size={14} className="text-link" />
          <span className="t-label">Decision for you</span>
        </span>
        <p className="text-body-strong text-primary">Approve the first print booking?</p>
        <p className="text-small text-secondary">Distribution prepared the artwork and the booking pack. Booking commits budget, so it waits for you.</p>
        <div className="flex gap-2 pt-1">
          <span className="inline-flex h-7 items-center rounded-chip bg-kit-primary px-2.5 text-small font-medium text-kit-on-primary">Approve</span>
          <span className="inline-flex h-7 items-center whitespace-nowrap rounded-chip border border-subtle px-2.5 text-small text-primary">Get a quote first</span>
        </div>
      </div>
    </Glass>
  );
}

function LiveNow() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % LIVE_LINES.length), 2600);
    return () => clearInterval(t);
  }, []);
  const shown = [0, 1, 2].map((k) => LIVE_LINES[(i + k) % LIVE_LINES.length]!);
  return (
    <Glass className="absolute -left-12 bottom-0 z-10 w-64 p-3">
      <div aria-hidden className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="relative inline-flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-status-good/60" />
            <span className="relative size-2 rounded-full bg-status-good" />
          </span>
          <span className="t-label">Live now</span>
        </span>
        <ul className="flex flex-col gap-1.5">
          {shown.map((l, k) => (
            <li key={`${i}-${k}`} className="flex animate-fade-in items-baseline gap-1.5 text-small" style={{ opacity: 1 - k * 0.28 }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--${l.dept})` }} />
              <span>
                <span className="font-medium text-primary">{l.who}</span> <span className="text-secondary">{l.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Glass>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Facts, how it works, departments
// ---------------------------------------------------------------------------------------------------------------------

const FACTS = [
  { figure: "6", label: "departments", text: "Product, Development, Distribution, Finance, Legal and Team, each with a lead agent." },
  { figure: "15", label: "channels", text: "Scored 1–20 for fit to your business before any budget is spent." },
  { figure: "1", label: "Chief of Staff", text: "Plans every cycle and writes you a short note about what happened." },
  { figure: "0", label: "signatures in your name", text: "Money, contracts and filings always wait for you." },
];

function Facts() {
  return (
    <section aria-label={`${APP_NAME} at a glance`}>
      <Container>
        <div className="grid grid-cols-4 divide-x divide-subtle rounded-panel border border-subtle bg-panel/70 backdrop-blur">
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col gap-1 p-6">
              <span className="flex items-baseline gap-2">
                <span className="t-display-xl tabular-nums text-primary">{f.figure}</span>
                <span className="t-label">{f.label}</span>
              </span>
              <p className="text-small text-secondary">{f.text}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

const STEPS: ReadonlyArray<{ n: string; icon: LucideIcon; title: string; text: string }> = [
  { n: "01", icon: Lightbulb, title: "Shape the idea", text: "Start from a sentence in the Ideation Studio, or import what already exists: your repository, documents, trackers, revenue and company registry. Concepts are drafted around your skills, your time and your constraints." },
  { n: "02", icon: Flag, title: "Commit", text: "Name it, choose your logo and brand colours, and decide how hands-on you want to be. Committing creates the departments, hires the team and drafts the first roadmap." },
  { n: "03", icon: Play, title: "Press Continue", text: "Each cycle the Chief of Staff plans the work, agents run it in sandboxes, and your Inbox gets a short note with anything that needs your decision." },
];

function HowItWorks() {
  return (
    <Section id="how">
      <SectionHeading id="how" eyebrow="How it works" title="From an idea to a running business, one cycle at a time." lede="You do not manage prompts. You run a business: set direction, approve what matters, and let the team carry the rest." />
      <ol className="relative grid grid-cols-3 gap-6">
        <span aria-hidden className="absolute left-8 right-8 top-10 h-px" style={{ background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--kit-primary) 70%, var(--white)), transparent)" }} />
        {STEPS.map((s) => (
          <li key={s.n} className="relative">
            <Glass className="flex h-full flex-col gap-4 p-6">
              <span className="flex items-center gap-3">
                <span className="relative grid size-12 place-items-center rounded-full border" style={{ borderColor: "color-mix(in oklab, var(--kit-primary) 70%, var(--white))", background: "radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--kit-primary) 70%, var(--white)), color-mix(in oklab, var(--kit-primary) 55%, var(--bg-ink)) 75%)" }}>
                  <Icon icon={s.icon} size={20} className="text-kit-on-primary" />
                </span>
                <span className="t-display-md tabular-nums text-secondary">{s.n}</span>
              </span>
              <h3 className="t-display-md text-primary">{s.title}</h3>
              <p className="text-body text-secondary">{s.text}</p>
            </Glass>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const DEPARTMENTS: ReadonlyArray<{ key: ModuleKey; name: string; dept: DeptColourToken; icon: LucideIcon; text: string }> = [
  { key: "product", name: "Product", dept: "dept-1", icon: Compass, text: "A vision, a living specification and a roadmap that moves as customers teach you something." },
  { key: "development", name: "Development", dept: "dept-2", icon: Code2, text: "Agents plan the tasks, write and test code in sandboxes, and open pull requests for review." },
  { key: "distribution", name: "Distribution", dept: "dept-3", icon: Megaphone, text: "Fifteen channels scored for fit; the strongest start first, inside the budget caps you set." },
  { key: "finance", name: "Finance", dept: "dept-6", icon: Wallet, text: "Cash, burn, runway and a reconciled ledger. Anything that is not a real figure is labelled Forecast or Estimate." },
  { key: "legal", name: "Legal", dept: "dept-5", icon: Scale, text: "Incorporation, contracts, IP and regulatory checklists, prepared in full. You review and sign." },
  { key: "team", name: "Team", dept: "dept-8", icon: Users, text: "Hire agents from templates, train them against real tests, and watch their skills grow." },
];

function Departments() {
  return (
    <Section id="departments">
      <SectionHeading id="departments" eyebrow="Departments" title="Every department, staffed from day one." lede="Each department has a lead agent and the specialists it needs. They share one picture of your business, so product, code, marketing and money stay in step." />
      <div className="grid grid-cols-3 gap-6">
        {DEPARTMENTS.map((d) => {
          const accent = `var(--${d.dept})`;
          return (
            <Glass key={d.key} accent={accent} className="group relative flex flex-col gap-4 overflow-hidden p-6">
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full opacity-60 transition-opacity duration-panel group-hover:opacity-100" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 30%, transparent), transparent)` }} />
              <span className="relative flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-panel border" style={{ borderColor: `color-mix(in oklab, ${accent} 60%, transparent)`, backgroundColor: `color-mix(in oklab, ${accent} 16%, var(--bg-ink))`, color: `color-mix(in oklab, ${accent} 80%, var(--white))` }}>
                  <Icon icon={d.icon} size={20} />
                </span>
                <h3 className="t-display-md text-primary">{d.name}</h3>
              </span>
              <p className="relative text-body text-secondary">{d.text}</p>
              <ul className="relative mt-auto flex flex-wrap gap-1.5" aria-label={`${d.name} screens`}>
                {MODULE_TABS[d.key].map((t) => (
                  <li key={t.slug}>
                    <Chip tone="neutral">{t.title}</Chip>
                  </li>
                ))}
              </ul>
            </Glass>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Live sessions and channels (the product itself, on example data)
// ---------------------------------------------------------------------------------------------------------------------

type TileItem = TileGridItem & { session: AgentTileSession };

/** The replay runs on a clock, so it renders in the browser only (the server sends the frame and a placeholder). */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function LiveSessions({ terminalRenderer }: { terminalRenderer?: "plain" | "xterm" }) {
  const mounted = useMounted();
  return (
    <Section id="live">
      <SectionHeading id="live" eyebrow="Live sessions" title="Watch the work happen." lede="Every agent works in its own sandbox and streams what it is doing: terminal, diff, preview and plan. Nudge one, pause one, or stop them all with a single button." />
      <Glass className="overflow-hidden">
        <div className="flex h-10 items-center gap-2 border-b border-subtle bg-panel-alt/80 px-4">
          <span className="relative inline-flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-status-good/60" />
            <span className="relative size-2 rounded-full bg-status-good" />
          </span>
          <span className="t-label">Live sessions · 4 agents</span>
          <span className="flex-1" />
          <Chip tone="neutral" icon={Radio}>
            Recorded example, replayed
          </Chip>
          <ProvenanceChip kind="estimate" />
        </div>
        <div className="h-[680px] bg-base">{mounted ? <LiveTiles terminalRenderer={terminalRenderer} /> : <div className="size-full animate-shimmer" />}</div>
      </Glass>
    </Section>
  );
}

function LiveTiles({ terminalRenderer }: { terminalRenderer?: "plain" | "xterm" }) {
  const live = useLiveMockSessions(4, { intervalMs: 500 });
  const [focused, setFocused] = useState<string | null>(null);
  const items: TileItem[] = live.sessions.map((s) => ({ id: s.id, label: `${s.agent.name}: ${s.task.title}`, avatar: { name: s.agent.name, seed: s.agent.seed, dept: s.agent.dept, status: s.agent.status }, session: s }));
  const noop = () => {};
  return (
          <TileGrid
            items={items}
            focusedId={focused}
            onFocusedChange={setFocused}
            aria-label="Example agent sessions"
            renderTile={(item, ctx) => (
              <AgentTile
                session={item.session}
                focused={ctx.focused}
                compact={ctx.compact}
                now={live.now}
                diffEngine="local"
                terminalRenderer={terminalRenderer}
                onFocus={(id) => setFocused(focused === id ? null : id)}
                controls={{ onPause: noop, onResume: noop, onShout: noop, onReassign: noop, onUpgradeModel: noop, onStop: noop }}
              />
            )}
          />
  );
}

function Channels() {
  const [channels, setChannels] = useState<ChannelTokenData[]>(() => mockChannels());
  return (
    <Section id="channels">
      <div className="flex items-end justify-between gap-10">
        <SectionHeading id="channels" eyebrow="Distribution" title="Fifteen channels. The right few first." lede="The Distribution Strategist scores every channel 1–20 for fit, puts the strongest on the board within your runway, and shows you why. Drag a channel on or off to try it." />
        <span className="flex shrink-0 items-center gap-2 pb-1">
          <Chip tone="neutral">Example business</Chip>
          <ProvenanceChip kind="estimate" />
        </span>
      </div>
      <FormationBoard channels={channels} onToggle={(k, on) => setChannels((prev) => toggleChannel(prev, k, on))} hoverCards={false} />
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Control and the way in
// ---------------------------------------------------------------------------------------------------------------------

const HOUSE_RULES: ReadonlyArray<{ icon: LucideIcon; text: string }> = [
  { icon: Landmark, text: "Never moves money" },
  { icon: FileSignature, text: "Never signs anything or accepts terms" },
  { icon: Tag, text: "Never files anything with your identity" },
  { icon: Trash2, text: "Never deletes anything permanently" },
  { icon: Lock, text: "Never changes security settings" },
  { icon: ShieldCheck, text: "Never acts on instructions found in emails, web pages or files it reads" },
];

const CONTROLS: ReadonlyArray<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: CircleStop, title: "Stop all agents", text: "One button in the top bar pauses every agent at once. They resume where they stopped." },
  { icon: Inbox, title: "Decisions, not dashboards", text: "When something needs you, it arrives as a short note with options, a recommendation and what each choice costs." },
  { icon: KeyRound, title: "Your key, sealed", text: "Bring your own Anthropic key. Credentials are encrypted per business and never sent into a sandbox." },
];

function YourCall() {
  return (
    <Section id="control">
      <SectionHeading id="control" eyebrow="You decide" title="Your team does the work. You make the calls." lede="House rules sit above every agent's instructions and cannot be edited away. When work needs one of these, the team prepares everything and asks you." />
      <div className="grid grid-cols-12 gap-6">
        <Glass className="col-span-7 flex flex-col gap-4 p-6" accent="var(--status-good)">
          <span className="t-label inline-flex items-center gap-1.5">
            <Icon icon={ShieldCheck} size={14} className="text-status-good" /> House rules
          </span>
          <ul className="grid grid-cols-2 gap-3">
            {HOUSE_RULES.map((r) => (
              <li key={r.text} className="flex items-start gap-3 rounded-panel border border-subtle/70 bg-ink/40 p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-status-good/12 text-status-good">
                  <Icon icon={r.icon} size={16} />
                </span>
                <span className="text-body text-primary">{r.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto flex items-start gap-2 border-t border-subtle/70 pt-4 text-body text-secondary">
            <Icon icon={Inbox} size={16} className="mt-0.5 shrink-0 text-link" />
            When a task needs one of these, the agent raises a request with everything prepared, and that piece of work waits for you. The rest of the team keeps going.
          </p>
        </Glass>
        <div className="col-span-5 flex flex-col gap-6">
          {CONTROLS.map((c) => (
            <Glass key={c.title} className="flex gap-4 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-panel border border-subtle bg-panel-alt text-link">
                <Icon icon={c.icon} size={20} />
              </span>
              <span className="flex flex-col gap-1">
                <h3 className="t-display-sm text-primary">{c.title}</h3>
                <p className="text-body text-secondary">{c.text}</p>
              </span>
            </Glass>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FinalCall() {
  return (
    <section aria-labelledby="start-title" className="relative py-24">
      <Container>
        <div className="relative overflow-hidden rounded-panel border border-subtle px-16 py-20 text-center">
          <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(ellipse 55% 90% at 50% 100%, color-mix(in oklab, var(--kit-primary) 45%, transparent), transparent 70%), var(--bg-ink)" }} />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--white) 10%, transparent) 1px, transparent 1.5px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse 60% 80% at 50% 100%, black 20%, transparent 80%)" }}
          />
          <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
            <h2 id="start-title" className="t-display-hero text-primary">
              Your team is ready when you are.
            </h2>
            <p className="t-reading text-secondary">Sign in with your email. No password, no card. Start from an idea or bring the business you already have.</p>
            <div className="flex gap-3">
              <Button asChild variant="primary" size="lg" iconRight={ArrowRight}>
                <Link href={SIGN_IN}>Start your business</Link>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <Link href={SIGN_IN}>Sign in</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-subtle/60">
      <Container className="flex h-20 items-center gap-6 text-small text-secondary">
        <Wordmark height={12} label={APP_NAME} className="text-secondary" />
        <span>{APP_TAGLINE}</span>
        <span className="flex-1" />
        <span>Desktop only · 1280 px and wider</span>
        <span>© {new Date().getFullYear()} {APP_NAME}</span>
      </Container>
    </footer>
  );
}
