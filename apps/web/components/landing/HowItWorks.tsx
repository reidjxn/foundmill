"use client";
/**
 * How it works: four steps, each shown with the product part it uses. The Ideation Studio's concept cards, the
 * logo and brand colours picker (it works: pick one and the brand bar follows), the Chief of Staff's cycle plan, and
 * day one as it really runs (docs/UX_AUDIT_AND_PLAN.md §7.1): the foundations drafting panel with its authors, the plan
 * note tagged Respond in the Inbox, then Continue.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Flag, Lightbulb, LoaderCircle, Play, Sunrise, type LucideIcon } from "lucide-react";
import { Avatar, AvatarStack, BusinessLogo, Chip, ConceptCard, ContinueButton, DRAFTING_LINE, Icon, ProgressRing, ProvenanceChip, StatusPill, Term, cn, kitBarGradient, kitStyle, type Kit } from "@foundmill/dugout";
import { PLAN_READY_NOTE } from "@foundmill/shared";
import { NOTE_TAG_ICONS, RESPOND_TAG } from "@foundmill/widgets/shared/note-tags";
import { useExample } from "./examples/context";
import { departmentOf, exampleMoney, leadOf } from "./examples/helpers";
import { Glass, Reveal, Section, SectionHeading } from "./parts";

/** The plan note day one sends, word for word (WP-04 T5: one note, `PLAN_READY_NOTE` in packages/shared). */
export const FIRST_DAY_SIGNOFFS = [PLAN_READY_NOTE.subject] as const;
/** The drafting panel's title as the app shows it (Dugout `FoundationsStatus`: the heading and its Drafting pill). */
export const FIRST_DAY_PANEL_TITLE = "Vision, specification and roadmap · Drafting";
/** One sentence on day one (docs/UX_AUDIT_AND_PLAN.md §7.1). */
export const FIRST_DAY_SENTENCE = "The team drafts; you sign off; then they build. Your project's money is never spent without your approval; agent work uses your monthly allowance.";

export function HowItWorks() {
  return (
    <Section id="how">
      <SectionHeading id="how" eyebrow="How it works" title="From an idea to a running business, one cycle at a time." lede="You do not manage prompts. You run a business: set the direction, approve what matters, and let the team carry the rest." />
      {/* Two by two: each step's product part keeps the width it has in the app (a concept card, the brand picker). */}
      <ol className="grid grid-cols-2 gap-10">
        <Step n="01" icon={Lightbulb} title="Shape the idea" text={
            <>
              Start from a sentence, or import what already exists: your <Term id="repository">repository</Term>, documents, trackers, revenue and company registry. Concepts are drafted around your skills, time and money, and rated for <Term id="fit">fit</Term>.
            </>
          } delay={0}>
          <ConceptStack />
        </Step>
        <Step n="02" icon={Flag} title="Make it yours" text="Name it, choose a logo and brand colors, and decide how hands-on you want to be. Committing creates the departments, hires the team and drafts the first roadmap." delay={90}>
          <BrandPicker />
        </Step>
        <Step n="03" icon={Play} title="Press Continue" text={
            <>
              Each <Term id="cycle">cycle</Term> the <Term id="chief_of_staff">Chief of Staff</Term> plans the work, agents do it in <Term id="sandbox">sandboxes</Term>, and your Inbox gets a short note with anything that needs your decision.
            </>
          } delay={180}>
          <CyclePlan />
        </Step>
        <Step n="04" icon={Sunrise} title="Your first day" text={FIRST_DAY_SENTENCE} delay={270}>
          <FirstDay />
        </Step>
      </ol>
    </Section>
  );
}

function Step({ n, icon, title, text, children, delay }: { n: string; icon: LucideIcon; title: string; text: ReactNode; children: ReactNode; delay: number }) {
  return (
    <Reveal as="li" delay={delay}>
      <Glass className="flex h-full flex-col overflow-hidden">
        <div className="relative h-88 overflow-hidden border-b border-subtle bg-ink/70">{children}</div>
        <div className="flex flex-col gap-3 p-8">
          {/* The Example chip sits on the step's own line, so it never covers the product part above. */}
          <span className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full border" style={{ borderColor: "color-mix(in oklab, var(--kit-primary) 70%, var(--white))", background: "radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--kit-primary) 70%, var(--white)), color-mix(in oklab, var(--kit-primary) 55%, var(--bg-ink)) 75%)" }}>
              <Icon icon={icon} size={16} className="text-kit-on-primary" />
            </span>
            <span className="t-label tabular-nums">Step {n}</span>
            <span className="flex-1" />
            <Chip tone="neutral">Example</Chip>
          </span>
          <h3 className="t-display-md text-primary" data-testid="step-title">
            {title}
          </h3>
          <p className="text-body text-secondary">{text}</p>
        </div>
      </Glass>
    </Reveal>
  );
}

/** Two of the Ideation Studio's concept cards, the second behind the first, fading out at the bottom. */
function ConceptStack() {
  const [front, back] = useExample().howItWorks.concepts;
  return (
    <div className="absolute inset-0" style={{ maskImage: "linear-gradient(180deg, black 70%, transparent 100%)" }}>
      {back ? (
        <div aria-hidden inert className="absolute left-1/2 top-10 origin-top-left -translate-x-1/3 rotate-6 opacity-50">
          {/* Decoration: out of the accessibility tree and out of the tab order (its card has buttons). */}
          <ConceptCard concept={back} hideActions />
        </div>
      ) : null}
      {front ? (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 -rotate-2 shadow-overlay">
          <ConceptCard concept={front} hideActions />
        </div>
      ) : null}
    </div>
  );
}

/** Logo and brand colours: six generated logos to choose from; the choice paints the brand bar under them. */
function BrandPicker() {
  const { identity, howItWorks } = useExample();
  const options = useMemo(() => howItWorks.brandOptions.map((o, i) => ({ seed: i === 0 ? identity.seed : `${identity.seed} ${i}`, kit: o.kit as Kit, logo: o.logo })), [identity, howItWorks]);
  const [chosen, setChosen] = useState(0);
  const pick = options[chosen]!;
  return (
    <div className="flex size-full flex-col justify-center gap-5 px-6" style={kitStyle(pick.kit)}>
      <div className="flex items-center gap-5">
        <span className="grid size-28 shrink-0 place-items-center rounded-panel border border-subtle bg-base transition-shadow duration-panel" style={{ boxShadow: "0 0 48px -10px var(--kit-primary)" }}>
          <BusinessLogo src={pick.logo} name={identity.name} primary={pick.kit.primary} size={96} />
        </span>
        <div role="group" aria-label="Choose a logo" className="grid grid-cols-3 gap-2">
          {options.map((o, i) => (
            <button
              key={o.seed}
              type="button"
              aria-pressed={i === chosen}
              aria-label={`Logo option ${i + 1}`}
              onClick={() => setChosen(i)}
              className={cn("grid size-14 place-items-center rounded-panel border bg-base transition-colors duration-micro", i === chosen ? "border-link" : "border-subtle hover:border-secondary/60")}
            >
              <BusinessLogo src={o.logo} name={identity.name} primary={o.kit.primary} size={48} title={`Logo option ${i + 1}`} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex h-11 items-center gap-2 rounded-panel px-3 text-kit-on-primary transition-[background-image] duration-panel" style={{ backgroundImage: kitBarGradient(pick.kit) }}>
        <BusinessLogo src={pick.logo} name={identity.name} primary={pick.kit.primary} size={24} />
        <span className="t-display-sm">{identity.name}</span>
        <span className="flex-1" />
        <span className="t-tab-sm rounded-panel bg-ink/25 px-2 py-1">Continue</span>
      </div>
      <span className="flex items-center gap-2 text-small text-secondary">
        <Chip tone="neutral">Assisted</Chip>
        Routine work runs within caps; contracts and new spend ask first.
      </span>
    </div>
  );
}

/** The Chief of Staff's plan for a cycle: tasks per department, then the note that comes back. */
function CyclePlan() {
  const business = useExample();
  const plan = business.howItWorks.firstCyclePlan;
  const chief = business.chief;
  const total = plan.reduce((s, p) => s + p.tasks, 0);
  return (
    <div className="flex size-full flex-col gap-3 p-5">
      <span className="flex items-center gap-2">
        <Avatar size={32} name={chief.name} agent={{ seed: chief.seed, dept: chief.dept }} />
        <span className="flex flex-col">
          <span className="t-body-strong text-primary">{chief.name} · Chief of Staff</span>
          <span className="text-small text-secondary">Plan for cycle 1</span>
        </span>
      </span>
      <ul className="flex flex-col gap-1.5">
        {plan.map((p) => {
          const dept = departmentOf(business, p.department).dept;
          const lead = leadOf(business, p.department);
          return (
            <li key={p.department} className="flex items-center gap-2 rounded-panel border border-subtle/70 bg-panel/80 px-2.5 py-1.5">
              <span className="h-6 w-1 rounded-full" style={{ backgroundColor: `var(--${dept})` }} />
              <Avatar size={20} name={lead.name} agent={{ seed: lead.seed, dept }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small text-primary">{p.task}</span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-panel-alt">
                  <span className="block h-full rounded-full" style={{ width: `${p.done}%`, backgroundColor: `var(--${dept})` }} />
                </span>
              </span>
              <span className="text-small tabular-nums text-secondary">{p.tasks}</span>
            </li>
          );
        })}
      </ul>
      <span className="mt-auto flex items-center gap-2 text-small text-secondary">
        <span className="tabular-nums">
          {total} tasks · {plan.length} departments · {exampleMoney(business, total * business.deck.costPerTaskMinor)}
        </span>
        <ProvenanceChip kind="estimate" />
      </span>
    </div>
  );
}

/**
 * Day one, in the order it happens (docs/UX_AUDIT_AND_PLAN.md §7.1; the founder's decision of Oct 20, 2026 keeps the
 * first Continue red until both notes are answered): the foundations drafting panel as Home shows it, with the agents
 * writing it named; the plan note in the Inbox, tagged Respond with the product's own tag; then Continue,
 * which starts the building. It is the sequence, not the deck: nothing here is pressed, so Continue is inert.
 */
function FirstDay() {
  const business = useExample();
  // The Product lead writes the foundations (packages/agents foundations.ts); the Chief of Staff plans the first cycle.
  const product = business.leads.find((l) => departmentOf(business, l.department).module === "product") ?? business.leads[0]!;
  const dept = departmentOf(business, product.department).dept;
  const chief = business.chief;
  const planned = business.howItWorks.firstCyclePlan.reduce((s, p) => s + p.tasks, 0);
  return (
    <div className="flex size-full flex-col gap-2.5 p-4">
      <section aria-label={FIRST_DAY_PANEL_TITLE} className="flex flex-col rounded-panel border border-subtle bg-panel/80">
        <div className="flex h-panel-header items-center gap-2 border-b border-subtle px-3">
          <span className="t-title text-primary">
            Vision, <Term id="specification">specification</Term> and roadmap
          </span>
          <span className="flex-1" />
          <StatusPill tone="info" icon={LoaderCircle} pulse>
            Drafting
          </StatusPill>
        </div>
        <div className="flex items-start gap-3 px-3 py-2.5">
          <span className="mt-0.5 shrink-0" aria-hidden>
            <ProgressRing indeterminate size={20} strokeWidth={2} tone="kit" label="Drafting" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="t-body-strong text-primary">{DRAFTING_LINE}</p>
            <p className="flex items-start gap-2 text-small text-secondary">
              <AvatarStack size={20} className="mt-px shrink-0" items={[{ name: product.name, agent: { seed: product.seed, dept } }, { name: chief.name, agent: { seed: chief.seed, dept: chief.dept } }]} />
              <span>
                {product.name}, {product.role}, writes it from your idea and your profile. {chief.name}, Chief of Staff, plans the first cycle from the roadmap.
              </span>
            </p>
          </div>
        </div>
      </section>
      <ul aria-label="Inbox" className="flex flex-col rounded-panel border border-subtle bg-panel/80">
        {FIRST_DAY_SIGNOFFS.map((subject) => (
          <li key={subject} className="flex items-center gap-2.5 border-b border-subtle/50 px-3 py-2 last:border-b-0">
            <Avatar size={24} name={product.name} agent={{ seed: product.seed, dept }} />
            <span className="t-body-strong min-w-0 flex-1 text-primary">{subject}</span>
            <Chip tone={RESPOND_TAG.tone} icon={NOTE_TAG_ICONS[RESPOND_TAG.icon]} className="h-badge shrink-0">
              {RESPOND_TAG.word}
            </Chip>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center gap-3">
        <span className="sr-only">Then press Continue.</span>
        {/* The product's own button, shown and not pressable: the deck above is where a visitor presses it. */}
        <span inert className="inline-flex">
          <ContinueButton state={{ kind: "idle" }} />
        </span>
        <span className="text-small text-secondary tabular-nums">Building starts: {planned} tasks planned</span>
      </div>
    </div>
  );
}
