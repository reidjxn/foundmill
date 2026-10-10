import { useId, type CSSProperties } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";

export interface TeamOrbitDepartment {
  name: string;
  dept: DeptColourToken;
  lead: { name: string; seed: string | number };
  workers: ReadonlyArray<{ name: string; seed: string | number }>;
}

export interface TeamOrbitProps {
  /** Centre label (default "You"). */
  centreLabel?: string;
  centreCaption?: string;
  chief?: { name: string; seed: string | number };
  departments?: readonly TeamOrbitDepartment[];
  /** Seconds for one turn of the departments ring; the outer ring turns the other way, slower. */
  periodSeconds?: number;
  className?: string;
}

export const DEFAULT_ORBIT_DEPARTMENTS: readonly TeamOrbitDepartment[] = [
  { name: "Product", dept: "dept-1", lead: { name: "Iris", seed: "iris" }, workers: [{ name: "Mira", seed: "mira" }, { name: "Quill", seed: "quill" }] },
  { name: "Development", dept: "dept-2", lead: { name: "Forge", seed: "forge" }, workers: [{ name: "Juno", seed: "juno" }, { name: "Wren", seed: "wren" }] },
  { name: "Distribution", dept: "dept-3", lead: { name: "Scout", seed: "scout" }, workers: [{ name: "Pike", seed: "pike" }, { name: "Nell", seed: "nell" }] },
  { name: "Finance", dept: "dept-6", lead: { name: "Ledger", seed: "ledger" }, workers: [{ name: "Tally", seed: "tally" }] },
  { name: "Legal", dept: "dept-5", lead: { name: "Lex", seed: "lex" }, workers: [{ name: "Clause", seed: "clause" }] },
  { name: "Team", dept: "dept-8", lead: { name: "Atlas", seed: "atlas" }, workers: [{ name: "Beacon", seed: "beacon" }, { name: "Sol", seed: "sol" }] },
];

const R_CHIEF = 17;
/** How much further out the Chief of Staff's label sits than its portrait (about 30 px at the deck's size). */
const R_CHIEF_LABEL = 7.5;
const R_LEADS = 31;
const R_WORKERS = 44.5;

/** Point on a circle in percent of the square, 0° at the top, clockwise. */
function at(radius: number, angleDeg: number): { left: string; top: string } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return { left: `${r4(50 + Math.cos(a) * radius)}%`, top: `${r4(50 + Math.sin(a) * radius)}%` };
}

/**
 * The team at a glance, for the signed-out landing page: the founder at the centre in the brand colour, the Chief of
 * Staff on the first orbit, each department lead on the second (joined to the centre by a signal in the department
 * colour) and the workers on the outer orbit. The rings turn slowly in opposite directions while every portrait stays
 * upright; under reduced motion everything holds still. Decorative: one accessible name describes the whole picture.
 */
export function TeamOrbit({ centreLabel = "You", centreCaption = "Founder", chief = { name: "Orla", seed: "orla" }, departments = DEFAULT_ORBIT_DEPARTMENTS, periodSeconds = 90, className }: TeamOrbitProps) {
  // Gradient ids are scoped to this instance: the orbit can appear more than once on a page.
  const uid = useId().replace(/:/g, "");
  const n = departments.length;
  const workers = departments.flatMap((d, i) => d.workers.map((w, j) => ({ ...w, dept: d.dept, angle: (360 / n) * i + (j - (d.workers.length - 1) / 2) * (360 / n / 3) + 360 / n / 2 })));
  const spin = (seconds: number, reverse = false): CSSProperties => ({ animationDuration: `${seconds}s`, animationDirection: reverse ? "reverse" : "normal" });
  const workerCount = workers.length;
  const label = `Your team: you at the centre, a Chief of Staff, and ${n} departments with ${n} leads and ${workerCount} agents.`;

  return (
    <div role="img" aria-label={label} className={cn("relative aspect-square w-full select-none", className)} data-team-orbit>
      {/* Glow and orbit guides. */}
      <div aria-hidden className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--kit-primary) 32%, transparent), transparent 72%)" }} />
      <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 100 100">
        {[R_CHIEF, R_LEADS, R_WORKERS].map((r, i) => (
          <circle key={r} cx={50} cy={50} r={r} fill="none" stroke="var(--white)" strokeOpacity={0.1 - i * 0.02} strokeWidth={0.18} strokeDasharray={i === 2 ? "0.4 1.2" : undefined} />
        ))}
      </svg>

      {/* Outer orbit: workers, turning the other way. */}
      <div aria-hidden className="absolute inset-0 animate-orbit" style={spin(periodSeconds * 1.6, true)} data-orbit="workers">
        {workers.map((w) => (
          <span key={String(w.seed)} className="absolute -translate-x-1/2 -translate-y-1/2" style={at(R_WORKERS, w.angle)}>
            <span className="block animate-orbit" style={spin(periodSeconds * 1.6)}>
              <Avatar size={28} name={w.name} agent={{ seed: w.seed, dept: w.dept }} />
            </span>
          </span>
        ))}
      </div>

      {/* Department orbit: leads with signals to the centre. */}
      <div aria-hidden className="absolute inset-0 animate-orbit" style={spin(periodSeconds)} data-orbit="leads">
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100">
          <defs>
            {departments.map((d) => (
              <radialGradient key={d.name} id={`orbit-spoke-${uid}-${d.dept}`} cx="50" cy="50" r={R_LEADS} gradientUnits="userSpaceOnUse">
                <stop offset="0.25" stopColor="var(--kit-primary)" stopOpacity="0.1" />
                <stop offset="1" stopColor={`var(--${d.dept})`} stopOpacity="0.9" />
              </radialGradient>
            ))}
          </defs>
          {departments.map((d, i) => {
            const a = (((360 / n) * i - 90) * Math.PI) / 180;
            const x = Math.round((50 + Math.cos(a) * R_LEADS) * 1e4) / 1e4;
            const y = Math.round((50 + Math.sin(a) * R_LEADS) * 1e4) / 1e4;
            return (
              <g key={d.name}>
                <line x1={50} y1={50} x2={x} y2={y} stroke={`url(#orbit-spoke-${uid}-${d.dept})`} strokeWidth={0.35} strokeLinecap="round" />
                <line x1={50} y1={50} x2={x} y2={y} stroke={`var(--${d.dept})`} strokeOpacity={0.75} strokeWidth={0.45} strokeLinecap="round" strokeDasharray="0.3 2.2" className="animate-signal" style={{ animationDuration: `${2.4 + i * 0.3}s` }} />
              </g>
            );
          })}
        </svg>
        {departments.map((d, i) => (
          <span key={d.name} className="absolute -translate-x-1/2 -translate-y-1/2" style={at(R_LEADS, (360 / n) * i)}>
            <span className="flex animate-orbit flex-col items-center gap-1" style={spin(periodSeconds, true)}>
              <span className="rounded-full p-0.5" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, var(--${d.dept}) 45%, transparent), transparent)` }}>
                <Avatar size={44} name={d.lead.name} agent={{ seed: d.lead.seed, dept: d.dept }} />
              </span>
              <span className="t-label whitespace-nowrap rounded-chip bg-ink/70 px-1.5 py-px" style={{ color: `color-mix(in oklab, var(--${d.dept}) 70%, var(--white))` }}>
                {d.name}
              </span>
            </span>
          </span>
        ))}
      </div>

      {/* First orbit: the Chief of Staff, above the founder. Its label rides on the outer side of the portrait (placed
          further out along the same spoke, then kept upright on its own centre), so as the ring turns the label never
          crosses the founder's "You". */}
      <div aria-hidden className="absolute inset-0 z-10 animate-orbit" style={spin(periodSeconds * 0.7)} data-orbit="chief">
        <span className="absolute -translate-x-1/2 -translate-y-1/2" style={at(R_CHIEF, 30)}>
          <span className="block animate-orbit" style={spin(periodSeconds * 0.7, true)}>
            <Avatar size={36} name={chief.name} agent={{ seed: chief.seed, dept: "dept-1" }} />
          </span>
        </span>
        <span className="absolute -translate-x-1/2 -translate-y-1/2" style={at(R_CHIEF + R_CHIEF_LABEL, 30)} data-orbit-label="chief">
          <span className="block animate-orbit" style={spin(periodSeconds * 0.7, true)}>
            <span className="t-label block whitespace-nowrap rounded-chip bg-ink/70 px-1.5 py-px text-white/80">Chief of Staff</span>
          </span>
        </span>
      </div>

      {/* The founder. */}
      <div aria-hidden className="absolute left-1/2 top-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center">
        <div
          className="absolute inset-0 animate-orbit rounded-full opacity-60"
          style={{ ...spin(20), background: "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--kit-primary) 30%, var(--white)) 80deg, transparent 160deg, transparent 360deg)", maskImage: "radial-gradient(closest-side, transparent 88%, black 90%)" }}
        />
        <div
          className="relative grid size-22 place-items-center rounded-full border"
          style={{ borderColor: "color-mix(in oklab, var(--kit-primary) 70%, var(--white))", background: "radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--kit-primary) 85%, var(--white)), color-mix(in oklab, var(--kit-primary) 60%, var(--bg-ink)) 70%)" }}
        >
          <span className="flex flex-col items-center leading-none">
            <span className="t-display-md text-kit-on-primary">{centreLabel}</span>
            <span className="t-label mt-1 text-kit-on-primary/80">{centreCaption}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
