import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { formatDate, formatNumber } from "../../lib/format";
import { Tooltip } from "../foundation/Tooltip";
import { DEPT_BG } from "./ribbon/OnThisDayCard";
import type { RibbonDepartment, SquadPulseCell } from "./types";

export interface SquadPulseProps {
  departments: readonly RibbonDepartment[];
  /** Seven days, oldest first (DayKeys). */
  days: readonly string[];
  cells: readonly SquadPulseCell[];
  onSelect?: (day: string, hour: number, breakdown: Array<{ department: RibbonDepartment; agentHours: number }>) => void;
  className?: string;
}

interface PulseCell {
  dayIndex: number;
  hour: number;
  total: number;
  /** The department with the most hours in the cell. */
  lead: RibbonDepartment | null;
  breakdown: Array<{ department: RibbonDepartment; agentHours: number }>;
}

/** Fold cells into a 7 × 24 grid, each cell coloured by its leading department. */
export function buildPulseGrid(departments: readonly RibbonDepartment[], cells: readonly SquadPulseCell[]): { grid: PulseCell[][]; max: number } {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const grid: PulseCell[][] = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => ({ dayIndex: d, hour: h, total: 0, lead: null, breakdown: [] })));
  for (const c of cells) {
    const dept = byId.get(c.departmentId);
    const cell = grid[c.dayIndex]?.[c.hour];
    if (!dept || !cell || c.agentHours <= 0) continue;
    cell.total += c.agentHours;
    const existing = cell.breakdown.find((b) => b.department.id === dept.id);
    if (existing) existing.agentHours += c.agentHours;
    else cell.breakdown.push({ department: dept, agentHours: c.agentHours });
  }
  let max = 0;
  for (const row of grid)
    for (const cell of row) {
      cell.breakdown.sort((a, b) => b.agentHours - a.agentHours || a.department.id.localeCompare(b.department.id));
      cell.lead = cell.breakdown[0]?.department ?? null;
      if (cell.total > max) max = cell.total;
    }
  return { grid, max };
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Home's squad pulse (BUILD §11.2, DESIGN §9): a 7 × 24 heatmap of agent activity, each cell in the leading
 * department's colour at activity alpha. Hover (or focus) lists the hours per department; arrow keys move the focus.
 */
export function SquadPulse({ departments, days, cells, onSelect, className }: SquadPulseProps) {
  const { grid, max } = useMemo(() => buildPulseGrid(departments, cells), [departments, cells]);
  const [focus, setFocus] = useState<{ d: number; h: number }>({ d: 6, h: 9 });
  const gridRef = useRef<HTMLDivElement>(null);
  const total = grid.flat().reduce((s, c) => s + c.total, 0);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let { d, h } = focus;
    if (e.key === "ArrowRight") h = Math.min(23, h + 1);
    else if (e.key === "ArrowLeft") h = Math.max(0, h - 1);
    else if (e.key === "ArrowDown") d = Math.min(6, d + 1);
    else if (e.key === "ArrowUp") d = Math.max(0, d - 1);
    else if (e.key === "Home") h = 0;
    else if (e.key === "End") h = 23;
    else return;
    e.preventDefault();
    setFocus({ d, h });
    gridRef.current?.querySelector<HTMLElement>(`[data-pulse-cell='${d}:${h}']`)?.focus();
  };
  return (
    <div className={cn("flex flex-col gap-2", className)} data-squad-pulse>
      <div ref={gridRef} role="grid" aria-label={`Squad pulse: ${formatNumber(total, { maxDigits: 0 })} agent hours over the last 7 days, by hour and department`} aria-rowcount={7} aria-colcount={24} className="flex flex-col gap-px" onKeyDown={onKeyDown}>
        <div role="row" className="flex items-center gap-px pl-12">
          {HOURS.map((h) => (
            <span key={h} role="columnheader" className={cn("flex-1 text-center font-mono text-[10px] leading-3 text-secondary", h % 3 !== 0 && "invisible")} aria-label={`${h}:00`}>
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
        {grid.map((row, d) => (
          <div key={d} role="row" className="flex items-center gap-px">
            <span role="rowheader" className="w-12 shrink-0 pr-2 text-right text-small text-secondary">
              {days[d] ? formatDate(days[d] as string, "EEE") : `Day ${d + 1}`}
            </span>
            {row.map((cell) => {
              const alpha = cell.total <= 0 || max <= 0 ? 0 : 0.15 + 0.85 * Math.min(1, cell.total / max);
              const label = `${days[d] ? formatDate(days[d] as string, "EEE d MMM") : `Day ${d + 1}`} ${String(cell.hour).padStart(2, "0")}:00 — ${cell.total > 0 ? `${formatNumber(cell.total, { maxDigits: 1 })} agent hours` : "no activity"}`;
              const isFocus = focus.d === d && focus.h === cell.hour;
              return (
                <Tooltip
                  key={cell.hour}
                  content={
                    <span className="flex flex-col gap-0.5">
                      <span className="text-body-strong">{label}</span>
                      {cell.breakdown.map((b) => (
                        <span key={b.department.id} className="flex items-center gap-1.5 text-secondary">
                          <span aria-hidden className={cn("inline-block size-1.5 rounded-full", DEPT_BG[b.department.dept])} />
                          {b.department.name}
                          <span className="ml-auto tabular-nums">{formatNumber(b.agentHours, { maxDigits: 1 })}h</span>
                        </span>
                      ))}
                    </span>
                  }
                >
                  <button
                    type="button"
                    role="gridcell"
                    tabIndex={isFocus ? 0 : -1}
                    aria-label={`${label}${cell.lead ? `, mostly ${cell.lead.name}` : ""}`}
                    data-pulse-cell={`${d}:${cell.hour}`}
                    data-lead={cell.lead?.id}
                    className={cn("h-4 flex-1 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-link", cell.total > 0 && cell.lead ? DEPT_BG[cell.lead.dept] : "bg-panel-alt")}
                    style={cell.total > 0 ? { opacity: alpha } : undefined}
                    onFocus={() => setFocus({ d, h: cell.hour })}
                    onClick={() => onSelect?.(days[d] ?? "", cell.hour, cell.breakdown)}
                  />
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-small text-secondary" aria-label="Departments">
        {departments.map((dep) => (
          <li key={dep.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("inline-block size-2 rounded-[2px]", DEPT_BG[dep.dept])} />
            {dep.name}
          </li>
        ))}
        <li className="ml-auto">Cell shade = share of the busiest hour</li>
      </ul>
    </div>
  );
}
