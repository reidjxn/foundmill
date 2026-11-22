"use client";
/**
 * Your team: the six department leads, one at a time. Across the top the departments as tabs; under them the lead's
 * profile from the product (portrait, stars, attribute ratings 1–20 with the change since the last training, traits)
 * and the department's real screens. The tabs advance on their own while the section is on screen, never under
 * reduced motion; they pause while the pointer or keyboard focus is inside, the Pause button stops them, and picking a
 * tab stops them for good.
 */
import { useEffect, useState } from "react";
import { Code2, Compass, FlaskConical, Gamepad2, GraduationCap, Megaphone, Pause, Play, Scale, Store, Users, Wallet, type LucideIcon } from "lucide-react";
import { Avatar, BuilderViewProvider, Button, Chip, DeptChip, Icon, SkillGrid, StarRating, StatusPill, Term, TraitChips, cn, usePrefersReducedMotion } from "@foundmill/dugout";
import { useExample } from "./examples/context";
import { departmentScreens, leadOf } from "./examples/helpers";
import type { ExampleDepartment, ExampleDepartmentIcon, ExampleLead } from "./examples/types";
import { Glass, Reveal, Section, SectionHeading, useSeen } from "./parts";

const ICONS: Record<ExampleDepartmentIcon, LucideIcon> = { product: Compass, development: Code2, distribution: Megaphone, finance: Wallet, legal: Scale, team: Users, lab: FlaskConical, retail: Store, playtest: Gamepad2 };
const iconFor = (d: ExampleDepartment): LucideIcon => ICONS[d.icon ?? d.module];
const ADVANCE_MS = 6500;

export function TeamSection() {
  const business = useExample();
  const tabs = business.departments.map((department) => ({ department, lead: leadOf(business, department.id) }));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [held, setHeld] = useState({ pointer: false, focus: false });
  const reduced = usePrefersReducedMotion();
  const [ref, seen] = useSeen<HTMLDivElement>("-20%");
  const current = tabs[index] ?? tabs[0]!;
  const touring = seen && !picked && !stopped && !reduced;
  const advancing = touring && !held.pointer && !held.focus;

  useEffect(() => {
    if (!advancing) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % tabs.length), ADVANCE_MS);
    return () => clearInterval(t);
  }, [advancing, tabs.length]);

  const choose = (i: number) => {
    setPicked(true);
    setIndex(i);
  };

  return (
    <Section id="team">
      <SectionHeading
        id="team"
        eyebrow="Your team"
        title="Hire them. Train them. Watch them get better."
        lede={
          <>
            Every department has a lead agent and the specialists it needs. Each agent has attribute ratings from 1 to 20, earned in tests and on real tasks, and is trained between <Term id="cycle">rounds of work</Term>. Ratings only move with evidence.
          </>
        }
      />
      <Reveal>
        <div
          ref={ref}
          className="flex flex-col gap-5"
          onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
          onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
          onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld((h) => ({ ...h, focus: false }));
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-small text-secondary">{business.identity.name}'s department leads</span>
            <span className="flex items-center gap-2">
              <Chip tone="neutral">Example business</Chip>
              {touring ? (
                <Button size="sm" variant="ghost" icon={Pause} onClick={() => setStopped(true)}>
                  Pause tour
                </Button>
              ) : !picked && !reduced && stopped ? (
                <Button size="sm" variant="ghost" icon={Play} onClick={() => setStopped(false)}>
                  Play tour
                </Button>
              ) : null}
            </span>
          </div>
          <div role="tablist" aria-label="Departments" className="grid grid-cols-6 gap-3">
            {tabs.map(({ department: d, lead: l }, i) => {
              const active = i === index;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  id={`team-tab-${d.id}`}
                  aria-selected={active}
                  aria-controls="team-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => choose(i)}
                  onKeyDown={(e) => {
                    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const next = (i + step + tabs.length) % tabs.length;
                    choose(next);
                    document.getElementById(`team-tab-${tabs[next]!.department.id}`)?.focus();
                  }}
                  className={cn(
                    "group relative flex items-center gap-3 overflow-hidden rounded-panel border px-3 py-3 text-left transition-colors duration-panel",
                    active ? "border-subtle bg-panel-alt" : "border-subtle/50 bg-panel/40 hover:bg-panel/80",
                  )}
                >
                  <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 transition-opacity duration-panel" style={{ backgroundColor: `var(--${d.dept})`, opacity: active ? 1 : 0 }} />
                  <span className="grid size-9 shrink-0 place-items-center rounded-panel border" style={{ borderColor: `color-mix(in oklab, var(--${d.dept}) ${active ? 60 : 30}%, transparent)`, backgroundColor: `color-mix(in oklab, var(--${d.dept}) ${active ? 18 : 8}%, var(--bg-ink))`, color: `color-mix(in oklab, var(--${d.dept}) 80%, var(--white))` }}>
                    <Icon icon={iconFor(d)} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("t-display-sm line-clamp-2 break-words", active ? "text-primary" : "text-secondary group-hover:text-primary")}>{d.label}</span>
                    <span className="block truncate text-small text-secondary">{l.name}</span>
                  </span>
                  {active && advancing ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-px origin-left animate-progress" style={{ backgroundColor: `var(--${d.dept})`, animationDuration: `${ADVANCE_MS}ms` }} key={index} /> : null}
                </button>
              );
            })}
          </div>
          <div id="team-panel" role="tabpanel" aria-labelledby={`team-tab-${current.department.id}`}>
            <LeadProfile key={current.department.id} department={current.department} lead={current.lead} />
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

function LeadProfile({ department, lead }: { department: ExampleDepartment; lead: ExampleLead }) {
  const accent = `var(--${department.dept})`;
  return (
    <Glass accent={accent} className="relative flex animate-fade-in flex-col overflow-hidden">
      <span aria-hidden className="pointer-events-none absolute -right-32 -top-40 size-112 rounded-full" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 22%, transparent), transparent)` }} />
      <header className="relative flex items-center gap-5 border-b border-subtle/70 px-8 py-6">
        <span className="rounded-full p-1.5" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 50%, transparent), transparent)` }}>
          <Avatar size={64} name={lead.name} agent={{ seed: lead.seed, dept: department.dept }} status="healthy" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex items-baseline gap-3">
            <span className="t-display-xl text-primary">{lead.name}</span>
            <span className="t-display-md text-secondary">{lead.role}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <DeptChip dept={department.dept}>{department.label}</DeptChip>
            <Chip tone="neutral" mono>
              {lead.model}
            </Chip>
            <StatusPill tone="good">Working</StatusPill>
            <span className="ml-1 truncate text-small text-secondary">{lead.now}</span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-2">
          <span className="t-label">
            Current · <Term id="potential">potential</Term>
          </span>
          <StarRating value={lead.stars.current} potential={lead.stars.potential} size={20} label="Ability" />
        </span>
      </header>
      <div className="relative flex flex-col gap-4 px-8 pb-4 pt-6">
        <span className="t-label">Attribute ratings · 1 to 20 · change since the last training</span>
        {/* The marketing page shows the ratings out of 20 on purpose: Builder view is on for the demo card alone. */}
        <BuilderViewProvider on>
          <SkillGrid skills={lead.skills} showPotential />
        </BuilderViewProvider>
      </div>
      <div className="relative grid grid-cols-3 gap-10 border-t border-subtle/70 px-8 py-6">
        <span className="flex flex-col gap-2">
          <span className="t-label">Traits</span>
          <TraitChips traits={[...lead.traits]} />
        </span>
        <span className="flex flex-col gap-2">
          <span className="t-label">Training</span>
          <span className="inline-flex items-start gap-2 text-body text-primary">
            <Icon icon={GraduationCap} size={16} className="mt-0.5 shrink-0 text-link" />
            {lead.training}
          </span>
          <span className="text-small text-secondary">{lead.remit}</span>
        </span>
        <span className="flex flex-col gap-2">
          <span className="t-label">{department.label} screens</span>
          <ul className="flex flex-wrap gap-1.5" aria-label={`${department.label} screens`}>
            {departmentScreens(department).map((t) => (
              <li key={t.slug}>
                <Chip tone="neutral">{t.title}</Chip>
              </li>
            ))}
          </ul>
        </span>
      </div>
    </Glass>
  );
}
