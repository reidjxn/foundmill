"use client";
/**
 * Your team: the six department leads, one at a time. On the left the departments as tabs; on the right the lead's
 * profile from the product (portrait, stars, attribute ratings 1–20 with the change since the last training, traits)
 * and the department's real screens. The tabs advance on their own while the section is on screen until the visitor
 * picks one.
 */
import { useEffect, useState } from "react";
import { Code2, Compass, GraduationCap, Megaphone, Scale, Users, Wallet, type LucideIcon } from "lucide-react";
import { Avatar, Chip, DeptChip, Icon, SkillGrid, StarRating, StatusPill, TraitChips, cn, prefersReducedMotion } from "@foundmill/dugout";
import { MODULE_TABS, type ModuleKey } from "@foundmill/shared";
import { LEADS, type ExampleLead } from "./example";
import { Glass, Reveal, Section, SectionHeading, useSeen } from "./parts";

const ICONS: Record<ModuleKey, LucideIcon> = { product: Compass, development: Code2, distribution: Megaphone, finance: Wallet, legal: Scale, team: Users };
const ADVANCE_MS = 6500;

export function TeamSection() {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(false);
  const [ref, seen] = useSeen<HTMLDivElement>("-20%");
  const lead = LEADS[index]!;

  useEffect(() => {
    if (!seen || picked || prefersReducedMotion()) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % LEADS.length), ADVANCE_MS);
    return () => clearInterval(t);
  }, [seen, picked]);

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
        lede="Every department has a lead agent and the specialists it needs. Each agent has attribute ratings from 1 to 20, earned in tests and on real tasks, and is trained between cycles. Ratings only move with evidence."
      />
      <Reveal>
        <div ref={ref} className="flex flex-col gap-4">
          <div role="tablist" aria-label="Departments" className="grid grid-cols-6 gap-2">
            {LEADS.map((l, i) => {
              const active = i === index;
              return (
                <button
                  key={l.key}
                  type="button"
                  role="tab"
                  id={`team-tab-${l.key}`}
                  aria-selected={active}
                  aria-controls="team-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => choose(i)}
                  onKeyDown={(e) => {
                    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const next = (i + step + LEADS.length) % LEADS.length;
                    choose(next);
                    document.getElementById(`team-tab-${LEADS[next]!.key}`)?.focus();
                  }}
                  className={cn(
                    "group relative flex items-center gap-3 overflow-hidden rounded-panel border px-3 py-3 text-left outline-none transition-colors duration-panel focus-visible:outline-2 focus-visible:outline-link",
                    active ? "border-subtle bg-panel-alt" : "border-subtle/50 bg-panel/40 hover:bg-panel/80",
                  )}
                >
                  <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 transition-opacity duration-panel" style={{ backgroundColor: `var(--${l.dept})`, opacity: active ? 1 : 0 }} />
                  <span className="grid size-9 shrink-0 place-items-center rounded-panel border" style={{ borderColor: `color-mix(in oklab, var(--${l.dept}) ${active ? 60 : 30}%, transparent)`, backgroundColor: `color-mix(in oklab, var(--${l.dept}) ${active ? 18 : 8}%, var(--bg-ink))`, color: `color-mix(in oklab, var(--${l.dept}) 80%, var(--white))` }}>
                    <Icon icon={ICONS[l.key]} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("t-display-sm block truncate", active ? "text-primary" : "text-secondary group-hover:text-primary")}>{l.department}</span>
                    <span className="block truncate text-small text-secondary">{l.name}</span>
                  </span>
                  {active && !picked && seen ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-px origin-left animate-progress" style={{ backgroundColor: `var(--${l.dept})`, animationDuration: `${ADVANCE_MS}ms` }} key={index} /> : null}
                </button>
              );
            })}
          </div>
          <div id="team-panel" role="tabpanel" aria-labelledby={`team-tab-${lead.key}`}>
            <LeadProfile key={lead.key} lead={lead} />
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

function LeadProfile({ lead }: { lead: ExampleLead }) {
  const accent = `var(--${lead.dept})`;
  return (
    <Glass accent={accent} className="relative flex animate-fade-in flex-col overflow-hidden">
      <span aria-hidden className="pointer-events-none absolute -right-32 -top-40 size-112 rounded-full" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 22%, transparent), transparent)` }} />
      <header className="relative flex items-center gap-5 border-b border-subtle/70 px-6 py-5">
        <span className="rounded-full p-1.5" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 50%, transparent), transparent)` }}>
          <Avatar size={64} name={lead.name} agent={{ seed: lead.seed, dept: lead.dept }} status="healthy" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex items-baseline gap-3">
            <span className="t-display-xl text-primary">{lead.name}</span>
            <span className="t-display-md text-secondary">{lead.role}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <DeptChip dept={lead.dept}>{lead.department}</DeptChip>
            <Chip tone="neutral" mono>
              {lead.model}
            </Chip>
            <StatusPill tone="good">Working</StatusPill>
            <span className="ml-1 truncate text-small text-secondary">{lead.now}</span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-2">
          <span className="t-label">Current · potential</span>
          <StarRating value={lead.stars.current} potential={lead.stars.potential} size={20} label="Ability" />
        </span>
      </header>
      <div className="relative flex flex-col gap-3 px-6 pb-2 pt-5">
        <span className="t-label">Attribute ratings · 1 to 20 · change since the last training</span>
        <SkillGrid skills={lead.skills} showPotential />
      </div>
      <div className="relative grid grid-cols-3 gap-6 border-t border-subtle/70 px-6 py-5">
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
          <span className="t-label">{lead.department} screens</span>
          <ul className="flex flex-wrap gap-1.5" aria-label={`${lead.department} screens`}>
            {MODULE_TABS[lead.key].map((t) => (
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
