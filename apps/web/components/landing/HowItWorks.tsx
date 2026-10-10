"use client";
/**
 * How it works: three steps, each shown with the product part it uses. The Ideation Studio's concept cards, the
 * logo and brand colours picker (it works: pick one and the brand bar follows), and the Chief of Staff's cycle plan.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Flag, Lightbulb, Play, type LucideIcon } from "lucide-react";
import { Avatar, BusinessLogo, Chip, ConceptCard, Icon, ProvenanceChip, cn, kitBarGradient, kitStyle, type Kit } from "@foundmill/dugout";
import { useExample } from "./examples/context";
import { departmentOf, exampleMoney, leadOf } from "./examples/helpers";
import { Glass, Reveal, Section, SectionHeading } from "./parts";

export function HowItWorks() {
  return (
    <Section id="how">
      <SectionHeading id="how" eyebrow="How it works" title="From an idea to a running business, one cycle at a time." lede="You do not manage prompts. You run a business: set the direction, approve what matters, and let the team carry the rest." />
      <ol className="grid grid-cols-3 gap-6">
        <Step n="01" icon={Lightbulb} title="Shape the idea" text="Start from a sentence, or import what already exists: your repository, documents, trackers, revenue and company registry. Concepts are drafted around your skills, time and money, and rated for fit." delay={0}>
          <ConceptStack />
        </Step>
        <Step n="02" icon={Flag} title="Make it yours" text="Name it, choose a logo and brand colours, and decide how hands-on you want to be. Committing creates the departments, hires the team and drafts the first roadmap." delay={90}>
          <BrandPicker />
        </Step>
        <Step n="03" icon={Play} title="Press Continue" text="Each cycle the Chief of Staff plans the work, agents do it in sandboxes, and your Inbox gets a short note with anything that needs your decision." delay={180}>
          <CyclePlan />
        </Step>
      </ol>
    </Section>
  );
}

function Step({ n, icon, title, text, children, delay }: { n: string; icon: LucideIcon; title: string; text: string; children: ReactNode; delay: number }) {
  return (
    <Reveal as="li" delay={delay}>
      <Glass className="flex h-full flex-col overflow-hidden">
        <div className="relative h-88 overflow-hidden border-b border-subtle bg-ink/70">
          {children}
          <span className="absolute right-3 top-3 z-10">
            <Chip tone="neutral">Example</Chip>
          </span>
        </div>
        <div className="flex flex-col gap-3 p-6">
          <span className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full border" style={{ borderColor: "color-mix(in oklab, var(--kit-primary) 70%, var(--white))", background: "radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--kit-primary) 70%, var(--white)), color-mix(in oklab, var(--kit-primary) 55%, var(--bg-ink)) 75%)" }}>
              <Icon icon={icon} size={16} className="text-kit-on-primary" />
            </span>
            <span className="t-label tabular-nums">Step {n}</span>
          </span>
          <h3 className="t-display-md text-primary">{title}</h3>
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
        <div aria-hidden className="absolute left-1/2 top-10 origin-top-left -translate-x-1/3 rotate-6 opacity-50">
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
