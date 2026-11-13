"use client";
/**
 * The journey: the example business on the product's Journey Ribbon (two years of chapters, revenue, signups, paying
 * customers and milestones, the forecast after Today), then one Customer Update (who made a customer happen, touch by
 * touch, with the standout agent) beside the milestones. All of it is the example business, labelled as such.
 */
import { useEffect, useMemo, useState } from "react";
import { Clock, Coins, MousePointerClick, Radio, Star, Trophy } from "lucide-react";
import { Avatar, Chip, EntityLinkProvider, EntityText, Icon, JourneyRibbon, ProvenanceChip, Term, TrophyCabinet, cn } from "@foundmill/dugout";
import { useExample } from "./examples/context";
import { datedCustomerUpdate, datedMilestones, exampleJourney, exampleMoney, type ExampleJourneyData } from "./examples/helpers";
import type { ExampleBusiness } from "./examples/types";
import { Glass, ProductWindow, Reveal, Section, SectionHeading, useSeen, useToday } from "./parts";

/** Taller than Home's 300 px so all four rows (revenue, signups, paying customers, agent hours) read at a glance. */
const RIBBON_HEIGHT = 400;

export function JourneySection() {
  const business = useExample();
  const { identity, deck } = business;
  const [ref, seen] = useSeen<HTMLDivElement>("600px");
  // The story is moved to today: the Ribbon, the milestone cards and the Customer Update agree on every date.
  const today = useToday();
  const data = useIdleJourney(seen, business, today);
  const milestones = useMemo(() => datedMilestones(business, today), [business, today]);
  return (
    <Section id="journey">
      <SectionHeading
        id="journey"
        eyebrow="The journey"
        title="Watch the business grow, chapter by chapter."
        lede={
          <>
            The Journey puts the whole business on one time axis: revenue, signups, paying customers and agent hours, in <Term id="chapter">chapters</Term>, with every milestone pinned. When a customer pays, a Customer Update shows who made it happen, touch by touch.
          </>
        }
      />
      <Reveal>
        <div ref={ref}>
          <ProductWindow
            title={`Journey · ${identity.name}`}
            chips={
              <span className="flex items-center gap-2">
                <Chip tone="neutral">Example business</Chip>
                <ProvenanceChip kind="estimate" />
              </span>
            }
          >
            <div className="bg-panel" style={{ height: RIBBON_HEIGHT }}>
              {data ? (
                <JourneyRibbon
                  rows={data.rows}
                  departments={[...business.journey.ribbonDepartments]}
                  conversions={data.conversions}
                  milestones={data.milestones}
                  chapters={data.chapters}
                  forecast={data.forecast}
                  roadmap={data.roadmap}
                  runwayMonths={deck.runwayMonths}
                  today={data.today}
                  kit={identity.kit}
                  currency={business.currency}
                  defaultZoom="all"
                  overlay="svg"
                  height={RIBBON_HEIGHT}
                  label="Example business journey"
                />
              ) : (
                <div className="size-full animate-shimmer" />
              )}
            </div>
          </ProductWindow>
        </div>
      </Reveal>
      <div className="grid grid-cols-12 gap-10">
        <Reveal className="col-span-7">
          <CustomerUpdate today={today} />
        </Reveal>
        <Reveal className="col-span-5" delay={90}>
          <Glass className="flex h-full flex-col gap-3 p-5">
            <span className="flex items-center justify-end gap-2">
              <Chip tone="neutral">Example business</Chip>
              <ProvenanceChip kind="estimate" />
            </span>
            <TrophyCabinet trophies={milestones} columns={2} />
          </Glass>
        </Reveal>
      </div>
    </Section>
  );
}

/**
 * Two years of the example's daily rows take tens of milliseconds to build, so they are built when the browser is idle
 * after the section comes near the window, never during a scroll frame.
 */
function useIdleJourney(seen: boolean, business: ExampleBusiness, today: string): ExampleJourneyData | null {
  const [built, setBuilt] = useState<{ today: string; data: ExampleJourneyData } | null>(null);
  const data = built?.today === today ? built.data : null;
  useEffect(() => {
    if (!seen || data) return;
    const build = () => setBuilt({ today, data: exampleJourney(business, today) });
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(build, { timeout: 800 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(build, 0);
    return () => clearTimeout(t);
  }, [seen, data, business, today]);
  return data;
}

/** A Customer Update, compact: the customer, the path in four numbers, the narrated touches and who was involved. */
function CustomerUpdate({ today }: { today: string }) {
  const business = useExample();
  const u = useMemo(() => datedCustomerUpdate(business, today), [business, today]);
  // The customer is an organisation; on this page there is no profile to open, so the mention carries its facts only.
  const entities = useMemo(
    () => ({
      resolve: (id: string) => (id === u.customer.entityId ? { id, kind: "organisation" as const, name: u.customer.name, subtitle: "Example customer", facts: [...u.customer.facts] } : undefined),
      onOpen: () => {},
    }),
    [u],
  );
  return (
    <section aria-label="Customer Update" className="relative h-full overflow-hidden rounded-panel border border-gold/45 bg-panel" style={{ boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--gold) 35%, transparent), 0 0 80px -30px color-mix(in oklab, var(--gold) 40%, transparent)" }}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-gold via-gold-deep to-transparent" />
      <span aria-hidden className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full" style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--gold) 16%, transparent), transparent)" }} />
      <div className="relative flex flex-col gap-5 p-6">
        <span className="flex items-center gap-2">
          <Icon icon={Trophy} size={16} className="text-gold" />
          <span className="t-label text-gold">Customer Update · {u.level}</span>
          <span className="flex-1" />
          <Chip tone="neutral">Example</Chip>
        </span>
        <span className="flex flex-col gap-1">
          <span className="t-display-xl text-primary">{u.customer.name}</span>
          <span className="text-body text-secondary">Customer won · {u.plan}</span>
        </span>
        <dl className="grid grid-cols-[1fr_1fr_1fr_1.6fr] divide-x divide-subtle rounded-panel border border-subtle bg-ink/50">
          <Stat icon={MousePointerClick} label="Touches" value={String(u.stats.touches)} />
          <Stat icon={Radio} label="Channels" value={String(u.stats.channels)} />
          <Stat icon={Clock} label="Days" value={String(u.stats.days)} />
          <Stat icon={Coins} label="Cost to acquire" value={exampleMoney(business, u.stats.acquisitionCostMinor)} estimate />
        </dl>
        <div className="grid grid-cols-[1fr_15rem] gap-6">
          <EntityLinkProvider value={entities}>
            <ol className="relative flex flex-col gap-3 pl-5" aria-label="How it happened">
              <span aria-hidden className="absolute bottom-1 left-1.5 top-1 w-px bg-gradient-to-b from-gold/70 via-subtle to-gold/70" />
              {u.commentary.map((c, i) => (
                <li key={i} className="relative">
                  <span aria-hidden className={cn("absolute -left-5 top-1.5 size-3 rounded-full border-2 border-panel", c.highlight ? "bg-gold" : "bg-secondary")} />
                  <EntityText as="p" className={cn("text-body", c.highlight ? "text-primary" : "text-secondary")}>
                    {c.text}
                  </EntityText>
                </li>
              ))}
            </ol>
          </EntityLinkProvider>
          <div className="flex flex-col gap-2">
            <span className="t-label">Who was involved</span>
            {u.agents.map((a) => (
              <span key={a.name} className={cn("flex items-center gap-2 rounded-panel border px-2 py-1.5", a.standout ? "border-gold/50 bg-gold/8" : "border-subtle/70")}>
                <Avatar size={32} name={a.name} agent={{ seed: a.seed, dept: a.dept }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 t-body-strong text-primary">
                    {a.name}
                    {a.standout ? <Star size={12} className="text-gold" fill="currentColor" aria-hidden /> : null}
                  </span>
                  <span className="block truncate text-small text-secondary">{a.standout ? "Standout agent" : a.role}</span>
                </span>
                <span className="t-display-lg tabular-nums text-primary">
                  {a.rating}
                  <span className="sr-only"> out of 10</span>
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, label, value, estimate }: { icon: typeof Clock; label: string; value: string; estimate?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="t-label inline-flex items-center gap-1.5">
        <Icon icon={icon} size={12} />
        {label}
      </dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="t-display-md tabular-nums text-primary">{value}</span>
        {estimate ? <ProvenanceChip kind="estimate" /> : null}
      </dd>
    </div>
  );
}
